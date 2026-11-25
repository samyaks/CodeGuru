'use strict';

// Milestone 4: check one PR head commit against takeoff.yaml and report it as
// one Takeoff comment (edited in place) plus a neutral check run.
//
// Order matters: everything that can skip the check (no project, PR closed or
// already moved on, no takeoff.yaml) runs before the claim, so only real
// checks take a pr_checks row; the claim runs before the model is called.

const { FILENAME } = require('@takeoff/cli');
const { loadIntent, chooseIntent, changedAreaIds } = require('./intent');
const { touchedAreas } = require('./globs');
const { buildPrompt } = require('./prompt');
const { parseVerdict, VerdictError } = require('./parse');
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
    clientForInstallation: (id) => getGithubApp().clientForInstallation(id),
    callModel: callVerdictModel,
    appSlug: config.slug || null,
    appUrl: (process.env.TAKEOFF_APP_URL || process.env.FRONTEND_URL || '').replace(/\/+$/, '') || null,
    log: (obj) => console.log(JSON.stringify(obj)),
  };
}

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

/** Edit the PR's Takeoff comment, or post it the first time. Returns its id. */
async function upsertComment(gh, { owner, repo, prNumber, body }, deps) {
  const repoFull = `${owner}/${repo}`;
  let id = await deps.prChecks.latestCommentId({ repo: repoFull, prNumber }).catch(() => null);
  if (id) {
    try {
      const updated = await gh.updateIssueComment(owner, repo, id, body);
      return Number(updated.id || id);
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

/**
 * @param {{ owner: string, repo: string, prNumber: number, headSha: string, installationId: number, force?: boolean, deliveryId?: string|null }} input
 * @returns {Promise<{ status: string, verdict?: string, reason?: string }>}
 */
async function runPrCheck(input, deps = defaultDeps()) {
  const { owner, repo, prNumber, headSha, installationId, force = false, deliveryId = null } = input;
  const repoFull = `${owner}/${repo}`;
  const log = deps.log || (() => {});
  const ctx = { repo: repoFull, prNumber, headSha, deliveryId };

  const projects = await deps.deployments.findByGithubRepo(owner, repo);
  if (!projects.length) {
    log({ event: 'pr_check_skipped', reason: 'no_project', ...ctx });
    return { status: 'skipped', reason: 'no_project' };
  }
  const project = projects[0];
  const gh = deps.clientForInstallation(installationId);

  const pr = await gh.fetchPullRequest(owner, repo, prNumber);
  if (pr.state !== 'open') return { status: 'skipped', reason: 'not_open' };
  if (pr.head?.sha !== headSha) {
    log({ event: 'pr_check_skipped', reason: 'superseded', currentHead: pr.head?.sha, ...ctx });
    return { status: 'skipped', reason: 'superseded' };
  }
  const baseSha = pr.base?.sha;
  const [baseText, headText] = await Promise.all([
    baseSha ? gh.fetchFileTextOrNull(owner, repo, FILENAME, baseSha) : null,
    gh.fetchFileTextOrNull(owner, repo, FILENAME, headSha),
  ]);
  if (baseText === null && headText === null) {
    log({ event: 'pr_check_skipped', reason: 'no_takeoff_yaml', ...ctx });
    return { status: 'skipped', reason: 'no_takeoff_yaml' };
  }

  const claim = await deps.prChecks.claim({ repo: repoFull, prNumber, headSha, projectId: project.id, force });
  if (!claim) {
    log({ event: 'pr_check_duplicate', ...ctx });
    return { status: 'skipped', reason: 'duplicate' };
  }
  const key = { repo: repoFull, prNumber, headSha };

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
  } catch (err) {
    log({ event: 'pr_check_run_create_failed', status: err.status || null, message: err.message, ...ctx });
  }

  const previewUrl = await gh.fetchPreviewUrl(owner, repo, headSha).catch(() => null);
  // Only the PR's current head gets to write the comment, so a slow check of
  // an older push never overwrites a newer verdict.
  const stillHead = async () => {
    const now = await gh.fetchPullRequest(owner, repo, prNumber).catch(() => null);
    return !now || now.head?.sha === headSha;
  };

  let result;
  let model = null;
  let note = null;
  try {
    const base = loadIntent(baseText);
    const head = loadIntent(headText);
    const chosen = chooseIntent(base, head);
    if (!chosen.intent) {
      const first = (head.present ? head.errors : base.errors)[0] || 'it could not be read';
      throw new VerdictError('intent_invalid', `${FILENAME} has errors, so there is nothing to check this PR against. First error: ${first}`);
    }
    note = chosen.note;
    const { intent } = chosen;

    const files = await gh.fetchAllPRFiles(owner, repo, prNumber);
    const paths = [...new Set(files.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean)))];
    const intentChanged = files.some((f) => f.filename === FILENAME || f.previous_filename === FILENAME);
    const { touched, unmapped } = touchedAreas(intent, paths);
    if (intentChanged && chosen.from === 'head') {
      for (const id of changedAreaIds(base.ok ? base.intent : null, intent)) {
        if (!touched.some((t) => t.area.id === id)) {
          const area = intent.areas.find((a) => a.id === id);
          touched.push({ area, files: [FILENAME] });
        }
      }
    }

    if (!touched.length) {
      // Nothing in the PR falls in an area the intent describes: no rule can apply.
      result = {
        verdict: 'matches',
        summary: `This PR changes ${files.length} file${files.length === 1 ? '' : 's'}, none of them in an area ${FILENAME} describes.`,
        conflicts: [],
        suggested_agreement: null,
      };
    } else {
      const commits = await gh.fetchPullCommits(owner, repo, prNumber).catch(() => []);
      const prompt = buildPrompt({
        pr: { number: prNumber, title: pr.title, body: pr.body },
        commits: commits.map((c) => c.message || c.title || ''),
        files,
        intent,
        touched,
        unmapped,
        intentChanged,
        intentNote: note,
      });
      const reply = await deps.callModel(prompt);
      model = reply.model;
      log({ event: 'pr_check_model_call', model, usage: reply.usage, ...ctx });
      result = parseVerdict(reply.text, {
        touchedAreaIds: touched.map((t) => t.area.id),
        changedFiles: paths,
      });
    }

    const areaNames = Object.fromEntries(intent.areas.map((a) => [a.id, a.name]));
    const reviewUrl = deps.appUrl ? `${deps.appUrl}/projects/${encodeURIComponent(project.id)}` : null;
    let commentId = null;
    let writeError = null;
    if (await stillHead()) {
      try {
        const body = renderComment(result, { areaNames, reviewUrl, previewUrl, headSha, note });
        commentId = await upsertComment(gh, { owner, repo, prNumber, body }, deps);
      } catch (err) {
        writeError = `comment: ${err.message}`;
        log({ event: 'pr_check_comment_failed', status: err.status || null, message: err.message, ...ctx });
      }
    }
    try {
      await finishCheckRun(gh, { owner, repo, headSha, prNumber, checkRunId, output: checkRunOutput(result), retry: false });
    } catch (err) {
      writeError = writeError || `check run: ${err.message}`;
      log({ event: 'pr_check_run_finish_failed', status: err.status || null, message: err.message, ...ctx });
    }
    await deps.prChecks.finish(key, { status: 'done', verdict: result.verdict, result, commentId, checkRunId, model, error: writeError });
    log({ event: 'pr_check_done', verdict: result.verdict, conflicts: result.conflicts.length, ...ctx });
    return { status: 'done', verdict: result.verdict };
  } catch (err) {
    log({ event: 'pr_check_failed', code: err.code || null, status: err.status || null, message: err.message, ...ctx });
    const reason = userReason(err);
    let commentId = null;
    try {
      if (await stillHead()) {
        commentId = await upsertComment(gh, { owner, repo, prNumber, body: renderFailureComment({ reason, headSha, previewUrl }) }, deps);
      }
    } catch (writeErr) {
      log({ event: 'pr_check_comment_failed', status: writeErr.status || null, message: writeErr.message, ...ctx });
    }
    try {
      await finishCheckRun(gh, { owner, repo, headSha, prNumber, checkRunId, output: failureCheckRunOutput(reason), retry: true });
    } catch (writeErr) {
      log({ event: 'pr_check_run_finish_failed', status: writeErr.status || null, message: writeErr.message, ...ctx });
    }
    await deps.prChecks.finish(key, { status: 'failed', commentId, checkRunId, model, error: String(err.message || err).slice(0, 2000) })
      .catch((e) => log({ event: 'pr_check_finish_failed', message: e.message, ...ctx }));
    return { status: 'failed', reason };
  }
}

/**
 * Which webhook deliveries start a check. Only the Takeoff App can write the
 * comment and check run, so only App-signed deliveries count.
 * @returns {null | { owner, repo, prNumber, headSha, installationId, force }[]}
 */
function prCheckJobs({ event, payload, source, installationId, appId = null }) {
  if (source !== 'app' || !installationId) return null;
  const fullName = payload?.repository?.full_name;
  if (!fullName || !fullName.includes('/')) return null;
  const [owner, repo] = fullName.split('/');
  const ours = (app) => !appId || (app && String(app.id) === String(appId));

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
    const suite = payload.check_suite;
    if (payload.action !== 'rerequested' || !ours(suite?.app) || !suite?.head_sha) return null;
    const prs = (Array.isArray(suite.pull_requests) ? suite.pull_requests : []).filter((p) => p?.number);
    if (!prs.length) return null;
    return prs.map((p) => ({ owner, repo, prNumber: Number(p.number), headSha: suite.head_sha, installationId, force: true }));
  }
  return null;
}

module.exports = { runPrCheck, prCheckJobs, upsertComment, defaultDeps };
