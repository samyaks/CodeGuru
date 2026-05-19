const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { deployments, suggestions, analyses, shippedItems } = require('../lib/db');
const { addConnection, broadcast, getRecentEvents, clearEventBuffer } = require('../lib/sse');
const github = require('../services/github');
const multer = require('multer');
const { analyzeRepo, analyzeFromFiles, shouldSkipFile } = require('../services/analyzer');
const { detectBuildPlan } = require('../services/build-detector');
const { scoreReadiness } = require('../services/readiness-scorer');
const { generatePlan } = require('../services/plan-generator');
const { describeFeatures } = require('../services/features-describer');
const { generateContextFiles } = require('../services/context-generator');
const { runStaticSuggestions, runGapSuggestions, STATIC_RULE_GAP_KEYS } = require('../services/suggestion-rules');
const { runAISuggestions } = require('../services/suggestion-ai');
const { runSecurityDetectors, listDetectorNames } = require('../services/security');
const { applySecurityFindings } = require('../services/security/persist');
const { computeSecurityScore } = require('../services/security/score');
const { connectWebhook } = require('../services/github-webhook-manager');
const productMapSvc = require('../services/product-map');
const { linkGapsToJobs } = require('../services/v2/gap-job-linker');
const { createRateLimit } = require('../lib/rate-limit');
const { validateRepoUrl } = require('../lib/validate');
const { AppError } = require('../lib/app-error');
const { asyncHandler } = require('../lib/async-handler');
const { seedFromAnalysis } = require('../lib/auto-entries');
const { checkProjectAccess } = require('../lib/helpers');
const { startTimer } = require('../lib/timing');

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

// In-process guard against overlapping runs for the same project id.
// Two concurrent re-analyses would race on `suggestions.deleteByProjectId`
// + interleaved inserts and produce undefined triage state. The DB
// `status='analyzing'` check covers the cross-process / restart case;
// this Set covers the (much more likely) same-process double-click.
// Lock is acquired in the reanalyze endpoint and released by the
// `setImmediate(runTakeoff)` wrapper's finally block.
const inFlightAnalyses = new Set();

// Tighter limit specifically for reanalyze. The flow re-runs LLM calls
// and re-hits GitHub, so a user mashing the button is expensive in a
// way the normal takeoff rate limit (which protects new-project
// creation) doesn't bound enough.
const reanalyzeRateLimit = createRateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  message: 'Too many re-analyses. Please wait a few minutes between runs.',
});

