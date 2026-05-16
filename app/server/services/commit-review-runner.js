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

// Paths considered "trivial" — changes touching only these files don't need a
// Claude review (docs, lockfiles, CI config, tests). Used to short-circuit
// review for things like dependabot bumps or README edits.
const TRIVIAL_PATTERNS = [
  /^(docs?|examples?)\//,
  /README(\.md)?$/,
  /CHANGELOG(\.md)?$/,
  /\.md$/,
  /\.mdx$/,
  /\.lock$/,
  /\.lockb$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /poetry\.lock$/,
  /Cargo\.lock$/,
  /^go\.sum$/,
  /Pipfile\.lock$/,
  /composer\.lock$/,
  /mix\.lock$/,
  /Podfile\.lock$/,
  // .github/workflows/* MUST go through Claude review — deployment, secrets,
  // CI integrity. Everything else under .github/ (dependabot, CODEOWNERS,
  // issue templates) stays trivial.
  /^\.github\/(?!workflows\/)/,
  /^\.gitignore$/,
  /^\.gitattributes$/,
  /^LICEN[SC]E(\.md|\.txt)?$/,
  /(^|\/)(__tests__|tests?)\//,
  /\.test\.(t|j)sx?$/,
  /\.spec\.(t|j)sx?$/,
];

function isTrivialPath(path) {
  if (!path) return false;
  return TRIVIAL_PATTERNS.some((re) => re.test(path));
}

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

  const isTrivial = files.length > 0 && files.every((f) => isTrivialPath(f.filename));

  let report;
  if (isTrivial) {
    report = {
      summary: `Skipped Claude review: all ${files.length} file(s) in this push are docs/tests/lockfiles/CI config.`,
      verdict: 'approve',
      findings: [],
      filesummaries: files.map((f) => ({ file: f.filename, severity: 'ok', comment: 'trivial' })),
      stats: { totalFindings: 0, critical: 0, warnings: 0, info: 0 },
      deployment: {
        status: 'not_applicable',
        summary: 'No deployment configuration touched in this push',
        platforms: [],
        cicd: 'Not affected',
        containerized: false,
        iac: 'Not affected',
        concerns: [],
        suggestions: [],
      },
      triage: { skippedClaude: true, reason: 'trivial_changes_only' },
    };
    console.log(`commit-review ${commitReviewId}: trivial commit detected (${files.length} files), skipping Claude call`);
  } else {
    report = await reviewer.reviewCommit(projectId, {
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
  }

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
  // or overturn a user's dismiss. Also skipped for trivial commits (dependabot,
  // README edits, etc.) — no point summarizing a lockfile bump.
  if (isTrivial) {
    return;
  }
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

module.exports = { runCommitReviewJob, runCommitReviewJobSafe, prepareFiles, isZeroSha, isTrivialPath };
