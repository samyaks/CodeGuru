'use strict';

// Drift review (Milestone 5). When the PR check says a PR drifts from
// takeoff.yaml (⚠️) or needs a decision (❓), the area's Creators are emailed
// and any member can open the review page: what the intent says, what the PR
// does, and why they conflict. Two decisions:
//
//   Accept & update intent: Takeoff commits the takeoff.yaml change (and the
//     regenerated agent files) to the PR's branch, then checks the PR again.
//     The check trusts takeoff.yaml changes that an accept committed.
//   Send back: a required note, posted on the PR by the Takeoff App, where
//     `takeoff notes` (and the Claude Code hook) read it for that branch.
//
// Both write to GitHub, so a member without write access leaves a
// recommendation (Milestone 2) that anyone with write access confirms.
// Every decision is a drift_decisions row.

const crypto = require('crypto');
const {
  FILENAME, applyIntentEdits, IntentEditError, addAgreement, AgreementError, agreementId,
  renderAgentFiles, AGENT_FILE_PATHS, sendBackMarker, MAX_INTENT_EDITS,
} = require('@takeoff/cli');
const { AppError } = require('../../lib/app-error');
const committing = require('../team/committing');
const { assertMember, currentMembers, clean, oneLine, nameOf, confirmedEmail } = require('../agreements');
const { treeEntry, writable } = require('../agreements/commit');
const notify = require('../agreements/notify');
const { loadIntent } = require('../verdict/intent');
const { LABELS, clean: mdClean } = require('../verdict/comment');

const ACTION = 'drift.decision';
const SHA_RE = /^[0-9a-f]{7,64}$/;
const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;
const REVIEW_VERDICTS = new Set(['drifts', 'needs_decision']);
const MAX_NOTE = 2000;
const MAX_AGREEMENT = 1000;
const MAX_FAST_FORWARD_RETRIES = 3;

const sha256 = (text) => (text === null || text === undefined ? 'none' : crypto.createHash('sha256').update(String(text), 'utf8').digest('hex'));

let emailOn;
function defaultDeps() {
  const db = require('../../lib/db');
  const { getGithubApp } = require('../../lib/github-app');
  if (emailOn === undefined) emailOn = !!notify.transportFromEnv();
  const client = (project, permissions) => getGithubApp().clientForInstallation(Number(project.github_installation_id), { repo: project.repo, permissions });
  return {
    prChecks: db.prChecks,
    driftDecisions: db.driftDecisions,
    projectMembers: db.projectMembers,
    userGithubLinks: db.userGithubLinks,
    recommendations: db.recommendations,
    notificationOutbox: db.notificationOutbox,
    emailEnabled: emailOn,
    readClientFor: (project) => client(project, { contents: 'read', metadata: 'read', pull_requests: 'read' }),
    writeClientFor: (project) => client(project, { contents: 'write', metadata: 'read', pull_requests: 'write' }),
    committing: {
      recommendations: db.recommendations,
      userGithubLinks: db.userGithubLinks,
      clientForInstallation: (id, repo) => getGithubApp().clientForInstallation(id, { repo }),
      newId: () => crypto.randomUUID(),
    },
    runPrCheck: (job) => require('../verdict/runner').runPrCheck(job),
    appUrl: require('../team/members').appUrlFromEnv(),
    now: () => new Date(),
    newId: () => `dec_${crypto.randomBytes(9).toString('base64url')}`,
    random: () => crypto.randomBytes(3).toString('hex'),
  };
}

const repoOf = (project) => `${project.owner}/${project.repo}`;
const reviewLink = (project, prNumber, deps) => `${deps.appUrl}/read/${encodeURIComponent(project.id)}/drift/${prNumber}`;

function parsePrNumber(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 1e9) throw AppError.badRequest('That is not a pull request number.');
  return n;
}

function requireRepo(project) {
  if (!project.owner || !project.repo || !project.github_installation_id) {
    throw AppError.badRequest('Connect this project to GitHub through the Takeoff App to review its pull requests.');
  }
}

