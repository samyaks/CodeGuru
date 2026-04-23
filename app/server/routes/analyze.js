const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { analyses, analysisFiles, analysisLlmCalls } = require('../lib/db');
const { addConnection, broadcast } = require('../lib/sse');
const github = require('../services/github');
const { analyzeRepo } = require('../services/analyzer');
const { generateContextFiles } = require('../services/context-generator');
const { describeFeatures } = require('../services/features-describer');
const { createRateLimit } = require('../lib/rate-limit');
const { validateRepoUrl, validatePagination } = require('../lib/validate');
const { AppError } = require('../lib/app-error');
const { asyncHandler } = require('../lib/async-handler');

const router = express.Router();

const analyzeRateLimit = createRateLimit({ windowMs: 60000, max: 10, message: 'Too many analysis requests. Please try again in a minute.' });

router.post('/', analyzeRateLimit, asyncHandler(async (req, res) => {
  const { repoUrl } = req.body;
  if (!repoUrl) throw AppError.badRequest('repoUrl is required');

  const validation = validateRepoUrl(repoUrl);
  if (!validation.valid) throw AppError.badRequest(validation.error);
  const { owner, repo } = validation;

  const id = uuidv4();
  await analyses.create({
    id,
    repo_url: repoUrl,
    owner,
    repo,
    status: 'pending',
    created_at: new Date().toISOString(),
    user_id: req.user?.id || null,
  });

  setImmediate(() => {
    runAnalysis(id, repoUrl).catch((err) => {
      console.error(`runAnalysis ${id} unhandled:`, err);
    });
  });

  res.status(201).json({ projectId: id, status: 'pending' });
}));

async function runAnalysis(id, repoUrl) {
  try {
    await analyses.update(id, { status: 'analyzing' });
    broadcast(id, { type: 'analysis-started', id });

    const codebaseModel = await analyzeRepo(repoUrl, (progress) => {
      broadcast(id, { type: 'progress', ...progress });
    }, id);

    await analyses.update(id, {
      owner: codebaseModel.meta.owner,
      repo: codebaseModel.meta.repo,
      status: 'generating',
      analysis: codebaseModel,
    });

    broadcast(id, { type: 'progress', phase: 'generating', message: 'Generating .context.md files...' });

    const { contextFiles, completionPct } = await generateContextFiles(id, codebaseModel);

    let featuresSummary = null;
    try {
      featuresSummary = await describeFeatures(id, codebaseModel);
    } catch (err) {
      console.error(`Features description for ${id} failed (non-fatal):`, err.message);
    }

    await analyses.update(id, {
      status: 'completed',
      context_files: contextFiles,
      completion_pct: completionPct,
      features_summary: featuresSummary,
      completed_at: new Date().toISOString(),
    });

    broadcast(id, {
      type: 'analysis-completed',
      id,
      completionPct,
      contextFileCount: contextFiles.length,
      hasFeaturesSummary: !!featuresSummary,
    });

    console.log(`Analysis ${id} completed: ${completionPct}% complete, ${contextFiles.length} context files, features: ${!!featuresSummary}`);
  } catch (err) {
    console.error(`Analysis ${id} failed:`, err);
    try {
      await analyses.update(id, { status: 'failed' });
    } catch (updateErr) {
      console.error(`Failed to mark analysis ${id} as failed:`, updateErr.message);
    }
    broadcast(id, { type: 'analysis-error', error: err.message });
  }
}

router.get('/:id', asyncHandler(async (req, res) => {
  const analysis = await analyses.findById(req.params.id);
  if (!analysis) throw AppError.notFound('Analysis not found');

  res.json(analysis);
}));

router.get('/', asyncHandler(async (req, res) => {
  const { limit, offset } = validatePagination(req.query);
  const list = await analyses.list({ limit, offset, userId: req.user?.id || null });
  res.json(list.map((a) => ({
    id: a.id,
    repo_url: a.repo_url,
    owner: a.owner,
    repo: a.repo,
    status: a.status,
    completion_pct: a.completion_pct,
    created_at: a.created_at,
    completed_at: a.completed_at,
  })));
}));

router.get('/:id/stream', asyncHandler(async (req, res) => {
  const analysis = await analyses.findById(req.params.id);
  if (!analysis) throw AppError.notFound('Analysis not found');
  addConnection(req.params.id, res, { origin: req.headers.origin || '*' });
}));

router.get('/:id/capture', asyncHandler(async (req, res) => {
  const analysis = await analyses.findById(req.params.id);
  if (!analysis) throw AppError.notFound('Analysis not found');

  const raw = (await analyses.getRollups(req.params.id)) || {};
  const rollups = {
    fileCount: raw.file_count ?? 0,
    treeTotalBytes: raw.tree_total_bytes ?? 0,
    treeEstimatedTokens: raw.tree_estimated_tokens ?? 0,
    treeTruncated: !!raw.tree_truncated,
    ingestedFileCount: raw.ingested_file_count ?? 0,
    ingestedBytes: raw.ingested_bytes ?? 0,
    ingestedTokens: raw.ingested_tokens ?? 0,
    llmCallCount: raw.llm_call_count ?? 0,
    llmInputTokens: raw.llm_input_tokens ?? 0,
    llmOutputTokens: raw.llm_output_tokens ?? 0,
    llmCostUsd: raw.llm_cost_usd ?? 0,
  };

  const tierCounts = await analysisFiles.countByTier(req.params.id);
  const phaseRows = await analysisLlmCalls.aggregateByPhase(req.params.id);
  const phaseAggregates = phaseRows.map((r) => ({
    phase: r.phase,
    callCount: r.call_count,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    costUsd: r.cost_usd,
  }));

  res.json({ rollups, tierCounts, phaseAggregates });
}));

module.exports = router;
