const express = require('express');
const { suggestions, deployments } = require('../../lib/db');
const { AppError } = require('../../lib/app-error');
const { asyncHandler } = require('../../lib/async-handler');
const { checkProjectAccess } = require('../../lib/helpers');
const { createRateLimit } = require('../../lib/rate-limit');
const {
  toGap,
  groupGaps,
  attachAffectedJobs,
  synthesizeMapGaps,
} = require('../../services/v2/gap-mapper');
const { generateCursorPrompt } = require('../../services/v2/gap-prompt-generator');
const { productMap: productMapDb } = require('../../lib/db-map');
const { linkGapsToJobs } = require('../../services/v2/gap-job-linker');

const router = express.Router({ mergeParams: true });

// Followup #7 (code-review H3): mutating endpoints require an authenticated
// user even on public projects. GETs stay open via `optionalAuth` at the
// mount; this guard runs only for writes (`accept`, `reject`, `restore`,
// `refine`, `mark-committed`).
function requireUser(req, _res, next) {
  if (!req.user) return next(AppError.unauthorized('Authentication required'));
  return next();
}

// Followup #6: the API stores v2_status in snake_case but the v2 frontend
// emits kebab-case (`in-progress`). Accept either casing here so the
// frontend's status filter actually narrows results.
const ALLOWED_V2_STATUS = new Set([
  'untriaged',
  'in_progress',
  'shipped',
  'rejected',
]);
function normalizeV2Status(raw) {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') return undefined;
  const normalized = raw.replace(/-/g, '_');
  if (!ALLOWED_V2_STATUS.has(normalized)) {
    throw AppError.badRequest(
      `Unknown ?status= value "${raw}". Allowed: untriaged, in-progress, shipped, rejected.`
    );
  }
  return normalized;
}

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
  const {
    rawCategory: _r,
    priority: _p,
    type: _t,
    affectedFiles: _af,
    jobLinks: _jl,
    ...publicFields
  } = gap;
  return publicFields;
}

router.get('/', readLimit, asyncHandler(async (req, res) => {
  await loadProjectAndAuthorize(req);
  const v2Status = normalizeV2Status(req.query.status);
  const projectId = req.params.id;

  // 1. Load the persisted AI/static gaps + the project's product map in
  //    parallel. We need the map for both display enrichment
  //    (`affectedJobs`) and for synthesizing map-derived gaps for any
  //    missing/partial entity not already covered by an AI gap.
  const [rows, map] = await Promise.all([
    suggestions.findV2GapsByProjectId(projectId, { v2Status }),
    productMapDb.getMapByProject(projectId).catch((err) => {
      console.warn(`[v2/gaps] product-map load failed for ${projectId}:`, err.message);
      return null;
    }),
  ]);

  const mapped = rows.map(toGap);

  // 2. If any gap is still un-linked AND we have a map, fire-and-forget
  //    a background linker pass. The current response goes out without
  //    `affectedJobs` for those rows; the next reload will see them
  //    populated. This is the lazy backstop for projects analyzed
  //    before migration 013 / the linker hooks landed in the pipeline.
  const hasUnlinked = mapped.some((g) => g.jobLinks === null);
  if (hasUnlinked && map && Array.isArray(map.jobs) && map.jobs.length > 0) {
    setImmediate(() => {
      linkGapsToJobs(projectId).catch((err) => {
        console.warn(`[v2/gaps] background linker for ${projectId} failed:`, err.message);
      });
    });
  }

  // 3. Decorate AI gaps with display-ready persona/job info.
  const enriched = attachAffectedJobs(mapped, map);

  // 4. Synthesize map-derived "Build [Entity] for [Job]" gaps for any
  //    needs-edge whose target entity isn't built yet. Skipped (no-op)
  //    when ?status= filter excludes 'untriaged' since synthetic gaps
  //    only exist as untriaged.
  const synthetic = (v2Status && v2Status !== 'untriaged')
    ? []
    : synthesizeMapGaps(map, enriched);

  const grouped = groupGaps([...enriched, ...synthetic]);

  // 5. Surface persona list for the frontend filter chips. Only personas
  //    that have at least one job are useful to filter by.
  const personasInPlay = (map?.personas || [])
    .filter((p) => (map.jobs || []).some((j) => (j.persona_id || j.personaId) === p.id))
    .map((p) => ({ id: p.id, name: p.name, emoji: p.emoji || '👤' }));

  res.json({
    broken: grouped.broken.map(pruneInternalFields),
    missing: grouped.missing.map(pruneInternalFields),
    infra: grouped.infra.map(pruneInternalFields),
    personas: personasInPlay,
  });
}));

