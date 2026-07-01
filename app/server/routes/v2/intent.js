const crypto = require('crypto');
const express = require('express');
const { deployments, intentStatements, analysisFiles } = require('../../lib/db');
const { AppError } = require('../../lib/app-error');
const { asyncHandler } = require('../../lib/async-handler');
const { checkProjectAccess } = require('../../lib/helpers');
const { createRateLimit } = require('../../lib/rate-limit');
const { toStatement, groupByArea } = require('../../services/intent/intent-mapper');
const { buildLivingSpec } = require('../../services/intent/spec-generator');

// Takeoff intent substrate router (Phase 4/4b/5 fill in the handlers).
//
// Wave 0 scaffolding: this file owns the full route surface and the shared
// auth / rate-limit / project-authorization plumbing so later phases only
// implement handler bodies, not wiring. Handlers currently return 501 until
// their phase lands. Mirrors the conventions in routes/v2/gaps.js.

const router = express.Router({ mergeParams: true });

// Mutating endpoints require an authenticated user even on public projects
// (GETs stay open via optionalAuth at the mount). Same guard as v2/gaps.js.
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
  max: 30,
  message: 'Too many writes. Please try again in a minute.',
});

async function loadProjectAndAuthorize(req) {
  const project = await deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');
  checkProjectAccess(project, req);
  return project;
}

// Placeholder until the owning phase implements the handler. Keeps the route
// surface (and thus the frontend contract) stable during the multi-agent build.
function notImplemented(feature) {
  return asyncHandler(async (req) => {
    await loadProjectAndAuthorize(req);
    throw new AppError(`${feature} is not implemented yet`, 501, 'NOT_IMPLEMENTED');
  });
}

const VALID_KINDS = new Set(['behavior', 'constraint', 'non_goal']);

// Compute the satisfaction baseline hash for a statement: sha256 over the
// CURRENT contents of its linked files. Links may point at the same file
// multiple times (different symbols), so we dedupe by file_path and hash each
// file's content once, in stable (sorted) order. For Takeoff projects the
// analysis id equals the project id. If no linked content is available
// (unlinked statement, or files not captured), returns null — a null baseline
// means "confirmed but nothing to check against yet".
async function computeBaselineHash(projectId, links) {
  const paths = [
    ...new Set(
      (Array.isArray(links) ? links : [])
        .map((l) => l && l.file_path)
        .filter((p) => typeof p === 'string' && p.length > 0)
    ),
  ].sort();
  if (paths.length === 0) return null;

  const contents = await analysisFiles.getContentsMap(projectId);
  const hash = crypto.createHash('sha256');
  let hashedAny = false;
  for (const p of paths) {
    const content = contents[p];
    if (typeof content !== 'string') continue; // hash over the available subset
    hash.update(p);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
    hashedAny = true;
  }
  return hashedAny ? hash.digest('hex') : null;
}

// ── Phase 4: list / confirm / edit / reject / restore ─────────────
// GET /  -> statements grouped by feature_area with links + status
router.get('/', readLimit, asyncHandler(async (req, res) => {
  await loadProjectAndAuthorize(req);
  const { status, featureArea } = req.query;
  const rows = await intentStatements.findByProjectId(req.params.id, {
    status: typeof status === 'string' ? status : undefined,
    featureArea: typeof featureArea === 'string' ? featureArea : undefined,
  });
  res.json(groupByArea(rows.map(toStatement)));
}));

// POST /:statementId/confirm -> status=confirmed + freeze satisfaction baseline
router.post('/:statementId/confirm', requireUser, writeLimit, asyncHandler(async (req, res) => {
  await loadProjectAndAuthorize(req);
  const existing = await intentStatements.findById(req.params.statementId, req.params.id);
  if (!existing) throw AppError.notFound('Statement not found');

  // Freeze the baseline: hash the current linked-file contents so Phase 6 can
  // detect drift. A freshly confirmed statement is satisfied by definition.
  const codeHash = await computeBaselineHash(req.params.id, existing.links);
  const updated = await intentStatements.update(req.params.statementId, req.params.id, {
    status: 'confirmed',
    code_hash: codeHash,
    satisfied: true,
    last_checked_at: new Date().toISOString(),
  });
  if (!updated) throw AppError.notFound('Statement not found');
  res.json({ statement: toStatement(updated) });
}));

