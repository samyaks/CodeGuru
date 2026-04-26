const express = require('express');
const { deployments, buildEntries, commitReviews } = require('../lib/db');
const { createRateLimit } = require('../lib/rate-limit');
const railway = require('@codeguru/railway');
const github = require('../services/github');
const { connectWebhook, disconnectWebhook, getWebhookStatus } = require('../services/github-webhook-manager');
const { AppError } = require('../lib/app-error');
const { asyncHandler } = require('../lib/async-handler');
const { checkProjectAccess } = require('../lib/helpers');

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

  const projects = await deployments.findByUserId(req.user.id);
  res.json(projects.map(projectSummary));
}));

router.get('/:id', readLimit, asyncHandler(async (req, res) => {
  const project = await deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');

  checkProjectAccess(project, req);

  const entries = await buildEntries.findByProjectId(req.params.id);
  res.json({ ...project, entries });
}));

router.get('/:id/commits', readLimit, asyncHandler(async (req, res) => {
  const project = await deployments.findById(req.params.id);
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
  const project = await deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');

  checkProjectAccess(project, req);

  const detail = await github.fetchCommitDetail(project.owner, project.repo, req.params.sha);
  res.json(detail);
}));

router.get('/:id/commit-reviews', readLimit, asyncHandler(async (req, res) => {
  const project = await deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');

  checkProjectAccess(project, req);

  const rows = await commitReviews.listByProject(req.params.id, { limit: 80, offset: 0 });
  res.json(rows);
}));

router.get('/:id/commit-reviews/:sha', readLimit, asyncHandler(async (req, res) => {
  const project = await deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');

  checkProjectAccess(project, req);

  const row = await commitReviews.findByProjectAndSha(req.params.id, req.params.sha);
  if (!row) throw AppError.notFound('Commit review not found');
  res.json(row);
}));

router.post('/:id/commits/:sha/approve-context', writeLimit, asyncHandler(async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Login required', code: 'UNAUTHORIZED' });
  }

  const project = await deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');
  checkProjectAccess(project, req);

  const entry = await buildEntries.findPendingBySourceCommitSha(project.id, req.params.sha);
  if (!entry) throw AppError.notFound('No pending context draft for this commit');
  if (entry.user_id !== req.user.id) throw AppError.forbidden('Forbidden');

  await buildEntries.update(entry.id, {
    approval_status: 'approved',
    updated_at: new Date().toISOString(),
  });
  const updated = await buildEntries.findById(entry.id);
  res.json(updated);
}));

router.post('/:id/commits/:sha/dismiss-context', writeLimit, asyncHandler(async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Login required', code: 'UNAUTHORIZED' });
  }

  const project = await deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');
  checkProjectAccess(project, req);

  const entry = await buildEntries.findPendingBySourceCommitSha(project.id, req.params.sha);
  if (!entry) throw AppError.notFound('No pending context draft for this commit');
  if (entry.user_id !== req.user.id) throw AppError.forbidden('Forbidden');

  await buildEntries.update(entry.id, {
    approval_status: 'dismissed',
    updated_at: new Date().toISOString(),
  });
  const updated = await buildEntries.findById(entry.id);
  res.json(updated);
}));

router.patch('/:id/commits/:sha/context', writeLimit, asyncHandler(async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Login required', code: 'UNAUTHORIZED' });
  }

  const project = await deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');
  checkProjectAccess(project, req);

  const entry = await buildEntries.findPendingBySourceCommitSha(project.id, req.params.sha);
  if (!entry) throw AppError.notFound('No pending context draft for this commit');
  if (entry.user_id !== req.user.id) throw AppError.forbidden('Forbidden');

  const { title, content } = req.body || {};
  if (content !== undefined && (typeof content !== 'string' || content.trim().length === 0)) {
    throw AppError.badRequest('content must be a non-empty string');
  }

  const updates = {
    approval_status: 'approved',
    updated_at: new Date().toISOString(),
  };
  if (title !== undefined) updates.title = title;
  if (content !== undefined) updates.content = content;

  await buildEntries.update(entry.id, updates);
  const updated = await buildEntries.findById(entry.id);
  res.json(updated);
}));

router.get('/:id/webhook', readLimit, asyncHandler(async (req, res) => {
  const project = await deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');

  checkProjectAccess(project, req);

  const status = await getWebhookStatus(req.params.id);
  res.json(status);
}));

router.post('/:id/webhook/connect', writeLimit, asyncHandler(async (req, res) => {
  const project = await deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');

  checkProjectAccess(project, req);

  if (!project.owner || !project.repo || project.repo_url?.startsWith('local://')) {
    throw AppError.badRequest('Webhook connect is only available for GitHub-linked projects');
  }

  const userToken = req.cookies?.['gh-provider-token'] || null;
  const result = await connectWebhook({
    projectId: project.id,
    owner: project.owner,
    repo: project.repo,
    userToken,
  });

  const status = result.needsReauth ? 403 : result.ok ? 200 : 400;
  res.status(status).json(result);
}));

router.delete('/:id/webhook/connect', writeLimit, asyncHandler(async (req, res) => {
  const project = await deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');

  checkProjectAccess(project, req);

  const userToken = req.cookies?.['gh-provider-token'] || null;
  const result = await disconnectWebhook({
    projectId: project.id,
    owner: project.owner,
    repo: project.repo,
    userToken,
  });
  res.json(result);
}));

router.delete('/:id', writeLimit, asyncHandler(async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Login required to delete a project', code: 'UNAUTHORIZED' });
  }

  const project = await deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');

  checkProjectAccess(project, req);

  if (project.railway_project_id) {
    try {
      await railway.deleteProject(project.railway_project_id);
    } catch (railwayErr) {
      console.warn(`Failed to delete Railway project ${project.railway_project_id}:`, railwayErr.message);
    }
  }

  // Best-effort webhook cleanup
  if (project.owner && project.repo && !project.repo_url?.startsWith('local://')) {
    const userToken = req.cookies?.['gh-provider-token'] || null;
    disconnectWebhook({ projectId: project.id, owner: project.owner, repo: project.repo, userToken })
      .catch((err) => console.warn(`webhook cleanup on delete ${project.id}:`, err.message));
  }

  await deployments.delete(req.params.id);

  res.json({ deleted: true });
}));

module.exports = router;
