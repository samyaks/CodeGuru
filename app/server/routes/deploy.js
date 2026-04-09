const express = require('express');
const { deployments } = require('../lib/db');
const { addConnection, broadcast } = require('../lib/sse');
const { createRateLimit } = require('../lib/rate-limit');
const railway = require('@codeguru/railway');
const { AppError } = require('../lib/app-error');
const { asyncHandler } = require('../lib/async-handler');
const { logDeployEvent } = require('../lib/auto-entries');

const router = express.Router();

const deployRateLimit = createRateLimit({
  windowMs: 60000,
  max: 5,
  message: 'Too many deploy requests. Please try again in a minute.',
});

router.post('/:projectId', deployRateLimit, asyncHandler(async (req, res) => {
  if (!req.user) throw AppError.unauthorized('Login required to deploy');

  const project = deployments.findById(req.params.projectId);
  if (!project) throw AppError.notFound('Project not found');

  if (project.user_id && project.user_id !== req.user.id) {
    throw AppError.forbidden('You do not own this project');
  }

  if (!process.env.RAILWAY_API_TOKEN) {
    throw new AppError('Deploy service not configured. RAILWAY_API_TOKEN is required.', 503, 'SERVICE_UNAVAILABLE');
  }

  const updateFields = {
    status: 'deploying',
    updated_at: new Date().toISOString(),
  };
  if (!project.user_id) updateFields.user_id = req.user.id;
  deployments.update(req.params.projectId, updateFields);

  setImmediate(() => runDeploy(req.params.projectId, project, req.user.id));

  res.json({ status: 'deploying', projectId: req.params.projectId });
}));

async function runDeploy(projectId, project, userId) {
  const deployStreamId = `deploy-${projectId}`;

  try {
    broadcast(deployStreamId, { type: 'status', status: 'deploying', message: 'Starting deployment...' });
    logDeployEvent(projectId, userId, { status: 'deploying' });

    const projectName = `takeoff-${project.repo}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32);

    const result = await railway.deployFromRepo(`${project.owner}/${project.repo}`, {
      projectName,
      branch: project.branch || 'main',
      onProgress: (p) => {
        broadcast(deployStreamId, { type: 'progress', ...p });
      },
    });

    if (result.status === 'SUCCESS') {
      deployments.update(projectId, {
        status: 'live',
        live_url: result.url,
        railway_project_id: result.projectId,
        railway_service_id: result.serviceId,
        railway_environment_id: result.environmentId,
        railway_deployment_id: result.deploymentId,
        railway_domain: result.domain,
        deployed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      broadcast(deployStreamId, {
        type: 'deployed',
        url: result.url,
        domain: result.domain,
        status: 'live',
      });

      logDeployEvent(projectId, userId, { status: 'live', liveUrl: result.url });
    } else {
      let buildLogs = '';
      try {
        const logs = await railway.getBuildLogs(result.deploymentId);
        buildLogs = logs.map((l) => l.message).join('\n');
      } catch {}

      deployments.update(projectId, {
        status: 'failed',
        error: `Deploy finished with status: ${result.status}`,
        build_logs: buildLogs,
        railway_project_id: result.projectId,
        railway_service_id: result.serviceId,
        railway_deployment_id: result.deploymentId,
        updated_at: new Date().toISOString(),
      });

      broadcast(deployStreamId, {
        type: 'failed',
        error: `Deploy finished with status: ${result.status}`,
        buildLogs,
      });

      logDeployEvent(projectId, userId, { status: 'failed', error: `Deploy finished with status: ${result.status}` });
    }
  } catch (err) {
    console.error(`Deploy failed for ${projectId}:`, err);
    deployments.update(projectId, {
      status: 'failed',
      error: err.message,
      updated_at: new Date().toISOString(),
    });
    broadcast(deployStreamId, { type: 'failed', error: err.message });
    logDeployEvent(projectId, userId, { status: 'failed', error: err.message });
  }
}

router.get('/:projectId/stream', asyncHandler(async (req, res) => {
  const project = deployments.findById(req.params.projectId);
  if (!project) throw AppError.notFound('Project not found');

  const streamId = `deploy-${req.params.projectId}`;
  addConnection(streamId, res, { origin: req.headers.origin });

  if (project.status === 'live') {
    broadcast(streamId, {
      type: 'deployed',
      url: project.live_url,
      domain: project.railway_domain,
      status: 'live',
    });
  }
  if (project.status === 'failed') {
    broadcast(streamId, {
      type: 'failed',
      error: project.error,
      buildLogs: project.build_logs,
    });
  }
}));

router.post('/:projectId/redeploy', deployRateLimit, asyncHandler(async (req, res) => {
  if (!req.user) throw AppError.unauthorized('Login required to redeploy');

  const project = deployments.findById(req.params.projectId);
  if (!project) throw AppError.notFound('Project not found');

  if (project.user_id && project.user_id !== req.user.id) {
    throw AppError.forbidden('You do not own this project');
  }

  if (!project.railway_deployment_id) {
    throw AppError.badRequest('No previous deployment to redeploy. Deploy first.');
  }

  deployments.update(req.params.projectId, {
    status: 'building',
    updated_at: new Date().toISOString(),
  });

  const redeployResult = await railway.redeployDeployment(project.railway_deployment_id);

  deployments.update(req.params.projectId, {
    railway_deployment_id: redeployResult.id,
    updated_at: new Date().toISOString(),
  });

  res.json({ status: 'redeploying', deploymentId: redeployResult.id });
}));

module.exports = router;
