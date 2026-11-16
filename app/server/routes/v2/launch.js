const express = require('express');
const { deployments } = require('../../lib/db');
const { AppError } = require('../../lib/app-error');
const { asyncHandler } = require('../../lib/async-handler');
const { checkProjectAccess } = require('../../lib/helpers');
const { createRateLimit } = require('../../lib/rate-limit');
const { buildLaunchChecks } = require('../../services/v2/launch-checks');

// GET /api/v2/projects/:id/launch -> the launch checks for the project page,
// read from the detector results saved by the last scan. No analysis runs here.
const router = express.Router({ mergeParams: true });

const readLimit = createRateLimit({
  windowMs: 60_000,
  max: 60,
  message: 'Too many requests. Please try again in a minute.',
});

router.get('/', readLimit, asyncHandler(async (req, res) => {
  const project = await deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');
  checkProjectAccess(project, req);

  const { checks, notChecked } = buildLaunchChecks(project.analysis_data?.gaps);
  res.json({
    name: project.owner && project.repo ? `${project.owner}/${project.repo}` : project.repo || 'Your project',
    scannedAt: project.updated_at || project.created_at || null,
    checks,
    notChecked,
  });
}));

module.exports = router;
