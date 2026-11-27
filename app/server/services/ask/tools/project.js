'use strict';

/**
 * Project tools: agreements, decisions, PR checks, people, confirmed
 * capabilities and recent commits. All read this project's own rows; only
 * recent_changes reads GitHub (the commit list), through the project's own
 * client.
 */

const { AskToolError, clampInt, short, sinceDate } = require('./safety');
const { loadPlan } = require('./plan');

const LIMITS = Object.freeze({ rows: 20, commits: 50, text: 600, comment: 300 });
const sha12 = (sha) => String(sha || '').slice(0, 12);
const repoName = (project) => `${project.owner}/${project.repo}`.toLowerCase();

function membersOf(ctx) {
  // The promise is cached, so calls made side by side share one read.
  if (!ctx.cache.members) ctx.cache.members = readMembers(ctx);
  return ctx.cache.members;
}

async function readMembers(ctx) {
  const rows = await ctx.deps.projectMembers.list(ctx.project.id).catch(() => []);
  const members = rows.map((m) => ({
    userId: m.user_id,
    // No email, or part of one, is shown in place of a name.
    name: nameOrNull(m.display_name, m.email) || 'A member',
    email: m.email ? String(m.email).toLowerCase() : null,
    labels: Array.isArray(m.labels) ? m.labels : [],
  }));
  if (ctx.project.user_id && !members.some((m) => m.userId === ctx.project.user_id)) {
    members.unshift({ userId: ctx.project.user_id, name: 'The owner', email: null, labels: [], owner: true });
  }
  for (const m of members) if (m.userId === ctx.project.user_id) m.owner = true;
  return members;
}

/** A stored name, unless it is an email (stored names fall back to one). */
function nameOrNull(name, email = null) {
  if (typeof name !== 'string' || !name.trim()) return null;
  const n = name.trim();
  if (n.includes('@')) return null;
  if (email && n.toLowerCase() === String(email).toLowerCase()) return null;
  return n;
}

function nameFor(members, userId, fallback = null) {
  const m = members.find((x) => x.userId === userId);
  return (m && m.name) || nameOrNull(fallback) || 'Someone no longer on the project';
}

