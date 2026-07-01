const express = require('express');
const { deployments, intentStatements, intentFeatures, analysisFiles } = require('../../lib/db');
const { AppError } = require('../../lib/app-error');
const { asyncHandler } = require('../../lib/async-handler');
const { checkProjectAccess } = require('../../lib/helpers');
const { createRateLimit } = require('../../lib/rate-limit');
const { toStatement, groupByArea } = require('../../services/intent/intent-mapper');
const { buildLivingSpec } = require('../../services/intent/spec-generator');
const { hashLinkedFiles } = require('../../services/intent/satisfaction');
const { synthesizeIntentGaps } = require('../../services/intent/intent-gaps');

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

const VALID_KINDS = new Set(['behavior', 'constraint', 'non_goal']);

// Compute the satisfaction baseline hash for a statement: sha256 over the
// CURRENT contents of its linked files. For Takeoff projects the analysis id
// equals the project id. Delegates the hashing to services/intent/satisfaction
// so confirm (baseline) and the Phase 6 re-check hash on an identical basis. A
// null result means "confirmed but nothing to check against yet".
async function computeBaselineHash(projectId, links) {
  const contents = await analysisFiles.getContentsMap(projectId);
  return hashLinkedFiles(contents, links);
}

// ── Phase 4: list / confirm / edit / reject / restore ─────────────
// GET /  -> statements grouped by feature_area with links + status
router.get('/', readLimit, asyncHandler(async (req, res) => {
  await loadProjectAndAuthorize(req);
  const { status, featureArea } = req.query;
  const [rows, features] = await Promise.all([
    intentStatements.findByProjectId(req.params.id, {
      status: typeof status === 'string' ? status : undefined,
      featureArea: typeof featureArea === 'string' ? featureArea : undefined,
    }),
    intentFeatures.findByProjectId(req.params.id),
  ]);
  res.json(groupByArea(rows.map(toStatement), features));
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
  const [confirmed, features] = await Promise.all([
    intentStatements.findConfirmedByProjectId(req.params.id),
    intentFeatures.findByProjectId(req.params.id),
  ]);
  res.json({ markdown: buildLivingSpec(confirmed, features) });
}));

// Null-safe match of a stored link by its current (file_path, symbol) identity.
function linkMatches(link, filePath, symbol) {
  const wantSymbol = symbol === undefined ? null : symbol;
  return link.file_path === filePath && (link.symbol ?? null) === wantSymbol;
}

// ── Phase 6: gaps-as-views ─────────────────────────────────────────
// GET /gaps -> confirmed statements whose linked code has drifted (unsatisfied
// or broken links), synthesized fresh from the substrate. Never stored.
router.get('/gaps', readLimit, asyncHandler(async (req, res) => {
  await loadProjectAndAuthorize(req);
  const confirmed = await intentStatements.findConfirmedByProjectId(req.params.id);
  res.json({ gaps: synthesizeIntentGaps(confirmed) });
}));

// ── Phase 5: link reconciliation triage ───────────────────────────
// GET /triage -> every link a human should adjudicate (needs_relink / broken),
// read straight from persisted link health (set by the pipeline's reconcile
// stage) so this is a cheap read with no re-analysis.
router.get('/triage', readLimit, asyncHandler(async (req, res) => {
  await loadProjectAndAuthorize(req);
  const rows = await intentStatements.findByProjectId(req.params.id);
  const items = [];
  for (const row of rows) {
    if (row.status === 'rejected') continue;
    const statement = toStatement(row);
    for (const link of statement.links) {
      if (link.linkStatus === 'needs_relink' || link.linkStatus === 'broken') {
        items.push({
          statementId: statement.id,
          statementText: statement.text,
          featureArea: statement.featureArea,
          link,
        });
      }
    }
  }
  res.json({ items });
}));

// POST /:statementId/relink -> repoint a needs_relink link at a real symbol.
// Body: { filePath, symbol, newSymbol?, newFilePath? }. Omit newSymbol to accept
// the reconciler's suggested_symbol.
router.post('/:statementId/relink', requireUser, writeLimit, asyncHandler(async (req, res) => {
  await loadProjectAndAuthorize(req);
  const { filePath, symbol, newSymbol, newFilePath } = req.body || {};
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw AppError.badRequest('`filePath` is required to identify the link');
  }
  if (newFilePath !== undefined && (typeof newFilePath !== 'string' || newFilePath.length === 0)) {
    throw AppError.badRequest('`newFilePath` must be a non-empty string when provided');
  }

  const existing = await intentStatements.findById(req.params.statementId, req.params.id);
  if (!existing) throw AppError.notFound('Statement not found');

  const links = Array.isArray(existing.links) ? existing.links : [];
  let matched = false;
  const updatedLinks = links.map((link) => {
    if (matched || !linkMatches(link, filePath, symbol)) return link;
    matched = true;
    // Resolve the target symbol: explicit newSymbol wins, else accept the
    // reconciler's suggestion, else keep the current symbol.
    const resolvedSymbol = newSymbol !== undefined
      ? newSymbol
      : (link.suggested_symbol ?? link.symbol ?? null);
    return {
      file_path: newFilePath || link.file_path,
      symbol: resolvedSymbol,
      link_status: 'healthy',
    };
  });
  if (!matched) throw AppError.notFound('Link not found on this statement');

  const updated = await intentStatements.update(req.params.statementId, req.params.id, { links: updatedLinks });
  if (!updated) throw AppError.notFound('Statement not found');
  res.json({ statement: toStatement(updated) });
}));

// POST /:statementId/mark-broken -> confirm a link is genuinely broken.
// Body: { filePath, symbol }.
router.post('/:statementId/mark-broken', requireUser, writeLimit, asyncHandler(async (req, res) => {
  await loadProjectAndAuthorize(req);
  const { filePath, symbol } = req.body || {};
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw AppError.badRequest('`filePath` is required to identify the link');
  }

  const existing = await intentStatements.findById(req.params.statementId, req.params.id);
  if (!existing) throw AppError.notFound('Statement not found');

  const links = Array.isArray(existing.links) ? existing.links : [];
  let matched = false;
  const updatedLinks = links.map((link) => {
    if (matched || !linkMatches(link, filePath, symbol)) return link;
    matched = true;
    return { file_path: link.file_path, symbol: link.symbol ?? null, link_status: 'broken' };
  });
  if (!matched) throw AppError.notFound('Link not found on this statement');

  const updated = await intentStatements.update(req.params.statementId, req.params.id, { links: updatedLinks });
  if (!updated) throw AppError.notFound('Statement not found');
  res.json({ statement: toStatement(updated) });
}));

module.exports = router;