/** The check result, as stored by the PR verdict. */
function storedResult(row) {
  const r = row?.result_json && typeof row.result_json === 'object' ? row.result_json : {};
  const { render = {}, ...result } = r;
  return {
    verdict: row?.verdict || result.verdict || null,
    summary: typeof result.summary === 'string' ? result.summary : '',
    conflicts: Array.isArray(result.conflicts) ? result.conflicts : [],
    suggestedAgreement: typeof result.suggested_agreement === 'string' ? result.suggested_agreement : null,
    areaNames: render.areaNames && typeof render.areaNames === 'object' ? render.areaNames : {},
    notes: Array.isArray(render.notes) ? render.notes.filter((n) => typeof n === 'string') : [],
  };
}

/** Where a quoted rule lives in the intent, so an accept can name it exactly. */
function targetFor(intent, conflict) {
  if (!intent) return null;
  const text = oneLine(conflict.rule_or_agreement || '');
  if (!text) return null;
  const area = intent.areas.find((a) => a.id === conflict.area);
  if (area) {
    if (area.rules.some((r) => oneLine(r.text) === text)) return { kind: 'rule', area: area.id, text };
    if (area.never.some((r) => oneLine(r.text) === text)) return { kind: 'never', area: area.id, text };
  }
  const agr = intent.agreements.filter((g) => oneLine(g.text) === text);
  if (agr.length) return { kind: 'agreement', area: agr.find((g) => g.area === conflict.area)?.area ?? agr[0].area, text };
  return null;
}

function publicDecision(d, { members = [], pendingRecIds = null } = {}) {
  const nameFor = (id) => members.find((m) => m.userId === id)?.name || null;
  const edits = d.edits && typeof d.edits === 'object' ? d.edits : {};
  let state = d.state;
  if (state === 'waiting_for_write' && pendingRecIds && d.recommendation_id && !pendingRecIds.has(d.recommendation_id)) state = 'dismissed';
  return {
    id: d.id,
    prNumber: Number(d.pr_number),
    headSha: d.head_sha,
    type: d.type,
    state,
    note: d.note || null,
    changes: Array.isArray(edits.summary) ? edits.summary : [],
    agreementText: edits.agreementText || null,
    agreementId: d.agreement_id || null,
    by: { userId: d.actor_user_id, name: d.actor_name || nameFor(d.actor_user_id) },
    confirmedBy: d.confirmed_by ? { userId: d.confirmed_by, name: nameFor(d.confirmed_by) } : null,
    commitUrl: d.commit_url || null,
    commentUrl: d.comment_url || null,
    recommendationId: d.recommendation_id || null,
    error: d.error || null,
    createdAt: d.created_at,
    doneAt: d.done_at || null,
  };
}

async function pendingRecommendationIds(project, deps) {
  try {
    return new Set((await deps.recommendations.listPending(project.id)).map((r) => r.id));
  } catch {
    return null;
  }
}

/** Live PR facts from GitHub, or null if GitHub can't be asked. */
async function livePr(gh, project, prNumber) {
  const pr = await gh.fetchPullRequest(project.owner, project.repo, prNumber);
  return {
    number: Number(pr.number),
    title: typeof pr.title === 'string' ? pr.title : `PR #${prNumber}`,
    url: pr.html_url,
    author: pr.user?.login || null,
    branch: pr.head?.ref || null,
    headSha: pr.head?.sha || null,
    baseSha: pr.base?.sha || null,
    state: pr.merged_at ? 'merged' : pr.state,
    // A deleted fork shows no head repo: treat it as a fork too.
    fork: !pr.head?.repo || String(pr.head.repo.full_name || '').toLowerCase() !== repoOf(project).toLowerCase(),
  };
}

/**
 * PRs whose newest check drifts or needs a decision, and recent decisions.
 */
