const express = require('express');
const crypto = require('crypto');
const { deployments, shippedItems, suggestions } = require('../../lib/db');
const { AppError } = require('../../lib/app-error');
const { asyncHandler } = require('../../lib/async-handler');
const { checkProjectAccess } = require('../../lib/helpers');
const { createRateLimit } = require('../../lib/rate-limit');

const router = express.Router({ mergeParams: true });

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

router.post('/:itemId/reopen', writeLimit, asyncHandler(async (req, res) => {
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

  const newId = crypto.createHash('sha256')
    .update(`${req.params.id}:${item.id}:${Date.now()}`)
    .digest('hex')
    .slice(0, 16);

  // Insert a new untriaged gap scoped to the still-failing files
  await suggestions.createBatch([{
    id: newId,
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
  }]);

  // Mark the new row's v2 fields explicitly (createBatch doesn't set them)
  await suggestions.setV2Status(newId, req.params.id, 'untriaged');

  res.json({ ok: true, newGapId: newId, project: { id: project.id } });
}));

module.exports = router;
