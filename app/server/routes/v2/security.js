const express = require('express');
const { suggestions, deployments } = require('../../lib/db');
const { AppError } = require('../../lib/app-error');
const { asyncHandler } = require('../../lib/async-handler');
const { checkProjectAccess } = require('../../lib/helpers');
const { createRateLimit } = require('../../lib/rate-limit');
const { toGap } = require('../../services/v2/gap-mapper');
const { computeSecurityScore } = require('../../services/security/score');
const { listDetectorNames } = require('../../services/security');

const router = express.Router({ mergeParams: true });

const readLimit = createRateLimit({
  windowMs: 60_000,
  max: 60,
  message: 'Too many requests. Please try again in a minute.',
});

const TOP_RISKS_LIMIT = 5;

function pruneInternalFields(gap) {
  const {
    rawCategory: _r,
    priority: _p,
    type: _t,
    affectedFiles: _af,
    jobLinks: _jl,
    mapEntityId: _me,
    mapJobId: _mj,
    ...publicFields
  } = gap;
  return publicFields;
}

async function loadProjectAndAuthorize(req) {
  const project = await deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');
  checkProjectAccess(project, req);
  return project;
}

// GET /api/v2/projects/:id/security-summary
//
// Read-only endpoint that returns the precomputed security score
// (cached on `deployments.security_score`) plus the unaddressed
// severity breakdown and the top-N risks for header / hero display.
// Intentionally lightweight — Phase 3's dedicated Security report
// will fetch a richer payload from a different endpoint.
//
// The score is recomputed from the live unaddressed rows on every
// request rather than blindly trusting the cached value, so a user
// who triages a gap (accept/reject) sees the score update on the
// next reload without waiting for a full re-analysis. The cached
// value on `deployments.security_score` is what list views read.
router.get('/', readLimit, asyncHandler(async (req, res) => {
  const project = await loadProjectAndAuthorize(req);

  const unaddressed = await suggestions.findV2SecurityGapsByProjectId(project.id);
  const { score, severityBreakdown, totalUnaddressed } = computeSecurityScore(unaddressed);

  // `findV2SecurityGapsByProjectId` already orders by severity then
  // recency, so slicing the front gives the top-N risks for free.
  const topRisks = unaddressed
    .slice(0, TOP_RISKS_LIMIT)
    .map(toGap)
    .map(pruneInternalFields);

  res.json({
    score,
    severityBreakdown,
    totalUnaddressed,
    cachedScore: typeof project.security_score === 'number' ? project.security_score : null,
    topRisks,
    detectors: listDetectorNames(),
    lastAnalyzed: project.updated_at || null,
  });
}));

module.exports = router;