async function listDrift({ project, user }, deps = defaultDeps()) {
  await assertMember(project, user, deps);
  if (!project.owner || !project.repo) return { reviews: [], decisions: [] };
  const repo = repoOf(project);
  const [rows, recent, members, pendingRecIds] = await Promise.all([
    deps.prChecks.latestPerPr(project.id, repo, { limit: 50 }),
    deps.driftDecisions.listRecent(project.id, { limit: 20 }),
    currentMembers(project, deps),
    pendingRecommendationIds(project, deps),
  ]);
  const open = rows.filter((r) => r.status === 'done' && REVIEW_VERDICTS.has(r.verdict) && !r.pr_closed_at).slice(0, 15);
  let gh = null;
  try { gh = project.github_installation_id ? deps.readClientFor(project) : null; } catch { gh = null; }
  const reviews = await Promise.all(open.map(async (row) => {
    const res = storedResult(row);
    let pr = null;
    if (gh) pr = await livePr(gh, project, Number(row.pr_number)).catch(() => null);
    const last = recent.find((d) => Number(d.pr_number) === Number(row.pr_number));
    return {
      prNumber: Number(row.pr_number),
      title: pr?.title || null,
      url: pr?.url || null,
      state: pr?.state || 'open',
      headSha: row.head_sha,
      verdict: res.verdict,
      summary: res.summary,
      conflictCount: res.conflicts.length,
      checkedAt: row.completed_at || row.updated_at,
      newerPush: !!(pr?.headSha && pr.headSha !== row.head_sha),
      lastDecision: last ? publicDecision(last, { members, pendingRecIds }) : null,
    };
  }));
  return {
    reviews: reviews.filter((r) => r.state === 'open'),
    decisions: recent.map((d) => publicDecision(d, { members, pendingRecIds })),
  };
}

/** Whether `user` can act directly (write access) or will leave a recommendation. */
async function accessFor(project, user, deps) {
  try {
    const a = await committing.writeAccess(project, user, deps.committing);
    return { canWrite: a.canWrite, reason: a.reason };
  } catch (err) {
    console.warn('[drift] write access check failed:', err.message);
    return { canWrite: false, reason: 'github_check_failed' };
  }
}

/**
 * Everything the review page shows for one PR.
 */
async function getReview({ project, user, prNumber: raw }, deps = defaultDeps()) {
  await assertMember(project, user, deps);
  requireRepo(project);
  const prNumber = parsePrNumber(raw);
  const repo = repoOf(project);
  const row = await deps.prChecks.latestForPr({ repo, prNumber });
  if (!row || row.project_id !== project.id) throw AppError.notFound('Takeoff has not checked this pull request.');
  const gh = deps.readClientFor(project);
  const pr = await livePr(gh, project, prNumber).catch((err) => {
    console.warn('[drift] reading the PR failed:', err.message);
    return null;
  });
  const res = storedResult(row);

  // The intent the check judged against (the base), and the PR's own, which
  // is what an accept edits.
  let baseIntent = null;
  let headIntent = null;
  let yamlChanged = false;
  if (pr) {
    const [baseText, headText] = await Promise.all([
      pr.baseSha ? gh.fetchFileTextOrNull(project.owner, project.repo, FILENAME, pr.baseSha).catch(() => null) : null,
      gh.fetchFileTextOrNull(project.owner, project.repo, FILENAME, row.head_sha).catch(() => null),
    ]);
    const b = loadIntent(baseText);
    const h = loadIntent(headText);
    baseIntent = b.ok ? b.intent : null;
    headIntent = h.ok ? h.intent : null;
    yamlChanged = baseText !== headText;
  }
  const judged = baseIntent || headIntent;
  const areaIds = new Set(res.conflicts.map((c) => c.area).filter(Boolean));
  const areas = (headIntent || judged)?.areas
    .filter((a) => areaIds.has(a.id) || (!areaIds.size && res.verdict === 'needs_decision'))
    .map((a) => ({ id: a.id, name: a.name, creators: a.creators, rules: a.rules.map((r) => r.text), never: a.never.map((r) => r.text) })) || [];
  const allAreas = (headIntent || judged)?.areas.map((a) => ({ id: a.id, name: a.name })) || [];

  const [decisions, members, pendingRecIds, access] = await Promise.all([
    deps.driftDecisions.listForPr(project.id, repo, prNumber),
    currentMembers(project, deps),
    pendingRecommendationIds(project, deps),
    accessFor(project, user, deps),
  ]);
  const working = decisions.some((d) => d.state === 'working');
  const reviewable = !!pr && pr.state === 'open' && row.status === 'done' && REVIEW_VERDICTS.has(res.verdict);
  return {
    pr: pr && {
      number: pr.number, title: pr.title, url: pr.url, filesUrl: `${pr.url}/files`, author: pr.author,
      branch: pr.branch, headSha: pr.headSha, state: pr.state, fork: pr.fork,
    },
    check: {
      headSha: row.head_sha,
      status: row.status,
      verdict: res.verdict,
      summary: res.summary,
      notes: res.notes,
      suggestedAgreement: res.suggestedAgreement,
      checkedAt: row.completed_at || row.updated_at,
      newerPush: !!(pr?.headSha && pr.headSha !== row.head_sha),
      conflicts: res.conflicts.map((c) => ({
        area: c.area || null,
        areaName: res.areaNames[c.area] || c.area || null,
        ruleOrAgreement: c.rule_or_agreement || '',
        explanation: c.explanation || '',
        files: Array.isArray(c.files) ? c.files.slice(0, 20) : [],
        target: targetFor(headIntent, c),
      })),
    },
    intent: { areas, allAreas, yamlChanged, headValid: !!headIntent },
    decisions: decisions.map((d) => publicDecision(d, { members, pendingRecIds })),
    you: {
      canDecide: reviewable && !working && !pr.fork,
      whyNot: !pr ? 'github_unavailable' : pr.fork ? 'fork' : pr.state !== 'open' ? 'closed' : !reviewable ? 'no_drift' : working ? 'decision_running' : null,
      canWrite: access.canWrite,
      writeReason: access.reason,
    },
  };
}

