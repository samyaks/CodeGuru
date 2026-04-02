const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { reviews, reviewFiles, fixPrompts } = require('../lib/db');
const { addConnection, broadcast } = require('../lib/sse');
const github = require('../services/github');
const reviewer = require('../services/reviewer');
const { detectDeploymentFiles, detectDeploymentInPR } = require('../services/deployment');
const { generateFixPrompts } = require('../services/fix-prompt');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { repoUrl, prNumber, type = 'pr', branch } = req.body;
    if (!repoUrl) return res.status(400).json({ error: 'repoUrl is required' });

    if (type === 'pr' && !prNumber) {
      const parsed = github.parsePRUrl(repoUrl);
      if (!parsed) return res.status(400).json({ error: 'prNumber is required for PR reviews, or provide a full PR URL' });
      return createReview(res, {
        repoUrl: `https://github.com/${parsed.owner}/${parsed.repo}`,
        prNumber: parsed.prNumber, type,
        owner: parsed.owner, repo: parsed.repo, branch,
      });
    }

    const { owner, repo } = github.parseRepoUrl(repoUrl);
    return createReview(res, { repoUrl, prNumber: prNumber || null, type, owner, repo, branch: branch || null });
  } catch (err) {
    console.error('Error creating review:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

async function createReview(res, { repoUrl, prNumber, type, owner, repo, branch }) {
  const id = uuidv4();
  reviews.create({
    id, type, repo_url: repoUrl, owner, repo,
    pr_number: prNumber, branch: branch || null,
    status: 'pending', created_at: new Date().toISOString(),
  });

  setImmediate(() => startReview(id));
  res.status(201).json({ reviewId: id, status: 'pending', message: 'Review created' });
}

async function startReview(reviewId) {
  try {
    reviews.updateStatus(reviewId, 'in_progress');
    broadcast(reviewId, { type: 'review-started', reviewId });

    const review = reviews.findById(reviewId);
    if (!review) return;

    const result = review.type === 'pr'
      ? await runPRReview(reviewId, review)
      : await runRepoReview(reviewId, review);

    const { report, fileContents } = result;
    const files = reviewFiles.findByReviewId(reviewId);
    const severities = reviewer.extractFileSeverities(report);
    const comments = reviewer.extractFileComments(report);

    for (const file of files) {
      const fileComments = comments.get(file.file_path) || [];
      const fileSeverity = severities.get(file.file_path) || (fileComments.length ? 'info' : 'ok');
      reviewFiles.updateAiComments(file.id, fileComments, fileSeverity);
    }

    reviews.updateStatus(reviewId, 'completed', { ai_report: report });
    broadcast(reviewId, { type: 'review-completed', reviewId, report });

    setImmediate(async () => {
      try {
        await generateFixPrompts(reviewId, review, report, fileContents);
      } catch (err) {
        console.error(`Fix prompt generation failed for review ${reviewId}:`, err.message);
      }
    });
  } catch (err) {
    console.error(`Review ${reviewId} failed:`, err);
    reviews.updateStatus(reviewId, 'failed', { error: err.message });
    broadcast(reviewId, { type: 'review-error', error: err.message });
  }
}

async function runPRReview(reviewId, review) {
  broadcast(reviewId, { type: 'progress', phase: 'fetching', message: `Fetching PR #${review.pr_number}...` });

  const [prMeta, prFiles] = await Promise.all([
    github.fetchPullRequest(review.owner, review.repo, review.pr_number),
    github.fetchPRFiles(review.owner, review.repo, review.pr_number),
  ]);

  broadcast(reviewId, { type: 'progress', phase: 'fetched', message: `Fetched ${prFiles.length} changed files`, fileCount: prFiles.length });

  for (const f of prFiles) {
    reviewFiles.create({
      id: uuidv4(), review_id: reviewId, file_path: f.filename,
      diff: f.patch || null, ai_comments: '[]', severity: null,
    });
  }

  const deployInfo = detectDeploymentInPR(prFiles.map((f) => f.filename));
  const report = await reviewer.reviewPR(reviewId, {
    owner: review.owner, repo: review.repo, prNumber: review.pr_number,
    prMeta, prFiles, deployInfo,
  });

  const fileContents = prFiles.map((f) => ({ path: f.filename, content: f.patch || null, size: f.patch?.length || 0 }));
  return { report, fileContents };
}

async function runRepoReview(reviewId, review) {
  broadcast(reviewId, { type: 'progress', phase: 'fetching', message: `Fetching repo tree for ${review.owner}/${review.repo}...` });

  let branch = review.branch;
  if (!branch) {
    try {
      const meta = await github.fetchRepoMeta(review.owner, review.repo);
      branch = meta.default_branch || 'main';
    } catch { branch = 'main'; }
  }

  let tree;
  try {
    tree = await github.fetchRepoTree(review.owner, review.repo, branch);
  } catch {
    branch = branch === 'main' ? 'master' : 'main';
    tree = await github.fetchRepoTree(review.owner, review.repo, branch);
  }

  const codeFiles = tree.filter((f) => f.type === 'blob' && !f.path.includes('node_modules') && !f.path.includes('.lock'));
  broadcast(reviewId, { type: 'progress', phase: 'fetched', message: `Found ${codeFiles.length} files`, fileCount: codeFiles.length });

  const deployInfo = detectDeploymentFiles(tree);
  const deployFileContents = await Promise.all(
    deployInfo.allPaths.slice(0, 10).map((p) =>
      github.fetchFileContent(review.owner, review.repo, p, branch).catch(() => ({ path: p, content: null, size: 0 }))
    )
  );

  const sample = codeFiles.slice(0, 20);
  const fileContents = await Promise.all(
    sample.map((f) =>
      github.fetchFileContent(review.owner, review.repo, f.path, branch).catch(() => ({ path: f.path, content: null, size: 0 }))
    )
  );

  for (const f of fileContents) {
    reviewFiles.create({
      id: uuidv4(), review_id: reviewId, file_path: f.path,
      diff: null, ai_comments: '[]', severity: null,
    });
  }

  const report = await reviewer.reviewRepo(reviewId, {
    owner: review.owner, repo: review.repo,
    files: fileContents, deployInfo, deployFiles: deployFileContents,
  });

  return { report, fileContents };
}

router.get('/', (req, res) => {
  const { limit = 20, offset = 0 } = req.query;
  res.json(reviews.list({ limit: parseInt(limit, 10), offset: parseInt(offset, 10) }));
});

router.get('/:id', (req, res) => {
  const review = reviews.findById(req.params.id);
  if (!review) return res.status(404).json({ error: 'Review not found' });
  const files = reviewFiles.findByReviewId(req.params.id);
  res.json({ ...review, files });
});

router.get('/:id/fix-prompts', (req, res) => {
  const review = reviews.findById(req.params.id);
  if (!review) return res.status(404).json({ error: 'Review not found' });
  const prompts = fixPrompts.findByReviewId(req.params.id);
  res.json(prompts.map((p) => ({
    id: p.id, short_id: p.short_id, file_path: p.file_path,
    line_start: p.line_start, line_end: p.line_end,
    issue_category: p.issue_category, issue_title: p.issue_title,
    issue_description: p.issue_description, severity: p.severity,
  })));
});

router.get('/:id/stream', (req, res) => {
  const review = reviews.findById(req.params.id);
  if (!review) return res.status(404).json({ error: 'Review not found' });
  addConnection(req.params.id, res);
});

router.patch('/:id', (req, res) => {
  const review = reviews.findById(req.params.id);
  if (!review) return res.status(404).json({ error: 'Review not found' });
  const { human_notes } = req.body;
  if (human_notes === undefined) return res.status(400).json({ error: 'human_notes is required' });
  reviews.updateHumanNotes(req.params.id, human_notes);
  res.json({ message: 'Human notes updated' });
});

router.patch('/:id/files/:fileId', (req, res) => {
  const review = reviews.findById(req.params.id);
  if (!review) return res.status(404).json({ error: 'Review not found' });
  const { human_comments } = req.body;
  if (human_comments === undefined) return res.status(400).json({ error: 'human_comments is required' });
  reviewFiles.updateHumanComments(req.params.fileId, human_comments);
  res.json({ message: 'Human comments updated' });
});

module.exports = router;
