const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { deployments, suggestions } = require('../lib/db');
const { addConnection, broadcast, getRecentEvents } = require('../lib/sse');
const github = require('../services/github');
const { analyzeRepo } = require('../services/analyzer');
const { detectBuildPlan } = require('../services/build-detector');
const { scoreReadiness } = require('../services/readiness-scorer');
const { generatePlan } = require('../services/plan-generator');
const { describeFeatures } = require('../services/features-describer');
const { runStaticSuggestions } = require('../services/suggestion-rules');
const { createRateLimit } = require('../lib/rate-limit');
const { validateRepoUrl } = require('../lib/validate');
const { AppError } = require('../lib/app-error');
const { asyncHandler } = require('../lib/async-handler');
const { seedFromAnalysis } = require('../lib/auto-entries');
const { parseJsonFields, checkProjectAccess } = require('../lib/helpers');

const TAKEOFF_JSON_FIELDS = ['stack_info', 'build_plan', 'readiness_categories', 'plan_steps', 'analysis_data'];

const router = express.Router();

const takeoffRateLimit = createRateLimit({
  windowMs: 60000,
  max: 10,
  message: 'Too many requests. Please try again in a minute.',
});

router.post('/', takeoffRateLimit, asyncHandler(async (req, res) => {
  const { repoUrl } = req.body;
  if (!repoUrl) throw AppError.badRequest('repoUrl is required');

  const validation = validateRepoUrl(repoUrl);
  if (!validation.valid) throw AppError.badRequest(validation.error);
  const { owner, repo } = validation;

  const id = uuidv4();
  deployments.create({
    id,
    repo_url: repoUrl,
    owner,
    repo,
    status: 'pending',
    created_at: new Date().toISOString(),
    user_id: req.user?.id || null,
  });

  let slug = `${owner}-${repo}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  try {
    deployments.update(id, { slug });
  } catch (_) {
    slug = `${slug}-${crypto.randomBytes(2).toString('hex')}`;
    deployments.update(id, { slug });
  }

  setImmediate(() => runTakeoff(id, repoUrl));

  res.status(201).json({ projectId: id, slug, status: 'pending' });
}));

async function runTakeoff(id, repoUrl) {
  console.log(JSON.stringify({ event: 'takeoff_start', projectId: id, repoUrl, timestamp: new Date().toISOString() }));
  try {
    deployments.update(id, { status: 'analyzing', updated_at: new Date().toISOString() });
    broadcast(id, { type: 'status', status: 'analyzing' });

    // Stage 1: Full analysis
    const codebaseModel = await analyzeRepo(repoUrl, (progress) => {
      broadcast(id, { type: 'progress', ...progress });
    });

    deployments.update(id, {
      owner: codebaseModel.meta.owner,
      repo: codebaseModel.meta.repo,
      branch: codebaseModel.meta.defaultBranch,
      framework: codebaseModel.stack.framework,
      description: codebaseModel.meta.description || null,
      stack_info: codebaseModel.stack,
      analysis_data: {
        meta: {
          name: codebaseModel.meta.name,
          description: codebaseModel.meta.description,
          language: codebaseModel.meta.language,
          stars: codebaseModel.meta.stars,
          forks: codebaseModel.meta.forks,
        },
        structure: codebaseModel.structure,
        features: codebaseModel.features,
        gaps: codebaseModel.gaps,
        deployInfo: codebaseModel.deployInfo,
        existingContext: codebaseModel.existingContext,
        fileTree: codebaseModel.fileTree,
      },
    });

    // Stage 1b: Plain-English app summary (non-blocking — failure doesn't stop pipeline)
    let featuresSummary = null;
    try {
      featuresSummary = await describeFeatures(id, codebaseModel);
      deployments.update(id, { features_summary: featuresSummary });
    } catch (err) {
      console.error(`Features description for ${id} failed (non-fatal):`, err.message);
    }

    // Stage 2: Build plan + Readiness score
    broadcast(id, { type: 'progress', phase: 'scoring', message: 'Scoring production readiness...' });

    const buildPlan = detectBuildPlan({
      stack: codebaseModel.stack,
      fileTree: codebaseModel.fileTree,
      fileContents: codebaseModel.fileContents,
      deployInfo: codebaseModel.deployInfo,
    });

    const readiness = scoreReadiness({
      gaps: codebaseModel.gaps,
      stack: codebaseModel.stack,
      fileTree: codebaseModel.fileTree,
      features: codebaseModel.features,
      deployInfo: codebaseModel.deployInfo,
      buildPlan,
    });

    deployments.update(id, {
      status: 'scored',
      deploy_type: buildPlan.type,
      build_plan: buildPlan,
      readiness_score: readiness.score,
      readiness_categories: readiness.categories,
      recommendation: readiness.recommendation,
      updated_at: new Date().toISOString(),
    });

    broadcast(id, {
      type: 'scored',
      score: readiness.score,
      recommendation: readiness.recommendation,
      categories: readiness.categories,
      summary: readiness.summary,
      stack: codebaseModel.stack,
      buildPlan: {
        type: buildPlan.type,
        framework: buildPlan.framework,
        confidence: buildPlan.confidence,
      },
    });

    const userId = deployments.findById(id)?.user_id;
    seedFromAnalysis(id, userId, codebaseModel, readiness.score);

    // Stage 2b: Static suggestions (instant, no API call)
    let suggestionsCount = 0;
    try {
      const staticSuggestions = runStaticSuggestions({
        stack: codebaseModel.stack,
        gaps: codebaseModel.gaps,
        features: codebaseModel.features,
        structure: codebaseModel.structure,
        fileContents: codebaseModel.fileContents,
        fileTree: codebaseModel.fileTree,
        buildPlan,
      });

      suggestions.deleteByProjectId(id);
      if (staticSuggestions.length > 0) {
        suggestions.createBatch(staticSuggestions.map(s => ({ ...s, project_id: id })));
      }
      suggestionsCount = staticSuggestions.length;
      deployments.update(id, { suggestions_count: suggestionsCount });

      broadcast(id, {
        type: 'suggestions-static',
        count: suggestionsCount,
        suggestions: staticSuggestions.slice(0, 5),
      });
    } catch (err) {
      console.error(`Static suggestions for ${id} failed (non-fatal):`, err.message);
    }

    // Stage 3: Generate plan steps
    broadcast(id, { type: 'progress', phase: 'planning', message: 'Generating your plan...' });

    const planSteps = generatePlan({
      categories: readiness.categories,
      stack: codebaseModel.stack,
      gaps: codebaseModel.gaps,
    });

    deployments.update(id, {
      status: 'ready',
      plan_steps: planSteps,
      updated_at: new Date().toISOString(),
    });

    broadcast(id, {
      type: 'complete',
      score: readiness.score,
      recommendation: readiness.recommendation,
      categories: readiness.categories,
      summary: readiness.summary,
      planSteps: planSteps,
      stack: codebaseModel.stack,
      buildPlan: {
        type: buildPlan.type,
        framework: buildPlan.framework,
        confidence: buildPlan.confidence,
        reason: buildPlan.reason,
      },
      suggestionsCount,
    });

    console.log(JSON.stringify({ event: 'takeoff_complete', projectId: id, repoUrl, score: readiness.score, recommendation: readiness.recommendation, timestamp: new Date().toISOString() }));

  } catch (err) {
    console.error(`Takeoff failed for ${id}:`, err);
    deployments.update(id, {
      status: 'failed',
      error: err.message,
      updated_at: new Date().toISOString(),
    });
    broadcast(id, { type: 'error', error: err.message });
    console.log(JSON.stringify({ event: 'takeoff_failed', projectId: id, repoUrl, error: err.message, timestamp: new Date().toISOString() }));
  }
}

router.get('/:id', asyncHandler(async (req, res) => {
  const project = deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');

  checkProjectAccess(project, req);

  res.json(parseJsonFields(project, TAKEOFF_JSON_FIELDS));
}));

router.get('/:id/stream', asyncHandler(async (req, res) => {
  const project = deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');

  checkProjectAccess(project, req);

  addConnection(req.params.id, res, { origin: req.headers.origin });

  const buffered = getRecentEvents(req.params.id);
  for (const event of buffered) {
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { break; }
  }

  if (project.status === 'ready' || project.status === 'live') {
    const parsed = parseJsonFields(project, TAKEOFF_JSON_FIELDS);
    broadcast(req.params.id, {
      type: 'complete',
      score: parsed.readiness_score,
      recommendation: parsed.recommendation,
      categories: parsed.readiness_categories,
      planSteps: parsed.plan_steps,
      stack: parsed.stack_info,
      buildPlan: parsed.build_plan,
    });
  }

  if (project.status === 'failed') {
    broadcast(req.params.id, { type: 'error', error: project.error });
  }
}));

router.get('/:id/env-vars', asyncHandler(async (req, res) => {
  if (!req.user) throw AppError.unauthorized('Login required');

  const project = deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');

  checkProjectAccess(project, req);

  let vars = {};
  try { vars = JSON.parse(project.env_vars || '{}'); } catch {}
  res.json({ vars });
}));

router.post('/:id/env-vars', asyncHandler(async (req, res) => {
  if (!req.user) throw AppError.unauthorized('Login required');

  const project = deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');

  checkProjectAccess(project, req);

  const { vars } = req.body;
  if (!vars || typeof vars !== 'object') throw AppError.badRequest('vars must be an object');

  deployments.update(req.params.id, {
    env_vars: JSON.stringify(vars),
    updated_at: new Date().toISOString(),
  });

  res.json({ ok: true });
}));

router.patch('/:id/plan/:stepId', asyncHandler(async (req, res) => {
  const project = deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');

  checkProjectAccess(project, req);

  let steps = project.plan_steps;
  if (typeof steps === 'string') {
    try { steps = JSON.parse(steps); } catch { throw AppError.internal('Invalid plan data'); }
  }
  if (!Array.isArray(steps)) throw AppError.badRequest('No plan found');

  const step = steps.find((s) => s.id === req.params.stepId);
  if (!step) throw AppError.notFound('Step not found');

  const { status } = req.body;
  if (!['todo', 'done'].includes(status)) {
    throw AppError.badRequest('Status must be "todo" or "done"');
  }

  step.status = status;
  deployments.update(req.params.id, {
    plan_steps: steps,
    updated_at: new Date().toISOString(),
  });

  res.json({ step });
}));

// ── Suggestions ──

router.get('/:id/suggestions', asyncHandler(async (req, res) => {
  const project = deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');
  checkProjectAccess(project, req);

  const items = suggestions.findByProjectId(req.params.id);
  const summary = suggestions.summary(req.params.id);

  res.json({ suggestions: items, summary });
}));

router.patch('/:id/suggestions/:suggestionId', asyncHandler(async (req, res) => {
  const project = deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');
  checkProjectAccess(project, req);

  const { status } = req.body;
  if (!['open', 'dismissed', 'done'].includes(status)) {
    throw AppError.badRequest('Status must be "open", "dismissed", or "done"');
  }

  suggestions.updateStatus(req.params.suggestionId, req.params.id, status);

  const counts = suggestions.countByProjectId(req.params.id);
  deployments.update(req.params.id, { suggestions_count: counts.total || 0 });

  res.json({ ok: true, status });
}));

router.post('/:id/suggestions/refresh', asyncHandler(async (req, res) => {
  const project = deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');
  checkProjectAccess(project, req);

  suggestions.deleteByProjectId(req.params.id);
  deployments.update(req.params.id, { suggestions_count: 0 });

  res.json({ ok: true, message: 'Suggestions cleared. Re-analyze to generate new suggestions.' });
}));

module.exports = router;