function checkAgreementText(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const t = oneLine(raw);
  if (!t) return null;
  if (t.length > MAX_AGREEMENT) throw AppError.badRequest(`The agreement is too long (at most ${MAX_AGREEMENT} characters).`);
  return t;
}

/** Clean what a browser sent as edits; the CLI checks them again against the file. */
function cleanEdits(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw AppError.badRequest('Changes must be a list.');
  if (raw.length > MAX_INTENT_EDITS) throw AppError.badRequest(`At most ${MAX_INTENT_EDITS} changes at once.`);
  const str = (v) => (typeof v === 'string' ? clean(v) : v);
  return raw.map((e) => {
    if (!e || typeof e !== 'object') throw AppError.badRequest('Each change must remove, reword or add.');
    const out = { op: e.op };
    if (e.op === 'add') Object.assign(out, { kind: e.kind, area: str(e.area), text: str(e.text) });
    else Object.assign(out, { target: e.target && typeof e.target === 'object' ? { kind: e.target.kind, area: str(e.target.area) || null, text: str(e.target.text) } : null, to: str(e.to) });
    return out;
  });
}

/** Check the PR is the one the reviewer saw, open, from this repo, and still drifting. */
async function loadDecidable(project, prNumber, headSha, deps) {
  if (typeof headSha !== 'string' || !SHA_RE.test(headSha)) throw AppError.badRequest('Missing which commit you reviewed.');
  const repo = repoOf(project);
  const row = await deps.prChecks.latestForPr({ repo, prNumber });
  if (!row || row.project_id !== project.id) throw AppError.notFound('Takeoff has not checked this pull request.');
  const gh = deps.readClientFor(project);
  const pr = await livePr(gh, project, prNumber);
  if (pr.state !== 'open') throw AppError.conflict('This pull request is closed.');
  if (pr.fork) throw AppError.badRequest('This pull request comes from a fork, so Takeoff can\'t commit to its branch or decide on it here.');
  if (pr.headSha !== headSha || row.head_sha !== headSha) {
    throw AppError.conflict('This pull request has changed since you opened it. Reload to see the latest check.');
  }
  if (row.status !== 'done' || !REVIEW_VERDICTS.has(row.verdict)) throw AppError.conflict('The latest check of this pull request needs no decision.');
  return { pr, row };
}

/**
 * Start a decision: run it now, or leave a recommendation when `user` can't
 * write to the repo.
 */
