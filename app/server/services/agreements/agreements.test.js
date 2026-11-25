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

test('someone leaving can complete a proposal: listing settles it', async () => {
  const { project, deps, people, memberRows } = setup({ members: ['owner', 'olive', 'rex'] });
  const { agreement: p } = await svc.propose({ project, user: people.olive, body: { text: 'Settle on list.' } }, deps);
  await svc.vote({ project, user: people.owner, agreementId: p.id, body: { vote: 'agree' } }, deps);
  memberRows.splice(memberRows.findIndex((m) => m.user_id === 'rex'), 1);
  const list = await svc.listAgreements({ project, user: people.owner }, deps);
  assert.strictEqual(list.agreements[0].status, 'accepted');
  assert.strictEqual(list.agreements[0].commit.state, 'committed');
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
