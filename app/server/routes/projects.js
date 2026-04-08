const express = require('express');
const { deployments, buildEntries } = require('../lib/db');
const { createRateLimit } = require('../lib/rate-limit');
const railway = require('@codeguru/railway');
const { AppError } = require('../lib/app-error');
const { asyncHandler } = require('../lib/async-handler');

const JSON_FIELDS = ['stack_info', 'build_plan', 'readiness_categories', 'plan_steps'];

function parseJsonFields(project) {
  const parsed = { ...project };
  for (const field of JSON_FIELDS) {
    if (parsed[field] && typeof parsed[field] === 'string') {
      try { parsed[field] = JSON.parse(parsed[field]); } catch {}
    }
  }
  return parsed;
}

function checkProjectAccess(project, req) {
  if (!project.user_id) return null;
  if (!req.user) return 403;
  if (project.user_id !== req.user.id) return 403;
  return null;
}

const SUMMARY_FIELDS = [
  'id', 'repo_url', 'owner', 'repo', 'status', 'readiness_score',
  'recommendation', 'framework', 'live_url', 'deployed_at', 'created_at', 'updated_at',
];

function projectSummary(project) {
  const out = {};
  for (const key of SUMMARY_FIELDS) {
    if (project[key] !== undefined) out[key] = project[key];
  }
  return out;
}

const router = express.Router();

const readLimit = createRateLimit({
  windowMs: 60000,
  max: 30,
  message: 'Too many requests. Please try again in a minute.',
});

const writeLimit = createRateLimit({
  windowMs: 60000,
  max: 10,
  message: 'Too many write requests. Please try again in a minute.',
});

router.get('/', readLimit, asyncHandler(async (req, res) => {
  if (!req.user) {
    return res.json([]);
  }

  const projects = deployments.findByUserId(req.user.id);
  const parsed = projects.map((p) => projectSummary(parseJsonFields(p)));
  res.json(parsed);
}));

router.get('/:id', readLimit, asyncHandler(async (req, res) => {
  const project = deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');

  const denied = checkProjectAccess(project, req);
  if (denied) throw AppError.forbidden('Forbidden');

  const parsed = parseJsonFields(project);
  const entries = buildEntries.findByProjectId(req.params.id);
  parsed.entries = entries;

  res.json(parsed);
}));

router.delete('/:id', writeLimit, asyncHandler(async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Login required to delete a project', code: 'UNAUTHORIZED' });
  }

  const project = deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');

  const denied = checkProjectAccess(project, req);
  if (denied) throw AppError.forbidden('Forbidden');

  if (project.railway_project_id) {
    try {
      await railway.deleteProject(project.railway_project_id);
    } catch (railwayErr) {
      console.warn(`Failed to delete Railway project ${project.railway_project_id}:`, railwayErr.message);
    }
  }

  deployments.delete(req.params.id);

  res.json({ deleted: true });
}));

module.exports = router;