async function decide({ project, user, prNumber: raw, body = {}, type }, deps) {
  await assertMember(project, user, deps);
  requireRepo(project);
  const prNumber = parsePrNumber(raw);
  let note = null;
  let edits = null;
  if (type === 'sent_back') {
    note = clean(String(body.note ?? '')).replace(/\r\n?/g, '\n');
    if (!note) throw AppError.badRequest('Say what the builder should change.');
    if (note.length > MAX_NOTE) throw AppError.badRequest(`The note is too long (at most ${MAX_NOTE} characters).`);
  } else {
    const list = cleanEdits(body.edits);
    const agreementText = checkAgreementText(body.agreement);
    edits = { edits: list, agreementText, agreedBy: confirmedEmail(user), summary: [] };
  }
  const { pr } = await loadDecidable(project, prNumber, body.headSha, deps);
  if (type === 'accepted') {
    // Try the edits now, so a mistake is reported before anything is queued.
    const gh = deps.readClientFor(project);
    const [yamlText, baseText] = await Promise.all([
      gh.fetchFileTextOrNull(project.owner, project.repo, FILENAME, pr.headSha),
      pr.baseSha ? gh.fetchFileTextOrNull(project.owner, project.repo, FILENAME, pr.baseSha) : null,
    ]);
    // A PR that edits takeoff.yaml itself can be accepted as it is.
    const ownChanges = yamlText !== null && yamlText !== baseText;
    edits.summary = planAccept({ yamlText, edits: { ...edits, allowNoEdits: ownChanges }, pr, deps }).summary;
    if (ownChanges) edits.summary.unshift(`Accept this PR's own changes to ${FILENAME}`);
  }

  const decision = await deps.driftDecisions.create({
    id: deps.newId(), projectId: project.id, repo: repoOf(project), prNumber, headSha: pr.headSha, branch: pr.branch,
    type, note, edits, actorUserId: user.id, actorName: nameOf(user),
  });
  if (!decision) throw AppError.conflict('Someone is deciding on this pull request right now. Reload in a moment.');

  const access = await accessFor(project, user, deps);
  if (!access.canWrite) {
    const summary = type === 'sent_back'
      ? `Send PR #${prNumber} back: "${note.length > 200 ? `${note.slice(0, 199)}…` : note}"`
      : `Accept the drift on PR #${prNumber} and update takeoff.yaml: ${edits.summary.join('; ').slice(0, 300) || 'accept the PR\'s own takeoff.yaml changes'}`;
    try {
      const rec = await deps.committing.recommendations.create({
        id: deps.committing.newId(), projectId: project.id, actionType: ACTION, payload: { decisionId: decision.id }, summary: summary.slice(0, 500), createdBy: user.id,
      });
      const waiting = await deps.driftDecisions.finish(decision.id, { state: 'waiting_for_write', recommendationId: rec.id });
      return { decision: publicDecision(waiting || decision), status: 'recommended', reason: access.reason };
    } catch (err) {
      await deps.driftDecisions.finish(decision.id, { state: 'failed', error: 'Couldn\'t save the recommendation. Try again.' }).catch(() => {});
      throw err;
    }
  }
  const done = await execute(project, decision, { userId: user.id }, deps);
  return { decision: publicDecision(done), status: done.state === 'done' ? 'done' : 'failed' };
}

/** What an accept will commit, worked out from the PR's takeoff.yaml. Throws AppError on a bad edit. */
function planAccept({ yamlText, edits, pr, deps }) {
  if (yamlText === null || yamlText === undefined) throw AppError.badRequest(`There's no ${FILENAME} on this PR's branch to update.`);
  let next = String(yamlText);
  let data = null;
  const summary = [];
  try {
    if (edits.edits.length) {
      const r = applyIntentEdits(next, edits.edits);
      next = r.text;
      data = r.data;
      summary.push(...r.summary);
    }
    let agreement = null;
    if (edits.agreementText) {
      if (!edits.agreedBy || !EMAIL_RE.test(edits.agreedBy)) {
        throw AppError.badRequest(`${FILENAME} records who agreed by email address. Confirm the email on your account to record an agreement.`);
      }
      const date = deps.now().toISOString().slice(0, 10);
      agreement = {
        id: agreementId(date, edits.agreementText, deps.random()),
        text: edits.agreementText,
        agreed_by: [edits.agreedBy],
        agreed_on: date,
        source: pr.url && /^https:\/\//.test(pr.url) ? pr.url : undefined,
      };
      const r = addAgreement(next, agreement);
      next = r.text;
      data = r.data;
      summary.push(`Record the agreement "${edits.agreementText.length > 120 ? `${edits.agreementText.slice(0, 119)}…` : edits.agreementText}"`);
    }
    if (!summary.length && !edits.allowNoEdits) {
      throw AppError.badRequest(`Choose how ${FILENAME} should change: remove or reword a rule, add one, or record an agreement.`);
    }
    return { text: next, data, summary, agreement };
  } catch (err) {
    if (err instanceof IntentEditError || err instanceof AgreementError) throw AppError.badRequest(err.message);
    throw err;
  }
}

