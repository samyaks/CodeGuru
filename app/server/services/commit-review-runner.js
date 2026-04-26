const { v4: uuidv4 } = require('uuid');
const github = require('./github');
const { commitReviews, deployments, buildEntries } = require('../lib/db');
const { detectDeploymentInPR } = require('./deployment');
const reviewer = require('./reviewer');
const { generateCommitContextDraft } = require('./commit-context-generator');
const { broadcast } = require('../lib/sse');

const MAX_FILES = parseInt(process.env.MAX_COMMIT_REVIEW_FILES, 10) || 40;
const MAX_PATCH_CHARS = parseInt(process.env.MAX_COMMIT_REVIEW_PATCH_CHARS, 10) || 10000;

const ZERO_SHA = '0000000000000000000000000000000000000000';

function isZeroSha(s) {
  return !s || s === ZERO_SHA || /^0+$/.test(s);
}

function truncatePatch(patch, max) {
  if (!patch || patch.length <= max) return patch;
  return `${patch.slice(0, max)}\n\n... [patch truncated]`;
}

function prepareFiles(rawFiles) {
  const scored = rawFiles
    .map((f) => ({
      filename: f.filename,
      status: f.status || 'modified',
      additions: f.additions || 0,
      deletions: f.deletions || 0,
      patch: truncatePatch(f.patch, MAX_PATCH_CHARS),
      _score: (f.additions || 0) + (f.deletions || 0),
    }))
    .sort((a, b) => b._score - a._score)
    .slice(0, MAX_FILES)
    .map(({ _score, ...rest }) => rest);

  return scored;
}

/**
 * Run AI review for a stored commit_reviews row (Agent 1B).
 */
async function runCommitReviewJob({
  commitReviewId,
  projectId,
  owner,
  repo,
  afterSha,
  beforeSha,
  ref,
  headCommitTitle,
  headCommitBody,
}) {
  let files = [];
  let before = beforeSha;
  let commitTitle = headCommitTitle || '';
  let commitBody = headCommitBody || '';

  if (isZeroSha(beforeSha)) {
    const detail = await github.fetchCommitWithPatches(owner, repo, afterSha);
    files = prepareFiles(detail.files || []);
    before = detail.parents && detail.parents[0] ? detail.parents[0] : null;
    if (!commitTitle) commitTitle = detail.title || '';
    if (!commitBody) commitBody = detail.message || '';
  } else {
    try {
      const compare = await github.fetchCompare(owner, repo, beforeSha, afterSha);
      const raw = (compare.files || []).map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions || 0,
        deletions: f.deletions || 0,
        patch: f.patch || null,
      }));
      files = prepareFiles(raw);
      const commits = compare.commits || [];
      if (commits.length && !commitTitle) {
        const last = commits[commits.length - 1];
        const msg = last.commit?.message || '';
        commitTitle = msg.split('\n')[0].trim();
        commitBody = msg;
      }
    } catch {
      const detail = await github.fetchCommitWithPatches(owner, repo, afterSha);
      files = prepareFiles(detail.files || []);
      if (!commitTitle) commitTitle = detail.title || '';
      if (!commitBody) commitBody = detail.message || '';
    }
  }

  const deployInfo = detectDeploymentInPR(files.map((f) => f.filename));

  await commitReviews.markInProgress(commitReviewId);

  const report = await reviewer.reviewCommit(projectId, {
    owner,
    repo,
    afterSha,
    beforeSha: before || beforeSha,
    ref,
    commitTitle,
    commitBody,
    files,
    deployInfo,
  });

  await commitReviews.markCompleted(commitReviewId, report);
  broadcast(projectId, {
    type: 'commit-review',
    status: 'completed',
    commitSha: afterSha,
    verdict: report.verdict,
  });

  // Draft a Build Story entry from the commit + AI review. Wrapped in try/catch
  // so a context-draft failure never marks the (already-completed) review as
  // failed. Skipped entirely if a draft (in any status — pending/approved/
  // dismissed) already exists for this commit, so retries don't generate dupes
  // or overturn a user's dismiss.
  try {
    const project = await deployments.findById(projectId);
    if (project && project.user_id) {
      const existingDraft = await buildEntries.findBySourceCommitSha(projectId, afterSha);
      if (existingDraft) {
        console.log(`commit-context draft for ${afterSha} already exists (id=${existingDraft.id}, status=${existingDraft.approval_status}) — skipping regeneration`);
      } else {
        const draft = await generateCommitContextDraft({
          project,
          commitTitle,
          commitBody,
          files,
          aiReport: report,
        });
        await buildEntries.create({
          id: uuidv4(),
          project_id: projectId,
          user_id: project.user_id,
          entry_type: 'note',
          title: draft.title,
          content: draft.content,
          metadata: null,
          is_public: false,
          source_commit_sha: afterSha,
          approval_status: 'pending',
          created_at: new Date().toISOString(),
        });
        broadcast(projectId, {
          type: 'commit-context',
          status: 'drafted',
          commitSha: afterSha,
        });
      }
    }
  } catch (err) {
    console.error(`commit-context draft for ${commitReviewId} failed:`, err.message);
  }
}

async function runCommitReviewJobSafe(ctx) {
  try {
    await runCommitReviewJob(ctx);
  } catch (err) {
    console.error(`commit-review ${ctx.commitReviewId} failed:`, err.message);
    try {
      await commitReviews.markFailed(ctx.commitReviewId, err.message || String(err));
      broadcast(ctx.projectId, {
        type: 'commit-review',
        status: 'failed',
        commitSha: ctx.afterSha,
      });
    } catch (e) {
      console.error(`commit-review markFailed:`, e.message);
    }
  }
}

module.exports = { runCommitReviewJob, runCommitReviewJobSafe, prepareFiles, isZeroSha };
