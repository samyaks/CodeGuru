const { broadcast } = require('../lib/sse');
const { buildPRReviewPrompt } = require('../prompts/pr-review');
const { buildRepoReviewPrompt } = require('../prompts/repo-review');
const { buildCommitReviewPrompt } = require('../prompts/commit-review');
const { CLAUDE_MODEL, anthropic } = require('../lib/constants');
const MAX_TOKENS = 6144;

async function reviewPR(reviewId, { owner, repo, prNumber, prMeta, prFiles, deployInfo }) {
  const prompt = buildPRReviewPrompt({
    owner, repo, prNumber,
    prTitle: prMeta.title,
    prBody: prMeta.body,
    files: prFiles,
    deployInfo,
  });
  return streamReview(reviewId, prompt);
}

async function reviewRepo(reviewId, { owner, repo, files, deployInfo, deployFiles }) {
  const prompt = buildRepoReviewPrompt({ owner, repo, files, deployInfo, deployFiles });
  return streamReview(reviewId, prompt);
}

/** broadcastId is usually projectId so Takeoff SSE clients receive progress. */
async function reviewCommit(broadcastId, payload) {
  const prompt = buildCommitReviewPrompt(payload);
  return streamReview(broadcastId, prompt);
}

async function streamReview(reviewId, { system, user }) {
  broadcast(reviewId, { type: 'progress', phase: 'analyzing', message: 'AI review in progress...' });

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    stream: true,
    system,
    messages: [{ role: 'user', content: user }],
  });

  let fullText = '';
  let chunkCount = 0;

  for await (const event of response) {
    if (event.type === 'content_block_delta' && event.delta?.text) {
      fullText += event.delta.text;
      chunkCount++;
      if (chunkCount % 5 === 0) {
        broadcast(reviewId, {
          type: 'progress',
          phase: 'analyzing',
          message: 'AI review in progress...',
          partial: fullText,
          chunks: chunkCount,
        });
      }
    }
  }

  broadcast(reviewId, { type: 'progress', phase: 'parsing', message: 'Parsing review results...' });
  return parseReport(fullText);
}

function parseReport(text) {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Claude did not return valid JSON. Raw response stored in ai_report.');
  }
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    const cleaned = jsonMatch[0].replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
    try {
      return JSON.parse(cleaned);
    } catch {
      throw new Error(`Failed to parse review JSON: ${e.message}`);
    }
  }
}

function extractFileSeverities(report) {
  const map = new Map();
  if (!report?.filesummaries) return map;
  for (const fs of report.filesummaries) {
    map.set(fs.file, fs.severity || 'ok');
  }
  return map;
}

function extractFileComments(report) {
  const map = new Map();
  if (!report?.findings) return map;
  for (const f of report.findings) {
    const key = f.file || 'general';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(f);
  }
  return map;
}

module.exports = { reviewPR, reviewRepo, reviewCommit, extractFileSeverities, extractFileComments };