const REANALYZABLE_STATUSES = new Set(['ready', 'live', 'scored', 'failed']);

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

  inFlightAnalyses.add(id);
  setImmediate(() => {
    runTakeoff(id, repoUrl)
      .catch((err) => {
        console.error(`runTakeoff ${id} unhandled:`, err);
      })
      .finally(() => {
        inFlightAnalyses.delete(id);
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
  const tTotal = startTimer('takeoff_total', id);
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

    const tAnalyze = startTimer('analyze_repo', id);
    const codebaseModel = await analyzeRepo(repoUrl, (progress) => {
      broadcast(id, { type: 'progress', ...progress });
    }, id);
    tAnalyze.end({
      files: Array.isArray(codebaseModel?.fileTree?.files) ? codebaseModel.fileTree.files.length : null,
      readBytes: codebaseModel?.meta?.ingestedBytes ?? null,
    });

    const currentDeployment = await deployments.findById(id);
    const userId = currentDeployment?.user_id;
    await runPipeline(id, codebaseModel, userId, label);

    try {
      await analyses.update(id, { status: 'completed', completed_at: new Date().toISOString() });
    } catch (err) {
      console.warn(`analyses.update completed for takeoff ${id} failed (non-fatal):`, err.message);
    }
    tTotal.end({ ok: true });
  } catch (err) {
    console.error(`Takeoff failed for ${id}:`, err);
    try {
      await deployments.update(id, { status: 'failed', error: err.message, updated_at: new Date().toISOString() });
    } catch (updateErr) {
      console.error(`Failed to mark deployment ${id} as failed:`, updateErr.message);
    }
    broadcast(id, { type: 'error', error: err.message });
    console.log(JSON.stringify({ event: 'takeoff_failed', projectId: id, repoUrl, error: err.message, timestamp: new Date().toISOString() }));
    tTotal.end({ ok: false, error: err.message });
  }
}

async function runUploadAnalysis(id, fileEntries, projectName, userId) {
  const label = projectName;
  const tTotal = startTimer('upload_analysis_total', id);
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

    const tAnalyze = startTimer('analyze_from_files', id);
    const codebaseModel = await analyzeFromFiles(fileEntries, projectName, (progress) => {
      broadcast(id, { type: 'progress', ...progress });
    }, id);
    tAnalyze.end({
      files: Array.isArray(codebaseModel?.fileTree?.files) ? codebaseModel.fileTree.files.length : null,
    });

    await runPipeline(id, codebaseModel, userId, label);

    try {
      await analyses.update(id, { status: 'completed', completed_at: new Date().toISOString() });
    } catch (err) {
      console.warn(`analyses.update completed for upload ${id} failed (non-fatal):`, err.message);
    }
    tTotal.end({ ok: true });
  } catch (err) {
    console.error(`Upload analysis failed for ${id}:`, err);
    try {
      await deployments.update(id, { status: 'failed', error: err.message, updated_at: new Date().toISOString() });
    } catch (updateErr) {
      console.error(`Failed to mark deployment ${id} as failed:`, updateErr.message);
    }
    broadcast(id, { type: 'error', error: err.message });
    console.log(JSON.stringify({ event: 'upload_analysis_failed', projectId: id, projectName, error: err.message, timestamp: new Date().toISOString() }));
    tTotal.end({ ok: false, error: err.message });
  }
}

async function runPipeline(id, codebaseModel, userId, label) {
  const tPipeline = startTimer('pipeline_total', id);

  // ── Triage preservation for re-analyses ──────────────────────
  //
  // Stage 2b does `suggestions.deleteByProjectId(id)` and Stage 4b
  // re-inserts security findings via the persist layer. Without this
  // snapshot, every re-analyze would wipe v2_status (accepted /
  // in_progress / shipped / rejected), reject reasons, refined
  // prompts, and job links — and would orphan every shipped_items
  // row's gap_id via ON DELETE SET NULL.
  //
  // Restoration is keyed by suggestion id, which is content-stable
  // across runs for all three sources (static rules, AI, security
  // findings keyed by fingerprint). Snapshot rows whose underlying
  // signal disappeared from the new analysis are silently dropped.
  //
  // First-run projects have empty snapshots, so this is essentially
  // free; the cost only shows up when there's real triage to save.
  const tSnap = startTimer('pipeline_snapshot_triage', id);
  let triageSnapshot = [];
  let shippedLinkSnapshot = [];
  try {
    [triageSnapshot, shippedLinkSnapshot] = await Promise.all([
      suggestions.snapshotV2Triage(id),
      shippedItems.snapshotGapLinks(id),
    ]);
    tSnap.end({
      triage: triageSnapshot.length,
      shippedLinks: shippedLinkSnapshot.length,
    });
  } catch (err) {
    // Snapshot failure is non-fatal: we'd rather lose triage on this
    // re-analyze than abort the whole pipeline. Logged so we can
    // catch a regression in the snapshot query.
    console.warn(`[pipeline] triage snapshot for ${id} failed (continuing without preservation):`, err.message);
    triageSnapshot = [];
    shippedLinkSnapshot = [];
    tSnap.end({ ok: false, error: err.message });
  }

  // Stage 1: Persist analysis data
  const tStage1 = startTimer('stage1_persist_analysis', id);
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
  tStage1.end();

  // Stage 1b: Plain-English app summary (non-blocking)
  const tStage1b = startTimer('stage1b_describe_features', id);
  let featuresSummary = null;
  try {
    featuresSummary = await describeFeatures(id, codebaseModel);
    await deployments.update(id, { features_summary: featuresSummary });
    tStage1b.end({ ok: true, hasSummary: !!featuresSummary });
  } catch (err) {
    console.error(`Features description for ${id} failed (non-fatal):`, err.message);
    tStage1b.end({ ok: false, error: err.message });
  }

  // Stage 2: Build plan + Readiness score
  const tStage2 = startTimer('stage2_score_readiness', id);
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
  tStage2.end({ readinessScore: readiness.score });

  // Stage 2b: Static + Gap suggestions
  const tStage2b = startTimer('stage2b_static_suggestions', id);
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
    tStage2b.end({ ok: true, count: suggestionsCount });
  } catch (err) {
    console.error(`Static suggestions for ${id} failed (non-fatal):`, err.message);
    tStage2b.end({ ok: false, error: err.message });
  }

  // Stage 3: Generate plan steps
  const tStage3 = startTimer('stage3_generate_plan', id);
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
  tStage3.end({ steps: Array.isArray(planSteps) ? planSteps.length : null });

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
  //
  // `autoCreateProductMap` broadcasts its own ready/skipped/failed SSE
  // event so AnalysisProgress can hold the user on the loading screen
  // until personas exist instead of dumping them on an empty Map tab.
  // The outer .catch here is for the rare unhandled error path; it
  // still broadcasts `product-map-failed` so the frontend's wait
  // unblocks instead of relying solely on the 60s timeout fallback.
  setImmediate(() => {
    autoCreateProductMap(id, codebaseModel, featuresSummary).catch((err) => {
      console.error(`[takeoff] auto product-map for ${id} failed (non-fatal):`, err.message);
      try {
        broadcast(id, { type: 'product-map-failed', error: err.message });
      } catch (broadcastErr) {
        console.warn(`[takeoff] product-map-failed broadcast failed: ${broadcastErr.message}`);
      }
    });
  });

  // Stage 4: AI suggestions (async, non-blocking — pipeline is already 'ready')
  const tStage4 = startTimer('stage4_ai_suggestions', id);
  let aiSuggestionsCount = 0;
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
    aiSuggestionsCount = aiSuggestions.length;

    if (aiSuggestions.length > 0) {
      await suggestions.createBatch(aiSuggestions.map(s => ({ ...s, project_id: id })));
      const counts = await suggestions.countByProjectId(id);
      await deployments.update(id, { suggestions_count: counts.total || 0 });
    }
    tStage4.end({ ok: true, count: aiSuggestionsCount });
  } catch (err) {
    console.error(`AI suggestions for ${id} failed (non-fatal):`, err.message);
    tStage4.end({ ok: false, error: err.message });
  }

  // Stage 4b: Security detectors. Runs after AI suggestions so the
  // upgrade path in `applySecurityFindings` can promote any overlapping
  // AI-generated gap to security-tagged instead of producing a sibling.
  // The score is persisted on `deployments.security_score` so the
  // project header / listings can render without recomputing.
  //
  // Slice (a) of Phase 1 ships the framework with zero detectors —
  // every project gets a 100/100 default until detectors land. This
  // call still runs end-to-end so we exercise the persistence + score
  // path on every analysis from day one.
  const tStage4b = startTimer('stage4b_security_total', id);
  try {
    const tDetectors = startTimer('stage4b_run_detectors', id);
    const { findings, errors, detectorCount, perDetectorMs } = await runSecurityDetectors({
      stack: codebaseModel.stack,
      structure: codebaseModel.structure,
      fileContents: codebaseModel.fileContents,
      fileTree: codebaseModel.fileTree,
      gaps: codebaseModel.gaps,
      deployInfo: codebaseModel.deployInfo,
      features: codebaseModel.features,
      meta: codebaseModel.meta,
    });
    tDetectors.end({
      detectorCount,
      findingsCount: findings.length,
      detectorErrors: errors.length,
      perDetectorMs,
    });

    const tPersist = startTimer('stage4b_persist_findings', id);
    const persistSummary = await applySecurityFindings(id, findings);
    tPersist.end({
      input: findings.length,
      created: persistSummary.created,
      upgraded: persistSummary.upgraded,
      skipped: persistSummary.skipped,
      errors: persistSummary.errors.length,
    });

    // Score is computed from the live DB state (not just this run's
    // findings) because user-rejected and shipped rows must be
    // excluded from the penalty. The unaddressed-only fetch in
    // `findV2SecurityGapsByProjectId` does that filtering.
    const tScore = startTimer('stage4b_compute_score', id);
    const unaddressed = await suggestions.findV2SecurityGapsByProjectId(id);
    const scoreResult = computeSecurityScore(unaddressed);

    await deployments.update(id, {
      security_score: scoreResult.score,
      updated_at: new Date().toISOString(),
    });
    tScore.end({ score: scoreResult.score, totalUnaddressed: scoreResult.totalUnaddressed });

    broadcast(id, {
      type: 'security-scored',
      score: scoreResult.score,
      severityBreakdown: scoreResult.severityBreakdown,
      totalUnaddressed: scoreResult.totalUnaddressed,
      detectorCount,
      detectorErrors: errors.length,
      persist: persistSummary,
    });

    console.log(JSON.stringify({
      event: 'security_scored',
      projectId: id,
      score: scoreResult.score,
      breakdown: scoreResult.severityBreakdown,
      detectorCount,
      detectorErrors: errors.length,
      created: persistSummary.created,
      upgraded: persistSummary.upgraded,
      skipped: persistSummary.skipped,
      timestamp: new Date().toISOString(),
    }));
    tStage4b.end({ ok: true, score: scoreResult.score, findings: findings.length });
  } catch (err) {
    console.error(`Security analysis for ${id} failed (non-fatal):`, err.message);
    tStage4b.end({ ok: false, error: err.message });
  }

  // ── Restore triage + shipped→gap links ──────────────────────
  //
  // All suggestion-creating stages (2b static/gap, 4 AI, 4b security)
  // have finished writing. The rows the snapshot captured either
  // returned with their original ids (signal still present → restore)
  // or didn't (signal gone → drop the snapshot row silently).
  //
  // Security re-scoring uses the live unaddressed set, so we recompute
  // the score after restoring rejected/shipped status to make sure the
  // cached `deployments.security_score` reflects post-restore reality.
  if (triageSnapshot.length > 0 || shippedLinkSnapshot.length > 0) {
    const tRestore = startTimer('pipeline_restore_triage', id);
    try {
      const triageResult = await suggestions.restoreV2Triage(id, triageSnapshot);
      const shippedResult = await shippedItems.relinkGaps(id, shippedLinkSnapshot);

      // Re-score security if any rejected/shipped status was restored,
      // since the score was computed in Stage 4b against fresh
      // untriaged rows (over-counting). Cheap: same query + math.
      if (triageResult.restored > 0) {
        try {
          const unaddressed = await suggestions.findV2SecurityGapsByProjectId(id);
          const rescored = computeSecurityScore(unaddressed);
          await deployments.update(id, {
            security_score: rescored.score,
            updated_at: new Date().toISOString(),
          });
        } catch (err) {
          console.warn(`[pipeline] post-restore security rescore for ${id} failed (non-fatal):`, err.message);
        }
      }

      tRestore.end({
        triageRestored: triageResult.restored,
        triageSkipped: triageResult.skipped,
        shippedRelinked: shippedResult.relinked,
        shippedSkipped: shippedResult.skipped,
      });

      console.log(JSON.stringify({
        event: 'triage_restored',
        projectId: id,
        triage: triageResult,
        shipped: shippedResult,
        timestamp: new Date().toISOString(),
      }));
    } catch (err) {
      console.error(`[pipeline] triage restore for ${id} failed (non-fatal):`, err.message);
      tRestore.end({ ok: false, error: err.message });
    }
  }

  // Stage 6: Generate AI-ready .context.md files (non-fatal).
  // These are the markdown files vibe coders commit to their repo so
  // Cursor/Claude can read them as it works on the code. Runs serially
  // at the tail of the pipeline so users see readiness/plan/suggestions
  // first (via the earlier `complete` broadcast); context files arrive
  // as the final SSE milestone.
  const tStage6 = startTimer('stage6_generate_context_files', id);
  broadcast(id, { type: 'progress', phase: 'context-files', message: 'Generating AI-ready context files...' });
  let contextFilesCount = 0;
  try {
    const { contextFiles, completionPct } = await generateContextFiles(id, codebaseModel);
    contextFilesCount = contextFiles.length;
    try {
      await analyses.update(id, {
        context_files: contextFiles,
        completion_pct: completionPct,
      });
    } catch (err) {
      console.warn(`analyses.update context_files for takeoff ${id} failed (non-fatal):`, err.message);
    }
    broadcast(id, {
      type: 'context-files-ready',
      count: contextFiles.length,
      completionPct,
    });
    tStage6.end({ ok: true, count: contextFiles.length, completionPct });
  } catch (err) {
    console.error(`Context file generation for ${id} failed (non-fatal):`, err.message);
    tStage6.end({ ok: false, error: err.message });
  }

  // Stage 5: link suggestions to product-map jobs (non-blocking, async).
  // The product map is built in a parallel `setImmediate` so it may not
  // exist yet when we kick this off. The linker logs a `no-map` reason
  // and bails in that case; `autoCreateProductMap` schedules a second
  // pass once the map lands so unlinked rows still get picked up.
  //
  // Timing: Stage 5 runs in `setImmediate`, so its duration is OUTSIDE
  // `pipeline_total`. We still time it so we can spot a regression in
  // the linker independently — useful when the linker is calling
  // Claude (it does, on cold maps).
  setImmediate(() => {
    const tStage5 = startTimer('stage5_link_gaps_to_jobs', id);
    linkGapsToJobs(id).then((summary) => {
      if (summary.linked > 0 || summary.total > 0) {
        console.log(`[takeoff] gap-job linker for ${id}: ${JSON.stringify(summary)}`);
      }
      tStage5.end({ ok: true, linked: summary.linked, total: summary.total });
    }).catch((err) => {
      console.error(`[takeoff] gap-job linker for ${id} failed (non-fatal):`, err.message);
      tStage5.end({ ok: false, error: err.message });
    });
  });

  tPipeline.end({
    aiSuggestions: aiSuggestionsCount,
    staticSuggestions: allStaticSuggestions.length,
    contextFiles: contextFilesCount,
  });
}

