'use strict';

// Milestone 4: check one PR head commit against takeoff.yaml and report it as
// one Takeoff comment (edited in place) plus a neutral check run.
//
// Order matters: everything that can skip the check (no project, PR closed or
// already moved on, no takeoff.yaml) runs before the claim, so only real
// checks take a pr_checks row; the claim runs before the model is called.
// Nothing here can post a ✅ for a check that did not run.

const { FILENAME } = require('@takeoff/cli');
const { loadIntent, chooseIntent } = require('./intent');
const { touchedAreas, uncheckablePatterns } = require('./globs');
const { buildPrompt } = require('./prompt');
const { parseVerdict, VerdictError, atLeastNeedsDecision } = require('./parse');
const {
  MARKER, CHECK_NAME, RETRY_ACTION,
  renderComment, renderFailureComment, checkRunOutput, failureCheckRunOutput,
} = require('./comment');

function defaultDeps() {
  const { deployments, prChecks } = require('../../lib/db');
  const { getGithubApp, readConfigFromEnv } = require('../../lib/github-app');
  const { callVerdictModel } = require('./llm');
  const config = readConfigFromEnv();
  return {
    deployments,
    prChecks,
    clientForInstallation: (id, repo) => getGithubApp().clientForInstallation(id, {
      repo, permissions: VERDICT_PERMISSIONS, optional: VERDICT_OPTIONAL_PERMISSIONS,
    }),
    callModel: callVerdictModel,
    appSlug: config.slug || null,
    appUrl: (process.env.TAKEOFF_APP_URL || process.env.FRONTEND_URL || '').replace(/\/+$/, '') || null,
    log: (obj) => console.log(JSON.stringify(obj)),
  };
}

// The verdict reads the PR and takeoff.yaml and writes one comment and one
// check run, on the PR's own repo only. Deployments: read is optional: it
// finds the preview link, and an installation without it still mints (the
// link is then skipped).
const VERDICT_PERMISSIONS = Object.freeze({
  contents: 'read', metadata: 'read', pull_requests: 'write', checks: 'write',
});
const VERDICT_OPTIONAL_PERMISSIONS = Object.freeze({ deployments: 'read' });

function userReason(err) {
  if (err instanceof VerdictError) {
    if (err.code === 'intent_invalid') return err.message;
    if (err.code === 'refused') return 'The AI model declined to check this PR.';
    return "Takeoff's AI check didn't return a usable verdict.";
  }
  return 'Something went wrong while checking this PR against takeoff.yaml.';
}

const isOurComment = (slug) => (c) =>
  c?.user?.type === 'Bot' && (!slug || String(c.user.login).toLowerCase() === `${slug}[bot]`.toLowerCase());

/**
 * Edit the PR's Takeoff comment, or post it the first time. Returns its id.
 * `latest` is the stored comment, read by the caller under the PR's lock.
 */
async function upsertComment(gh, { owner, repo, prNumber, body, latest = null }, deps) {
  if (latest?.commentId) {
    try {
      const updated = await gh.updateIssueComment(owner, repo, latest.commentId, body);
      return Number(updated.id || latest.commentId);
    } catch (err) {
      if (err.status !== 404) throw err; // deleted by someone: find or post again
    }
  }
  const existing = await gh.findIssueCommentWithMarker(owner, repo, prNumber, MARKER, { accept: isOurComment(deps.appSlug) });
  if (existing) {
    const updated = await gh.updateIssueComment(owner, repo, existing.id, body);
    return Number(updated.id || existing.id);
  }
  const created = await gh.createIssueComment(owner, repo, prNumber, body);
  return Number(created.id);
}

/**
 * Write the comment only while `headSha` is still the PR's head, so a slow
 * check of an older push never overwrites a newer verdict. Everything runs
 * under the per-PR lock, on the locked client: the head check, reading which
 * sha the comment shows, the write, and recording it. So two runs never both
 * post a first comment, and the stored "shown" sha always matches the PR.
 * `skipIfShown` leaves the comment alone when it already shows `headSha`.
 * @returns {Promise<number|null>} the comment id, or null when nothing was written
 */
async function writeComment(gh, { owner, repo, prNumber, headSha, body, skipIfShown = false }, deps) {
  const prKey = { repo: `${owner}/${repo}`, prNumber };
  return deps.prChecks.withCommentLock(prKey, async (db) => {
    const now = await gh.fetchPullRequest(owner, repo, prNumber).catch(() => null);
    if (now && now.head?.sha !== headSha) return null;
    const latest = await deps.prChecks.latestComment(prKey, db);
    if (skipIfShown && latest && latest.headSha === headSha) return null;
    const commentId = await upsertComment(gh, { owner, repo, prNumber, body, latest }, deps);
    await deps.prChecks.setComment({ ...prKey, headSha }, commentId, db);
    return commentId;
  });
}

