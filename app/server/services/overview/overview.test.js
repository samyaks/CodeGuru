'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { setup } = require('../drift/test-fakes');
const overview = require('./index');

const INTENT = {
  ok: true, reason: null, branch: 'main',
  areas: [
    { id: 'billing', name: 'Billing', creators: ['sam@acme.test'] },
    { id: 'auth', name: 'Auth', creators: ['nobody@acme.test'] },
  ],
};

/** The drift fakes, plus agreements, votes and labels. */
function world({ labels = {}, agreements = [], votes = [] } = {}) {
  const ctx = setup();
  for (const m of ctx.memberRows) m.labels = labels[m.user_id] || [];
  const deps = {
    ...ctx.deps,
    readIntent: async () => INTENT,
    agreements: { async list(pid) { return agreements.filter((a) => a.project_id === pid); } },
    agreementVotes: { async listFor(ids) { return votes.filter((v) => ids.includes(v.agreement_id)); } },
    prCache: null,
  };
  return { ...ctx, deps };
}

const agreement = (over) => ({
  project_id: 'p1', id: 'agr_1', area_id: 'billing', text: 'Offer an annual plan at 20% off.', status: 'proposed',
  proposed_by: 'olive', proposed_by_name: 'Olive', proposed_at: new Date('2026-11-24T10:00:00Z'), commit_state: 'none', ...over,
});

test('the overview shows areas with their Creators, open PRs with verdicts, pending agreements and recent decisions', async () => {
  const w = world({
    labels: { owner: ['creator'], olive: ['builder'] },
    agreements: [
      agreement({}),
      agreement({ id: 'agr_2', area_id: null, text: 'Write errors in plain words.', status: 'accepted', decided_by: 'owner', decided_at: new Date('2026-11-25T09:00:00Z'), decided_via: 'everyone_agreed', commit_url: 'https://github.com/acme/web/commit/abc' }),
    ],
    votes: [{ agreement_id: 'agr_1', user_id: 'olive', vote: 'agree' }, { agreement_id: 'agr_1', user_id: 'rex', vote: 'not_yet' }],
  });
  const o = await overview.getOverview({ project: w.project, user: w.people.owner }, w.deps);
  assert.deepStrictEqual(o.view, { default: 'creator', labels: ['creator'] });
  assert.strictEqual(o.linked, true);
  assert.deepStrictEqual(o.areas[0], { id: 'billing', name: 'Billing', creators: [{ email: 'sam@acme.test', name: 'Sam', member: true }] });
  assert.deepStrictEqual(o.areas[1].creators, [{ email: 'nobody@acme.test', name: null, member: false }]);

  assert.strictEqual(o.pullRequests.length, 1);
  const pr = o.pullRequests[0];
  assert.strictEqual(pr.prNumber, 7);
  assert.strictEqual(pr.title, 'Charge at signup');
  assert.strictEqual(pr.verdict, 'drifts');
  assert.strictEqual(pr.needsDecision, true);
  assert.strictEqual(pr.author, 'olivegh');
  assert.strictEqual(pr.yours, false, 'the owner did not open it');

  // Only current members' votes count; Rex isn't one.
  assert.deepStrictEqual(o.pendingAgreements.map((a) => [a.id, a.agreed, a.notYet, a.members, a.yourVote, a.areaName]), [['agr_1', 1, 0, 2, null, 'Billing']]);
  assert.deepStrictEqual(o.recentDecisions.map((e) => [e.kind, e.id, e.outcome]), [['agreement', 'agr_2', 'accepted']]);

  // A Builder lands on their own PRs.
  const b = await overview.getOverview({ project: w.project, user: w.people.olive }, w.deps);
  assert.strictEqual(b.view.default, 'builder');
  assert.strictEqual(b.pullRequests[0].yours, true);
  assert.strictEqual(b.githubLinked, true);
  assert.strictEqual(b.pendingAgreements[0].yourVote, 'agree');
});

test('a decided PR no longer needs a decision, and a closed or unlinked project shows no PRs', async () => {
  const w = world();
  w.state.decisions.push({
    id: 'dec_1', project_id: 'p1', repo_full_name: 'acme/web', pr_number: 7, head_sha: 'a1a1a1a1', type: 'sent_back', state: 'done',
    note: 'Keep the trial free.', actor_user_id: 'owner', actor_name: 'Sam', created_at: '2026-11-26T11:00:00Z', done_at: '2026-11-26T11:01:00Z',
    comment_url: 'https://github.com/acme/web/pull/7#issuecomment-1',
  });
  let o = await overview.getOverview({ project: w.project, user: w.people.owner }, w.deps);
  assert.strictEqual(o.pullRequests[0].needsDecision, false);
  assert.strictEqual(o.pullRequests[0].lastDecision.type, 'sent_back');
  assert.strictEqual(o.recentDecisions[0].kind, 'decision');

  w.state.checks[0].pr_closed_at = '2026-11-26T12:00:00Z';
  o = await overview.getOverview({ project: w.project, user: w.people.owner }, w.deps);
  assert.deepStrictEqual(o.pullRequests, []);

  // The owner's grant moved to another installation: nothing is read from GitHub.
  w.state.checks[0].pr_closed_at = null;
  w.state.grants.set('owner', { installation_id: 99 });
  let asked = false;
  o = await overview.getOverview({ project: w.project, user: w.people.owner }, { ...w.deps, readIntent: async () => { asked = true; return INTENT; } });
  assert.deepStrictEqual([o.linked, o.pullRequests, o.areas, asked], [false, [], [], false]);
  assert.strictEqual(o.recentDecisions.length, 1, 'decisions already made still show');
});

