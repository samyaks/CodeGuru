const express = require('express');
const { deployments, buildEntries } = require('../lib/db');
const { createRateLimit } = require('../lib/rate-limit');
const { CLAUDE_MODEL, anthropic } = require('../lib/constants');
const { AppError } = require('../lib/app-error');
const { asyncHandler } = require('../lib/async-handler');
const { parseJsonFields, safeParseJson } = require('../lib/helpers');

const router = express.Router();

const STORY_JSON_FIELDS = ['stack_info', 'readiness_categories', 'plan_steps'];

function parseMetadata(entry) {
  const parsed = { ...entry };
  if (parsed.metadata && typeof parsed.metadata === 'string') {
    try { parsed.metadata = JSON.parse(parsed.metadata); } catch {}
  }
  return parsed;
}

function sanitizeEntry(entry) {
  const parsed = parseMetadata(entry);
  return {
    id: parsed.id,
    entry_type: parsed.entry_type,
    title: parsed.title,
    content: parsed.content,
    metadata: parsed.metadata,
    created_at: parsed.created_at,
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
  const project = deployments.findBySlug(req.params.slug);
  if (!project) throw AppError.notFound('Story not found');

  const parsed = parseJsonFields(project, STORY_JSON_FIELDS);
  const entries = buildEntries.findPublicByProjectId(project.id);

  res.json({
    project: {
      owner: parsed.owner,
      repo: parsed.repo,
      framework: parsed.framework || null,
      description: parsed.description || null,
      readiness_score: parsed.readiness_score || null,
      live_url: parsed.live_url || null,
      status: parsed.status,
      slug: parsed.slug,
    },
    entries: entries.map(sanitizeEntry),
    social_summary: parsed.social_summary || null,
  });
}));

router.get('/:slug/summary', summaryLimit, asyncHandler(async (req, res) => {
  const project = deployments.findBySlug(req.params.slug);
  if (!project) throw AppError.notFound('Story not found');

  if (project.social_summary) {
    return res.json({ summary: project.social_summary });
  }

  const entries = buildEntries.findPublicByProjectId(project.id);
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

  deployments.update(project.id, { social_summary: summary });

  res.json({ summary });
}));

module.exports = router;