async function finishCheckRun(gh, { owner, repo, headSha, prNumber, checkRunId, output, retry }) {
  const params = {
    status: 'completed',
    conclusion: 'neutral', // never blocks merging
    completed_at: new Date().toISOString(),
    output,
    actions: retry ? [RETRY_ACTION] : [],
  };
  if (checkRunId) return gh.updateCheckRun(owner, repo, checkRunId, params);
  return gh.createCheckRun(owner, repo, { name: CHECK_NAME, head_sha: headSha, external_id: String(prNumber), ...params });
}

/** "Couldn't check": failure comment and check run with Retry, best effort. */
async function reportFailure(gh, { owner, repo, prNumber, headSha, checkRunId = null, previewUrl = null, reason }, deps, log, ctx) {
  let commentId = null;
  try {
    commentId = await writeComment(gh, { owner, repo, prNumber, headSha, body: renderFailureComment({ reason, headSha, previewUrl }) }, deps);
  } catch (err) {
    log({ event: 'pr_check_comment_failed', status: err.status || null, message: err.message, ...ctx });
  }
  try {
    await finishCheckRun(gh, { owner, repo, headSha, prNumber, checkRunId, output: failureCheckRunOutput(reason), retry: true });
  } catch (err) {
    log({ event: 'pr_check_run_finish_failed', status: err.status || null, message: err.message, ...ctx });
  }
  return commentId;
}

const list3 = (items) => (items.length > 3 ? `${items.slice(0, 3).join(' ')} And ${items.length - 3} more.` : items.join(' '));

/**
 * Work out the verdict. Throws on anything that should read "couldn't check".
 * @returns {Promise<{ result: object, render: { areaNames: object, notes: string[] }, model: string|null }>}
 */
async function computeVerdict(gh, { owner, repo, prNumber, pr, baseText, headText }, deps, log, ctx) {
  const files = await gh.fetchAllPRFiles(owner, repo, prNumber);
  // GitHub lists at most 3000 files. Past that, the list can't show whether
  // takeoff.yaml changed or which areas are touched, so the texts decide the
  // first and a person decides the rest.
  const incomplete = Number(pr.changed_files) > files.length;
  const yamlFile = files.find((f) => f.filename === FILENAME || f.previous_filename === FILENAME);
  const yamlDiffers = incomplete && baseText !== headText;
  const chosen = chooseIntent({
    base: loadIntent(baseText),
    head: loadIntent(headText),
    yamlInPr: !!yamlFile || yamlDiffers,
    yamlRemoved: (!!yamlFile && (yamlFile.status === 'removed' || yamlFile.filename !== FILENAME))
      || (yamlDiffers && headText === null),
  });
  if (!chosen.intent) {
    throw new VerdictError('intent_invalid', `${FILENAME} has errors, so there is nothing to check this PR against. First error: ${chosen.error}`);
  }
  const { intent } = chosen;
  const notes = [];
  if (chosen.changes.length) {
    notes.push(`This PR also edits ${FILENAME}, so a person should confirm the new intent. ${list3(chosen.changes)}`);
  }
  if (incomplete) {
    notes.push(`GitHub lists only ${files.length} of this PR's ${pr.changed_files} changed files, so a person should look at the rest.`);
  }
  const uncheckable = uncheckablePatterns(intent);
  if (uncheckable.length) {
    const shown = uncheckable.slice(0, 3).map((u) => `"${u.pattern.length > 60 ? `${u.pattern.slice(0, 59)}…` : u.pattern}"`).join(', ');
    notes.push(`${uncheckable.length} path pattern(s) in ${FILENAME} can't be checked (${shown}${uncheckable.length > 3 ? ', and more' : ''}), so files they mean to cover may have been missed.`);
  }
  // Only a complete picture can earn ✅ without a person looking.
  const mustReview = chosen.changes.length > 0 || incomplete || uncheckable.length > 0;

  const paths = [...new Set(files.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean)))];
  const { touched, unmapped } = touchedAreas(intent, paths);
  for (const id of chosen.areaIds) {
    const area = intent.areas.find((a) => a.id === id);
    if (area && !touched.some((t) => t.area.id === id)) touched.push({ area, files: [FILENAME] });
  }
  const areaNames = Object.fromEntries(intent.areas.map((a) => [a.id, a.name]));

  if (!touched.length && !mustReview) {
    // Nothing in the PR falls in an area the intent describes, and the intent
    // itself is unchanged: no rule can apply.
    return {
      result: {
        verdict: 'matches',
        summary: `This PR changes ${files.length} file${files.length === 1 ? '' : 's'}, none of them in an area ${FILENAME} describes.`,
        conflicts: [],
        suggested_agreement: null,
      },
      render: { areaNames, notes },
      model: null,
    };
  }

  const commits = await gh.fetchPullCommits(owner, repo, prNumber).catch(() => []);
  const prompt = buildPrompt({
    pr: { number: prNumber, title: pr.title, body: pr.body },
    commits: commits.map((c) => c.message || c.title || ''),
    files,
    intent,
    touched,
    unmapped,
    intentChanges: chosen.changes,
  });
  const reply = await deps.callModel(prompt);
  log({ event: 'pr_check_model_call', model: reply.model, usage: reply.usage, ...ctx });

  const touchedIds = new Set(touched.map((t) => t.area.id));
  const known = [
    ...touched.flatMap(({ area }) => [...area.rules, ...area.never].map((r) => ({ area: area.id, text: r.text }))),
    ...intent.agreements.filter((g) => !g.area || touchedIds.has(g.area)).map((g) => ({ area: g.area, text: g.text })),
  ];
  let result = parseVerdict(reply.text, { known, changedFiles: paths });
  if (result.dropped_conflicts) {
    log({ event: 'pr_check_conflicts_dropped', count: result.dropped_conflicts, ...ctx });
  }
  const { dropped_conflicts: _dropped, ...clean } = result;
  result = clean;

  // Code-enforced floors: a PR that edits the intent, whose file list or path
  // patterns are incomplete, or whose touched code the model could not see,
  // is never ✅.
  if (mustReview) result = atLeastNeedsDecision(result);
  if (prompt.omittedTouched.length) {
    result = atLeastNeedsDecision(result);
    notes.push(`${prompt.omittedTouched.length} changed file(s) in areas ${FILENAME} covers were too large to check, so a person should look at them.`);
  }
  return { result, render: { areaNames, notes }, model: reply.model || null };
}

