const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { deployments, suggestions, analyses } = require('../lib/db');
const { addConnection, broadcast, getRecentEvents } = require('../lib/sse');
const github = require('../services/github');
const multer = require('multer');
const { analyzeRepo, analyzeFromFiles, shouldSkipFile } = require('../services/analyzer');
const { detectBuildPlan } = require('../services/build-detector');
const { scoreReadiness } = require('../services/readiness-scorer');
const { generatePlan } = require('../services/plan-generator');
const { describeFeatures } = require('../services/features-describer');
const { runStaticSuggestions, runGapSuggestions, STATIC_RULE_GAP_KEYS } = require('../services/suggestion-rules');
const { runAISuggestions } = require('../services/suggestion-ai');
const { connectWebhook } = require('../services/github-webhook-manager');
const productMapSvc = require('../services/product-map');
const { createRateLimit } = require('../lib/rate-limit');
const { validateRepoUrl } = require('../lib/validate');
const { AppError } = require('../lib/app-error');
const { asyncHandler } = require('../lib/async-handler');
const { seedFromAnalysis } = require('../lib/auto-entries');
const { checkProjectAccess } = require('../lib/helpers');

const router = express.Router();

const MAX_UPLOAD_FILES = 300;
const MAX_FILE_SIZE = 2 * 1024 * 1024;
const MAX_TOTAL_SIZE = 50 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_UPLOAD_FILES },
});

function sanitizePath(filePath) {
  return filePath
    .split('/')
    .filter(seg => seg && seg !== '.' && seg !== '..')
    .join('/');
}

const takeoffRateLimit = createRateLimit({
  windowMs: 60000,
  max: 10,
  message: 'Too many requests. Please try again in a minute.',
});

router.post('/upload', takeoffRateLimit, upload.array('files', MAX_UPLOAD_FILES), asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    throw AppError.badRequest('No files uploaded');
  }

  const totalSize = req.files.reduce((sum, f) => sum + f.size, 0);
  if (totalSize > MAX_TOTAL_SIZE) {
    throw AppError.badRequest(`Total upload size exceeds ${MAX_TOTAL_SIZE / 1024 / 1024}MB limit`);
  }

  const projectName = req.body.projectName || 'Uploaded Project';
  const userId = req.user?.id || null;

  const id = uuidv4();
  let slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) + '-' + id.slice(0, 6);

  await deployments.create({
    id,
    repo_url: `local://${projectName}`,
    owner: 'local',
    repo: projectName,
    status: 'pending',
    created_at: new Date().toISOString(),
    user_id: userId,
  });

  try {
    await deployments.update(id, { slug });
  } catch (err) {
    if (err && err.code !== '23505') throw err;
    slug = `${slug}-${crypto.randomBytes(2).toString('hex')}`;
    await deployments.update(id, { slug });
  }

  // Sanitize paths and pre-filter binary files before UTF-8 conversion
  const fileEntries = req.files
    .map(f => ({ ...f, safePath: sanitizePath(f.originalname) }))
    .filter(f => f.safePath && !shouldSkipFile(f.safePath))
    .map(f => ({
      path: f.safePath,
      content: f.buffer.toString('utf-8'),
    }));

  setImmediate(() => {
    runUploadAnalysis(id, fileEntries, projectName, userId).catch((err) => {
      console.error(`runUploadAnalysis ${id} unhandled:`, err);
    });
  });

  res.status(201).json({ projectId: id, slug, status: 'pending' });
}));