test('only members see the overview or the log', async () => {
  const w = world();
  await assert.rejects(overview.getOverview({ project: w.project, user: w.people.rex }, w.deps), /Forbidden/);
  await assert.rejects(overview.getDecisionLog({ project: w.project, user: w.people.rex }, w.deps), /Forbidden/);
  await assert.rejects(overview.getDecisionLog({ project: w.project, user: null }, w.deps), /Sign in/);
});

test('the decision log lists decided agreements and finished decisions, newest first, and exports as Markdown', async () => {
  const w = world({
    agreements: [
      agreement({ id: 'agr_open' }),
      agreement({ id: 'agr_ok', status: 'accepted', decided_by: 'owner', decided_at: new Date('2026-11-25T09:00:00Z'), decided_via: 'stall_fallback', commit_url: 'https://github.com/acme/web/commit/abc', source: 'javascript:alert(1)' }),
      agreement({ id: 'agr_no', text: 'Use **bold** [links](https://evil.test) and @team', status: 'declined', decided_by: 'owner', decided_at: new Date('2026-11-24T12:00:00Z'), decision_note: 'Not now.' }),
      agreement({ id: 'agr_wd', status: 'withdrawn', decided_by: 'olive', decided_at: new Date('2026-11-24T11:00:00Z'), decided_via: 'withdrawn' }),
    ],
  });
  w.state.decisions.push(
    { id: 'dec_a', project_id: 'p1', repo_full_name: 'acme/web', pr_number: 7, head_sha: 'a1', type: 'accepted', state: 'done', actor_user_id: 'olive', actor_name: 'Olive', confirmed_by: 'owner', edits: { summary: ['Removed the never rule “Charge before the trial ends.”'], agreementText: 'Charge at signup.' }, commit_url: 'https://github.com/acme/web/commit/def', created_at: '2026-11-26T10:00:00Z', done_at: '2026-11-26T10:01:00Z' },
    { id: 'dec_f', project_id: 'p1', repo_full_name: 'acme/web', pr_number: 8, head_sha: 'b1', type: 'sent_back', state: 'failed', actor_user_id: 'owner', created_at: '2026-11-26T09:00:00Z' },
    { id: 'dec_other', project_id: 'p2', repo_full_name: 'acme/web', pr_number: 9, head_sha: 'c1', type: 'sent_back', state: 'done', actor_user_id: 'owner', created_at: '2026-11-26T09:00:00Z', done_at: '2026-11-26T09:00:00Z' },
  );
  const log = await overview.getDecisionLog({ project: w.project, user: w.people.olive }, w.deps);
  assert.deepStrictEqual(log.entries.map((e) => e.id), ['dec_a', 'agr_ok', 'agr_no', 'agr_wd']);
  assert.strictEqual(log.entries[0].prUrl, 'https://github.com/acme/web/pull/7');
  assert.strictEqual(log.entries[0].confirmedBy.name, 'Sam');
  assert.strictEqual(log.entries[1].sourceUrl, null, 'only https links');
  assert.strictEqual(log.truncated, false);

  const text = overview.decisionLogMarkdown(w.project, log, { now: new Date('2026-11-27T00:00:00Z') });
  assert.match(text, /^# Decision log: acme\/web\n\nExported from Takeoff on 2026-11-27\./);
  assert.match(text, /## 2026-11-26\n\n- \*\*PR #7: drift accepted into takeoff\.yaml\*\* by Olive, confirmed by Sam\. Changes: Removed the never rule “Charge before the trial ends\.”\. Recorded as an agreement: Charge at signup\. \[Pull request\]\(https:\/\/github\.com\/acme\/web\/pull\/7\) · \[Commit\]\(https:\/\/github\.com\/acme\/web\/commit\/def\)/);
  assert.match(text, /- \*\*Agreement accepted\*\* \(decided after 48 hours without objection\): Offer an annual plan at 20% off\. Area: Billing\. Proposed by Olive; decided by Sam\. \[Commit\]/);
  assert.match(text, /- \*\*Agreement withdrawn\*\*: Offer an annual plan at 20% off\. Area: Billing\. Proposed by Olive\./);
  // Text from people is plain: no Markdown, links or mentions of its own.
  assert.match(text, /Use \\\*\\\*bold\\\*\\\* \\\[links\\\]\\\(https:\/​\/evil\.test\\\) and @​team/);
  assert.doesNotMatch(text, /javascript:/);
  assert.doesNotMatch(text, /PR #8|PR #9/);

  assert.match(overview.decisionLogMarkdown(w.project, { entries: [], truncated: false }), /Nothing has been decided yet\./);
});

test('the default view follows the labels: Creator first when someone has both', () => {
  assert.strictEqual(overview.defaultView(['builder', 'creator']), 'creator');
  assert.strictEqual(overview.defaultView(['builder']), 'builder');
  assert.strictEqual(overview.defaultView([]), 'creator');
});
