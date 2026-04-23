const express = require('express');
const { deployments, buildEntries } = require('../lib/db');
const { createRateLimit } = require('../lib/rate-limit');
const { CLAUDE_MODEL, anthropic } = require('../lib/constants');
const { AppError } = require('../lib/app-error');
const { asyncHandler } = require('../lib/async-handler');
const router = express.Router();

function sanitizeEntry(entry) {
  return {
    id: entry.id,
    entry_type: entry.entry_type,
    title: entry.title,
    content: entry.content,
    metadata: entry.metadata,
    created_at: entry.created_at,
  };
}

const readLimit = createRateLimit({
  windowMs: 60000,
  max: 60,
  message: 'Too many requests. Please try again in a minute.',
});

const summaryLimit = createRateLimit({
  windowMs: 60000,
  max: 5,
  message: 'Too many summary requests. Please try again in a minute.',
});

router.get('/:slug', readLimit, asyncHandler(async (req, res) => {
  const project = await deployments.findBySlug(req.params.slug);
  if (!project) throw AppError.notFound('Story not found');

  const entries = await buildEntries.findPublicByProjectId(project.id);

  res.json({
    project: {
      owner: project.owner,
      repo: project.repo,
      framework: project.framework || null,
      description: project.description || null,
      readiness_score: project.readiness_score || null,
      live_url: project.live_url || null,
      status: project.status,
      slug: project.slug,
    },
    entries: entries.map(sanitizeEntry),
    social_summary: project.social_summary || null,
  });
}));

router.get('/:slug/summary', summaryLimit, asyncHandler(async (req, res) => {
  const project = await deployments.findBySlug(req.params.slug);
  if (!project) throw AppError.notFound('Story not found');

  if (project.social_summary) {
    return res.json({ summary: project.social_summary });
  }

  const entries = await buildEntries.findPublicByProjectId(project.id);
  if (entries.length === 0) {
    throw AppError.badRequest('No public build entries to summarize');
  }

  const entrySummary = entries.map((e) => {
    return `[${e.entry_type}] ${e.title ? e.title + ': ' : ''}${e.content} (${e.created_at})`;
  }).join('\n');

  const projectInfo = [
    `Repository: ${project.owner}/${project.repo}`,
    project.framework ? `Framework: ${project.framework}` : null,
    project.description ? `Description: ${project.description}` : null,
    project.status ? `Status: ${project.status}` : null,
    project.live_url ? `Live URL: ${project.live_url}` : null,
    project.readiness_score != null ? `Readiness: ${project.readiness_score}/100` : null,
  ].filter(Boolean).join('\n');

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 256,
    system: 'You write concise, engaging social media summaries of software build stories. Write 2-3 sentences that capture what was built, key decisions, and current status. Be factual and enthusiastic without being cheesy. No hashtags or emojis.',
    messages: [{
      role: 'user',
      content: `Summarize this build story for sharing:\n\nProject:\n${projectInfo}\n\nBuild entries:\n${entrySummary}`,
    }],
  });

  const summary = message.content[0].text;

  await deployments.update(project.id, { social_summary: summary });

  res.json({ summary });
}));

module.exports = router;