router.post('/', takeoffRateLimit, asyncHandler(async (req, res) => {
  const { repoUrl } = req.body;
  if (!repoUrl) throw AppError.badRequest('repoUrl is required');

  const validation = validateRepoUrl(repoUrl);
  if (!validation.valid) throw AppError.badRequest(validation.error);
  const { owner, repo } = validation;

  const id = uuidv4();
  await deployments.create({
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
    await deployments.update(id, { slug });
  } catch (err) {
    if (err && err.code !== '23505') throw err;
    slug = `${slug}-${crypto.randomBytes(2).toString('hex')}`;
    await deployments.update(id, { slug });
  }

  setImmediate(() => {
    runTakeoff(id, repoUrl).catch((err) => {
      console.error(`runTakeoff ${id} unhandled:`, err);
    });
  });

  // Auto-connect webhook for GitHub-linked projects when the user has a GH token
  const ghToken = req.cookies?.['gh-provider-token'] || null;
  if (ghToken) {
    setImmediate(() => {
      connectWebhook({ projectId: id, owner, repo, userToken: ghToken })
        .then((result) => {
          if (!result.ok) {
            console.log(JSON.stringify({ event: 'webhook_auto_connect_skipped', projectId: id, reason: result.error }));
          }
        })
        .catch((err) => console.warn(`webhook auto-connect ${id}:`, err.message));
    });
  }

  res.status(201).json({ projectId: id, slug, status: 'pending' });
}));

async function runTakeoff(id, repoUrl) {
  const label = repoUrl;
  console.log(JSON.stringify({ event: 'takeoff_start', projectId: id, repoUrl, timestamp: new Date().toISOString() }));
  try {
    // Ensure a parent `analyses` row exists so the data-capture FKs resolve.
    // Takeoff reuses the deployments.id for the analyses.id; the capture
    // tables (analysis_files, analysis_file_chunks, analysis_llm_calls,
    // analysis_events) all FK to analyses(id) ON DELETE CASCADE.
    try {
      if (!(await analyses.findById(id))) {
        const deployment = await deployments.findById(id);
        await analyses.create({
          id,
          repo_url: repoUrl,
          owner: deployment?.owner || 'unknown',
          repo: deployment?.repo || 'unknown',
          status: 'analyzing',
          created_at: new Date().toISOString(),
          user_id: deployment?.user_id || null,
        });
      }
    } catch (err) {
      console.warn(`analyses.create for takeoff ${id} failed (non-fatal):`, err.message);
    }

    await deployments.update(id, { status: 'analyzing', updated_at: new Date().toISOString() });
    broadcast(id, { type: 'status', status: 'analyzing' });

    const codebaseModel = await analyzeRepo(repoUrl, (progress) => {
      broadcast(id, { type: 'progress', ...progress });
    }, id);

    const currentDeployment = await deployments.findById(id);
    const userId = currentDeployment?.user_id;
    await runPipeline(id, codebaseModel, userId, label);

    try {
      await analyses.update(id, { status: 'completed', completed_at: new Date().toISOString() });
    } catch (err) {
      console.warn(`analyses.update completed for takeoff ${id} failed (non-fatal):`, err.message);
    }
  } catch (err) {
    console.error(`Takeoff failed for ${id}:`, err);
    try {
      await deployments.update(id, { status: 'failed', error: err.message, updated_at: new Date().toISOString() });
    } catch (updateErr) {
      console.error(`Failed to mark deployment ${id} as failed:`, updateErr.message);
    }
    broadcast(id, { type: 'error', error: err.message });
    console.log(JSON.stringify({ event: 'takeoff_failed', projectId: id, repoUrl, error: err.message, timestamp: new Date().toISOString() }));
  }
}

async function runUploadAnalysis(id, fileEntries, projectName, userId) {
  const label = projectName;
  console.log(JSON.stringify({ event: 'upload_analysis_start', projectId: id, projectName, timestamp: new Date().toISOString() }));
  try {
    // Ensure a parent `analyses` row exists so data-capture FKs resolve for
    // the upload flow too. Uses the same id that Takeoff already threads
    // through analyzeFromFiles and the capture tables.
    try {
      if (!(await analyses.findById(id))) {
        await analyses.create({
          id,
          repo_url: `local://${projectName}`,
          owner: 'local',
          repo: projectName,
          status: 'analyzing',
          created_at: new Date().toISOString(),
          user_id: userId || null,
        });
      }
    } catch (err) {
      console.warn(`analyses.create for upload ${id} failed (non-fatal):`, err.message);
    }

    await deployments.update(id, { status: 'analyzing', updated_at: new Date().toISOString() });
    broadcast(id, { type: 'status', status: 'analyzing' });

    const codebaseModel = await analyzeFromFiles(fileEntries, projectName, (progress) => {
      broadcast(id, { type: 'progress', ...progress });
    }, id);

    await runPipeline(id, codebaseModel, userId, label);

    try {
      await analyses.update(id, { status: 'completed', completed_at: new Date().toISOString() });
    } catch (err) {
      console.warn(`analyses.update completed for upload ${id} failed (non-fatal):`, err.message);
    }
  } catch (err) {
    console.error(`Upload analysis failed for ${id}:`, err);
    try {
      await deployments.update(id, { status: 'failed', error: err.message, updated_at: new Date().toISOString() });
    } catch (updateErr) {
      console.error(`Failed to mark deployment ${id} as failed:`, updateErr.message);
    }
    broadcast(id, { type: 'error', error: err.message });
    console.log(JSON.stringify({ event: 'upload_analysis_failed', projectId: id, projectName, error: err.message, timestamp: new Date().toISOString() }));
  }
}

async function runPipeline(id, codebaseModel, userId, label) {
  // Stage 1: Persist analysis data
  await deployments.update(id, {
    owner: codebaseModel.meta.owner,
    repo: codebaseModel.meta.repo,
    branch: codebaseModel.meta.defaultBranch || null,
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

  // Stage 1b: Plain-English app summary (non-blocking)
  let featuresSummary = null;
  try {
    featuresSummary = await describeFeatures(id, codebaseModel);
    await deployments.update(id, { features_summary: featuresSummary });
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

  await deployments.update(id, {
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

  await seedFromAnalysis(id, userId, codebaseModel, readiness.score);

  // Stage 2b: Static + Gap suggestions
  let allStaticSuggestions = [];
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

    await suggestions.deleteByProjectId(id);
    if (staticSuggestions.length > 0) {
      await suggestions.createBatch(staticSuggestions.map(s => ({ ...s, project_id: id })));
    }
    allStaticSuggestions = [...staticSuggestions];

    const gapKeysFromStaticRules = new Set(Object.values(STATIC_RULE_GAP_KEYS));
    const coveredGapKeys = new Set();
    for (const s of staticSuggestions) {
      if (gapKeysFromStaticRules.has(s.category)) coveredGapKeys.add(s.category);
    }
    try {
      const gapSuggestions = runGapSuggestions({
        gaps: codebaseModel.gaps,
        readinessCategories: readiness.categories,
        coveredGapKeys,
      });
      if (gapSuggestions.length > 0) {
        await suggestions.createBatch(gapSuggestions.map(s => ({ ...s, project_id: id })));
        allStaticSuggestions.push(...gapSuggestions);
      }
    } catch (err) {
      console.warn(`Gap suggestions for ${id} failed (non-fatal):`, err.message);
    }

    const suggestionsCount = allStaticSuggestions.length;
    await deployments.update(id, { suggestions_count: suggestionsCount });

    broadcast(id, {
      type: 'suggestions-static',
      count: suggestionsCount,
      suggestions: allStaticSuggestions.slice(0, 5),
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

  await deployments.update(id, {
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
    suggestionsCount: allStaticSuggestions.length,
  });

  console.log(JSON.stringify({ event: 'pipeline_complete', projectId: id, label, score: readiness.score, recommendation: readiness.recommendation, timestamp: new Date().toISOString() }));

  // Stage 3b: Product-map auto-extraction (async, non-blocking).
  // The v1 onboarding wizard was removed in the v2 migration, so without
  // this hook the v2 Map tab stays empty forever. We use featuresSummary
  // (or the GitHub repo description) as the seed for Claude's
  // persona/jobs extraction.
  setImmediate(() => {
    autoCreateProductMap(id, codebaseModel, featuresSummary).catch((err) => {
      console.error(`[takeoff] auto product-map for ${id} failed (non-fatal):`, err.message);
    });
  });

  // Stage 4: AI suggestions (async, non-blocking — pipeline is already 'ready')
  try {
    const aiSuggestions = await runAISuggestions({
      projectId: id,
      stack: codebaseModel.stack,
      gaps: codebaseModel.gaps,
      features: codebaseModel.features,
      fileContents: codebaseModel.fileContents,
      fileTree: codebaseModel.fileTree,
      staticSuggestions: allStaticSuggestions,
      featuresSummary,
    });

    if (aiSuggestions.length > 0) {
      await suggestions.createBatch(aiSuggestions.map(s => ({ ...s, project_id: id })));
      const counts = await suggestions.countByProjectId(id);
      await deployments.update(id, { suggestions_count: counts.total || 0 });
    }
  } catch (err) {
    console.error(`AI suggestions for ${id} failed (non-fatal):`, err.message);
  }
}

// Build a product-map (personas + jobs + entity graph) for a freshly-analyzed
// project. Skips silently when:
//   - a map already exists (idempotent),
//   - we don't have a strong description signal (would produce garbage personas),
//   - Claude or the persistence layer fails (logged as non-fatal).
async function autoCreateProductMap(projectId, codebaseModel, featuresSummary) {
  // Don't overwrite an existing map.
  try {
    const existing = await productMapSvc.getMapByProject(projectId);
    if (existing && existing.map) {
      console.log(`[takeoff] product-map already exists for ${projectId}, skipping auto-extract`);
      return;
    }
  } catch (err) {
    console.warn(`[takeoff] product-map existence check failed for ${projectId}: ${err.message}`);
  }

  const description = (featuresSummary && String(featuresSummary).trim())
    || (codebaseModel?.meta?.description && String(codebaseModel.meta.description).trim())
    || null;

  if (!description) {
    console.log(`[takeoff] no description available for ${projectId}; skipping auto product-map`);
    return;
  }

  console.log(`[takeoff] auto-creating product-map for ${projectId} (description ${description.length} chars)`);
  const result = await productMapSvc.createProductMap(projectId, null, description);
  console.log(`[takeoff] auto product-map created for ${projectId}: ${result.personas.length} personas, ${result.jobs.length} jobs`);
}

router.get('/:id', asyncHandler(async (req, res) => {
  const project = await deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');

  checkProjectAccess(project, req);

  res.json(project);
}));

router.get('/:id/stream', asyncHandler(async (req, res) => {
  const project = await deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');

  checkProjectAccess(project, req);

  addConnection(req.params.id, res, { origin: req.headers.origin });

  const buffered = getRecentEvents(req.params.id);
  for (const event of buffered) {
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { break; }
  }

  if (project.status === 'ready' || project.status === 'live') {
    broadcast(req.params.id, {
      type: 'complete',
      score: project.readiness_score,
      recommendation: project.recommendation,
      categories: project.readiness_categories,
      planSteps: project.plan_steps,
      stack: project.stack_info,
      buildPlan: project.build_plan,
    });
  }

  if (project.status === 'failed') {
    broadcast(req.params.id, { type: 'error', error: project.error });
  }
}));

router.get('/:id/env-vars', asyncHandler(async (req, res) => {
  if (!req.user) throw AppError.unauthorized('Login required');

  const project = await deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');

  checkProjectAccess(project, req);

  const vars = project.env_vars && typeof project.env_vars === 'object' ? project.env_vars : {};
  res.json({ vars });
}));

router.post('/:id/env-vars', asyncHandler(async (req, res) => {
  if (!req.user) throw AppError.unauthorized('Login required');

  const project = await deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');

  checkProjectAccess(project, req);

  const { vars } = req.body;
  if (!vars || typeof vars !== 'object') throw AppError.badRequest('vars must be an object');

  await deployments.update(req.params.id, {
    env_vars: vars,
    updated_at: new Date().toISOString(),
  });

  res.json({ ok: true });
}));

router.patch('/:id/plan/:stepId', asyncHandler(async (req, res) => {
  const project = await deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');

  checkProjectAccess(project, req);

  const steps = project.plan_steps;
  if (!Array.isArray(steps)) throw AppError.badRequest('No plan found');

  const step = steps.find((s) => s.id === req.params.stepId);
  if (!step) throw AppError.notFound('Step not found');

  const { status } = req.body;
  if (!['todo', 'done'].includes(status)) {
    throw AppError.badRequest('Status must be "todo" or "done"');
  }

  step.status = status;
  await deployments.update(req.params.id, {
    plan_steps: steps,
    updated_at: new Date().toISOString(),
  });

  res.json({ step });
}));

// ── Suggestions ──

router.get('/:id/suggestions', asyncHandler(async (req, res) => {
  const project = await deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');
  checkProjectAccess(project, req);

  const items = await suggestions.findByProjectId(req.params.id);
  const summary = await suggestions.summary(req.params.id);

  res.json({ suggestions: items, summary });
}));

router.patch('/:id/suggestions/:suggestionId', asyncHandler(async (req, res) => {
  const project = await deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');
  checkProjectAccess(project, req);

  const { status } = req.body;
  if (!['open', 'dismissed', 'done'].includes(status)) {
    throw AppError.badRequest('Status must be "open", "dismissed", or "done"');
  }

  await suggestions.updateStatus(req.params.suggestionId, req.params.id, status);

  const counts = await suggestions.countByProjectId(req.params.id);
  await deployments.update(req.params.id, { suggestions_count: counts.total || 0 });

  res.json({ ok: true, status });
}));

router.post('/:id/suggestions/refresh', asyncHandler(async (req, res) => {
  const project = await deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');
  checkProjectAccess(project, req);

  await suggestions.deleteByProjectId(req.params.id);
  await deployments.update(req.params.id, { suggestions_count: 0 });

  res.json({ ok: true, message: 'Suggestions cleared. Re-analyze to generate new suggestions.' });
}));

module.exports = router;
