'use strict';

// Project overview and decision log (Milestone 7).
//
// The overview: the areas in takeoff.yaml with their Creators, open pull
// requests with their verdicts, agreements waiting on votes, and recent
// decisions. Each member lands on the view their label suggests: a Creator
// on what waits for a decision, a Builder on their own pull requests. Labels
// pick the view; every member can see both.
//
// The decision log: agreements that were decided and drift decisions that
// went through, newest first, each linked to its pull request or commit.
// It can be downloaded as Markdown.

const drift = require('../drift');
const { assertMember, currentMembers, oneLine } = require('../agreements');
const { readIntent } = require('../agreements/intent');
const { clean: mdClean } = require('../verdict/comment');

const MAX_PRS = 10;
const MAX_LOG = 500;
const MAX_PENDING = 50;
const RECENT = 5;
const VIEWS = ['creator', 'builder'];
const AGREEMENT_OUTCOMES = new Set(['accepted', 'declined', 'withdrawn']);

function defaultDeps() {
  const db = require('../../lib/db');
  return {
    ...drift.defaultDeps(),
    agreements: db.agreements,
    agreementVotes: db.agreementVotes,
    readIntent: (project) => readIntent(project),
  };
}

const repoOf = (project) => `${project.owner}/${project.repo}`;
const prUrl = (project, n) => `https://github.com/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.repo)}/pull/${Number(n)}`;
/** A stored link is shown only when it is a plain https URL. */
const httpsOrNull = (u) => (typeof u === 'string' && /^https:\/\/[^\s<>"'`]+$/i.test(u) ? u : null);
const iso = (t) => (t ? new Date(t).toISOString() : null);

/** The view a member lands on: Creator first when they hold both labels. */
function defaultView(labels) {
  if (labels.includes('creator')) return 'creator';
  if (labels.includes('builder')) return 'builder';
  return 'creator';
}

async function labelsOf(project, user, deps) {
  const row = await deps.projectMembers.get(project.id, user.id);
  return Array.isArray(row?.labels) ? VIEWS.filter((l) => row.labels.includes(l)) : [];
}

async function githubLoginOf(user, deps) {
  try {
    const link = await deps.userGithubLinks.get(user.id);
    return typeof link?.github_login === 'string' && link.github_login ? link.github_login.toLowerCase() : null;
  } catch {
    return null;
  }
}

const nameIn = (members) => (id) => members.find((m) => m.userId === id)?.name || null;

/** Open PRs with a finished check, newest first, each with its verdict and whether it waits on a decision. */
async function openPullRequests(project, { members, pendingRecIds, decisions }, deps) {
  const rows = await deps.prChecks.latestPerPr({ repo: repoOf(project), ...drift.checkScope(project), limit: 50 });
  const done = rows.filter((r) => r.status === 'done' && r.verdict && !r.pr_closed_at).slice(0, MAX_PRS);
  let gh = null;
  try { gh = deps.readClientFor(project); } catch { gh = null; }
  const prs = await Promise.all(done.map(async (row) => {
    const n = Number(row.pr_number);
    const res = drift.storedResult(row);
    const pr = gh ? await drift.cachedLivePr(gh, project, n, deps.prCache).catch(() => null) : null;
    const forPr = decisions.filter((d) => Number(d.pr_number) === n);
    const decided = forPr.some((d) => d.head_sha === row.head_sha && d.state === 'done');
    return {
      prNumber: n,
      title: pr?.title || null,
      url: httpsOrNull(pr?.url) || prUrl(project, n),
      author: pr?.author || null,
      state: pr?.state || 'open',
      headSha: row.head_sha,
      verdict: res.verdict,
      summary: res.summary,
      checkedAt: iso(row.completed_at || row.updated_at),
      newerPush: !!(pr?.headSha && pr.headSha !== row.head_sha),
      needsDecision: drift.REVIEW_VERDICTS.has(res.verdict) && !decided,
      lastDecision: forPr[0] ? drift.publicDecision(forPr[0], { members, pendingRecIds }) : null,
    };
  }));
  return prs.filter((p) => p.state === 'open');
}

/** Agreements still waiting on votes, with how many current members agreed and whether you have. */
async function pendingAgreements(project, user, { members, intent, rows }, deps) {
  const open = rows.filter((a) => a.status === 'proposed').slice(0, MAX_PENDING);
  const votes = open.length ? await deps.agreementVotes.listFor(open.map((a) => a.id)) : [];
  const memberIds = new Set(members.map((m) => m.userId));
  const name = nameIn(members);
  return open.map((a) => {
    const v = votes.filter((x) => x.agreement_id === a.id && memberIds.has(x.user_id));
    const mine = v.find((x) => x.user_id === user.id);
    return {
      id: a.id,
      text: a.text,
      areaId: a.area_id || null,
      areaName: a.area_id ? intent.areas.find((x) => x.id === a.area_id)?.name || null : null,
      proposedBy: { userId: a.proposed_by, name: a.proposed_by_name || name(a.proposed_by) },
      proposedAt: iso(a.proposed_at),
      agreed: v.filter((x) => x.vote === 'agree').length,
      notYet: v.filter((x) => x.vote === 'not_yet').length,
      members: members.length,
      yourVote: mine?.vote || null,
    };
  });
}

/** Decided agreements and finished drift decisions, newest first. */
function logEntries(project, { agreements, decisions, members, intent }) {
  const name = nameIn(members);
  const out = [];
  for (const a of agreements) {
    if (!AGREEMENT_OUTCOMES.has(a.status) || !a.decided_at) continue;
    out.push({
      kind: 'agreement',
      id: a.id,
      at: iso(a.decided_at),
      outcome: a.status,
      via: a.decided_via || null,
      text: a.text,
      areaName: a.area_id ? intent.areas.find((x) => x.id === a.area_id)?.name || a.area_id : null,
      proposedBy: { userId: a.proposed_by, name: a.proposed_by_name || name(a.proposed_by) },
      decidedBy: a.decided_by ? { userId: a.decided_by, name: name(a.decided_by) } : null,
      note: a.decision_note || null,
      commitUrl: httpsOrNull(a.commit_url),
      commitPrUrl: httpsOrNull(a.commit_pr_url),
      sourceUrl: httpsOrNull(a.source),
    });
  }
  for (const d of decisions) {
    if (d.state !== 'done') continue;
    const p = drift.publicDecision(d, { members });
    out.push({
      kind: 'decision',
      id: d.id,
      at: iso(d.done_at || d.updated_at || d.created_at),
      outcome: d.type,
      prNumber: p.prNumber,
      prUrl: prUrl(project, p.prNumber),
      by: p.by,
      confirmedBy: p.confirmedBy,
      note: p.note,
      changes: p.changes,
      agreementText: p.agreementText,
      commitUrl: httpsOrNull(p.commitUrl),
      commentUrl: httpsOrNull(p.commentUrl),
    });
  }
  return out.sort((x, y) => String(y.at).localeCompare(String(x.at)) || String(x.id).localeCompare(String(y.id)));
}

async function loadLog(project, { members, intent }, deps) {
  const [agreements, decisions] = await Promise.all([
    deps.agreements.list(project.id, { limit: MAX_LOG }),
    deps.driftDecisions.listRecent(project.id, { limit: MAX_LOG }),
  ]);
  return {
    agreements,
    decisions,
    entries: logEntries(project, { agreements, decisions, members, intent }),
    truncated: agreements.length >= MAX_LOG || decisions.length >= MAX_LOG,
  };
}

const NO_INTENT = { ok: false, reason: 'app_not_installed', branch: null, areas: [] };

async function context(project, user, deps) {
  await assertMember(project, user, deps);
  const linked = await drift.isLinked(project, deps);
  const [members, intent] = await Promise.all([
    currentMembers(project, deps),
    linked ? deps.readIntent(project) : NO_INTENT,
  ]);
  return { linked, members, intent: intent || NO_INTENT };
}

/**
 * Everything the overview shows for `user`.
 */
async function getOverview({ project, user }, deps = defaultDeps()) {
  const { linked, members, intent } = await context(project, user, deps);
  const [labels, login, log, pendingRecIds] = await Promise.all([
    labelsOf(project, user, deps),
    githubLoginOf(user, deps),
    loadLog(project, { members, intent }, deps),
    drift.pendingRecommendationIds(project, deps),
  ]);
  const [prs, pending] = await Promise.all([
    linked ? openPullRequests(project, { members, pendingRecIds, decisions: log.decisions }, deps) : [],
    pendingAgreements(project, user, { members, intent, rows: log.agreements }, deps),
  ]);
  const byEmail = new Map(members.filter((m) => m.email).map((m) => [m.email, m]));
  return {
    view: { default: defaultView(labels), labels },
    linked,
    intent: { ok: !!intent.ok, reason: intent.reason || null, branch: intent.branch || null },
    areas: intent.areas.map((a) => ({
      id: a.id,
      name: a.name,
      creators: a.creators.map((email) => ({ email, name: byEmail.get(email)?.name || null, member: byEmail.has(email) })),
    })),
    pullRequests: prs.map((p) => ({ ...p, yours: !!(login && p.author && p.author.toLowerCase() === login) })),
    githubLinked: !!login,
    pendingAgreements: pending,
    recentDecisions: log.entries.slice(0, RECENT),
  };
}

/** The whole decision log for the project. */
async function getDecisionLog({ project, user }, deps = defaultDeps()) {
  const { members, intent } = await context(project, user, deps);
  const log = await loadLog(project, { members, intent }, deps);
  return { entries: log.entries, truncated: log.truncated };
}

// ── Markdown ───────────────────────────────────────────────────────────

const md = (t, max = 1000) => mdClean(oneLine(String(t ?? '')), { max });
const who = (p) => (p?.name ? md(p.name, 80) : 'a teammate');
const pct = (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`;
const link = (label, url) => (httpsOrNull(url) ? `[${label}](${url.replace(/[()]/g, pct)})` : null);

const VIA = { everyone_agreed: 'everyone agreed', stall_fallback: 'decided after 48 hours without objection', withdrawn: 'withdrawn' };

function entryLine(e) {
  const parts = [];
  if (e.kind === 'agreement') {
    const verb = { accepted: 'Agreement accepted', declined: 'Agreement declined', withdrawn: 'Agreement withdrawn' }[e.outcome];
    const via = e.via && e.via !== 'withdrawn' && VIA[e.via] ? ` (${VIA[e.via]})` : '';
    parts.push(`**${verb}**${via}: ${md(e.text)}`);
    if (e.areaName) parts.push(`Area: ${md(e.areaName, 120)}.`);
    const by = e.decidedBy && e.outcome !== 'withdrawn' ? `; decided by ${who(e.decidedBy)}` : '';
    parts.push(`Proposed by ${who(e.proposedBy)}${by}.`);
    if (e.note) parts.push(`Note: ${md(e.note)}`);
    const links = [link('Commit', e.commitUrl), link('Pull request', e.commitPrUrl), link('Source', e.sourceUrl)].filter(Boolean);
    if (links.length) parts.push(links.join(' · '));
  } else {
    const confirmed = e.confirmedBy ? `, confirmed by ${who(e.confirmedBy)}` : '';
    if (e.outcome === 'accepted') {
      parts.push(`**PR #${e.prNumber}: drift accepted into takeoff.yaml** by ${who(e.by)}${confirmed}.`);
      if (e.changes?.length) parts.push(`Changes: ${e.changes.map((c) => md(c, 300)).join('; ')}.`);
      if (e.agreementText) parts.push(`Recorded as an agreement: ${md(e.agreementText)}`);
    } else {
      parts.push(`**PR #${e.prNumber}: sent back** by ${who(e.by)}${confirmed}.`);
      if (e.note) parts.push(`Note: ${md(e.note)}`);
    }
    const links = [link('Pull request', e.prUrl), link('Commit', e.commitUrl), link('Comment', e.commentUrl)].filter(Boolean);
    if (links.length) parts.push(links.join(' · '));
  }
  return `- ${parts.join(' ')}`;
}

/** The decision log as a Markdown document, grouped by day (UTC), newest first. */
function decisionLogMarkdown(project, { entries, truncated }, { now = new Date() } = {}) {
  const name = project.owner && project.repo ? md(repoOf(project), 200) : 'this project';
  const lines = [`# Decision log: ${name}`, '', `Exported from Takeoff on ${now.toISOString().slice(0, 10)}. Newest first; days are in UTC.`];
  if (truncated) lines.push('', `This export holds the latest ${MAX_LOG} agreements and ${MAX_LOG} decisions.`);
  if (!entries.length) lines.push('', 'Nothing has been decided yet.');
  let day = null;
  for (const e of entries) {
    const d = String(e.at || '').slice(0, 10) || 'Undated';
    if (d !== day) {
      lines.push('', `## ${d}`, '');
      day = d;
    }
    lines.push(entryLine(e));
  }
  return `${lines.join('\n')}\n`;
}

module.exports = { getOverview, getDecisionLog, decisionLogMarkdown, defaultDeps, defaultView, logEntries };
