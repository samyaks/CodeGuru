'use strict';

// Milestone 3: async agreements, end to end against in-memory stores and a
// fake GitHub repo.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { validateText, AGENT_FILE_PATHS } = require('@takeoff/cli');
const svc = require('./index');
const notify = require('./notify');
const committing = require('../team/committing');

const { setup, T0, HOUR } = require('./test-fakes');

beforeEach(() => svc._resetRegistration());

test('two members propose and agree; the agreement is committed with the agent files and co-author trailers', async () => {
  const { project, repo, state, deps, people } = setup();
  const { agreement: proposed } = await svc.propose({ project, user: people.olive, body: { text: '  Ship dark mode   before pricing. ', areaId: 'billing', source: 'https://docs.acme.test/x' } }, deps);
  assert.strictEqual(proposed.status, 'proposed');
  assert.deepStrictEqual(proposed.waitingOn.map((w) => w.userId), ['owner']);
  assert.strictEqual(proposed.you.vote, 'agree');
  assert.match(proposed.id, /^agr_2026_11_25_ship_dark_mode_before_r\d+$/);
  // The owner was told; the proposer wasn't.
  assert.deepStrictEqual(state.outbox.map((o) => o.recipient_email), ['sam@acme.test']);
  assert.strictEqual(state.outbox[0].link, 'https://takeoff.test/read/p1');

  const { agreement } = await svc.vote({ project, user: people.owner, agreementId: proposed.id, body: { vote: 'agree' } }, deps);
  assert.strictEqual(agreement.status, 'accepted');
  assert.strictEqual(agreement.decidedVia, 'everyone_agreed');
  assert.strictEqual(agreement.commit.state, 'committed');
  assert.match(agreement.commit.url, /^https:\/\/github\.com\/acme\/web\/commit\/c\d+$/);

  // takeoff.yaml has the entry, kept its comment, and still validates.
  const yaml = repo.files['takeoff.yaml'];
  assert.ok(yaml.startsWith('# Keep this comment.'));
  assert.strictEqual(validateText(yaml).issues.filter((i) => i.severity === 'error').length, 0);
  const entry = validateText(yaml).data.agreements[0];
  assert.strictEqual(entry.id, proposed.id);
  assert.strictEqual(entry.area, 'billing');
  assert.strictEqual(entry.agreed_on, '2026-11-25');
  assert.deepStrictEqual([...entry.agreed_by].sort(), ['olive@acme.test', 'sam@acme.test']);
  assert.strictEqual(entry.text, 'Ship dark mode before pricing.');
  assert.strictEqual(entry.source, 'https://docs.acme.test/x');
  // Agent files regenerated in the same commit.
  for (const p of AGENT_FILE_PATHS) assert.ok(repo.files[p] && repo.files[p].includes('Ship dark mode before pricing.'), p);
  // One commit, with the message and trailers.
  assert.strictEqual(repo.log.length, 1);
  const msg = repo.log[0];
  assert.ok(msg.startsWith(`takeoff: agreement ${proposed.id} — Ship dark mode before pricing.`));
  assert.ok(msg.includes('Co-authored-by: olivegh <12+olivegh@users.noreply.github.com>'));
  assert.ok(msg.includes('Co-authored-by: samgh <11+samgh@users.noreply.github.com>'));
  // Everyone hears it was agreed.
  assert.strictEqual(state.outbox.filter((o) => o.kind === 'agreement_accepted').length, 2);
});

test('committing twice is safe: an agreement already in takeoff.yaml is not added again', async () => {
  const { project, repo, state, deps, people } = setup();
  const { agreement: p } = await svc.propose({ project, user: people.olive, body: { text: 'Use UTC everywhere.' } }, deps);
  await svc.vote({ project, user: people.owner, agreementId: p.id, body: { vote: 'agree' } }, deps);
  assert.strictEqual(repo.log.length, 1);
  // Pretend the row lost its outcome (a crash after the push) and run again.
  const row = state.agreements[0];
  row.commit_state = 'failed';
  const out = await svc.retryCommit({ project, user: people.owner, agreementId: p.id }, deps);
  assert.strictEqual(out.agreement.commit.state, 'committed');
  assert.strictEqual(repo.log.length, 1);
  assert.strictEqual(validateText(repo.files['takeoff.yaml']).data.agreements.length, 1);
});

