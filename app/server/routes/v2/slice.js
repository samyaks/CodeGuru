const express = require('express');
const { deployments } = require('../../lib/db');
const { AppError } = require('../../lib/app-error');
const { asyncHandler } = require('../../lib/async-handler');
const { checkProjectAccess } = require('../../lib/helpers');
const { createRateLimit } = require('../../lib/rate-limit');
const {
  SLICE_SOURCE_KINDS,
  OWNER_SETTABLE_CRITERION_STATUSES,
  SLICE_LIMITS,
  NotImplementedError,
} = require('../../lib/slice-types');

// Intent loop V1 — the slice router (owner: Agent B).
//
// Mounted at /api/v2/projects/:id/slice with optionalAuth. GET is public;
// every mutation requires a user. Every mutation returns the full Slice so the
// client can replace its state wholesale. Route table and bodies:
// docs/specs/intent-driven-building.md → "API".
//
// Agent 0 ships this as a 501 skeleton with validation in place so Agent E can
// develop against real URLs. Agent B replaces each NotImplementedError with
// store/deriver/sync/verifier calls and does not change the route table.

const router = express.Router({ mergeParams: true });

function requireUser(req, _res, next) {
  if (!req.user) return next(AppError.unauthorized('Authentication required'));
  return next();
}

const readLimit = createRateLimit({ windowMs: 60_000, max: 60, message: 'Too many requests. Please try again in a minute.' });
const writeLimit = createRateLimit({ windowMs: 60_000, max: 30, message: 'Too many writes. Please try again in a minute.' });

async function loadProjectAndAuthorize(req) {
  const project = await deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');
  checkProjectAccess(project, req);
  return project;
}

/** Validates POST /activate body → { kind, id, text }. Exported for tests. */
function parseActivateBody(body) {
  const source = body && typeof body === 'object' ? body.source : null;
  if (!SLICE_SOURCE_KINDS.includes(source)) {
    throw AppError.badRequest(`source must be one of: ${SLICE_SOURCE_KINDS.join(', ')}`);
  }
  if (source === 'gap') {
    const gapId = typeof body.gapId === 'string' ? body.gapId.trim() : '';
    if (!gapId) throw AppError.badRequest('gapId is required when source is "gap"');
    return { kind: 'gap', id: gapId, text: null };
  }
  if (source === 'manual') {
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) throw AppError.badRequest('text is required when source is "manual"');
    if (text.length > SLICE_LIMITS.manualTextMax) {
      throw AppError.badRequest(`text must be ${SLICE_LIMITS.manualTextMax} characters or fewer`);
    }
    return { kind: 'manual', id: null, text };
  }
  return { kind: 'next_thing', id: null, text: null };
}

/** Validates POST /:sliceId/criteria/:critId body. Exported for tests. */
function parseCriterionBody(body) {
  const status = body && typeof body === 'object' ? body.status : null;
  if (!OWNER_SETTABLE_CRITERION_STATUSES.includes(status)) {
    throw AppError.badRequest(`status must be one of: ${OWNER_SETTABLE_CRITERION_STATUSES.join(', ')}`);
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : null;
  return { status, note: note || null };
}

/** Validates POST /:sliceId/staging body. Exported for tests. */
function parseStagingBody(body) {
  const tested = body && typeof body === 'object' ? body.tested : undefined;
  if (typeof tested !== 'boolean') throw AppError.badRequest('tested must be a boolean');
  let url = null;
  if (body.url != null && body.url !== '') {
    if (typeof body.url !== 'string') throw AppError.badRequest('url must be a string');
    let parsed;
    try { parsed = new URL(body.url.trim()); } catch { parsed = null; }
    if (!parsed || !/^https?:$/.test(parsed.protocol)) throw AppError.badRequest('url must be an http(s) URL');
    url = parsed.toString();
  }
  return { tested, url };
}

// GET / → { active: Slice | null, recent: Slice[] }
router.get('/', readLimit, asyncHandler(async (req, res) => {
  await loadProjectAndAuthorize(req);
  throw new NotImplementedError('GET /slice');
  // eslint-disable-next-line no-unreachable
  res.json({ active: null, recent: [] });
}));

// POST /activate { source: 'next_thing' } | { source: 'gap', gapId } | { source: 'manual', text }
router.post('/activate', requireUser, writeLimit, asyncHandler(async (req, res) => {
  await loadProjectAndAuthorize(req);
  const source = parseActivateBody(req.body);
  throw new NotImplementedError(`POST /slice/activate (${source.kind})`);
  // eslint-disable-next-line no-unreachable
  res.status(201).json(null);
}));

// GET /:sliceId/sync/preview → { branch, files: [{ path, action, content }] }
router.get('/:sliceId/sync/preview', requireUser, readLimit, asyncHandler(async (req, res) => {
  await loadProjectAndAuthorize(req);
  throw new NotImplementedError('GET /slice/:sliceId/sync/preview');
  // eslint-disable-next-line no-unreachable
  res.json({ branch: '', files: [] });
}));

// POST /:sliceId/sync { branch? } → Slice | 424 NEEDS_RECONNECT
router.post('/:sliceId/sync', requireUser, writeLimit, asyncHandler(async (req, res) => {
  await loadProjectAndAuthorize(req);
  throw new NotImplementedError('POST /slice/:sliceId/sync');
  // eslint-disable-next-line no-unreachable
  res.json(null);
}));

// POST /:sliceId/criteria/:critId { status: 'met'|'unmet'|'pending', note? } → Slice
router.post('/:sliceId/criteria/:critId', requireUser, writeLimit, asyncHandler(async (req, res) => {
  await loadProjectAndAuthorize(req);
  parseCriterionBody(req.body);
  throw new NotImplementedError('POST /slice/:sliceId/criteria/:critId');
  // eslint-disable-next-line no-unreachable
  res.json(null);
}));

// POST /:sliceId/staging { tested, url? } → Slice
router.post('/:sliceId/staging', requireUser, writeLimit, asyncHandler(async (req, res) => {
  await loadProjectAndAuthorize(req);
  parseStagingBody(req.body);
  throw new NotImplementedError('POST /slice/:sliceId/staging');
  // eslint-disable-next-line no-unreachable
  res.json(null);
}));

// POST /:sliceId/check → Slice (manual verification against latest commits on slice.branch)
router.post('/:sliceId/check', requireUser, writeLimit, asyncHandler(async (req, res) => {
  await loadProjectAndAuthorize(req);
  throw new NotImplementedError('POST /slice/:sliceId/check');
  // eslint-disable-next-line no-unreachable
  res.json(null);
}));

// POST /:sliceId/abandon { reason? } → Slice
router.post('/:sliceId/abandon', requireUser, writeLimit, asyncHandler(async (req, res) => {
  await loadProjectAndAuthorize(req);
  throw new NotImplementedError('POST /slice/:sliceId/abandon');
  // eslint-disable-next-line no-unreachable
  res.json(null);
}));

module.exports = router;
module.exports.parseActivateBody = parseActivateBody;
module.exports.parseCriterionBody = parseCriterionBody;
module.exports.parseStagingBody = parseStagingBody;