/**
 * @param {{ owner: string, repo: string, prNumber: number, headSha: string, installationId: number, force?: boolean, deliveryId?: string|null }} input
 * @returns {Promise<{ status: string, verdict?: string, reason?: string }>}
 */
async function runPrCheck(input, deps = defaultDeps()) {
  const { owner, repo, prNumber, headSha, installationId, force = false, deliveryId = null } = input;
  const repoFull = `${owner}/${repo}`;
  const log = deps.log || (() => {});
  const ctx = { repo: repoFull, prNumber, headSha, deliveryId };
  const key = { repo: repoFull, prNumber, headSha };

  const projects = await deps.deployments.findByGithubRepo(owner, repo);
  if (!projects.length) {
    log({ event: 'pr_check_skipped', reason: 'no_project', ...ctx });
    return { status: 'skipped', reason: 'no_project' };
  }
  const project = projects[0];
  const gh = deps.clientForInstallation(installationId, repo);

  let pr;
  let baseText;
  let headText;
  try {
    pr = await gh.fetchPullRequest(owner, repo, prNumber);
    if (pr.state !== 'open') return { status: 'skipped', reason: 'not_open' };
    if (pr.head?.sha !== headSha) {
      log({ event: 'pr_check_skipped', reason: 'superseded', currentHead: pr.head?.sha, ...ctx });
      return { status: 'skipped', reason: 'superseded' };
    }
    [baseText, headText] = await Promise.all([
      pr.base?.sha ? gh.fetchFileTextOrNull(owner, repo, FILENAME, pr.base.sha) : null,
      gh.fetchFileTextOrNull(owner, repo, FILENAME, headSha),
    ]);
  } catch (err) {
    // GitHub won't redeliver (we already answered 202), so say so on the PR.
    log({ event: 'pr_check_failed', stage: 'fetch', status: err.status || null, message: err.message, ...ctx });
    const reason = userReason(err);
    await reportFailure(gh, { owner, repo, prNumber, headSha, reason }, deps, log, ctx);
    return { status: 'failed', reason };
  }
  if (baseText === null && headText === null) {
    log({ event: 'pr_check_skipped', reason: 'no_takeoff_yaml', ...ctx });
    return { status: 'skipped', reason: 'no_takeoff_yaml' };
  }

  const claim = await deps.prChecks.claim({ ...key, projectId: project.id, installationId, force });
  if (!claim) return handleDuplicate(gh, { owner, repo, prNumber, headSha, key }, deps, log, ctx);
  const attempt = claim.attempts;
  const finish = (fields) => deps.prChecks.finish(key, fields, attempt)
    .then((landed) => { if (!landed) log({ event: 'pr_check_finish_superseded', ...ctx }); })
    .catch((e) => log({ event: 'pr_check_finish_failed', message: e.message, ...ctx }));

  let checkRunId = null;
  try {
    const run = await gh.createCheckRun(owner, repo, {
      name: CHECK_NAME,
      head_sha: headSha,
      external_id: String(prNumber),
      status: 'in_progress',
      started_at: new Date().toISOString(),
      output: { title: 'Checking against takeoff.yaml', summary: 'Takeoff is comparing this PR with the product intent.' },
    });
    checkRunId = run?.id ? Number(run.id) : null;
    // Saved now, so a restart mid-check leaves something the sweep can close.
    if (checkRunId) {
      await deps.prChecks.setCheckRun(key, attempt, checkRunId)
        .catch((e) => log({ event: 'pr_check_set_run_failed', message: e.message, ...ctx }));
    }
  } catch (err) {
    log({ event: 'pr_check_run_create_failed', status: err.status || null, message: err.message, ...ctx });
  }
  const previewUrl = await gh.fetchPreviewUrl(owner, repo, headSha).catch(() => null);

  let computed = null;
  try {
    computed = await computeVerdict(gh, { owner, repo, prNumber, pr, baseText, headText }, deps, log, ctx);
  } catch (err) {
    log({ event: 'pr_check_failed', stage: 'verdict', code: err.code || null, status: err.status || null, message: err.message, ...ctx });
    const reason = userReason(err);
    const commentId = await reportFailure(gh, { owner, repo, prNumber, headSha, checkRunId, previewUrl, reason }, deps, log, ctx);
    await finish({ status: 'failed', commentId, checkRunId, error: String(err.message || err).slice(0, 2000) });
    return { status: 'failed', reason };
  }

  const { result, render, model } = computed;
  const reviewUrl = deps.appUrl ? `${deps.appUrl}/projects/${encodeURIComponent(project.id)}` : null;
  let commentId = null;
  let writeError = null;
  try {
    const body = renderComment(result, { ...render, reviewUrl, previewUrl, headSha });
    commentId = await writeComment(gh, { owner, repo, prNumber, headSha, body }, deps);
  } catch (err) {
    writeError = `comment: ${err.message}`;
    log({ event: 'pr_check_comment_failed', status: err.status || null, message: err.message, ...ctx });
  }
  try {
    // A verdict that could not be posted is retryable, like any failure.
    await finishCheckRun(gh, { owner, repo, headSha, prNumber, checkRunId, output: checkRunOutput(result, render), retry: !!writeError });
  } catch (err) {
    log({ event: 'pr_check_run_finish_failed', status: err.status || null, message: err.message, ...ctx });
    // Never leave the check run "in progress": close it as "couldn't check".
    try {
      await finishCheckRun(gh, {
        owner, repo, headSha, prNumber, checkRunId, retry: true,
        output: failureCheckRunOutput("Takeoff couldn't attach its verdict to this check. Retry to run it again."),
      });
    } catch (err2) {
      log({ event: 'pr_check_run_finish_failed', status: err2.status || null, message: err2.message, fallback: true, ...ctx });
    }
  }
  const status = writeError ? 'failed' : 'done';
  await finish({ status, verdict: result.verdict, result: { ...result, render }, commentId, checkRunId, model, error: writeError });
  log({ event: 'pr_check_done', verdict: result.verdict, conflicts: result.conflicts.length, posted: !writeError, ...ctx });
  return writeError ? { status: 'failed', reason: 'comment_write_failed', verdict: result.verdict } : { status: 'done', verdict: result.verdict };
}