function commitMessage(prNumber, summary, actorName, coAuthor) {
  const first = summary[0] || `Update ${FILENAME}`;
  const subject = `takeoff: accept drift on #${prNumber} — ${first.length > 60 ? `${first.slice(0, 59)}…` : first}`;
  const lines = [subject, '', ...summary.map((s) => `- ${s}`), '', `Accepted in Takeoff${actorName ? ` by ${oneLine(actorName).slice(0, 80)}` : ''}.`];
  if (coAuthor) lines.push('', `Co-authored-by: ${coAuthor.login} <${coAuthor.id}+${coAuthor.login}@users.noreply.github.com>`);
  return lines.join('\n');
}

async function coAuthorOf(userId, deps) {
  const link = await deps.userGithubLinks.get(userId).catch(() => null);
  const login = String(link?.github_login || '').replace(/[^A-Za-z0-9-]/g, '');
  return login && link?.github_user_id ? { login, id: Number(link.github_user_id) } : null;
}

function friendly(err, project) {
  if (err instanceof AppError) return err.message;
  const msg = String(err?.message || err);
  if (/rate limit/i.test(msg)) return 'GitHub\'s rate limit for this repo is used up for now. Try again in a while.';
  if (/access_tokens/.test(msg) || err?.status === 403 || err?.status === 401) {
    return `Takeoff's GitHub App can't write to ${project.owner}/${project.repo}. Approve its new permissions (Contents and Pull requests: read and write) in GitHub, then try again.`;
  }
  if ((err?.status === 422) && /protected|rule/i.test(msg)) return 'This PR\'s branch is protected, so Takeoff can\'t commit to it. Make the change on the branch yourself.';
  if (err?.status === 404) return `Takeoff's GitHub App can't see ${project.owner}/${project.repo} or this pull request any more.`;
  return `GitHub refused the change: ${msg.slice(0, 300)}`;
}

/** Commit the accepted takeoff.yaml (and agent files) on top of the PR's head. */
async function commitAccept(gh, project, decision, actor, deps) {
  const { owner, repo } = project;
  const edits = decision.edits || {};
  for (let attempt = 1; ; attempt += 1) {
    const pr = await livePr(gh, project, Number(decision.pr_number));
    if (pr.state !== 'open') throw AppError.conflict('This pull request was closed before Takeoff could commit.');
    if (pr.fork) throw AppError.badRequest('This pull request comes from a fork, so Takeoff can\'t commit to its branch.');
    const head = await gh.fetchGitCommit(owner, repo, pr.headSha);
    const trees = new Map();
    const yamlEntry = await treeEntry(gh, owner, repo, head.tree.sha, FILENAME, trees);
    if (yamlEntry && !writable(yamlEntry)) throw AppError.badRequest(`${FILENAME} on this branch is a link or too big for Takeoff to edit.`);
    const yamlText = yamlEntry ? await gh.fetchFileTextOrNull(owner, repo, FILENAME, pr.headSha) : null;
    const baseText = pr.baseSha ? await gh.fetchFileTextOrNull(owner, repo, FILENAME, pr.baseSha) : null;
    const plan = planAccept({ yamlText, edits: { ...edits, edits: edits.edits || [], allowNoEdits: true }, pr, deps });
    const data = plan.data || loadIntentData(plan.text);

    const current = {};
    const skipped = [];
    for (const p of AGENT_FILE_PATHS) {
      const e = await treeEntry(gh, owner, repo, head.tree.sha, p, trees);
      if (!writable(e)) { skipped.push(p); continue; }
      current[p] = e ? await gh.fetchFileTextOrNull(owner, repo, p, pr.headSha) : null;
      if (e && current[p] === null) skipped.push(p);
    }
    let agentFiles = [];
    try {
      agentFiles = data ? renderAgentFiles(data, current).filter((f) => f.changed && !skipped.includes(f.path)) : [];
    } catch (err) {
      if (err instanceof AgreementError) throw AppError.badRequest(err.message);
      throw err;
    }
    const files = [];
    if (plan.text !== yamlText) files.push({ path: FILENAME, content: plan.text });
    files.push(...agentFiles.map((f) => ({ path: f.path, content: f.text })));
    const result = {
      yamlSha256: sha256(plan.text), baseYamlSha256: sha256(baseText), agreementId: plan.agreement?.id || null,
      branch: pr.branch, prHead: pr.headSha, summary: plan.summary,
    };
    if (!files.length) return { ...result, commitSha: null, commitUrl: null, newHead: pr.headSha };

    const tree = await gh.createTextTree(owner, repo, head.tree.sha, files);
    const coAuthor = await coAuthorOf(decision.actor_user_id, deps);
    const message = commitMessage(Number(decision.pr_number), plan.summary.length ? plan.summary : [`Regenerate the agent files from ${FILENAME}`], decision.actor_name, coAuthor);
    const commit = await gh.createGitCommit(owner, repo, { message, tree: tree.sha, parents: [pr.headSha] });
    try {
      await gh.updateBranchRef(owner, repo, pr.branch, commit.sha, { force: false });
    } catch (err) {
      if (err.status === 422 && /fast.?forward/i.test(err.message) && attempt < MAX_FAST_FORWARD_RETRIES) continue;
      if (err.status === 422 && /fast.?forward/i.test(err.message)) throw AppError.conflict('The PR\'s branch kept changing while Takeoff committed. Try again.');
      throw err;
    }
    return { ...result, commitSha: commit.sha, commitUrl: `https://github.com/${owner}/${repo}/commit/${commit.sha}`, newHead: commit.sha };
  }
}

