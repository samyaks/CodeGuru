const express = require('express');
const { suggestions, deployments } = require('../../lib/db');
const { AppError } = require('../../lib/app-error');
const { asyncHandler } = require('../../lib/async-handler');
const { checkProjectAccess } = require('../../lib/helpers');
const { createRateLimit } = require('../../lib/rate-limit');
const { toGap, groupGaps } = require('../../services/v2/gap-mapper');
const { generateCursorPrompt } = require('../../services/v2/gap-prompt-generator');

const router = express.Router({ mergeParams: true });

const readLimit = createRateLimit({
  windowMs: 60_000,
  max: 60,
  message: 'Too many requests. Please try again in a minute.',
});

const writeLimit = createRateLimit({
  windowMs: 60_000,
  max: 30,
  message: 'Too many writes. Please try again in a minute.',
});

const REFINE_LIMIT = createRateLimit({
  windowMs: 60_000,
  max: 10,
  message: 'Refining a gap is rate-limited. Try again shortly.',
});

async function loadProjectAndAuthorize(req) {
  const project = await deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');
  checkProjectAccess(project, req);
  return project;
}

function pruneInternalFields(gap) {
  const { rawCategory: _r, priority: _p, type: _t, affectedFiles: _af, ...publicFields } = gap;
  return publicFields;
}

router.get('/', readLimit, asyncHandler(async (req, res) => {
  await loadProjectAndAuthorize(req);
  const v2Status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const rows = await suggestions.findV2GapsByProjectId(req.params.id, { v2Status });
  const mapped = rows.map(toGap);
  const grouped = groupGaps(mapped);
  res.json({
    broken: grouped.broken.map(pruneInternalFields),
    missing: grouped.missing.map(pruneInternalFields),
    infra: grouped.infra.map(pruneInternalFields),
  });
}));

router.post('/:gapId/accept', writeLimit, asyncHandler(async (req, res) => {
  const project = await loadProjectAndAuthorize(req);
  const row = await suggestions.findV2GapById(req.params.gapId, req.params.id);
  if (!row) throw AppError.notFound('Gap not found');

  let cursorPrompt = row.cursor_prompt;
  if (!cursorPrompt) {
    try {
      const gapShape = toGap(row);
      cursorPrompt = await generateCursorPrompt({ project, gap: gapShape });
      if (cursorPrompt) {
        await suggestions.setCursorPrompt(req.params.gapId, req.params.id, cursorPrompt);
      }
    } catch (err) {
      console.error(`[v2/gaps] cursor-prompt generation failed for ${req.params.gapId}:`, err.message);
    }
  }

  const updated = await suggestions.setV2Status(req.params.gapId, req.params.id, 'in_progress');
  if (!updated) throw AppError.notFound('Gap not found');
  res.json({ gap: pruneInternalFields(toGap(updated)) });
}));

router.post('/:gapId/reject', writeLimit, asyncHandler(async (req, res) => {
  await loadProjectAndAuthorize(req);
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : null;
  const updated = await suggestions.setV2Status(
    req.params.gapId, req.params.id, 'rejected', { rejectedReason: reason }
  );
  if (!updated) throw AppError.notFound('Gap not found');
  res.json({ gap: pruneInternalFields(toGap(updated)) });
}));

router.post('/:gapId/restore', writeLimit, asyncHandler(async (req, res) => {
  await loadProjectAndAuthorize(req);
  const updated = await suggestions.setV2Status(
    req.params.gapId, req.params.id, 'untriaged', { rejectedReason: null }
  );
  if (!updated) throw AppError.notFound('Gap not found');
  res.json({ gap: pruneInternalFields(toGap(updated)) });
}));

router.post('/:gapId/refine', REFINE_LIMIT, asyncHandler(async (req, res) => {
  const project = await loadProjectAndAuthorize(req);
  const instructions = typeof req.body?.instructions === 'string' ? req.body.instructions.trim() : '';
  if (!instructions) throw AppError.badRequest('Missing refine instructions');

  const row = await suggestions.findV2GapById(req.params.gapId, req.params.id);
  if (!row) throw AppError.notFound('Gap not found');

  let newPrompt = null;
  try {
    const gapShape = toGap(row);
    newPrompt = await generateCursorPrompt({
      project,
      gap: gapShape,
      refineInstructions: instructions,
    });
  } catch (err) {
    console.error(`[v2/gaps] refine failed for ${req.params.gapId}:`, err.message);
    throw AppError.internal('Could not refine gap. Try again in a moment.');
  }

  const updated = await suggestions.refineV2Gap(req.params.gapId, req.params.id, {
    cursorPrompt: newPrompt,
    refinedFromId: req.params.gapId,
  });
  if (!updated) throw AppError.notFound('Gap not found');
  res.json({ gap: pruneInternalFields(toGap(updated)) });
}));

router.post('/:gapId/mark-committed', writeLimit, asyncHandler(async (req, res) => {
  await loadProjectAndAuthorize(req);
  const updated = await suggestions.setV2Status(
    req.params.gapId, req.params.id, 'shipped',
    { committedAt: new Date().toISOString(), verification: 'pending' }
  );
  if (!updated) throw AppError.notFound('Gap not found');
  res.json({ gap: pruneInternalFields(toGap(updated)) });
}));

module.exports = router;
