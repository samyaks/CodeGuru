'use strict';

// Milestone 5: the drift review, accept & update intent, send back, and the
// drift email, against in-memory stores and a fake PR.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { validateText, parseSendBack, AGENT_FILE_PATHS } = require('@takeoff/cli');
const svc = require('./index');
const committing = require('../team/committing');
const { AppError } = require('../../lib/app-error');
const { setup, BASE_YAML, DRIFT_RESULT } = require('./test-fakes');

beforeEach(() => svc._resetRegistration());

const HEAD = 'a1a1a1a1';
const neverRule = { kind: 'never', area: 'billing', text: 'Charge before the trial ends.' };

async function rejects(promise, status, re) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof AppError, `expected an AppError, got ${err}`);
    assert.strictEqual(err.statusCode, status, err.message);
    if (re) assert.match(err.message, re);
    return true;
  });
}

const tick = () => new Promise((r) => setImmediate(r));

test('the review shows the rule, the PR and where the rule lives in the intent', async () => {
  const { project, deps, people } = setup();
  const review = await svc.getReview({ project, user: people.owner, prNumber: '7' }, deps);
  assert.strictEqual(review.pr.title, 'Charge at signup');
  assert.strictEqual(review.pr.filesUrl, 'https://github.com/acme/web/pull/7/files');
  assert.strictEqual(review.pr.fork, false);
  assert.strictEqual(review.check.verdict, 'drifts');
  assert.strictEqual(review.check.newerPush, false);
  assert.deepStrictEqual(review.check.conflicts[0].target, neverRule);
  assert.strictEqual(review.check.conflicts[0].areaName, 'Billing');
  assert.deepStrictEqual(review.intent.areas, [{
    id: 'billing', name: 'Billing', creators: ['sam@acme.test'],
    rules: ['Stripe holds all billing data.'], never: ['Charge before the trial ends.'],
  }]);
  assert.strictEqual(review.intent.yamlChanged, false);
  assert.deepStrictEqual(review.you, { canDecide: true, whyNot: null, canWrite: true, writeReason: null });

  const olive = await svc.getReview({ project, user: people.olive, prNumber: 7 }, deps);
  assert.strictEqual(olive.you.canDecide, true);
  assert.strictEqual(olive.you.canWrite, false);
  assert.strictEqual(olive.you.writeReason, 'no_write_access');
});

test('only members see a review, and only of a PR Takeoff checked', async () => {
  const { project, deps, people } = setup();
  await rejects(svc.getReview({ project, user: people.rex, prNumber: 7 }, deps), 403);
  await rejects(svc.getReview({ project, user: people.owner, prNumber: 8 }, deps), 404);
  await rejects(svc.getReview({ project, user: people.owner, prNumber: 'x' }, deps), 400);
  await rejects(svc.accept({ project, user: people.rex, prNumber: 7, body: { headSha: HEAD, edits: [{ op: 'remove', target: neverRule }] } }, deps), 403);
});