function loadIntentData(text) {
  const { validateText } = require('@takeoff/cli');
  const r = validateText(text);
  return r.ok && r.version === 2 ? r.data : null;
}

/** The PR comment a send-back posts. */
function sendBackComment(decision, actorName) {
  const who = actorName ? mdClean(actorName, { max: 80 }) : 'A reviewer';
  const lines = String(decision.note).split('\n').map((l) => mdClean(l, { max: 1000 }));
  return [
    sendBackMarker({ id: decision.id, sha: decision.head_sha, note: decision.note }),
    `**↩️ Takeoff: sent back by ${who}**`,
    '',
    ...lines.map((l) => `> ${l}`),
    '',
    `This is about \`${decision.head_sha.slice(0, 7)}\`. Builders and their AI agents can read this note with \`takeoff notes\` on this branch.`,
  ].join('\n');
}

/**
 * Run a decision that is 'working'. Records the outcome on the row and
 * returns it; never throws for a GitHub or file problem.
 */
async function execute(project, decision, actor, deps) {
  let gh;
  try {
    gh = deps.writeClientFor(project);
    if (decision.type === 'sent_back') {
      const pr = await livePr(gh, project, Number(decision.pr_number));
      if (pr.state !== 'open') throw AppError.conflict('This pull request was closed before Takeoff could post the note.');
      const comment = await gh.createIssueComment(project.owner, project.repo, Number(decision.pr_number), sendBackComment(decision, decision.actor_name));
      return (await deps.driftDecisions.finish(decision.id, {
        state: 'done', commentId: comment?.id ? Number(comment.id) : null, commentUrl: comment?.html_url || null,
      })) || decision;
    }
    const out = await commitAccept(gh, project, decision, actor, deps);
    const done = (await deps.driftDecisions.finish(decision.id, {
      state: 'done', commitSha: out.commitSha, commitUrl: out.commitUrl, yamlSha256: out.yamlSha256,
      baseYamlSha256: out.baseYamlSha256, agreementId: out.agreementId,
    })) || decision;
    // Check the PR again against the accepted intent. A new commit also
    // reaches the check through the webhook; the check runs once per commit.
    Promise.resolve()
      .then(() => deps.runPrCheck({
        owner: project.owner, repo: project.repo, prNumber: Number(decision.pr_number), headSha: out.newHead,
        installationId: Number(project.github_installation_id), force: !out.commitSha,
      }))
      .catch((err) => console.warn('[drift] re-check failed:', err.message));
    return done;
  } catch (err) {
    const message = friendly(err, project);
    console.warn(`[drift] decision ${decision.id} failed:`, err.message);
    return (await deps.driftDecisions.finish(decision.id, { state: 'failed', error: message }).catch(() => null)) || { ...decision, state: 'failed', error: message };
  }
}

const accept = (input, deps = defaultDeps()) => decide({ ...input, type: 'accepted' }, deps);
const sendBack = (input, deps = defaultDeps()) => decide({ ...input, type: 'sent_back' }, deps);

