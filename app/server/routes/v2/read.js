const express = require('express');
const { deployments, projectReads, readClaims } = require('../../lib/db');
const { AppError } = require('../../lib/app-error');
const { asyncHandler } = require('../../lib/async-handler');
const { checkProjectAccess } = require('../../lib/helpers');
const { createRateLimit } = require('../../lib/rate-limit');
// Safe to require at module load: run-read only lazily requires the LLM
// synthesis modules inside its functions.
const { runRead } = require('../../services/read/run-read');
const { applyCorrection } = require('../../services/read/cascade');

// "The Read" router — the prose read of a project: three slotted claims
// (objective / audience / core_job) plus the derived "next thing to build".
// The builder prompt is gated behind a Pro stub (`project_reads.read_unlocked`).
// Mirrors the conventions in routes/v2/intent.js.

const router = express.Router({ mergeParams: true });

// Mutating endpoints require an authenticated user even on public projects
// (GETs stay open via optionalAuth at the mount). Same guard as v2/intent.js.
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

// Evidence is stored as the synthesizer emitted it; normalize defensively so
// the client always sees { filePath, symbol, note }.
function toEvidenceEntry(e) {
  if (!e || typeof e !== 'object') return { filePath: null, symbol: null, note: null };
  return {
    filePath: e.filePath ?? e.file_path ?? null,
    symbol: e.symbol ?? null,
    note: e.note ?? null,
  };
}

function toClaim(row) {
  return {
    id: row.id,
    slot: row.slot,
    text: row.text,
    confidence: row.confidence ?? null,
    status: row.status,
    source: row.source,
    evidence: (Array.isArray(row.evidence) ? row.evidence : []).map(toEvidenceEntry),
    alternative: row.alternative ?? null,
  };
}

// The full read payload — shared by every endpoint so corrections, unlock,
// and regenerate all return the same shape as GET /.
async function buildReadPayload(project) {
  const readRow = await projectReads.findByProjectId(project.id);
  if (!readRow) {
    // The client treats this 404 as "the read is still being drafted".
    throw AppError.notFound('No read drafted for this project yet — analysis may still be running');
  }
  const claimRows = await readClaims.findByProjectId(project.id);

  const gated = !readRow.read_unlocked;
  const fileTree = project.analysis_data?.fileTree;

  return {
    projectId: project.id,
    draftedAt: readRow.drafted_at || null,
    fileCount: Array.isArray(fileTree) ? fileTree.length : null,
    claims: claimRows.map(toClaim),
    next: {
      title: readRow.next_title || null,
      why: readRow.next_why || null,
      category: readRow.next_category || null,
      // The builder prompt is the Pro-gated artifact.
      prompt: gated ? null : (readRow.next_prompt || null),
      gated,
    },
  };
}

// GET / -> the full read (claims + gated next-thing)
router.get('/', readLimit, asyncHandler(async (req, res) => {
  const project = await loadProjectAndAuthorize(req);
  res.json(await buildReadPayload(project));
}));

// PATCH /claims/:claimId -> settle a claim with a correction.
// Body: { text } (free-form correction) OR { optionId } (pick one of the
// claim's stored alternative options). Settling re-derives the next-thing;
// if that LLM call fails the settle still sticks and the response carries
// `nextStale: true` with the previous next-thing unchanged.
router.patch('/claims/:claimId', requireUser, writeLimit, asyncHandler(async (req, res) => {
  const project = await loadProjectAndAuthorize(req);

  // The cascade owns validation, the settle, and the re-derivation; here we
  // only authorize and translate its coded errors to HTTP.
  let result;
  try {
    result = await applyCorrection(project.id, req.params.claimId, req.body || {});
  } catch (err) {
    if (err.code === 'BAD_REQUEST') throw AppError.badRequest(err.message);
    if (err.code === 'NOT_FOUND') throw AppError.notFound(err.message);
    throw err;
  }

  const payload = await buildReadPayload(project);
  if (result.nextStale) payload.nextStale = true;
  res.json(payload);
}));

// POST /unlock -> Pro stub: flip read_unlocked so the builder prompt is
// returned. No billing — just the flag.
router.post('/unlock', requireUser, writeLimit, asyncHandler(async (req, res) => {
  const project = await loadProjectAndAuthorize(req);
  const updated = await projectReads.setUnlocked(project.id, true);
  if (!updated) {
    throw AppError.notFound('No read drafted for this project yet — analysis may still be running');
  }
  res.json(await buildReadPayload(project));
}));

// POST /regenerate -> re-run the full read pipeline now (awaited), return
// the fresh read. Settled claims survive regeneration by design.
router.post('/regenerate', requireUser, writeLimit, asyncHandler(async (req, res) => {
  const project = await loadProjectAndAuthorize(req);
  await runRead(project.id, {});
  res.json(await buildReadPayload(project));
}));

module.exports = router;
