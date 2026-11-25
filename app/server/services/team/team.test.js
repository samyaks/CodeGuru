'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const members = require('./members');
const committing = require('./committing');
const { checkProjectAccess, checkProjectOwner } = require('../../lib/helpers');
const { loadMemberships } = require('../../lib/memberships');

const { fakeDb, LABELS, NOW } = require('./test-fakes');

const owner = { id: 'owner', email: 'owner@acme.test', email_confirmed_at: 'x', user_metadata: { full_name: 'Olive Owner' } };
const sam = { id: 'sam', email: 'sam@acme.test', email_confirmed_at: 'x', user_metadata: {} };
const eve = { id: 'eve', email: 'eve@evil.test', email_confirmed_at: 'x', user_metadata: {} };

const tokenOf = (out) => out.path.split('/').pop();
// Kim, a second member, for flows where someone else re-invites.
const sam2 = (state) => { state.members.push({ project_id: 'p1', user_id: 'kim', email: 'kim@acme.test', labels: ['builder'] }); return { id: 'kim', email: 'kim@acme.test', email_confirmed_at: 'x' }; };

test('parseInviteTarget accepts emails and GitHub usernames, rejects junk', () => {
  assert.deepStrictEqual(members.parseInviteTarget({ target: ' Sam@Acme.Test ' }), { email: 'sam@acme.test', githubLogin: null });
  assert.deepStrictEqual(members.parseInviteTarget({ target: '@octo-cat' }), { email: null, githubLogin: 'octo-cat' });
  assert.deepStrictEqual(members.parseInviteTarget({ githubLogin: 'octocat' }), { email: null, githubLogin: 'octocat' });
  for (const bad of [{}, { target: '' }, { target: 'a b' }, { target: '-bad' }, { target: 'x@' }, { email: 'no-at' }, { githubLogin: 'a--b' }, { target: 'x'.repeat(40) }]) {
    assert.throws(() => members.parseInviteTarget(bad), /look right|Give an email/, JSON.stringify(bad));
  }
});

test('normalizeLabels needs at least one known label and keeps a fixed order', () => {
  assert.deepStrictEqual(members.normalizeLabels(['Builder', 'creator', 'builder'], LABELS), ['creator', 'builder']);
  assert.throws(() => members.normalizeLabels([], LABELS), /at least one/);
  assert.throws(() => members.normalizeLabels(['admin'], LABELS), /Unknown label/);
  assert.throws(() => members.normalizeLabels('creator', LABELS), /must be a list/);
});

test('an email invite stores only a hash, emails a link back to the invite, and works once for that email', async () => {
  const { state, deps, project } = fakeDb();
  const out = await members.createInvite({ project, user: owner, body: { target: 'sam@acme.test' } }, deps);
  const token = tokenOf(out);
  assert.ok(/^[A-Za-z0-9_-]{43}$/.test(token));
  assert.strictEqual(out.link, `https://takeoff.test/invite/${token}`);
  assert.strictEqual(out.emailSent, true);
  assert.strictEqual(state.invites[0].token_hash, members.hashToken(token));
  assert.ok(!JSON.stringify(state.invites).includes(token), 'the raw token is never stored');
  assert.strictEqual(state.invites[0].invited_by_name, 'Olive Owner');
  assert.deepStrictEqual(state.sent, [{ email: 'sam@acme.test', redirectTo: `https://takeoff.test/auth/callback?next=${encodeURIComponent(`/invite/${token}`)}` }]);

  const signedOut = await members.previewInvite({ token, user: null }, deps);
  assert.strictEqual(signedOut.state, 'open');
  assert.strictEqual(signedOut.invitedFor, 's**@acme.test');
  assert.strictEqual(signedOut.projectName, 'acme/web');
  assert.strictEqual(signedOut.reason, 'signed_out');

  // Someone else signed in can't use it.
  await assert.rejects(members.acceptInvite({ token, user: eve, labels: ['builder'] }, deps), (e) => e.statusCode === 403 && e.code === 'INVITE_MISMATCH');
  // Unconfirmed email doesn't count, and a phone confirmation isn't an email one.
  await assert.rejects(members.acceptInvite({ token, user: { ...sam, email_confirmed_at: null }, labels: ['builder'] }, deps), (e) => e.statusCode === 403);
  await assert.rejects(members.acceptInvite({ token, user: { ...sam, email_confirmed_at: null, confirmed_at: 'x' }, labels: ['builder'] }, deps), (e) => e.statusCode === 403);
  // Labels are required.
  await assert.rejects(members.acceptInvite({ token, user: sam, labels: [] }, deps), /at least one/);

  const joined = await members.acceptInvite({ token, user: sam, labels: ['builder'] }, deps);
  assert.deepStrictEqual(joined, { projectId: 'p1', alreadyMember: false });
  assert.deepStrictEqual(state.members.find((m) => m.user_id === 'sam').labels, ['builder']);

  // Used once: a second person can't reuse it, the member gets a friendly result.
  assert.deepStrictEqual(await members.acceptInvite({ token, user: sam, labels: ['creator'] }, deps), { projectId: 'p1', alreadyMember: true });
  await assert.rejects(members.acceptInvite({ token, user: eve, labels: ['builder'] }, deps), /already been used/);
  const after = await members.previewInvite({ token, user: sam }, deps);
  assert.strictEqual(after.state, 'used');
  assert.strictEqual(after.alreadyMember, true);
});