/**
 * Already checked (or being checked). If the PR's head went back to a commit
 * that was checked before, its stored verdict goes back on the comment: no
 * second model call, and never another commit's verdict on this one.
 */
async function handleDuplicate(gh, { owner, repo, prNumber, headSha, key }, deps, log, ctx) {
  log({ event: 'pr_check_duplicate', ...ctx });
  try {
    const row = await deps.prChecks.get(key);
    const stored = row?.result_json;
    if (row?.status !== 'done' || !stored?.verdict) return { status: 'skipped', reason: 'duplicate' };
    const { render = {}, ...result } = stored;
    const reviewUrl = deps.appUrl && row.project_id ? `${deps.appUrl}/projects/${encodeURIComponent(row.project_id)}` : null;
    const body = renderComment(result, { areaNames: render.areaNames || {}, notes: render.notes || [], reviewUrl, headSha });
    // Whether the comment already shows this sha is decided under the lock.
    const commentId = await writeComment(gh, { owner, repo, prNumber, headSha, body, skipIfShown: true }, deps);
    if (!commentId) return { status: 'skipped', reason: 'duplicate' };
    return { status: 'restored', verdict: result.verdict };
  } catch (err) {
    log({ event: 'pr_check_restore_failed', status: err.status || null, message: err.message, ...ctx });
    return { status: 'skipped', reason: 'duplicate' };
  }
}