/** Run a failed decision again (by someone with write access). */
async function retryDecision({ project, user, decisionId }, deps = defaultDeps()) {
  await assertMember(project, user, deps);
  const access = await accessFor(project, user, deps);
  if (!access.canWrite) throw AppError.forbidden('Trying again needs write access to the repo on GitHub.');
  const claimed = await deps.driftDecisions.claim(project.id, String(decisionId || ''), { from: ['failed'], confirmedBy: user.id });
  if (!claimed) throw AppError.conflict('This decision is not waiting to be tried again.');
  return { decision: publicDecision(await execute(project, claimed, { userId: user.id }, deps)) };
}

/**
 * Email the area Creators (members whose confirmed email is a Creator of an
 * area the PR drifts in); with none, every member with write access. Called
 * by the PR check after it posts a ⚠️ or ❓ verdict. Never throws.
 */
async function notifyDrift({ project, prNumber, headSha, result, intent, touchedAreaIds = [], prTitle = null }, deps = defaultDeps()) {
  try {
    if (!deps.emailEnabled || !REVIEW_VERDICTS.has(result?.verdict)) return 0;
    const members = await currentMembers(project, deps);
    const conflictAreas = new Set((result.conflicts || []).map((c) => c.area).filter(Boolean));
    const areaIds = conflictAreas.size ? conflictAreas : new Set(touchedAreaIds);
    const creatorEmails = new Set((intent?.areas || []).filter((a) => areaIds.has(a.id)).flatMap((a) => a.creators.map((e) => String(e).toLowerCase())));
    let recipients = members.filter((m) => m.email && creatorEmails.has(m.email));
    if (!recipients.length) {
      recipients = [];
      for (const m of members.slice(0, 25)) {
        const a = await committing.writeAccess(project, { id: m.userId }, deps.committing).catch(() => null);
        if (a?.canWrite) recipients.push(m);
      }
    }
    if (!recipients.length) return 0;
    const label = LABELS[result.verdict]?.label || 'Needs review';
    const title = oneLine(prTitle || '').slice(0, 100);
    return await notify.enqueue({
      projectId: project.id,
      recipients,
      kind: 'drift',
      subject: `${label}: PR #${prNumber}${title ? ` ${title}` : ''} in ${project.repo}`,
      body: `Takeoff checked PR #${prNumber} in ${repoOf(project)} against takeoff.yaml: ${label.toLowerCase()}.\n\n${oneLine(result.summary || '').slice(0, 600)}\n\nOpen it in Takeoff to accept the change into the intent or send it back with a note.`,
      link: reviewLink(project, prNumber, deps),
      dedupeKey: `drift:${repoOf(project)}#${prNumber}:${headSha}`,
    }, deps);
  } catch (err) {
    console.warn('[drift] queueing email failed:', err.message);
    return 0;
  }
}

let registered = false;
function registerDecisionAction(depsFactory = defaultDeps) {
  if (registered) return;
  registered = true;
  committing.registerCommittingAction(ACTION, {
    summarize: () => 'Decide on drift in a pull request',
    // Confirming the recommendation runs the decision it was left for.
    run: async ({ project, payload, actor }) => {
      const deps = depsFactory();
      // 'failed': an earlier confirm failed and its recommendation went back to pending.
      const claimed = await deps.driftDecisions.claim(project.id, String(payload?.decisionId || ''), { from: ['waiting_for_write', 'failed'], confirmedBy: actor.userId });
      if (!claimed) {
        const row = await deps.driftDecisions.get(project.id, String(payload?.decisionId || ''));
        if (row?.state === 'done') return publicDecision(row);
        throw AppError.conflict('This decision is already running or was decided another way.');
      }
      const done = await execute(project, claimed, actor, deps);
      if (done.state !== 'done') throw new AppError(done.error || 'The decision failed.', 502, 'DECISION_FAILED');
      return publicDecision(done);
    },
  });
}

module.exports = {
  listDrift, getReview, accept, sendBack, retryDecision, notifyDrift, registerDecisionAction, defaultDeps,
  sendBackComment, commitMessage, planAccept, targetFor, sha256, ACTION,
  _resetRegistration: () => { registered = false; committing._actions.delete(ACTION); },
};