test('inviting the same address again makes a new link and the old one stops working', async () => {
  const { state, deps, project } = fakeDb();
  const first = await members.createInvite({ project, user: owner, body: { email: 'sam@acme.test' } }, deps);
  // Inside a minute of the email, a new link would kill the one just sent: refused.
  await assert.rejects(members.createInvite({ project, user: owner, body: { email: 'SAM@acme.test' } }, deps), (e) => e.statusCode === 429);
  assert.strictEqual(state.invites[0].token_hash, members.hashToken(tokenOf(first)));
  state.invites[0].last_link_sent_at = '2026-11-25T11:58:00Z';
  const second = await members.createInvite({ project, user: sam2(state), body: { email: 'SAM@acme.test' } }, deps);
  assert.strictEqual(state.invites.length, 1);
  assert.notStrictEqual(tokenOf(first), tokenOf(second));
  assert.strictEqual(second.emailSent, true);
  assert.strictEqual(state.invites[0].invited_by, 'owner', 'the original inviter stays on the invite');
  await assert.rejects(members.previewInvite({ token: tokenOf(first), user: null }, deps), /isn't valid/);
  assert.strictEqual((await members.previewInvite({ token: tokenOf(second), user: null }, deps)).state, 'open');
});

test('a GitHub invite is accepted only by that GitHub account', async () => {
  const { state, deps, project } = fakeDb();
  await assert.rejects(members.createInvite({ project, user: owner, body: { target: '@nobody-here' } }, deps), /no GitHub account named/);
  const out = await members.createInvite({ project, user: owner, body: { target: '@octo' } }, deps);
  assert.strictEqual(out.invite.githubLogin, 'Octo', 'GitHub\'s spelling of the login');
  assert.strictEqual(state.invites[0].github_user_id, 9);
  assert.strictEqual(out.emailSent, false);
  assert.strictEqual(state.sent.length, 0);
  const token = tokenOf(out);
  await assert.rejects(members.acceptInvite({ token, user: sam, labels: ['creator'] }, deps), (e) => e.code === 'GITHUB_NOT_CONNECTED');
  const octoSignin = { id: 'octo', email: 'o@x.test', identities: [{ provider: 'github', identity_data: { user_name: 'octo', provider_id: '9' } }] };
  const imposter = { id: 'imp', email: 'i@x.test', identities: [{ provider: 'github', identity_data: { user_name: 'octo-2', provider_id: '10' } }] };
  await assert.rejects(members.acceptInvite({ token, user: imposter, labels: ['creator'] }, deps), (e) => e.code === 'INVITE_MISMATCH');
  // Someone now holding the login "octo" but a different account (a rename and reuse) is refused.
  const reused = { id: 'reuse', email: 'r@x.test', identities: [{ provider: 'github', identity_data: { user_name: 'octo', provider_id: '555' } }] };
  await assert.rejects(members.acceptInvite({ token, user: reused, labels: ['creator'] }, deps), (e) => e.code === 'INVITE_MISMATCH');
  // user_metadata is editable by the user, so it never proves a GitHub login.
  const spoof = { id: 'spoof', email: 's@x.test', app_metadata: { provider: 'github' }, user_metadata: { user_name: 'octo', provider_id: '9' } };
  await assert.rejects(members.acceptInvite({ token, user: spoof, labels: ['creator'] }, deps), (e) => e.code === 'GITHUB_NOT_CONNECTED');
  assert.strictEqual((await members.previewInvite({ token, user: octoSignin }, deps)).matches, true);
  assert.deepStrictEqual(await members.acceptInvite({ token, user: octoSignin, labels: ['creator', 'builder'] }, deps), { projectId: 'p1', alreadyMember: false });
  await assert.rejects(members.requestSignInLink({ token }, deps), /can't be used/);
});

test('invites expire after 14 days and can be cancelled by the owner or the inviter only', async () => {
  const { deps, project, state } = fakeDb();
  state.members.push({ project_id: 'p1', user_id: 'sam', email: 'sam@acme.test', labels: ['builder'] });
  state.members.push({ project_id: 'p1', user_id: 'kim', email: 'kim@acme.test', labels: ['builder'] });
  const kim = { id: 'kim', email: 'kim@acme.test', email_confirmed_at: 'x' };
  const out = await members.createInvite({ project, user: sam, body: { email: 'new@acme.test' } }, deps);
  assert.strictEqual(out.invite.expiresAt, new Date(NOW.getTime() + 14 * 86400000).toISOString());
  await assert.rejects(members.revokeInvite({ project, user: kim, inviteId: out.invite.id }, deps), (e) => e.statusCode === 403);
  assert.deepStrictEqual(await members.revokeInvite({ project, user: sam, inviteId: out.invite.id }, deps), { revoked: true });
  assert.strictEqual((await members.previewInvite({ token: tokenOf(out), user: null }, deps)).state, 'revoked');

  const late = await members.createInvite({ project, user: owner, body: { email: 'late@acme.test' } }, deps);
  state.invites.find((i) => i.id === late.invite.id).expires_at = '2026-11-25T11:59:59Z';
  assert.strictEqual((await members.previewInvite({ token: tokenOf(late), user: null }, deps)).state, 'expired');
  await assert.rejects(members.acceptInvite({ token: tokenOf(late), user: { id: 'l', email: 'late@acme.test', email_confirmed_at: 'x' }, labels: ['builder'] }, deps), /expired/);
});

test('only members invite; you cannot invite yourself or someone already on the project', async () => {
  const { deps, project, state } = fakeDb();
  await assert.rejects(members.createInvite({ project, user: eve, body: { email: 'x@y.test' } }, deps), (e) => e.statusCode === 403);
  await assert.rejects(members.createInvite({ project, user: owner, body: { email: 'owner@acme.test' } }, deps), /That's you/);
  state.members.push({ project_id: 'p1', user_id: 'sam', email: 'sam@acme.test', labels: ['builder'] });
  await assert.rejects(members.createInvite({ project, user: owner, body: { email: 'Sam@acme.test' } }, deps), (e) => e.statusCode === 409);
});

test('sign-in links go only to the invite email, at most once a minute', async () => {
  const { deps, project, state } = fakeDb();
  const out = await members.createInvite({ project, user: owner, body: { email: 'sam@acme.test' } }, deps);
  state.invites[0].last_link_sent_at = '2026-11-25T11:58:00Z';
  assert.deepStrictEqual(await members.requestSignInLink({ token: tokenOf(out) }, deps), { sent: true, to: 's**@acme.test' });
  assert.strictEqual(state.sent.at(-1).email, 'sam@acme.test');
  await assert.rejects(members.requestSignInLink({ token: tokenOf(out) }, deps), (e) => e.statusCode === 429);
  await assert.rejects(members.requestSignInLink({ token: 'short' }, deps), (e) => e.statusCode === 404);
});

test('team view lists the owner first with an owner row made on first use; labels are editable', async () => {
  const { deps, project, state } = fakeDb();
  state.members.push({ project_id: 'p1', user_id: 'sam', email: 'sam@acme.test', labels: ['builder'], joined_at: '2026-11-20T00:00:00Z' });
  const seenBySam = await members.getTeam({ project, user: sam }, deps);
  assert.strictEqual(seenBySam.members[0].isOwner, true);
  assert.strictEqual(seenBySam.members[0].userId, 'owner');
  assert.strictEqual(seenBySam.you.isOwner, false);
  assert.deepStrictEqual(seenBySam.you.labels, ['builder']);

  const seenByOwner = await members.getTeam({ project, user: owner }, deps);
  assert.strictEqual(seenByOwner.members[0].name, 'Olive Owner');
  assert.ok(state.members.some((m) => m.user_id === 'owner'));
  const mine = await members.setMyLabels({ project, user: owner, labels: ['creator'] }, deps);
  assert.deepStrictEqual(mine.labels, ['creator']);
  await assert.rejects(members.getTeam({ project, user: eve }, deps), (e) => e.statusCode === 403);
});

test('the owner removes members, members can leave, nobody removes the owner', async () => {
  const { deps, project, state } = fakeDb();
  state.members.push({ project_id: 'p1', user_id: 'sam', labels: ['builder'] }, { project_id: 'p1', user_id: 'kim', labels: ['builder'] });
  await assert.rejects(members.removeMember({ project, user: sam, memberId: 'kim' }, deps), (e) => e.statusCode === 403);
  await assert.rejects(members.removeMember({ project, user: sam, memberId: 'owner' }, deps), /can't be removed/);
  const sent = await members.createInvite({ project, user: sam, body: { email: 'friend@acme.test' } }, deps);
  assert.deepStrictEqual(await members.removeMember({ project, user: sam, memberId: 'sam' }, deps), { removed: true });
  assert.strictEqual((await members.previewInvite({ token: tokenOf(sent), user: null }, deps)).state, 'revoked', 'their open invites stop working');
  assert.deepStrictEqual(await members.removeMember({ project, user: owner, memberId: 'kim' }, deps), { removed: true });
});

test('accepting as the owner sets labels without using the invite', async () => {
  const { deps, project, state } = fakeDb();
  const out = await members.createInvite({ project, user: owner, body: { email: 'sam@acme.test' } }, deps);
  assert.deepStrictEqual(await members.acceptInvite({ token: tokenOf(out), user: owner, labels: ['creator'] }, deps), { projectId: 'p1', alreadyMember: true });
  assert.strictEqual(state.invites[0].accepted_at, null);
});

test('a failed send can be retried straight away', async () => {
  const { deps, project, state } = fakeDb();
  deps.sendSignInLink = async () => { throw new Error('smtp down'); };
  const warn = console.warn; console.warn = () => {};
  try {
    const out = await members.createInvite({ project, user: owner, body: { email: 'sam@acme.test' } }, deps);
    assert.deepStrictEqual([out.emailSent, out.emailError], [false, 'send_failed']);
    assert.strictEqual(state.invites[0].last_link_sent_at, null);
  } finally { console.warn = warn; }
});

test('appUrlFromEnv prefers TAKEOFF_APP_URL, then FRONTEND_URL, then the Supabase redirect origin', () => {
  assert.strictEqual(members.appUrlFromEnv({ TAKEOFF_APP_URL: 'https://a.test/', FRONTEND_URL: 'https://b.test' }), 'https://a.test');
  assert.strictEqual(members.appUrlFromEnv({ FRONTEND_URL: 'https://b.test' }), 'https://b.test');
  assert.strictEqual(members.appUrlFromEnv({ SUPABASE_REDIRECT_URL: 'https://c.test/auth/callback' }), 'https://c.test');
  assert.strictEqual(members.appUrlFromEnv({ NODE_ENV: 'production' }), null);
  assert.strictEqual(members.appUrlFromEnv({}), 'http://localhost:3000');
});

// ── Committing actions ──────────────────────────────────────────────

function committingDeps(db, permissions) {
  const calls = [];
  return {
    calls,
    deps: {
      recommendations: db.deps.recommendations,
      userGithubLinks: db.deps.userGithubLinks,
      newId: db.deps.newId,
      clientForInstallation: (id, repo) => ({
        async fetchCollaboratorPermission(owner, r, login) {
          calls.push({ id, repo, owner, r, login });
          return permissions[login.toLowerCase()] || { permission: 'none', canPush: false, githubUserId: null };
        },
      }),
    },
  };
}

test('a member without write access gets a recommendation; a member with write access confirms it once', async () => {
  const db = fakeDb();
  const ran = [];
  committing.registerCommittingAction('test.commit_note', {
    summarize: (p) => `Commit the note "${p.text}"`,
    run: async ({ project, payload, actor }) => { ran.push({ project: project.id, payload, actor }); return { sha: 'abc' }; },
  });
  await db.deps.userGithubLinks.upsert('sam', { githubUserId: 5, githubLogin: 'sam-gh' });
  await db.deps.userGithubLinks.upsert('owner', { githubUserId: 1, githubLogin: 'olive' });
  const { deps, calls } = committingDeps(db, {
    'sam-gh': { permission: 'read', canPush: false, githubUserId: 5 },
    olive: { permission: 'custom-release-role', canPush: true, githubUserId: 1 },
  });

  // No GitHub connected at all: still recorded, and says why.
  const anon = await committing.performCommittingAction({ project: db.project, user: { id: 'kim' }, type: 'test.commit_note', payload: { text: 'hi' } }, deps);
  assert.strictEqual(anon.status, 'recommended');
  assert.strictEqual(anon.githubConnected, false);
  assert.strictEqual(anon.reason, 'github_not_connected');

  const rec = await committing.performCommittingAction({ project: db.project, user: sam, type: 'test.commit_note', payload: { text: 'ship it' } }, deps);
  assert.strictEqual(rec.status, 'recommended');
  assert.strictEqual(rec.reason, 'no_write_access');
  assert.strictEqual(rec.recommendation.summary, 'Commit the note "ship it"');
  assert.strictEqual(ran.length, 0, 'nothing was committed');
  assert.deepStrictEqual(calls[0], { id: 77, repo: 'web', owner: 'acme', r: 'web', login: 'sam-gh' });

  // Sam can't confirm their own recommendation without write access.
  await assert.rejects(committing.confirmRecommendation({ project: db.project, user: sam, recommendationId: rec.recommendation.id }, deps), (e) => e.code === 'GITHUB_WRITE_REQUIRED');
  await assert.rejects(committing.confirmRecommendation({ project: db.project, user: { id: 'kim' }, recommendationId: rec.recommendation.id }, deps), (e) => e.code === 'GITHUB_NOT_CONNECTED');

  const done = await committing.confirmRecommendation({ project: db.project, user: owner, recommendationId: rec.recommendation.id }, deps);
  assert.strictEqual(done.status, 'confirmed');
  assert.deepStrictEqual(ran, [{ project: 'p1', payload: { text: 'ship it' }, actor: { userId: 'owner', githubLogin: 'olive' } }]);
  await assert.rejects(committing.confirmRecommendation({ project: db.project, user: owner, recommendationId: rec.recommendation.id }, deps), (e) => e.statusCode === 409);

  // With write access the action just runs.
  const direct = await committing.performCommittingAction({ project: db.project, user: owner, type: 'test.commit_note', payload: { text: 'now' } }, deps);
  assert.deepStrictEqual(direct, { status: 'done', result: { sha: 'abc' } });

  // Dismissed recommendations can't be confirmed later. Only the recommender
  // or someone with write access may dismiss.
  const rec2 = await committing.performCommittingAction({ project: db.project, user: sam, type: 'test.commit_note', payload: { text: 'maybe' } }, deps);
  await assert.rejects(committing.dismissRecommendation({ project: db.project, user: { id: 'kim' }, recommendationId: rec2.recommendation.id }, deps), (e) => e.statusCode === 403);
  assert.strictEqual((await committing.dismissRecommendation({ project: db.project, user: sam, recommendationId: rec2.recommendation.id }, deps)).status, 'dismissed');
  await assert.rejects(committing.confirmRecommendation({ project: db.project, user: owner, recommendationId: rec2.recommendation.id }, deps), (e) => e.statusCode === 409);
  committing._actions.delete('test.commit_note');
});

test('a failed run marks the recommendation failed; a renamed GitHub login held by another account is refused', async () => {
  const db = fakeDb();
  committing.registerCommittingAction('test.boom', { summarize: () => 'Boom', run: async () => { throw new Error('GitHub said no'); } });
  await db.deps.userGithubLinks.upsert('owner', { githubUserId: 1, githubLogin: 'olive' });
  await db.deps.userGithubLinks.upsert('sam', { githubUserId: 5, githubLogin: 'sam-gh' });
  const { deps } = committingDeps(db, {
    olive: { permission: 'admin', canPush: true, githubUserId: 1 },
    'sam-gh': { permission: 'write', canPush: true, githubUserId: 999 },
  });
  const changed = await committing.writeAccess(db.project, sam, deps);
  assert.deepStrictEqual([changed.canWrite, changed.reason], [false, 'github_account_changed']);

  const rec = await db.deps.recommendations.create({ id: 'r1', projectId: 'p1', actionType: 'test.boom', payload: {}, summary: 'Boom', createdBy: 'sam' });
  await assert.rejects(committing.confirmRecommendation({ project: db.project, user: owner, recommendationId: rec.id }, deps), /GitHub said no/);
  assert.strictEqual(db.state.recs[0].status, 'pending', 'stays on the list to try again');
  assert.strictEqual(db.state.recs[0].error, 'GitHub said no');

  await assert.rejects(committing.performCommittingAction({ project: db.project, user: owner, type: 'nope' }, deps), /Unknown action/);
  assert.throws(() => committing.registerCommittingAction('Bad Type', { summarize() {}, run() {} }), /bad action type/);
  committing._actions.delete('test.boom');
});

test('a run that succeeds is never run twice, even if saving the result fails; the owner can always dismiss', async () => {
  const db = fakeDb();
  let runs = 0;
  committing.registerCommittingAction('test.once', { summarize: () => 'Once', run: async () => { runs += 1; return { sha: 'x' }; } });
  await db.deps.userGithubLinks.upsert('kim', { githubUserId: 3, githubLogin: 'kim-gh' });
  const { deps } = committingDeps(db, { 'kim-gh': { permission: 'write', canPush: true, githubUserId: 3 } });
  const brokenDeps = { ...deps, recommendations: { ...deps.recommendations, finish: async () => { throw new Error('db down'); } } };
  const rec = await db.deps.recommendations.create({ id: 'r9', projectId: 'p1', actionType: 'test.once', payload: {}, summary: 'Once', createdBy: 'sam' });
  await assert.rejects(committing.confirmRecommendation({ project: db.project, user: { id: 'kim' }, recommendationId: rec.id }, brokenDeps), /db down/);
  assert.strictEqual(runs, 1);
  assert.strictEqual(db.state.recs.find((r) => r.id === 'r9').status, 'confirming', 'not put back to pending');
  await assert.rejects(committing.confirmRecommendation({ project: db.project, user: { id: 'kim' }, recommendationId: rec.id }, deps), (e) => e.statusCode === 409);
  assert.strictEqual(runs, 1, 'ran once');

  // The owner dismisses without GitHub; anyone else gets a 503, not a 500, when GitHub can't be asked.
  const rec2 = await db.deps.recommendations.create({ id: 'r10', projectId: 'p1', actionType: 'test.once', payload: {}, summary: 'Once', createdBy: 'sam' });
  const downDeps = { ...deps, clientForInstallation: () => ({ fetchCollaboratorPermission: async () => { throw new Error('GitHub down'); } }) };
  const warn = console.warn; console.warn = () => {};
  try {
    await assert.rejects(committing.dismissRecommendation({ project: db.project, user: { id: 'kim' }, recommendationId: rec2.id }, downDeps), (e) => e.statusCode === 503);
  } finally { console.warn = warn; }
  assert.strictEqual((await committing.dismissRecommendation({ project: db.project, user: owner, recommendationId: rec2.id }, downDeps)).status, 'dismissed');
  committing._actions.delete('test.once');
});

test('when GitHub can\'t be asked, the change is kept as a recommendation', async () => {
  const db = fakeDb();
  committing.registerCommittingAction('test.keep', { summarize: () => 'Keep', run: async () => { throw new Error('must not run'); } });
  await db.deps.userGithubLinks.upsert('owner', { githubUserId: 1, githubLogin: 'olive' });
  const deps = { ...committingDeps(db, {}).deps, clientForInstallation: () => ({ fetchCollaboratorPermission: async () => { throw new Error('token mint failed'); } }) };
  const warn = console.warn; console.warn = () => {};
  try {
    const out = await committing.performCommittingAction({ project: db.project, user: owner, type: 'test.keep' }, deps);
    assert.deepStrictEqual([out.status, out.reason, out.githubConnected], ['recommended', 'github_check_failed', true]);
  } finally { console.warn = warn; committing._actions.delete('test.keep'); }
});

test('no App installation on the project means no write access, with a reason', async () => {
  const db = fakeDb();
  await db.deps.userGithubLinks.upsert('owner', { githubUserId: 1, githubLogin: 'olive' });
  const { deps } = committingDeps(db, {});
  const access = await committing.writeAccess({ ...db.project, github_installation_id: null }, owner, deps);
  assert.deepStrictEqual([access.canWrite, access.reason, access.githubConnected], [false, 'app_not_installed', true]);
});

// ── Access checks ───────────────────────────────────────────────────

test('checkProjectAccess lets the owner and members in; checkProjectOwner only the owner', () => {
  const project = { id: 'p1', user_id: 'owner' };
  const as = (user, ids = []) => ({ user, memberProjectIds: new Set(ids) });
  assert.doesNotThrow(() => checkProjectAccess(project, as({ id: 'owner' })));
  assert.doesNotThrow(() => checkProjectAccess(project, as({ id: 'sam' }, ['p1'])));
  assert.throws(() => checkProjectAccess(project, as({ id: 'sam' }, ['p2'])), /Forbidden/);
  assert.throws(() => checkProjectAccess(project, { user: null }), /Forbidden/);
  assert.throws(() => checkProjectAccess(project, { user: { id: 'sam' } }), /Forbidden/, 'no membership loaded means no member access');
  assert.doesNotThrow(() => checkProjectAccess({ id: 'pub', user_id: null }, { user: null }));
  assert.doesNotThrow(() => checkProjectOwner(project, as({ id: 'owner' })));
  assert.throws(() => checkProjectOwner(project, as({ id: 'sam' }, ['p1'])), /Only the project owner/);
});

test('the memberships middleware loads project ids and fails closed', async () => {
  const run = async (mw, req) => { await new Promise((resolve) => mw(req, {}, resolve)); return req; };
  const ok = await run(loadMemberships({ projectIdsForUser: async () => ['p1', 2] }), { user: { id: 'sam' } });
  assert.deepStrictEqual([...ok.memberProjectIds], ['p1', '2']);
  const anon = await run(loadMemberships({ projectIdsForUser: async () => { throw new Error('should not run'); } }), {});
  assert.strictEqual(anon.memberProjectIds.size, 0);
  const warn = console.warn; console.warn = () => {};
  try {
    const failed = await run(loadMemberships({ projectIdsForUser: async () => { throw new Error('db down'); } }), { user: { id: 'sam' } });
    assert.strictEqual(failed.memberProjectIds.size, 0);
  } finally { console.warn = warn; }
});
