const express = require('express');
const crypto = require('crypto');
const { deployments, shippedItems, suggestions } = require('../../lib/db');
const { AppError } = require('../../lib/app-error');
const { asyncHandler } = require('../../lib/async-handler');
const { checkProjectAccess } = require('../../lib/helpers');
const { createRateLimit } = require('../../lib/rate-limit');
const github = require('../../services/github');
const { processCommit } = require('../../services/v2/shipped-runner');

const router = express.Router({ mergeParams: true });

// Followup #7 (code-review H3): mutating endpoints require an authenticated
// user even on public projects — `optionalAuth` at the mount populates
// `req.user` when a session is present, and this middleware enforces it
// for writes. GETs stay open so unauthenticated dashboards keep working.
function requireUser(req, _res, next) {
  if (!req.user) return next(AppError.unauthorized('Authentication required'));
  return next();
}

const readLimit = createRateLimit({
  windowMs: 60_000,
  max: 60,
  message: 'Too many requests. Please try again in a minute.',
});

const writeLimit = createRateLimit({
  windowMs: 60_000,
  max: 20,
  message: 'Too many writes. Please try again in a minute.',
});

// Stricter limit for the backfill endpoint — each call fans out to N
// GitHub API calls + (potentially) N Anthropic verifier calls.
const backfillLimit = createRateLimit({
  windowMs: 5 * 60_000,
  max: 5,
  message: 'Backfill is rate-limited. Please wait a few minutes between runs.',
});

const BACKFILL_MAX_COMMITS = 50;
const BACKFILL_DEFAULT_COMMITS = 20;

async function loadProjectAndAuthorize(req) {
  const project = await deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');
  checkProjectAccess(project, req);
  return project;
}

function shapeShipped(row) {
  return {
    id: row.id,
    title: row.commit_message ? row.commit_message.split('\n')[0].slice(0, 120) : '(no message)',
    commit: typeof row.commit_sha === 'string' ? row.commit_sha.slice(0, 8) : row.commit_sha,
    commitMessage: row.commit_message || '',
    filesChanged: row.files_changed_count ?? 0,
    verification: row.verification,
    verificationDetail: row.verification_detail || '',
    partialItems: Array.isArray(row.partial_items) ? row.partial_items : [],
    shippedAt: row.shipped_at,
    deployedTo: row.deployed_to || null,
    gapId: row.gap_id || null,
    matchConfidence: row.match_confidence,
    matchStrategy: row.match_strategy,
  };
}

router.get('/', readLimit, asyncHandler(async (req, res) => {
  const project = await loadProjectAndAuthorize(req);
  const rows = await shippedItems.listByProjectId(req.params.id);
  res.json({
    repo: project.owner && project.repo ? `${project.owner}/${project.repo}` : null,
    items: rows.map(shapeShipped),
  });
}));

// POST /api/v2/projects/:id/shipped/backfill?limit=N
//
// Pull the last N commits from the project's GitHub repo, hand each one
// to `processCommit`, and report how many landed in `shipped_items`. We
// do this synchronously and return a summary, but each commit is
// idempotent (the unique index on (project_id, commit_sha) + the
// fast-path check in shipped-runner mean re-runs never duplicate).
//
// Why this exists: the v2 webhook flow only writes shipped rows for
// *new* pushes received after the deploy. Without backfill, projects
// that connected their repo before v2 went live see an empty Shipped
// tab forever even though they have plenty of history.
router.post('/backfill', requireUser, backfillLimit, asyncHandler(async (req, res) => {
  const project = await loadProjectAndAuthorize(req);

  if (!project.owner || !project.repo) {
    throw AppError.badRequest('Project is missing owner/repo metadata.');
  }
  if (typeof project.repo_url === 'string' && project.repo_url.startsWith('local://')) {
    throw AppError.badRequest('Backfill requires a GitHub-linked project (folder uploads have no commit history).');
  }

  const requested = Number.parseInt(req.query.limit, 10);
  const perPage = Number.isFinite(requested)
    ? Math.max(1, Math.min(BACKFILL_MAX_COMMITS, requested))
    : BACKFILL_DEFAULT_COMMITS;
  const branch = project.branch || 'main';

  let commits;
  try {
    commits = await github.fetchCommits(project.owner, project.repo, { branch, perPage });
  } catch (err) {
    throw AppError.internal(`Could not fetch commits from GitHub: ${err.message}`);
  }

  const stats = {
    total: commits.length,
    processed: 0,
    matched: 0,
    skippedExisting: 0,
    failed: 0,
  };

  for (const c of commits) {
    const existing = await shippedItems.findByCommit(project.id, c.sha);
    if (existing) {
      stats.skippedExisting += 1;
      continue;
    }

    let detail;
    try {
      detail = await github.fetchCommitDetail(project.owner, project.repo, c.sha);
    } catch (err) {
      console.warn(`[v2/shipped/backfill] fetchCommitDetail ${c.sha} failed: ${err.message}`);
      stats.failed += 1;
      continue;
    }

    const buckets = { added: [], modified: [], removed: [] };
    for (const f of detail.files || []) {
      const status =
        f.status === 'added' ? 'added' :
        f.status === 'removed' ? 'removed' : 'modified';
      buckets[status].push(f.path);
    }

    const commitForRunner = {
      id: c.sha,
      message: c.message || '',
      ...buckets,
    };

    await processCommit({ project, commit: commitForRunner, branch });
    stats.processed += 1;

    const after = await shippedItems.findByCommit(project.id, c.sha);
    if (after) stats.matched += 1;
  }

  res.json({ ok: true, branch, ...stats });
}));

router.post('/:itemId/reopen', requireUser, writeLimit, asyncHandler(async (req, res) => {
  const project = await loadProjectAndAuthorize(req);
  const rows = await shippedItems.listByProjectId(req.params.id);
  const item = rows.find((r) => r.id === req.params.itemId);
  if (!item) throw AppError.notFound('Shipped item not found');
  if (item.verification !== 'partial') {
    throw AppError.badRequest('Only partial-verification items can be reopened.');
  }
  if (!item.gap_id) {
    throw AppError.badRequest('No source gap to reopen.');
  }

  const sourceGap = await suggestions.findV2GapById(item.gap_id, req.params.id);
  if (!sourceGap) throw AppError.notFound('Source gap missing.');

  // Followup #5 (code-review C1): use createV2Gap so we get back the row
  // as actually stored (id is hashed by db.js to prevent guessing). The
  // previous code returned the pre-hash token and the follow-up
  // setV2Status call targeted no row.
  const seedId = crypto
    .createHash('sha256')
    .update(`${req.params.id}:${item.id}:${Date.now()}`)
    .digest('hex')
    .slice(0, 16);

  const inserted = await suggestions.createV2Gap({
    id: seedId,
    project_id: req.params.id,
    type: sourceGap.type,
    category: sourceGap.category,
    priority: sourceGap.priority,
    title: `${sourceGap.title} (remaining)`,
    description: `Reopened from partial commit ${item.commit_sha?.slice(0, 8) || ''}. ${item.verification_detail || ''}`,
    evidence: [],
    effort: sourceGap.effort,
    cursor_prompt: null,
    affected_files: Array.isArray(item.partial_items) ? item.partial_items : [],
    source: 'static',
    status: 'open',
    v2_status: 'untriaged',
    v2_category: sourceGap.v2_category,
    v2_refined_from_id: sourceGap.id,
  });

  if (!inserted) {
    throw AppError.internal('Could not reopen — failed to insert remaining gap.');
  }

  res.json({ ok: true, newGapId: inserted.id, project: { id: project.id } });
}));

module.exports = router;