test('a reviewer with write access accepts: the rule leaves takeoff.yaml on the PR branch, and the PR is checked again', async () => {
  const { project, gh, state, deps, people } = setup();
  // The push starts a PR check at once: by then the accept must already be trusted.
  let trustedAtPush = null;
  gh.onUpdateRef = async (sha) => {
    const yaml = gh.commits[sha].files['takeoff.yaml'];
    trustedAtPush = await deps.driftDecisions.acceptedFor({ projectId: 'p1', repo: 'acme/web', prNumber: 7, yamlSha256: svc.sha256(yaml), baseYamlSha256: svc.sha256(BASE_YAML) });
  };
  const res = await svc.accept({ project, user: people.owner, prNumber: 7, body: { headSha: HEAD, edits: [{ op: 'remove', target: neverRule }] } }, deps);
  assert.strictEqual(res.status, 'done');
  assert.strictEqual(res.decision.state, 'done');
  assert.deepStrictEqual(res.decision.changes, ['Remove the never-rule "Charge before the trial ends."']);

  const head = gh.branches['feat/charge'];
  assert.notStrictEqual(head, HEAD);
  assert.deepStrictEqual(gh.commits[head].parents, [HEAD]);
  assert.ok(gh.calls.some((c) => c[0] === 'updateBranchRef' && c[1] === 'feat/charge' && c[3] === false), 'never forces the branch');
  assert.strictEqual(res.decision.commitUrl, `https://github.com/acme/web/commit/${head}`);
  const yaml = gh.commits[head].files['takeoff.yaml'];
  assert.ok(yaml.startsWith('# Keep this comment.'));
  assert.ok(!yaml.includes('Charge before the trial ends.'));
  assert.ok(yaml.includes('Stripe holds all billing data.'));
  assert.ok(validateText(yaml).ok);
  for (const p of AGENT_FILE_PATHS) assert.ok(gh.commits[head].files[p], `${p} regenerated`);
  assert.strictEqual(gh.commits[head].files['src/billing/signup.js'], 'charge();\n', 'the PR\'s own code is untouched');
  const message = gh.commits[head].message;
  assert.match(message, /^takeoff: accept drift on #7 — Remove the never-rule/);
  assert.match(message, /Accepted in Takeoff by Sam\./);
  assert.match(message, /Co-authored-by: samgh <11\+samgh@users\.noreply\.github\.com>/);

  const row = state.decisions[0];
  assert.strictEqual(row.yaml_sha256, svc.sha256(yaml));
  assert.strictEqual(row.base_yaml_sha256, svc.sha256(BASE_YAML));
  await tick();
  assert.deepStrictEqual(state.rechecks, [{ owner: 'acme', repo: 'web', prNumber: 7, headSha: head, installationId: 77, force: false }]);

  // The accept the check will trust is exactly this file over this base.
  assert.ok(trustedAtPush, 'trusted before the branch moved');
  assert.ok(await deps.driftDecisions.acceptedFor({ projectId: 'p1', repo: 'acme/web', prNumber: 7, yamlSha256: svc.sha256(yaml), baseYamlSha256: svc.sha256(BASE_YAML) }));
  assert.strictEqual(await deps.driftDecisions.acceptedFor({ projectId: 'p1', repo: 'acme/web', prNumber: 7, yamlSha256: svc.sha256(yaml), baseYamlSha256: svc.sha256('other') }), null);
  assert.strictEqual(await deps.driftDecisions.acceptedFor({ projectId: 'p2', repo: 'acme/web', prNumber: 7, yamlSha256: svc.sha256(yaml), baseYamlSha256: svc.sha256(BASE_YAML) }), null, 'another project on the same repo doesn\'t inherit it');
});

test('an accept can reword a rule, add one and record an agreement', async () => {
  const { project, gh, deps, people } = setup();
  const res = await svc.accept({
    project, user: people.owner, prNumber: 7,
    body: {
      headSha: HEAD,
      edits: [
        { op: 'reword', target: neverRule, to: 'Charge only after the trial ends, unless the customer upgrades early.' },
        { op: 'add', kind: 'rule', area: 'billing', text: '  Receipts go out the same day. ' },
      ],
      agreement: 'Early upgrades are charged at once.',
    },
  }, deps);
  assert.strictEqual(res.decision.state, 'done', res.decision.error);
  const data = validateText(gh.commits[gh.branches['feat/charge']].files['takeoff.yaml']).data;
  const billing = data.areas[0];
  assert.deepStrictEqual(billing.never, ['Charge only after the trial ends, unless the customer upgrades early.']);
  assert.deepStrictEqual(billing.rules, ['Stripe holds all billing data.', 'Receipts go out the same day.']);
  assert.strictEqual(data.agreements.length, 1);
  assert.deepStrictEqual(data.agreements[0].agreed_by, ['sam@acme.test']);
  assert.strictEqual(data.agreements[0].source, 'https://github.com/acme/web/pull/7');
  assert.strictEqual(res.decision.agreementId, data.agreements[0].id);
  assert.strictEqual(res.decision.agreementText, 'Early upgrades are charged at once.');
  assert.strictEqual(res.decision.changes.length, 3);
});

test('a bad edit is refused before anything is queued or committed', async () => {
  const { project, gh, state, deps, people } = setup();
  await rejects(svc.accept({ project, user: people.owner, prNumber: 7, body: { headSha: HEAD, edits: [] } }, deps), 400, /Choose how takeoff\.yaml should change/);
  await rejects(svc.accept({ project, user: people.owner, prNumber: 7, body: { headSha: HEAD, edits: [{ op: 'remove', target: { kind: 'rule', area: 'billing', text: 'No such rule.' } }] } }, deps), 400);
  await rejects(svc.accept({ project, user: people.owner, prNumber: 7, body: { headSha: HEAD, edits: 'remove it' } }, deps), 400);
  await rejects(svc.accept({ project, user: people.owner, prNumber: 7, body: { headSha: HEAD, agreement: 'x'.repeat(1001) } }, deps), 400);
  assert.strictEqual(state.decisions.length, 0);
  assert.strictEqual(gh.branches['feat/charge'], HEAD);
});

test('recording an agreement needs a confirmed email on the account', async () => {
  const { project, deps, people } = setup();
  const user = { ...people.owner, email_confirmed_at: null };
  await rejects(svc.accept({ project, user, prNumber: 7, body: { headSha: HEAD, agreement: 'Early upgrades are charged at once.' } }, deps), 400, /Confirm the email/);
});

test('a PR that edits takeoff.yaml itself can be accepted as it is', async () => {
  const headYaml = BASE_YAML.replace('    never:\n      - "Charge before the trial ends."\n', '');
  const { project, gh, state, deps, people } = setup({ ghOpts: { headFiles: { 'takeoff.yaml': headYaml } } });
  const review = await svc.getReview({ project, user: people.owner, prNumber: 7 }, deps);
  assert.strictEqual(review.intent.yamlChanged, true);
  assert.strictEqual(review.check.conflicts[0].target, null, 'the rule is already gone from the PR\'s own file');

  const res = await svc.accept({ project, user: people.owner, prNumber: 7, body: { headSha: HEAD } }, deps);
  assert.strictEqual(res.decision.state, 'done', res.decision.error);
  assert.deepStrictEqual(res.decision.changes, ['Accept this PR\'s own changes to takeoff.yaml']);
  // Only the agent files needed writing; the yaml stays the PR's own.
  const head = gh.branches['feat/charge'];
  assert.strictEqual(gh.commits[head].files['takeoff.yaml'], headYaml);
  assert.strictEqual(state.decisions[0].yaml_sha256, svc.sha256(headYaml));
  assert.strictEqual(state.decisions[0].base_yaml_sha256, svc.sha256(BASE_YAML));
});

test('nothing to commit still records the accept and checks the PR again by force', async () => {
  const headYaml = BASE_YAML.replace('    never:\n      - "Charge before the trial ends."\n', '');
  const { project, gh, state, deps, people } = setup({ ghOpts: { headFiles: { 'takeoff.yaml': headYaml } } });
  await svc.accept({ project, user: people.owner, prNumber: 7, body: { headSha: HEAD } }, deps);
  const head = gh.branches['feat/charge'];
  // The PR's head now carries the agent files; accepting again commits nothing.
  state.checks.push({ ...state.checks[0], head_sha: head });
  const again = await svc.accept({ project, user: people.owner, prNumber: 7, body: { headSha: head } }, deps);
  assert.strictEqual(again.decision.state, 'done', again.decision.error);
  assert.strictEqual(again.decision.commitUrl, null);
  assert.strictEqual(gh.branches['feat/charge'], head);
  // Until the new head is checked, the review waits for it.
  state.checks.pop();
  const review = await svc.getReview({ project, user: people.owner, prNumber: 7 }, deps);
  assert.strictEqual(review.check.newerPush, true);
  assert.strictEqual(review.you.whyNot, 'newer_push');
  await tick();
  assert.deepStrictEqual(state.rechecks.at(-1), { owner: 'acme', repo: 'web', prNumber: 7, headSha: head, installationId: 77, force: true });
});

test('a decision is about the commit the reviewer saw, on an open PR from this repo', async () => {
  const { project, gh, state, deps, people } = setup();
  const body = { headSha: HEAD, edits: [{ op: 'remove', target: neverRule }] };
  await rejects(svc.accept({ project, user: people.owner, prNumber: 7, body: { ...body, headSha: 'nope' } }, deps), 400);
  await rejects(svc.accept({ project, user: people.owner, prNumber: 7, body: { ...body, headSha: 'beefbeef' } }, deps), 409, /changed since you opened it/);
  gh.branches['feat/charge'] = 'b0b0b0b0';
  await rejects(svc.accept({ project, user: people.owner, prNumber: 7, body }, deps), 409, /changed since/);
  gh.branches['feat/charge'] = HEAD;
  state.checks[0].verdict = 'aligned';
  await rejects(svc.accept({ project, user: people.owner, prNumber: 7, body }, deps), 409, /needs no decision/);
  state.checks[0].verdict = 'drifts';
  gh.pr.state = 'closed';
  await rejects(svc.sendBack({ project, user: people.owner, prNumber: 7, body: { headSha: HEAD, note: 'x' } }, deps), 409, /closed/);
  gh.pr.state = 'open';
  gh.fork = true;
  await rejects(svc.accept({ project, user: people.owner, prNumber: 7, body }, deps), 400, /fork/);
  const review = await svc.getReview({ project, user: people.owner, prNumber: 7 }, deps);
  assert.strictEqual(review.you.canDecide, false);
  assert.strictEqual(review.you.whyNot, 'fork');
  assert.strictEqual(state.decisions.length, 0);
});

test('one decision at a time on a PR', async () => {
  const { project, state, deps, people } = setup();
  state.decisions.push({ id: 'dec_x', project_id: 'p1', repo_full_name: 'acme/web', pr_number: 7, head_sha: HEAD, type: 'sent_back', state: 'working', created_at: state.now.toISOString() });
  await rejects(svc.sendBack({ project, user: people.owner, prNumber: 7, body: { headSha: HEAD, note: 'Wait for the trial.' } }, deps), 409, /deciding on this pull request right now/);
  const review = await svc.getReview({ project, user: people.owner, prNumber: 7 }, deps);
  assert.strictEqual(review.you.whyNot, 'decision_running');
});

test('send back posts the note on the PR where `takeoff notes` can read it', async () => {
  const { project, gh, deps, people } = setup();
  await rejects(svc.sendBack({ project, user: people.owner, prNumber: 7, body: { headSha: HEAD, note: '   ' } }, deps), 400, /Say what the builder should change/);
  await rejects(svc.sendBack({ project, user: people.owner, prNumber: 7, body: { headSha: HEAD, note: 'x'.repeat(2001) } }, deps), 400);

  const note = 'Keep the trial free.\nCharge when it ends, not at signup. <b>Thanks</b>';
  const res = await svc.sendBack({ project, user: people.owner, prNumber: 7, body: { headSha: HEAD, note } }, deps);
  assert.strictEqual(res.status, 'done');
  assert.strictEqual(res.decision.type, 'sent_back');
  assert.strictEqual(res.decision.commentUrl, 'https://github.com/acme/web/pull/7#issuecomment-900');
  assert.strictEqual(gh.comments.length, 1);
  const { body } = gh.comments[0];
  assert.deepStrictEqual(parseSendBack(body), { id: res.decision.id, sha: HEAD, note });
  assert.match(body, /sent back by Sam/);
  assert.match(body, /^> Keep the trial free\.$/m);
  assert.ok(!body.includes('<b>'), 'the shown note is escaped');
  assert.match(body, /`takeoff notes`/);
  assert.strictEqual(gh.branches['feat/charge'], HEAD, 'a send-back commits nothing');
});

test('a member without write access leaves a recommendation; a member with write access confirms it', async () => {
  const { project, gh, state, deps, people } = setup();
  const res = await svc.accept({ project, user: people.olive, prNumber: 7, body: { headSha: HEAD, edits: [{ op: 'remove', target: neverRule }] } }, deps);
  assert.strictEqual(res.status, 'recommended');
  assert.strictEqual(res.reason, 'no_write_access');
  assert.strictEqual(res.decision.state, 'waiting_for_write');
  assert.strictEqual(gh.branches['feat/charge'], HEAD);
  assert.strictEqual(state.recs.length, 1);
  assert.strictEqual(state.recs[0].action_type, 'drift.decision');
  assert.match(state.recs[0].summary, /^Accept the drift on PR #7 and update takeoff\.yaml: Remove the never-rule/);

  // Olive can't confirm her own; Sam can.
  await assert.rejects(committing.confirmRecommendation({ project, user: people.olive, recommendationId: state.recs[0].id }, deps.committing), /write access/);
  await committing.confirmRecommendation({ project, user: people.owner, recommendationId: state.recs[0].id }, deps.committing);
  assert.strictEqual(state.recs[0].status, 'confirmed');
  const row = state.decisions[0];
  assert.strictEqual(row.state, 'done');
  assert.strictEqual(row.confirmed_by, 'owner');
  const head = gh.branches['feat/charge'];
  assert.notStrictEqual(head, HEAD);
  // The commit credits the member who decided.
  assert.match(gh.commits[head].message, /Accepted in Takeoff by Olive\./);
  assert.match(gh.commits[head].message, /Co-authored-by: olivegh <12\+olivegh@users\.noreply\.github\.com>/);
  const review = await svc.getReview({ project, user: people.olive, prNumber: 7 }, deps);
  assert.strictEqual(review.decisions[0].confirmedBy.name, 'Sam');
});

test('a dismissed recommendation shows as dismissed', async () => {
  const { project, state, deps, people } = setup();
  await svc.sendBack({ project, user: people.olive, prNumber: 7, body: { headSha: HEAD, note: 'Keep the trial free.' } }, deps);
  assert.match(state.recs[0].summary, /^Send PR #7 back: "Keep the trial free\."/);
  await deps.recommendations.dismiss('p1', state.recs[0].id, 'owner');
  const { decisions } = await svc.listDrift({ project, user: people.owner }, deps);
  assert.strictEqual(decisions[0].state, 'dismissed');
});

test('a push after the reviewer looked sets the accept aside; it never lands on unreviewed code', async () => {
  const { project, gh, state, deps, people } = setup();
  gh.pushesBeforeUpdate = 1;
  const res = await svc.accept({ project, user: people.owner, prNumber: 7, body: { headSha: HEAD, edits: [{ op: 'remove', target: neverRule }] } }, deps);
  assert.strictEqual(res.decision.state, 'dismissed');
  assert.match(res.decision.error, /changed after the decision was made/);
  const head = gh.branches['feat/charge'];
  assert.match(head, /^dead00/, 'only the other push is on the branch');
  assert.strictEqual(gh.commits[head].files['takeoff.yaml'], BASE_YAML);
  assert.strictEqual(await deps.driftDecisions.acceptedFor({ projectId: 'p1', repo: 'acme/web', prNumber: 7, yamlSha256: state.decisions[0].yaml_sha256, baseYamlSha256: svc.sha256(BASE_YAML) }), null, 'a set-aside accept is not trusted');
  await rejects(svc.retryDecision({ project, user: people.owner, decisionId: res.decision.id }, deps), 409);
});

test('a recommendation confirmed after the PR moved on is set aside and leaves the list', async () => {
  const { project, gh, state, deps, people } = setup();
  await svc.accept({ project, user: people.olive, prNumber: 7, body: { headSha: HEAD, edits: [{ op: 'remove', target: neverRule }] } }, deps);
  gh.commits.beefbeef = { files: { ...gh.commits[HEAD].files, 'takeoff.yaml': BASE_YAML.replace('Stripe holds', 'Anyone holds') }, parents: [HEAD] };
  gh.branches['feat/charge'] = 'beefbeef';
  await assert.rejects(committing.confirmRecommendation({ project, user: people.owner, recommendationId: state.recs[0].id }, deps.committing), /changed after the decision/);
  assert.strictEqual(state.recs[0].status, 'failed');
  assert.strictEqual(state.decisions[0].state, 'dismissed');
  assert.strictEqual(gh.branches['feat/charge'], 'beefbeef');
  assert.ok(!gh.calls.some((c) => c[0] === 'updateBranchRef'));
});

test('a send-back after a newer push is set aside too', async () => {
  const { project, gh, state, deps, people } = setup();
  await svc.sendBack({ project, user: people.olive, prNumber: 7, body: { headSha: HEAD, note: 'Keep the trial free.' } }, deps);
  gh.commits.beefbeef = { files: gh.commits[HEAD].files, parents: [HEAD] };
  gh.branches['feat/charge'] = 'beefbeef';
  await assert.rejects(committing.confirmRecommendation({ project, user: people.owner, recommendationId: state.recs[0].id }, deps.committing));
  assert.strictEqual(gh.comments.length, 0);
  assert.strictEqual(state.decisions[0].state, 'dismissed');
});

test('only GitHub\'s own errors are shown to members', async () => {
  const { project, deps, people } = setup();
  const broken = { ...deps, writeClientFor: () => { throw new TypeError('Cannot read properties of undefined (reading \'token\')'); } };
  const res = await svc.sendBack({ project, user: people.owner, prNumber: 7, body: { headSha: HEAD, note: 'Keep the trial free.' } }, broken);
  assert.strictEqual(res.decision.state, 'failed');
  assert.strictEqual(res.decision.error, 'Something went wrong in Takeoff. Try again in a minute.');
});

test('a failed decision can be tried again by someone with write access', async () => {
  const { project, gh, deps, people } = setup();
  gh.failComment = 'Resource not accessible by integration';
  const res = await svc.sendBack({ project, user: people.owner, prNumber: 7, body: { headSha: HEAD, note: 'Keep the trial free.' } }, deps);
  assert.strictEqual(res.status, 'failed');
  assert.match(res.decision.error, /can't write to acme\/web/);

  await rejects(svc.retryDecision({ project, user: people.olive, decisionId: res.decision.id }, deps), 403);
  gh.failComment = null;
  const again = await svc.retryDecision({ project, user: people.owner, decisionId: res.decision.id }, deps);
  assert.strictEqual(again.decision.state, 'done');
  assert.strictEqual(gh.comments.length, 1);
  await rejects(svc.retryDecision({ project, user: people.owner, decisionId: res.decision.id }, deps), 409);
});

test('a failed decision can\'t be tried again once someone decided after it', async () => {
  const { project, gh, state, deps, people } = setup();
  gh.failComment = 'Resource not accessible by integration';
  const first = await svc.sendBack({ project, user: people.owner, prNumber: 7, body: { headSha: HEAD, note: 'Keep the trial free.' } }, deps);
  gh.failComment = null;
  state.now = new Date(state.now.getTime() + 1000);
  await svc.sendBack({ project, user: people.owner, prNumber: 7, body: { headSha: HEAD, note: 'Second thoughts.' } }, deps);
  await rejects(svc.retryDecision({ project, user: people.owner, decisionId: first.decision.id }, deps), 409, /decided on this pull request after this/);
  assert.strictEqual(gh.comments.length, 1);
});

test('the drift list shows open PRs that need a decision, with the latest decision', async () => {
  const { project, state, deps, people } = setup();
  state.checks.push({ project_id: 'p1', repo_full_name: 'acme/web', pr_number: 9, head_sha: 'cafecafe', status: 'done', verdict: 'aligned', result_json: {}, completed_at: state.now.toISOString() });
  let list = await svc.listDrift({ project, user: people.olive }, deps);
  assert.deepStrictEqual(list.reviews.map((r) => [r.prNumber, r.title, r.verdict, r.conflictCount]), [[7, 'Charge at signup', 'drifts', 1]]);
  assert.strictEqual(list.reviews[0].lastDecision, null);

  await svc.sendBack({ project, user: people.owner, prNumber: 7, body: { headSha: HEAD, note: 'Keep the trial free.' } }, deps);
  list = await svc.listDrift({ project, user: people.olive }, deps);
  assert.strictEqual(list.reviews[0].lastDecision.type, 'sent_back');
  assert.strictEqual(list.decisions[0].by.name, 'Sam');

  state.checks[0].pr_closed_at = state.now.toISOString();
  list = await svc.listDrift({ project, user: people.olive }, deps);
  assert.deepStrictEqual(list.reviews, []);
  await rejects(svc.listDrift({ project, user: people.rex }, deps), 403);
});

test('drift email goes to the area\'s Creators who are members, once per commit, linking the review page', async () => {
  const { project, state, deps } = setup();
  const intent = { areas: [{ id: 'billing', creators: ['Sam@Acme.test'] }] };
  const input = { project, prNumber: 7, headSha: HEAD, result: DRIFT_RESULT, intent, prTitle: 'Charge at signup' };
  assert.strictEqual(await svc.notifyDrift(input, deps), 1);
  assert.strictEqual(await svc.notifyDrift(input, deps), 0, 'the same commit is emailed once');
  assert.strictEqual(state.outbox.length, 1);
  const mail = state.outbox[0];
  assert.strictEqual(mail.recipient_email, 'sam@acme.test');
  assert.strictEqual(mail.kind, 'drift');
  assert.strictEqual(mail.subject, 'Drifts from intent: PR #7 Charge at signup in web');
  assert.strictEqual(mail.link, 'https://takeoff.test/read/p1/drift/7');
  assert.match(mail.body, /charges at signup/);
  // Nothing for a verdict that needs no decision, or with email off.
  assert.strictEqual(await svc.notifyDrift({ ...input, result: { verdict: 'aligned' } }, deps), 0);
  assert.strictEqual(await svc.notifyDrift({ ...input, headSha: 'beefbeef' }, { ...deps, emailEnabled: false }), 0);
});

test('with no Creator among the members, drift email goes to members with write access', async () => {
  const { project, state, deps } = setup();
  const intent = { areas: [{ id: 'billing', creators: ['someone@else.test'] }] };
  assert.strictEqual(await svc.notifyDrift({ project, prNumber: 7, headSha: HEAD, result: DRIFT_RESULT, intent }, deps), 1);
  assert.deepStrictEqual(state.outbox.map((o) => o.recipient_email), ['sam@acme.test']);
  // A broken outbox never breaks the PR check.
  const broken = { ...deps, notificationOutbox: { async enqueue() { throw new Error('db down'); } } };
  assert.strictEqual(await svc.notifyDrift({ project, prNumber: 7, headSha: 'beefbeef', result: DRIFT_RESULT, intent }, broken), 0);
});

test('targetFor finds rules, never rules and agreements by their exact text', () => {
  const intent = {
    areas: [{ id: 'billing', rules: [{ text: 'Stripe holds all billing data.' }], never: [{ text: 'Charge  before the trial ends.' }] }],
    agreements: [{ area: null, text: 'Weekly digests only.' }],
  };
  assert.deepStrictEqual(svc.targetFor(intent, { area: 'billing', rule_or_agreement: 'Stripe holds all billing data.' }), { kind: 'rule', area: 'billing', text: 'Stripe holds all billing data.' });
  assert.deepStrictEqual(svc.targetFor(intent, { area: 'billing', rule_or_agreement: 'Charge before the trial ends.' }), { kind: 'never', area: 'billing', text: 'Charge before the trial ends.' });
  assert.deepStrictEqual(svc.targetFor(intent, { area: 'emails', rule_or_agreement: 'Weekly digests only.' }), { kind: 'agreement', area: null, text: 'Weekly digests only.' });
  assert.strictEqual(svc.targetFor(intent, { area: 'billing', rule_or_agreement: 'Something the model made up.' }), null);
  assert.strictEqual(svc.targetFor(null, { area: 'billing', rule_or_agreement: 'x' }), null);
});

test('an older recommendation confirmed after a later decision is set aside', async () => {
  const { project, gh, state, deps, people } = setup();
  await svc.accept({ project, user: people.olive, prNumber: 7, body: { headSha: HEAD, edits: [{ op: 'remove', target: neverRule }] } }, deps);
  state.now = new Date(state.now.getTime() + 1000);
  await svc.sendBack({ project, user: people.owner, prNumber: 7, body: { headSha: HEAD, note: 'Keep the trial free.' } }, deps);
  await assert.rejects(committing.confirmRecommendation({ project, user: people.owner, recommendationId: state.recs[0].id }, deps.committing), /decided on this pull request after this/);
  assert.strictEqual(state.recs[0].status, 'failed');
  assert.strictEqual(state.decisions.find((d) => d.type === 'accepted').state, 'dismissed');
  assert.strictEqual(gh.branches['feat/charge'], HEAD, 'nothing was committed');
});

test('a recommendation whose decision was set aside closes when confirmed', async () => {
  const { project, gh, state, deps, people } = setup();
  await svc.sendBack({ project, user: people.olive, prNumber: 7, body: { headSha: HEAD, note: 'Keep the trial free.' } }, deps);
  Object.assign(state.decisions[0], { state: 'dismissed', error: 'Set aside.' });
  await assert.rejects(committing.confirmRecommendation({ project, user: people.owner, recommendationId: state.recs[0].id }, deps.committing), /Set aside/);
  assert.strictEqual(state.recs[0].status, 'failed');
  assert.strictEqual(gh.comments.length, 0);
});
