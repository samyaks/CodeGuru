const express = require('express');
const { deployments, buildEntries } = require('../lib/db');
const { createRateLimit } = require('../lib/rate-limit');
const railway = require('@codeguru/railway');
const github = require('../services/github');
const { AppError } = require('../lib/app-error');
const { asyncHandler } = require('../lib/async-handler');
const { parseJsonFields, checkProjectAccess } = require('../lib/helpers');

const PROJECT_JSON_FIELDS = ['stack_info', 'build_plan', 'readiness_categories', 'plan_steps', 'analysis_data'];

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
  const parsed = projects.map((p) => projectSummary(parseJsonFields(p, PROJECT_JSON_FIELDS)));
  res.json(parsed);
}));

router.get('/:id', readLimit, asyncHandler(async (req, res) => {
  const project = deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');

  checkProjectAccess(project, req);

  const parsed = parseJsonFields(project, PROJECT_JSON_FIELDS);
  const entries = buildEntries.findByProjectId(req.params.id);
  parsed.entries = entries;

  res.json(parsed);
}));

router.get('/:id/commits', readLimit, asyncHandler(async (req, res) => {
  const project = deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');

  checkProjectAccess(project, req);

  if (!project.owner || !project.repo) {
    return res.json({ commits: [], reason: 'no_repo' });
  }

  try {
    const commits = await github.fetchCommits(project.owner, project.repo, {
      branch: project.branch || 'main',
      perPage: 50,
    });
    res.json({ commits, owner: project.owner, repo: project.repo });
  } catch (err) {
    console.warn(`Commit fetch failed for ${project.owner}/${project.repo}:`, err.message);
    res.json({ commits: [], reason: 'fetch_failed', error: err.message });
  }
}));

router.get('/:id/commits/:sha', readLimit, asyncHandler(async (req, res) => {
  const project = deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');

  checkProjectAccess(project, req);

  const detail = await github.fetchCommitDetail(project.owner, project.repo, req.params.sha);
  res.json(detail);
}));

router.delete('/:id', writeLimit, asyncHandler(async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Login required to delete a project', code: 'UNAUTHORIZED' });
  }

  const project = deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');

  checkProjectAccess(project, req);

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