test('a protected default branch gets a small pull request', async () => {
  const { project, repo, deps, people } = setup({ repoOpts: { protectedBranch: true } });
  const { agreement: p } = await svc.propose({ project, user: people.olive, body: { text: 'Feature flags for every launch.' } }, deps);
  const { agreement } = await svc.vote({ project, user: people.owner, agreementId: p.id, body: { vote: 'agree' } }, deps);
  assert.strictEqual(agreement.commit.state, 'pr_opened');
  assert.strictEqual(agreement.commit.prUrl, 'https://github.com/acme/web/pull/1');
  assert.strictEqual(repo.pulls[0].head, `takeoff/${p.id}`);
  assert.strictEqual(repo.pulls[0].base, 'main');
  assert.strictEqual(repo.head, 'c0'); // main untouched
});

test('when the branch moves under the commit, it retries on the new head', async () => {
  const { project, repo, deps, people } = setup({ repoOpts: { moveTimes: 2 } });
  const { agreement: p } = await svc.propose({ project, user: people.olive, body: { text: 'Retry me.' } }, deps);
  const { agreement } = await svc.vote({ project, user: people.owner, agreementId: p.id, body: { vote: 'agree' } }, deps);
  assert.strictEqual(agreement.commit.state, 'committed');
  assert.strictEqual(repo.log.length, 1);
});

test('a branch that keeps moving leaves the commit failed with a plain reason and a retry', async () => {
  const { project, deps, people } = setup({ repoOpts: { moveTimes: 5 } });
  const { agreement: p } = await svc.propose({ project, user: people.olive, body: { text: 'Retry me.' } }, deps);
  const { agreement } = await svc.vote({ project, user: people.owner, agreementId: p.id, body: { vote: 'agree' } }, deps);
  assert.strictEqual(agreement.status, 'accepted');
  assert.strictEqual(agreement.commit.state, 'failed');
  assert.match(agreement.commit.error, /kept changing/);
  assert.strictEqual(agreement.you.canRetryCommit, true);
});

test('a member without write access completes the vote: a recommendation waits for someone who can write', async () => {
  const { project, repo, state, deps, people } = setup();
  const { agreement: p } = await svc.propose({ project, user: people.owner, body: { text: 'Owner proposes.' } }, deps);
  const { agreement } = await svc.vote({ project, user: people.olive, agreementId: p.id, body: { vote: 'agree' } }, deps);
  assert.strictEqual(agreement.status, 'accepted');
  assert.strictEqual(agreement.commit.state, 'waiting_for_write');
  assert.strictEqual(repo.log.length, 0);
  assert.strictEqual(state.recs.length, 1);
  assert.strictEqual(state.recs[0].action_type, svc.COMMIT_ACTION);
  // The owner, who can write, confirms it in one click.
  await committing.confirmRecommendation({ project, user: people.owner, recommendationId: state.recs[0].id }, deps.committing);
  assert.strictEqual(repo.log.length, 1);
  assert.strictEqual(state.agreements[0].commit_state, 'committed');
});