/**
 * Close checks a restart left running: their check run would otherwise stay
 * "in progress" with no Re-run button. They become "couldn't check" with Retry.
 */
async function recoverStalePrChecks(deps = defaultDeps()) {
  const log = deps.log || (() => {});
  // failStale marks them failed atomically, so a check claimed or finished
  // meanwhile is never touched and two sweeps never report the same row.
  const rows = await deps.prChecks.failStale();
  for (const row of rows) {
    const [owner, repo] = String(row.repo_full_name).split('/');
    const key = { repo: row.repo_full_name, prNumber: Number(row.pr_number), headSha: row.head_sha };
    const ctx = { ...key, stage: 'recover' };
    try {
      if (row.installation_id) {
        const gh = deps.clientForInstallation(Number(row.installation_id), repo);
        await reportFailure(gh, {
          owner, repo, prNumber: key.prNumber, headSha: key.headSha,
          checkRunId: row.check_run_id ? Number(row.check_run_id) : null,
          reason: 'The check was interrupted before it finished.',
        }, deps, log, ctx);
      }
    } catch (err) {
      log({ event: 'pr_check_recover_failed', message: err.message, ...ctx });
    }
  }
  if (rows.length) log({ event: 'pr_check_recovered', count: rows.length });
  return rows.length;
}

/**
 * Which webhook deliveries start a check. Only the Takeoff App can write the
 * comment and check run, so only App-signed deliveries count, and Re-run only
 * counts for check runs our App created.
 * @returns {null | { owner, repo, prNumber, headSha, installationId, force }[]}
 */
function prCheckJobs({ event, payload, source, installationId, appId = null }) {
  if (source !== 'app' || !installationId) return null;
  const fullName = payload?.repository?.full_name;
  if (!fullName || !fullName.includes('/')) return null;
  const [owner, repo] = fullName.split('/');
  const ours = (app) => !!appId && !!app && String(app.id) === String(appId);

  if (event === 'pull_request') {
    if (!['opened', 'synchronize', 'reopened'].includes(payload.action)) return null;
    const pr = payload.pull_request;
    if (!pr?.number || !pr?.head?.sha) return null;
    return [{ owner, repo, prNumber: Number(pr.number), headSha: pr.head.sha, installationId, force: false }];
  }
  if (event === 'check_run') {
    const run = payload.check_run;
    const retry = payload.action === 'rerequested'
      || (payload.action === 'requested_action' && payload.requested_action?.identifier === RETRY_ACTION.identifier);
    if (!retry || run?.name !== CHECK_NAME || !ours(run.app) || !run.head_sha) return null;
    const prNumber = Number(run.external_id) || Number(run.pull_requests?.[0]?.number);
    if (!prNumber) return null;
    return [{ owner, repo, prNumber, headSha: run.head_sha, installationId, force: true }];
  }
  if (event === 'check_suite') {
    // "Re-run all checks". Fork PRs list no pull_requests here; their
    // per-check Re-run still works through the check run's external_id.
    const suite = payload.check_suite;
    if (payload.action !== 'rerequested' || !ours(suite?.app) || !suite?.head_sha) return null;
    const prs = (Array.isArray(suite.pull_requests) ? suite.pull_requests : []).filter((p) => p?.number);
    if (!prs.length) return null;
    return prs.map((p) => ({ owner, repo, prNumber: Number(p.number), headSha: suite.head_sha, installationId, force: true }));
  }
  return null;
}

module.exports = { runPrCheck, prCheckJobs, upsertComment, recoverStalePrChecks, defaultDeps };
