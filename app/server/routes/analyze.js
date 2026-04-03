const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { analyses } = require('../lib/db');
const { addConnection, broadcast } = require('../lib/sse');
const github = require('../services/github');
const { analyzeRepo } = require('../services/analyzer');
const { generateContextFiles } = require('../services/context-generator');
const { describeFeatures } = require('../services/features-describer');
const { createRateLimit } = require('../lib/rate-limit');
const { validateRepoUrl, validatePagination } = require('../lib/validate');

const router = express.Router();

const analyzeRateLimit = createRateLimit({ windowMs: 60000, max: 10, message: 'Too many analysis requests. Please try again in a minute.' });

router.post('/', analyzeRateLimit, async (req, res) => {
  try {
    const { repoUrl } = req.body;
    if (!repoUrl) {
      return res.status(400).json({ error: 'repoUrl is required' });
    }

    const validation = validateRepoUrl(repoUrl);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    const { owner, repo } = validation;

    const id = uuidv4();
    analyses.create({
      id,
      repo_url: repoUrl,
      owner,
      repo,
      status: 'pending',
      created_at: new Date().toISOString(),
      user_id: req.user?.id || null,
    });

    setImmediate(() => runAnalysis(id, repoUrl));

    res.status(201).json({ projectId: id, status: 'pending' });
  } catch (err) {
    console.error('Error creating analysis:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

async function runAnalysis(id, repoUrl) {
  try {
    analyses.update(id, { status: 'analyzing' });
    broadcast(id, { type: 'analysis-started', id });

    const codebaseModel = await analyzeRepo(repoUrl, (progress) => {
      broadcast(id, { type: 'progress', ...progress });
    });

    analyses.update(id, {
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

    analyses.update(id, {
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
    analyses.update(id, { status: 'failed' });
    broadcast(id, { type: 'analysis-error', error: err.message });
  }
}

router.get('/:id', (req, res) => {
  const analysis = analyses.findById(req.params.id);
  if (!analysis) return res.status(404).json({ error: 'Analysis not found' });

  const result = { ...analysis };
  if (result.analysis) {
    try { result.analysis = JSON.parse(result.analysis); } catch (e) {
      console.warn(`Failed to parse analysis JSON for ${req.params.id}:`, e.message);
    }
  }
  if (result.context_files) {
    try { result.context_files = JSON.parse(result.context_files); } catch (e) {
      console.warn(`Failed to parse context_files JSON for ${req.params.id}:`, e.message);
    }
  }
  // features_summary is plain text, no parsing needed
  res.json(result);
});

router.get('/', (req, res) => {
  const { limit, offset } = validatePagination(req.query);
  const list = analyses.list({ limit, offset, userId: req.user?.id || null });
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
});

router.get('/:id/stream', (req, res) => {
  const analysis = analyses.findById(req.params.id);
  if (!analysis) return res.status(404).json({ error: 'Analysis not found' });
  addConnection(req.params.id, res, { origin: req.headers.origin || '*' });
});

module.exports = router;