function prNumberOf(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace(/^#/, ''));
  if (!Number.isInteger(n) || n <= 0 || n > 10_000_000) throw new AskToolError('`pr` must be a pull request number.');
  return n;
}

/** get_agreements(area?, status?, text?) */
async function getAgreements(ctx, input = {}) {
  const status = input.status == null || input.status === '' ? null : String(input.status);
  if (status && !['proposed', 'accepted', 'declined', 'withdrawn'].includes(status)) {
    throw new AskToolError('`status` is one of proposed, accepted, declined, withdrawn.');
  }
  const area = input.area == null || input.area === '' ? null : String(input.area).toLowerCase();
  const text = input.text == null || input.text === '' ? null : String(input.text).toLowerCase().slice(0, 200);
  const rows = (await ctx.deps.agreements.list(ctx.project.id, { limit: 500 }))
    .filter((a) => !status || a.status === status)
    .filter((a) => !area || String(a.area_id || '').toLowerCase() === area)
    .filter((a) => !text || String(a.text).toLowerCase().includes(text));
  const shown = rows.slice(0, LIMITS.rows);
  const members = await membersOf(ctx);
  const votes = shown.length ? await ctx.deps.agreementVotes.listFor(shown.map((a) => a.id)) : [];
  const out = shown.map((a) => {
    ctx.addSource(a.id, { kind: 'agreement', id: a.id, text: a.text, status: a.status });
    const mine = votes.filter((v) => v.agreement_id === a.id);
    return {
      source_id: a.id,
      area: a.area_id || null,
      text: short(a.text, LIMITS.text),
      status: a.status,
      proposed_by: nameFor(members, a.proposed_by, a.proposed_by_name),
      proposed_at: a.proposed_at,
      decided_by: a.decided_by ? nameFor(members, a.decided_by) : null,
      decided_at: a.decided_at || null,
      decided_how: a.decided_via || null,
      note: a.decision_note ? short(a.decision_note, LIMITS.comment) : null,
      in_the_plan: a.commit_state === 'committed' ? (a.commit_sha ? sha12(a.commit_sha) : true) : false,
      agree: mine.filter((v) => v.vote === 'agree').map((v) => nameFor(members, v.user_id)),
      not_yet: mine.filter((v) => v.vote === 'not_yet').map((v) => ({ who: nameFor(members, v.user_id), comment: short(v.comment || '', LIMITS.comment) })),
    };
  });
  return { agreements: out, more: rows.length > shown.length, sources: out.map((a) => a.source_id) };
}

/** A decision in words; only a finished one reads as made. */
function decisionText(d) {
  const what = d.type === 'accepted' ? 'accept the change' : 'send it back';
  if (d.state === 'done') return d.type === 'accepted' ? 'accepted the change' : 'sent it back';
  if (d.state === 'failed') return `chose to ${what}, but it didn't go through`;
  return `chose to ${what}; not finished yet`;
}

/** get_decisions(pr?, since?) */
async function getDecisions(ctx, input = {}) {
  const pr = prNumberOf(input.pr);
  const since = input.since ? sinceDate(input.since, { defaultDays: 30, maxDays: 365, now: ctx.now() }) : null;
  const rows = pr
    ? await ctx.deps.driftDecisions.listForPr(ctx.project.id, repoName(ctx.project), pr)
    : await ctx.deps.driftDecisions.listRecent(ctx.project.id, { limit: 100 });
  const members = await membersOf(ctx);
  const kept = rows
    .filter((d) => d.state !== 'dismissed')
    .filter((d) => !since || new Date(d.created_at) >= since);
  const shown = kept.slice(0, LIMITS.rows).map((d) => {
    const edits = d.edits && typeof d.edits === 'object' ? d.edits : {};
    ctx.addSource(d.id, { kind: 'decision', id: d.id, pr: Number(d.pr_number) });
    return {
      source_id: d.id,
      pr: Number(d.pr_number),
      checked_commit: sha12(d.head_sha),
      decision: decisionText(d),
      finished: d.state === 'done',
      state: d.state,
      by: nameFor(members, d.actor_user_id, d.actor_name),
      note: d.note ? short(d.note, LIMITS.text) : null,
      plan_changes: Array.isArray(edits.summary) ? edits.summary.slice(0, 8).map((s) => short(s, 200)) : [],
      agreement: d.agreement_id || null,
      at: d.created_at,
    };
  });
  return { decisions: shown, more: kept.length > shown.length, sources: shown.map((d) => d.source_id) };
}

function checkOut(ctx, row) {
  const r = row.result_json && typeof row.result_json === 'object' ? row.result_json : {};
  const id = `pr#${row.pr_number}@${sha12(row.head_sha)}`;
  ctx.addSource(id, { kind: 'pr_check', pr: Number(row.pr_number), sha: row.head_sha });
  const conflicts = Array.isArray(r.conflicts) ? r.conflicts : [];
  return {
    source_id: id,
    pr: Number(row.pr_number),
    checked_commit: sha12(row.head_sha),
    status: row.status,
    verdict: row.verdict || r.verdict || null,
    summary: typeof r.summary === 'string' ? short(r.summary, LIMITS.text) : '',
    conflicts: conflicts.slice(0, 5).map((c) => ({
      area: c && c.area ? String(c.area) : null,
      rule: c && c.rule_or_agreement ? short(c.rule_or_agreement, 300) : null,
      why: c && (c.explanation || c.why) ? short(c.explanation || c.why, 300) : null,
    })),
    closed: !!row.pr_closed_at,
    at: row.completed_at || row.updated_at,
  };
}

/** get_pr_checks(pr?, verdict?, since?) */
async function getPrChecks(ctx, input = {}) {
  const pr = prNumberOf(input.pr);
  const verdict = input.verdict == null || input.verdict === '' ? null : String(input.verdict);
  if (verdict && !['matches', 'drifts', 'needs_decision'].includes(verdict)) {
    throw new AskToolError('`verdict` is one of matches, drifts, needs_decision.');
  }
  const since = input.since ? sinceDate(input.since, { defaultDays: 30, maxDays: 365, now: ctx.now() }) : null;
  const scope = { repo: repoName(ctx.project), installationId: ctx.project.github_installation_id || null, projectId: ctx.project.id };
  let rows;
  if (pr) {
    const one = await ctx.deps.prChecks.latestForPr({ ...scope, prNumber: pr });
    rows = one ? [one] : [];
  } else {
    rows = await ctx.deps.prChecks.latestPerPr({ ...scope, limit: 100 });
  }
  const kept = rows
    .filter((r) => !verdict || r.verdict === verdict)
    .filter((r) => !since || new Date(r.completed_at || r.updated_at) >= since);
  const shown = kept.slice(0, LIMITS.rows).map((r) => checkOut(ctx, r));
  return {
    checks: shown,
    more: kept.length > shown.length,
    message: pr && !shown.length ? `Takeoff hasn't checked PR #${pr}.` : undefined,
    sources: shown.map((c) => c.source_id),
  };
}

/** get_people(area?) */
async function getPeople(ctx, input = {}) {
  const members = await membersOf(ctx);
  const plan = await loadPlan(ctx);
  const area = input.area == null || input.area === '' ? null : String(input.area).toLowerCase();
  const people = members.map((m) => ({
    name: m.name,
    owner: !!m.owner,
    labels: m.labels,
  }));
  let areas = [];
  if (plan.ok) {
    areas = plan.intent.areas
      .filter((a) => !area || a.id.toLowerCase() === area || a.name.toLowerCase() === area)
      .map((a) => {
        const named = [];
        let others = 0;
        for (const c of a.creators) {
          const m = members.find((x) => x.email && x.email === String(c).toLowerCase());
          if (m) named.push(m.name); else others += 1;
        }
        return { area: a.id, name: a.name, creators: named, creators_not_on_project: others };
      });
  }
  return {
    members: area ? [] : people,
    areas,
    plan_available: plan.ok,
    note: 'Creators who aren’t members of this project are counted, not named.',
    sources: [],
  };
}

/** get_capabilities(query?): confirmed statements of what the product does. */
async function getCapabilities(ctx, input = {}) {
  const q = input.query == null || input.query === '' ? null : String(input.query).toLowerCase().slice(0, 200);
  const rows = (await ctx.deps.intentStatements.findConfirmedByProjectId(ctx.project.id))
    .filter((s) => !q || String(s.text || '').toLowerCase().includes(q) || String(s.feature_area || '').toLowerCase().includes(q));
  const shown = rows.slice(0, LIMITS.rows).map((s) => {
    const id = `intent:${s.id}`;
    ctx.addSource(id, { kind: 'capability', id: s.id, text: s.text });
    return {
      source_id: id,
      text: short(s.text, LIMITS.text),
      area: s.feature_area || null,
      holds_in_code: s.satisfied === null || s.satisfied === undefined ? 'not checked' : (s.satisfied ? 'yes' : 'no'),
      last_checked: s.last_checked_at || null,
    };
  });
  return { capabilities: shown, more: rows.length > shown.length, sources: shown.map((c) => c.source_id) };
}

function prFromTitle(title) {
  const m = /\(#(\d{1,7})\)\s*$/.exec(title) || /^Merge pull request #(\d{1,7})\b/.exec(title);
  return m ? Number(m[1]) : null;
}

/** recent_changes(since?): default-branch commits, newest first. */
async function recentChanges(ctx, input = {}) {
  const since = sinceDate(input.since, { defaultDays: 14, maxDays: 90, now: ctx.now() });
  const { project, deps } = ctx;
  let commits;
  try {
    const gh = deps.clientFor(project);
    const meta = await gh.fetchRepoMeta(project.owner, project.repo);
    const branch = (meta && meta.default_branch) || 'main';
    commits = await gh.fetchCommits(project.owner, project.repo, { branch, since: since.toISOString(), perPage: LIMITS.commits });
  } catch {
    return { available: false, reason: 'Takeoff can’t read this repo’s commits right now.', sources: [] };
  }
  const checks = await deps.prChecks.latestPerPr({
    repo: repoName(project), installationId: project.github_installation_id || null, projectId: project.id, limit: 100,
  }).catch(() => []);
  const byPr = new Map(checks.map((c) => [Number(c.pr_number), c]));
  const out = (Array.isArray(commits) ? commits : []).slice(0, LIMITS.commits).map((c) => {
    const id = `commit:${sha12(c.sha)}`;
    ctx.addSource(id, { kind: 'commit', sha: c.sha });
    const pr = prFromTitle(String(c.title || ''));
    const check = pr ? byPr.get(pr) : null;
    return {
      source_id: id,
      sha: sha12(c.sha),
      title: short(c.title || '', 200),
      author: c.authorLogin || c.author || null,
      at: c.date || null,
      pr,
      pr_check: check ? { verdict: check.verdict || null, source_id: checkOut(ctx, check).source_id } : null,
    };
  });
  return {
    since: since.toISOString().slice(0, 10),
    commits: out,
    more: out.length >= LIMITS.commits,
    note: 'Changed files per commit aren’t listed; search or read the code for that.',
    sources: out.map((c) => c.source_id),
  };
}

module.exports = {
  getAgreements, getDecisions, getPrChecks, getPeople, getCapabilities, recentChanges, prFromTitle, LIMITS,
  clampInt,
};