// Build a product-map (personas + jobs + entity graph) for a freshly-analyzed
// project. Skips silently when:
//   - a map already exists (idempotent),
//   - we don't have a strong description signal (would produce garbage personas),
//   - Claude or the persistence layer fails (logged as non-fatal).
//
// Emits SSE events at each gate so AnalysisProgress can wait on the
// real result instead of dumping the user onto the v2 Map tab to
// click "Generate" themselves:
//   - 'progress' phase='product-map'   when the extract-intent call starts
//   - 'product-map-ready'              on success (with persona/job counts)
//   - 'product-map-skipped'            when an existing map blocks us OR
//                                      no description is available
//   - 'product-map-failed'             on Claude / persistence error
// The frontend treats ready/skipped/failed as "we're done waiting"
// and proceeds with whatever data it has.
async function autoCreateProductMap(projectId, codebaseModel, featuresSummary) {
  // Don't overwrite an existing map.
  try {
    const existing = await productMapSvc.getMapByProject(projectId);
    if (existing && existing.map) {
      console.log(`[takeoff] product-map already exists for ${projectId}, skipping auto-extract`);
      broadcast(projectId, { type: 'product-map-skipped', reason: 'exists' });
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
    broadcast(projectId, { type: 'product-map-skipped', reason: 'no-description' });
    return;
  }

  console.log(`[takeoff] auto-creating product-map for ${projectId} (description ${description.length} chars)`);
  broadcast(projectId, {
    type: 'progress',
    phase: 'product-map',
    message: 'Mapping personas and jobs to your code…',
  });

  let result;
  try {
    result = await productMapSvc.createProductMap(projectId, null, description);
  } catch (err) {
    console.error(`[takeoff] auto product-map for ${projectId} failed (non-fatal):`, err.message);
    broadcast(projectId, { type: 'product-map-failed', error: err.message });
    return;
  }

  console.log(`[takeoff] auto product-map created for ${projectId}: ${result.personas.length} personas, ${result.jobs.length} jobs`);
  broadcast(projectId, {
    type: 'product-map-ready',
    personasCount: result.personas.length,
    jobsCount: result.jobs.length,
  });

  // Map just landed — link any suggestions that the Stage-5 pass skipped
  // because the map didn't exist yet. Idempotent: rows already linked are
  // left alone (only `v2_job_links IS NULL` rows are touched).
  setImmediate(() => {
    linkGapsToJobs(projectId).then((summary) => {
      if (summary.linked > 0) {
        console.log(`[takeoff] gap-job linker (post-map) for ${projectId}: ${JSON.stringify(summary)}`);
      }
    }).catch((err) => {
      console.error(`[takeoff] gap-job linker (post-map) for ${projectId} failed (non-fatal):`, err.message);
    });
  });
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

// Re-run the full analysis pipeline for an existing project. The button
// in the UI sends users here instead of the old no-op (navigate-to-
// progress-page-and-replay-cached-complete) flow.
//
// Triage preservation (snapshot v2 columns + shipped→gap links before
// the delete in Stage 2b, restore after Stage 4b) lives in
// `runPipeline`, so anything that gets here will preserve user state
// automatically. See suggestions.snapshotV2Triage in lib/db.js.
//
// Guards:
//   • Auth + checkProjectAccess (owner-only mutating op)
//   • Rate limit (5/5min/IP — re-analyses re-hit LLMs + GitHub)
//   • 409 if status ∈ {pending, analyzing} OR an in-process run is
//     already underway. Atomic via the inFlightAnalyses Set check
//     PLUS a DB status check, so neither a same-process double-click
//     nor a cross-restart race can fire two pipelines.
//   • 400 if repo_url is a `local://` upload (we don't persist
//     uploaded files, so there's nothing to re-analyze).
//
// On success we clear the SSE buffer so the AnalysisProgress page
// doesn't receive the previous run's cached `complete` event — that
// would close the EventSource immediately and the user would see
// "Analysis Complete" before the new run had broadcast a single
// progress message.
router.post('/:id/reanalyze', reanalyzeRateLimit, asyncHandler(async (req, res) => {
  const project = await deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');

  checkProjectAccess(project, req);

  if (typeof project.repo_url !== 'string' || project.repo_url.startsWith('local://')) {
    throw AppError.badRequest(
      'Re-analyze is only available for GitHub-connected projects. ' +
      'Uploaded folders cannot be re-analyzed because we do not store the original files.'
    );
  }

  if (inFlightAnalyses.has(project.id) || !REANALYZABLE_STATUSES.has(project.status)) {
    throw AppError.conflict(
      `Project is currently ${project.status === 'analyzing' ? 'being analyzed' : `in '${project.status}' state`}; ` +
      'wait for it to finish before re-analyzing.'
    );
  }

  inFlightAnalyses.add(project.id);

  // Order matters: status update must commit BEFORE we drop the SSE
  // buffer, so any client that's mid-reconnect doesn't see the stale
  // 'ready' state during the gap. Clear → reset status → broadcast a
  // fresh 'status: analyzing' so currently-connected clients flip
  // immediately.
  clearEventBuffer(project.id);
  await deployments.update(project.id, {
    status: 'analyzing',
    error: null,
    updated_at: new Date().toISOString(),
  });
  broadcast(project.id, { type: 'status', status: 'analyzing' });

  console.log(JSON.stringify({
    event: 'reanalyze_triggered',
    projectId: project.id,
    repoUrl: project.repo_url,
    userId: req.user?.id || null,
    timestamp: new Date().toISOString(),
  }));

  setImmediate(() => {
    runTakeoff(project.id, project.repo_url)
      .catch((err) => {
        console.error(`reanalyze runTakeoff ${project.id} unhandled:`, err);
      })
      .finally(() => {
        inFlightAnalyses.delete(project.id);
      });
  });

  res.status(202).json({ projectId: project.id, status: 'analyzing' });
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