// PATCH /:statementId -> edit text/kind/links (source -> human)
router.patch('/:statementId', requireUser, writeLimit, asyncHandler(async (req, res) => {
  await loadProjectAndAuthorize(req);
  const { text, kind, links } = req.body || {};

  const fields = {};
  let edited = false;

  if (text !== undefined) {
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw AppError.badRequest('`text` must be a non-empty string');
    }
    fields.text = text;
    edited = true;
  }

  if (kind !== undefined) {
    if (!VALID_KINDS.has(kind)) {
      throw AppError.badRequest('`kind` must be one of: behavior, constraint, non_goal');
    }
    fields.kind = kind;
    edited = true;
  }

  if (links !== undefined) {
    if (!Array.isArray(links)) {
      throw AppError.badRequest('`links` must be an array of { filePath, symbol }');
    }
    // Human-supplied links are trusted as healthy anchors; Phase 5 revalidates.
    fields.links = links.map((l) => {
      if (!l || typeof l.filePath !== 'string' || l.filePath.length === 0) {
        throw AppError.badRequest('Each link needs a non-empty `filePath`');
      }
      return {
        file_path: l.filePath,
        symbol: l.symbol ?? null,
        link_status: 'healthy',
      };
    });
    edited = true;
  }

  if (!edited) throw AppError.badRequest('Nothing to update; provide text, kind, or links');

  // A human touching the content promotes the statement off the inferred track.
  fields.source = 'human';

  const updated = await intentStatements.update(req.params.statementId, req.params.id, fields);
  if (!updated) throw AppError.notFound('Statement not found');
  res.json({ statement: toStatement(updated) });
}));

// POST /:statementId/reject -> status=rejected (kept for suppression + restore)
router.post('/:statementId/reject', requireUser, writeLimit, asyncHandler(async (req, res) => {
  await loadProjectAndAuthorize(req);
  const updated = await intentStatements.setStatus(req.params.statementId, req.params.id, 'rejected');
  if (!updated) throw AppError.notFound('Statement not found');
  res.json({ statement: toStatement(updated) });
}));

// POST /:statementId/restore -> rejected -> candidate
router.post('/:statementId/restore', requireUser, writeLimit, asyncHandler(async (req, res) => {
  await loadProjectAndAuthorize(req);
  const updated = await intentStatements.setStatus(req.params.statementId, req.params.id, 'candidate');
  if (!updated) throw AppError.notFound('Statement not found');
  res.json({ statement: toStatement(updated) });
}));

// ── Phase 4b: living spec view ────────────────────────────────────
// GET /spec -> generated markdown living spec from confirmed statements
router.get('/spec', readLimit, asyncHandler(async (req, res) => {
  await loadProjectAndAuthorize(req);
  const confirmed = await intentStatements.findConfirmedByProjectId(req.params.id);
  res.json({ markdown: buildLivingSpec(confirmed) });
}));

// ── Phase 5: link reconciliation triage ───────────────────────────
// GET /triage -> links needing attention (needs_relink / broken)
router.get('/triage', readLimit, notImplemented('Link triage list'));
// POST /:statementId/relink -> apply a suggested relink
router.post('/:statementId/relink', requireUser, writeLimit, notImplemented('Apply relink'));
// POST /:statementId/mark-broken -> confirm a link as broken
router.post('/:statementId/mark-broken', requireUser, writeLimit, notImplemented('Mark link broken'));

module.exports = router;