// Lazy Cursor-prompt generator. AI gaps cache `cursor_prompt` on their
// suggestions row; this endpoint regenerates if that's missing. For
// synthetic map-derived gaps (id starts with `map-`), nothing is cached,
// so we always generate. The frontend calls this only when the user
// clicks "Get Cursor prompt" on a synthetic gap card.
router.post('/:gapId/prompt', requireUser, writeLimit, asyncHandler(async (req, res) => {
  const project = await loadProjectAndAuthorize(req);
  const gapId = req.params.gapId;

  // Synthetic map-derived gap path. The id is unstable (encodes
  // entityId + jobId) so we look up the entity/job from the live map
  // each time rather than persisting.
  if (gapId.startsWith('map-')) {
    const map = await productMapDb.getMapByProject(req.params.id);
    if (!map || !Array.isArray(map.entities) || !Array.isArray(map.jobs)) {
      throw AppError.notFound('Map not available for this project');
    }
    const synthetic = synthesizeMapGaps(map, []);
    const target = synthetic.find((g) => g.id === gapId);
    if (!target) throw AppError.notFound('Synthetic gap no longer applies (entity may have been built)');

    let prompt = null;
    try {
      prompt = await generateCursorPrompt({ project, gap: target });
    } catch (err) {
      console.error(`[v2/gaps] synthetic-prompt generation failed for ${gapId}:`, err.message);
      throw AppError.internal('Could not generate prompt. Try again in a moment.');
    }
    return res.json({ prompt });
  }

  // AI gap path — regenerate and cache.
  const row = await suggestions.findV2GapById(gapId, req.params.id);
  if (!row) throw AppError.notFound('Gap not found');

  let prompt = row.cursor_prompt || null;
  if (!prompt) {
    try {
      const gapShape = toGap(row);
      prompt = await generateCursorPrompt({ project, gap: gapShape });
      if (prompt) {
        await suggestions.setCursorPrompt(gapId, req.params.id, prompt);
      }
    } catch (err) {
      console.error(`[v2/gaps] prompt generation failed for ${gapId}:`, err.message);
      throw AppError.internal('Could not generate prompt. Try again in a moment.');
    }
  }
  return res.json({ prompt });
}));

router.post('/:gapId/accept', requireUser, writeLimit, asyncHandler(async (req, res) => {
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

router.post('/:gapId/reject', requireUser, writeLimit, asyncHandler(async (req, res) => {
  await loadProjectAndAuthorize(req);
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : null;
  const updated = await suggestions.setV2Status(
    req.params.gapId, req.params.id, 'rejected', { rejectedReason: reason }
  );
  if (!updated) throw AppError.notFound('Gap not found');
  res.json({ gap: pruneInternalFields(toGap(updated)) });
}));

router.post('/:gapId/restore', requireUser, writeLimit, asyncHandler(async (req, res) => {
  await loadProjectAndAuthorize(req);
  const updated = await suggestions.setV2Status(
    req.params.gapId, req.params.id, 'untriaged', { rejectedReason: null }
  );
  if (!updated) throw AppError.notFound('Gap not found');
  res.json({ gap: pruneInternalFields(toGap(updated)) });
}));

router.post('/:gapId/refine', requireUser, REFINE_LIMIT, asyncHandler(async (req, res) => {
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

router.post('/:gapId/mark-committed', requireUser, writeLimit, asyncHandler(async (req, res) => {
  await loadProjectAndAuthorize(req);
  const updated = await suggestions.setV2Status(
    req.params.gapId, req.params.id, 'shipped',
    { committedAt: new Date().toISOString(), verification: 'pending' }
  );
  if (!updated) throw AppError.notFound('Gap not found');
  res.json({ gap: pruneInternalFields(toGap(updated)) });
}));

module.exports = router;