test('"Not yet" needs a comment, blocks acceptance and tells the proposer', async () => {
  const { project, state, deps, people } = setup();
  const { agreement: p } = await svc.propose({ project, user: people.olive, body: { text: 'Drop IE.' } }, deps);
  await assert.rejects(svc.vote({ project, user: people.owner, agreementId: p.id, body: { vote: 'not_yet' } }, deps), /what's missing/);
  const { agreement } = await svc.vote({ project, user: people.owner, agreementId: p.id, body: { vote: 'not_yet', comment: 'Check analytics first.' } }, deps);
  assert.strictEqual(agreement.status, 'proposed');
  const toProposer = state.outbox.filter((o) => o.kind === 'agreement_not_yet');
  assert.deepStrictEqual(toProposer.map((o) => o.recipient_email), ['olive@acme.test']);
  // Even after 48 hours a "Not yet" keeps it with the team.
  state.now = new Date(T0.getTime() + 49 * HOUR);
  await assert.rejects(svc.decide({ project, user: people.owner, agreementId: p.id, body: { outcome: 'accept', note: 'Moving on.' } }, deps), /Not yet/);
});

test('after 48 hours with no "Not yet", an area Creator can decide alone, and it is logged', async () => {
  const { project, repo, state, deps, people } = setup({ members: ['owner', 'olive', 'rex'] });
  const { agreement: p } = await svc.propose({ project, user: people.olive, body: { text: 'Annual plan at 20% off.', areaId: 'billing' } }, deps);
  await assert.rejects(svc.decide({ project, user: people.owner, agreementId: p.id, body: { outcome: 'accept', note: 'x' } }, deps), /48 hours/);
  state.now = new Date(T0.getTime() + 48 * HOUR + 1000);

  // Olive isn't a Creator of billing.
  const list = await svc.listAgreements({ project, user: people.olive }, deps);
  assert.strictEqual(list.agreements[0].stalled, true);
  assert.strictEqual(list.agreements[0].you.canDecide, false);
  assert.strictEqual(list.agreements[0].you.decideReason, 'not_area_creator');
  await assert.rejects(svc.decide({ project, user: people.olive, agreementId: p.id, body: { outcome: 'accept', note: 'x' } }, deps), /Creator/);

  await assert.rejects(svc.decide({ project, user: people.owner, agreementId: p.id, body: { outcome: 'accept' } }, deps), /why/);
  const logs = [];
  const orig = console.log;
  console.log = (line) => logs.push(line);
  let out;
  try {
    out = await svc.decide({ project, user: people.owner, agreementId: p.id, body: { outcome: 'accept', note: 'Rex is away this week.' } }, deps);
  } finally { console.log = orig; }
  assert.strictEqual(out.agreement.status, 'accepted');
  assert.strictEqual(out.agreement.decidedVia, 'stall_fallback');
  assert.strictEqual(out.agreement.decisionNote, 'Rex is away this week.');
  assert.strictEqual(out.agreement.commit.state, 'committed');
  const logged = logs.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((l) => l?.event === 'agreement_decided_alone');
  assert.deepStrictEqual(logged, { event: 'agreement_decided_alone', projectId: 'p1', agreementId: p.id, outcome: 'accept', decidedBy: 'owner' });
  // Only the people who agreed are recorded as agreeing (not Rex).
  assert.deepStrictEqual([...validateText(repo.files['takeoff.yaml']).data.agreements[0].agreed_by].sort(), ['olive@acme.test', 'sam@acme.test']);
});

test('with no area, deciding alone needs write access to the repo', async () => {
  const { project, state, deps, people } = setup({ members: ['owner', 'olive', 'rex'] });
  const { agreement: p } = await svc.propose({ project, user: people.owner, body: { text: 'No area here.' } }, deps);
  state.now = new Date(T0.getTime() + 49 * HOUR);
  await assert.rejects(svc.decide({ project, user: people.olive, agreementId: p.id, body: { outcome: 'decline', note: 'x' } }, deps), /write access/);
  const out = await svc.decide({ project, user: people.owner, agreementId: p.id, body: { outcome: 'decline', note: 'Not needed.' } }, deps);
  assert.strictEqual(out.agreement.status, 'declined');
  assert.strictEqual(out.agreement.commit.state, 'none');
});

test('only members see or act on agreements; only the proposer withdraws', async () => {
  const { project, deps, people } = setup();
  await assert.rejects(svc.listAgreements({ project, user: people.rex }, deps), /Forbidden/);
  const { agreement: p } = await svc.propose({ project, user: people.olive, body: { text: 'Withdraw me.' } }, deps);
  await assert.rejects(svc.withdraw({ project, user: people.owner, agreementId: p.id }, deps), /proposed it/);
  const { agreement } = await svc.withdraw({ project, user: people.olive, agreementId: p.id }, deps);
  assert.strictEqual(agreement.status, 'withdrawn');
  await assert.rejects(svc.vote({ project, user: people.owner, agreementId: p.id, body: { vote: 'agree' } }, deps), /already decided/);
  await assert.rejects(svc.propose({ project, user: people.olive, body: { text: 'x', source: 'javascript:alert(1)' } }, deps), /http/);
  await assert.rejects(svc.propose({ project, user: people.olive, body: { text: 'x', areaId: 'nope' } }, deps), /not in takeoff.yaml/);
});

test('someone leaving can complete a proposal: settling after they leave accepts it; listing alone changes nothing', async () => {
  const { project, deps, people, memberRows } = setup({ members: ['owner', 'olive', 'rex'] });
  const { agreement: p } = await svc.propose({ project, user: people.olive, body: { text: 'Settle on leave.' } }, deps);
  await svc.vote({ project, user: people.owner, agreementId: p.id, body: { vote: 'agree' } }, deps);
  memberRows.splice(memberRows.findIndex((m) => m.user_id === 'rex'), 1);
  const before = await svc.listAgreements({ project, user: people.owner }, deps);
  assert.strictEqual(before.agreements[0].status, 'proposed', 'a GET does not change anything');
  assert.strictEqual(await svc.settleOpen({ project, actor: people.owner }, deps), 1);
  const list = await svc.listAgreements({ project, user: people.owner }, deps);
  assert.strictEqual(list.agreements[0].status, 'accepted');
  assert.strictEqual(list.agreements[0].commit.state, 'committed');
});

test('a commit stuck in "committing" can be retried after 10 minutes, and the re-run adds nothing twice', async () => {
  const { project, repo, state, deps, people } = setup();
  const { agreement: p } = await svc.propose({ project, user: people.olive, body: { text: 'Crash after push.' } }, deps);
  await svc.vote({ project, user: people.owner, agreementId: p.id, body: { vote: 'agree' } }, deps);
  const row = state.agreements[0];
  Object.assign(row, { commit_state: 'committing', commit_attempted_at: state.now.toISOString(), commit_url: null });
  let list = await svc.listAgreements({ project, user: people.owner }, deps);
  assert.strictEqual(list.agreements[0].you.canRetryCommit, false);
  await assert.rejects(svc.retryCommit({ project, user: people.owner, agreementId: p.id }, deps), /nothing to retry/);
  state.now = new Date(T0.getTime() + 11 * 60 * 1000);
  list = await svc.listAgreements({ project, user: people.owner }, deps);
  assert.strictEqual(list.agreements[0].you.canRetryCommit, true);
  const out = await svc.retryCommit({ project, user: people.owner, agreementId: p.id }, deps);
  assert.strictEqual(out.agreement.commit.state, 'committed');
  assert.strictEqual(out.agreement.commit.url, null, 'no link to a commit that did not add it');
  assert.strictEqual(repo.log.length, 1);
});

test('a dismissed recommendation can be retried; a pending one cannot', async () => {
  const { project, repo, state, deps, people } = setup();
  const { agreement: p } = await svc.propose({ project, user: people.owner, body: { text: 'Dismiss me.' } }, deps);
  await svc.vote({ project, user: people.olive, agreementId: p.id, body: { vote: 'agree' } }, deps);
  await assert.rejects(svc.retryCommit({ project, user: people.owner, agreementId: p.id }, deps), /nothing to retry/);
  await committing.dismissRecommendation({ project, user: people.owner, recommendationId: state.recs[0].id }, deps.committing);
  const out = await svc.retryCommit({ project, user: people.owner, agreementId: p.id }, deps);
  assert.strictEqual(out.agreement.commit.state, 'committed');
  assert.strictEqual(repo.log.length, 1);
  // What the person confirming sees says what goes into the repo.
  assert.strictEqual(state.recs[0].summary, 'Add this agreement to takeoff.yaml: "Dismiss me."');
});

test('agent files that are symlinks are left alone', async () => {
  const { project, repo, deps, people } = setup();
  repo.files['CLAUDE.md'] = '# Notes\n';
  repo.links.add('AGENTS.md');
  const { agreement: p } = await svc.propose({ project, user: people.olive, body: { text: 'Leave links.' } }, deps);
  await svc.vote({ project, user: people.owner, agreementId: p.id, body: { vote: 'agree' } }, deps);
  const written = Object.values(repo.trees).pop().files.map((f) => f.path);
  assert.ok(written.includes('CLAUDE.md'));
  assert.ok(!written.includes('AGENTS.md'));
});

test('a ruleset that requires pull requests opens one; an open PR from an earlier try is reused, not overwritten', async () => {
  const { project, repo, state, deps, people } = setup();
  repo.rulesError = 'Repository rule violations found\n\nChanges must be made through a pull request.';
  const { agreement: p } = await svc.propose({ project, user: people.olive, body: { text: 'Rules apply.' } }, deps);
  const { agreement } = await svc.vote({ project, user: people.owner, agreementId: p.id, body: { vote: 'agree' } }, deps);
  assert.strictEqual(agreement.commit.state, 'pr_opened');
  const branch = repo.refs[`takeoff/${p.id}`];
  state.agreements[0].commit_state = 'failed';
  const again = await svc.retryCommit({ project, user: people.owner, agreementId: p.id }, deps);
  assert.strictEqual(again.agreement.commit.state, 'pr_opened');
  assert.strictEqual(repo.pulls.length, 1);
  assert.strictEqual(repo.refs[`takeoff/${p.id}`], branch, 'the branch was not force-pushed');
});

test('with no email to record, the commit fails plainly and a retry looks again', async () => {
  const { project, repo, state, deps, people, memberRows } = setup();
  for (const m of memberRows) m.email = null;
  const noMail = { ...people.owner, email_confirmed_at: null };
  const { agreement: p } = await svc.propose({ project, user: people.olive, body: { text: 'Who agreed?' } }, { ...deps });
  people.olive.email_confirmed_at = null;
  const { agreement } = await svc.vote({ project, user: noMail, agreementId: p.id, body: { vote: 'agree' } }, deps);
  assert.strictEqual(agreement.commit.state, 'failed');
  assert.match(agreement.commit.error, /email/);
  memberRows.find((m) => m.user_id === 'owner').email = 'sam@acme.test';
  const out = await svc.retryCommit({ project, user: people.owner, agreementId: p.id }, deps);
  assert.strictEqual(out.agreement.commit.state, 'committed');
  assert.deepStrictEqual(validateText(repo.files['takeoff.yaml']).data.agreements[0].agreed_by, ['sam@acme.test']);
  assert.ok(state.agreements[0].agreed_by_emails.includes('sam@acme.test'));
});

test('a "Not yet" from someone who left does not block the 48-hour fallback', async () => {
  const { project, state, deps, people, memberRows } = setup({ members: ['owner', 'olive', 'rex'] });
  const { agreement: p } = await svc.propose({ project, user: people.owner, body: { text: 'Rex left.' } }, deps);
  await svc.vote({ project, user: people.rex, agreementId: p.id, body: { vote: 'not_yet', comment: 'Hmm.' } }, deps);
  memberRows.splice(memberRows.findIndex((m) => m.user_id === 'rex'), 1);
  state.now = new Date(T0.getTime() + 49 * HOUR);
  const out = await svc.decide({ project, user: people.owner, agreementId: p.id, body: { outcome: 'accept', note: 'Rex left the team.' } }, deps);
  assert.strictEqual(out.agreement.status, 'accepted');
});

test('an area with no Creators is decided like one with no area: write access', async () => {
  const { project, state, deps, people } = setup({ members: ['owner', 'olive', 'rex'] });
  deps.readIntent = async () => ({ ok: true, reason: null, branch: 'main', areas: [{ id: 'billing', name: 'Billing', creators: [] }] });
  const { agreement: p } = await svc.propose({ project, user: people.olive, body: { text: 'No creators.', areaId: 'billing' } }, deps);
  state.now = new Date(T0.getTime() + 49 * HOUR);
  await assert.rejects(svc.decide({ project, user: people.olive, agreementId: p.id, body: { outcome: 'accept', note: 'x' } }, deps), /Creator|write access/);
  const out = await svc.decide({ project, user: people.owner, agreementId: p.id, body: { outcome: 'accept', note: 'Owner can write.' } }, deps);
  assert.strictEqual(out.agreement.status, 'accepted');
});

test('hidden characters are stripped, and toggling "Not yet" emails the proposer once', async () => {
  const { project, state, deps, people } = setup({ members: ['owner', 'olive', 'rex'] });
  const { agreement: p } = await svc.propose({ project, user: people.olive, body: { text: 'Use\u200b UTC\u202e everywhere.' } }, deps);
  assert.strictEqual(p.text, 'Use UTC everywhere.');
  const { agreement: tagged } = await svc.propose({ project, user: people.olive, body: { text: 'Ship it.\u{E0049}\u{E0067}\u{E006E}\uFE0F' } }, deps);
  assert.strictEqual(tagged.text, 'Ship it.');
  for (const vote of ['not_yet', 'agree', 'not_yet', 'agree', 'not_yet']) {
    await svc.vote({ project, user: people.rex, agreementId: p.id, body: { vote, comment: vote === 'not_yet' ? 'Wait.' : undefined } }, deps);
  }
  assert.strictEqual(state.outbox.filter((o) => o.kind === 'agreement_not_yet').length, 1);
});

test('the decide check asks GitHub once per page, however many rows need it', async () => {
  const { project, state, deps, people, committingDeps } = setup({ members: ['owner', 'olive', 'rex'] });
  for (let i = 0; i < 5; i += 1) await svc.propose({ project, user: people.olive, body: { text: `Row ${i}.` } }, deps);
  state.now = new Date(T0.getTime() + 49 * HOUR);
  let calls = 0;
  const real = committingDeps.clientForInstallation;
  committingDeps.clientForInstallation = (...a) => { const gh = real(...a); return { ...gh, fetchCollaboratorPermission: async (...b) => { calls += 1; return gh.fetchCollaboratorPermission(...b); } }; };
  const list = await svc.listAgreements({ project, user: people.owner }, deps);
  assert.strictEqual(list.agreements.filter((a) => a.you.canDecide).length, 5);
  assert.strictEqual(calls, 1);
});

test('with emails off nothing is queued', async () => {
  const { project, state, deps, people } = setup({ emailEnabled: false });
  await svc.propose({ project, user: people.olive, body: { text: 'Quiet.' } }, deps);
  assert.strictEqual(state.outbox.length, 0);
});

test('emails: at most 3 singles an hour, then one digest, then hold', async () => {
  const { state, deps } = setup();
  const sent = [];
  const flushDeps = { notificationOutbox: deps.notificationOutbox, now: () => state.now, transport: { async send(m) { sent.push(m); } } };
  const queue = (k) => notify.enqueue({ projectId: 'p1', recipients: [{ userId: 'u', email: 'Sam@Acme.test' }], kind: 'k', subject: `s${k}`, body: `b${k}`, link: 'https://takeoff.test/read/p1' }, deps);
  for (let i = 1; i <= 2; i += 1) await queue(i);
  assert.strictEqual(await notify.flush(flushDeps), 2);
  assert.deepStrictEqual(sent.map((m) => m.subject), ['s1', 's2']);
  assert.strictEqual(sent[0].to, 'sam@acme.test');
  assert.ok(sent[0].text.endsWith('https://takeoff.test/read/p1'));
  for (let i = 3; i <= 5; i += 1) await queue(i);
  // 2 sent + 3 waiting > 3: the three go together as the hour's digest.
  assert.strictEqual(await notify.flush(flushDeps), 1);
  assert.strictEqual(sent[2].subject, '3 updates on agreements in Takeoff');
  await queue(6);
  assert.strictEqual(await notify.flush(flushDeps), 0); // this hour is used up
  state.now = new Date(T0.getTime() + HOUR + 60000);
  assert.strictEqual(await notify.flush(flushDeps), 1);
  assert.strictEqual(sent[3].subject, 's6');
});

test('the email transport is off unless a provider is fully configured', () => {
  assert.strictEqual(notify.transportFromEnv({}), null);
  const warn = console.warn; console.warn = () => {};
  try { assert.strictEqual(notify.transportFromEnv({ TAKEOFF_EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k' }), null); } finally { console.warn = warn; }
  assert.ok(notify.transportFromEnv({ TAKEOFF_EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k', TAKEOFF_EMAIL_FROM: 'Takeoff <t@x.test>' }, async () => ({ ok: true })));
});
