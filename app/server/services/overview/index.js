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
const { maskEmail } = require('../team/members');

const MAX_PRS = 10;
const MAX_SHOWN_PRS = 40;
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
/** A PR's link, from a repo full name like `owner/repo`. */
const prUrl = (fullName, n) => {
  const [owner, repo, extra] = String(fullName || '').split('/');
  if (!owner || !repo || extra !== undefined || owner === 'undefined' || repo === 'undefined') return null;
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pull/${Number(n)}`;
};
const hasRepo = (project) => !!(project.owner && project.repo);
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

// Open PRs come from one GitHub call per project, cached briefly. A failure
// is cached for less time, so a broken install doesn't use up the App's
// rate limit when the page is reloaded.
const OPEN_PRS_MS = 60 * 1000;
const OPEN_PRS_FAIL_MS = 20 * 1000;
const OPEN_PRS_PAGE = 100;
const OPEN_PRS_PAGES = 3;
const OPEN_PRS_CACHE_MAX = 500;
const sharedOpenPrCache = new Map();

async function openPrsOnGithub(project, deps) {
  const cache = deps.openPrCache === undefined ? sharedOpenPrCache : deps.openPrCache;
  const key = `${project.github_installation_id}:${repoOf(project).toLowerCase()}`;
  const hit = cache?.get(key);
  if (hit && Date.now() - hit.at < (hit.value.ok ? OPEN_PRS_MS : OPEN_PRS_FAIL_MS)) return hit.value;
  let value;
  try {
    const gh = deps.readClientFor(project);
    const fetchedAt = Date.now();
    const prs = new Map();
    let complete = false;
    for (let page = 1; page <= OPEN_PRS_PAGES && !complete; page += 1) {
      const list = await gh.fetchRepoPulls(project.owner, project.repo, { state: 'open', perPage: OPEN_PRS_PAGE, page });
      const rows = Array.isArray(list) ? list : [];
      for (const p of rows) {
        prs.set(Number(p.number), {
          title: typeof p.title === 'string' ? p.title : null,
          url: httpsOrNull(p.html_url),
          author: typeof p.user?.login === 'string' ? p.user.login : null,
          headSha: p.head?.sha || null,
        });
      }
      // A full page may not be the last: then a PR missing from it isn't known to be closed.
      complete = rows.length < OPEN_PRS_PAGE;
    }
    value = { ok: true, complete, fetchedAt, prs };
  } catch {
    value = { ok: false, complete: false, fetchedAt: 0, prs: new Map() };
  }
  if (cache) {
    if (cache.size >= OPEN_PRS_CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { at: Date.now(), value });
  }
  return value;
}

const CHECK_STATES = new Set(['done', 'running', 'failed']);

/**
 * Open PRs with a Takeoff check, newest first: their verdict, whether they
 * wait on a decision, and whether they're `login`'s. Every PR of `login`'s is
 * kept; the others are cut to the newest few.
 */
async function openPullRequests(project, { members, pendingRecIds, decisions, login }, deps) {
  const rows = await deps.prChecks.latestPerPr({ repo: repoOf(project), ...drift.checkScope(project), limit: 100 });
  const live = await openPrsOnGithub(project, deps);
  const repo = repoOf(project).toLowerCase();
  const prs = [];
  for (const row of rows) {
    if (row.pr_closed_at || !CHECK_STATES.has(row.status)) continue;
    const n = Number(row.pr_number);
    const pr = live.prs.get(n) || null;
    // GitHub says it isn't open, unless Takeoff saw it after that list was read.
    const seenAt = new Date(row.created_at || row.updated_at || 0).getTime();
    if (!pr && live.complete && seenAt < live.fetchedAt) continue;
    const done = row.status === 'done' && !!row.verdict;
    const res = done ? drift.storedResult(row) : { verdict: null, summary: '' };
    const forPr = decisions.filter((d) => Number(d.pr_number) === n
      && (!d.repo_full_name || String(d.repo_full_name).toLowerCase() === repo));
    const decided = forPr.some((d) => d.head_sha === row.head_sha && (d.state === 'done' || d.state === 'working'));
    const newerPush = !!(pr?.headSha && pr.headSha !== row.head_sha);
    prs.push({
      prNumber: n,
      title: pr?.title || null,
      url: pr?.url || prUrl(repoOf(project), n),  // null only for a project with no repo
      author: pr?.author || null,
      headSha: row.head_sha,
      verdict: res.verdict,
      summary: res.summary,
      checking: row.status === 'running',
      checkFailed: row.status === 'failed' || (row.status === 'done' && !row.verdict),
      checkedAt: iso(row.completed_at || row.updated_at),
      newerPush,
      needsDecision: done && drift.REVIEW_VERDICTS.has(res.verdict) && !newerPush && !decided,
      lastDecision: forPr[0] ? drift.publicDecision(forPr[0], { members, pendingRecIds }) : null,
      yours: !!(login && pr?.author && pr.author.toLowerCase() === login),
    });
  }
  // Yours first, then what waits on a decision, then the newest few others,
  // shown in the order they came (newest first).
  const yours = prs.filter((p) => p.yours);
  const deciding = prs.filter((p) => !p.yours && p.needsDecision);
  const others = prs.filter((p) => !p.yours && !p.needsDecision).slice(0, MAX_PRS);
  const keep = new Set([...yours, ...deciding, ...others].slice(0, Math.max(MAX_SHOWN_PRS, yours.length)));
  return { prs: prs.filter((p) => keep.has(p)), githubReachable: live.ok, githubComplete: live.ok && live.complete };
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
  const repo = hasRepo(project) ? repoOf(project).toLowerCase() : null;
  for (const d of decisions) {
    if (d.state !== 'done') continue;
    // Decisions about a repo the project no longer points at stay out.
    if (repo && d.repo_full_name && String(d.repo_full_name).toLowerCase() !== repo) continue;
    const p = drift.publicDecision(d, { members });
    out.push({
      kind: 'decision',
      id: d.id,
      at: iso(d.done_at || d.updated_at || d.created_at),
      outcome: d.type,
      prNumber: p.prNumber,
      prUrl: prUrl(d.repo_full_name || (hasRepo(project) ? repoOf(project) : null), p.prNumber),
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

// The overview needs open agreements (listed first by the store) and the
// decisions on open PRs; the full log reads more. One extra row tells
// whether anything was left out.
const OVERVIEW_ROWS = { agreements: 150, decisions: 200 };

async function loadLog(project, { members, intent, limit = MAX_LOG, limits = null }, deps) {
  const max = limits || { agreements: limit, decisions: limit };
  const [a, d] = await Promise.all([
    deps.agreements.list(project.id, { limit: max.agreements + 1 }),
    deps.driftDecisions.listRecent(project.id, { limit: max.decisions + 1 }),
  ]);
  const agreements = a.slice(0, max.agreements);
  const decisions = d.slice(0, max.decisions);
  return {
    agreements,
    decisions,
    entries: logEntries(project, { agreements, decisions, members, intent }),
    truncated: a.length > max.agreements || d.length > max.decisions,
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
    loadLog(project, { members, intent, limits: OVERVIEW_ROWS }, deps),
    drift.pendingRecommendationIds(project, deps),
  ]);
  const [open, pending] = await Promise.all([
    linked ? openPullRequests(project, { members, pendingRecIds, decisions: log.decisions, login }, deps) : { prs: [], githubReachable: true, githubComplete: true },
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
      // A Creator who isn't on the project shows as a masked address.
      creators: a.creators.map((email) => (byEmail.has(email)
        ? { email, name: byEmail.get(email).name || null, member: true }
        : { email: maskEmail(email), name: null, member: false })),
    })),
    pullRequests: open.prs,
    githubReachable: open.githubReachable,
    githubComplete: open.githubComplete,
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
  if (truncated) lines.push('', 'This export leaves out the oldest entries: it holds the most recent agreements and decisions only.');
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
