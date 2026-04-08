const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { deployments, buildEntries } = require('../lib/db');
const { createRateLimit } = require('../lib/rate-limit');
const Anthropic = require('@anthropic-ai/sdk');
const { AppError } = require('../lib/app-error');
const { asyncHandler } = require('../lib/async-handler');

const VALID_ENTRY_TYPES = ['prompt', 'note', 'decision', 'milestone', 'deploy_event', 'file'];

const router = express.Router({ mergeParams: true });

function checkProjectAccess(project, req) {
  if (!project.user_id) return null;
  if (!req.user) return 403;
  if (project.user_id !== req.user.id) return 403;
  return null;
}

function parseMetadata(entry) {
  const parsed = { ...entry };
  if (parsed.metadata && typeof parsed.metadata === 'string') {
    try { parsed.metadata = JSON.parse(parsed.metadata); } catch {}
  }
  return parsed;
}

const readLimit = createRateLimit({
  windowMs: 60000,
  max: 30,
  message: 'Too many requests. Please try again in a minute.',
});

const writeLimit = createRateLimit({
  windowMs: 60000,
  max: 10,
  message: 'Too many write requests. Please try again in a minute.',
});

const generateLimit = createRateLimit({
  windowMs: 60000,
  max: 3,
  message: 'Too many generate requests. Please try again in a minute.',
});

router.get('/', readLimit, asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const project = deployments.findById(projectId);
  if (!project) throw AppError.notFound('Project not found');

  const denied = checkProjectAccess(project, req);
  if (denied) throw AppError.forbidden('Forbidden');

  const entries = buildEntries.findByProjectId(projectId);
  res.json(entries.map(parseMetadata));
}));

router.post('/', writeLimit, asyncHandler(async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Login required to create entries', code: 'UNAUTHORIZED' });
  }

  const { projectId } = req.params;
  const project = deployments.findById(projectId);
  if (!project) throw AppError.notFound('Project not found');

  const denied = checkProjectAccess(project, req);
  if (denied) throw AppError.forbidden('Forbidden');

  const { entry_type, title, content, metadata } = req.body;

  if (!entry_type || !VALID_ENTRY_TYPES.includes(entry_type)) {
    throw AppError.badRequest(`entry_type is required and must be one of: ${VALID_ENTRY_TYPES.join(', ')}`);
  }
  if (!content) {
    throw AppError.badRequest('content is required');
  }

  const entry = {
    id: uuidv4(),
    project_id: projectId,
    user_id: req.user.id,
    entry_type,
    title: title || null,
    content,
    metadata: metadata || null,
    created_at: new Date().toISOString(),
  };

  buildEntries.create(entry);
  res.status(201).json(parseMetadata(entry));
}));

router.patch('/:entryId', writeLimit, asyncHandler(async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Login required to update entries', code: 'UNAUTHORIZED' });
  }

  const { projectId, entryId } = req.params;
  const entry = buildEntries.findById(entryId);
  if (!entry) throw AppError.notFound('Entry not found');

  if (entry.project_id !== projectId) {
    throw AppError.notFound('Entry not found in this project');
  }
  if (entry.user_id !== req.user.id) {
    throw AppError.forbidden('Forbidden');
  }

  const { title, content, metadata, entry_type, is_public } = req.body;
  const updates = { updated_at: new Date().toISOString() };

  if (title !== undefined) updates.title = title;
  if (content !== undefined) updates.content = content;
  if (metadata !== undefined) updates.metadata = metadata;
  if (entry_type !== undefined) {
    if (!VALID_ENTRY_TYPES.includes(entry_type)) {
      throw AppError.badRequest(`entry_type must be one of: ${VALID_ENTRY_TYPES.join(', ')}`);
    }
    updates.entry_type = entry_type;
  }
  if (is_public !== undefined) updates.is_public = is_public ? 1 : 0;

  buildEntries.update(entryId, updates);

  const updated = buildEntries.findById(entryId);
  res.json(parseMetadata(updated));
}));

router.delete('/:entryId', writeLimit, asyncHandler(async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Login required to delete entries', code: 'UNAUTHORIZED' });
  }

  const { projectId, entryId } = req.params;
  const entry = buildEntries.findById(entryId);
  if (!entry) throw AppError.notFound('Entry not found');

  if (entry.project_id !== projectId) {
    throw AppError.notFound('Entry not found in this project');
  }
  if (entry.user_id !== req.user.id) {
    throw AppError.forbidden('Forbidden');
  }

  buildEntries.delete(entryId);
  res.json({ deleted: true });
}));

router.post('/generate-context', generateLimit, asyncHandler(async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Login required to generate context', code: 'UNAUTHORIZED' });
  }

  const { projectId } = req.params;
  const project = deployments.findById(projectId);
  if (!project) throw AppError.notFound('Project not found');

  const denied = checkProjectAccess(project, req);
  if (denied) throw AppError.forbidden('Forbidden');

  const entries = buildEntries.findByProjectId(projectId);
  if (entries.length === 0) {
    throw AppError.badRequest('No build entries found. Add some entries before generating context.');
  }

  let stackInfo = project.stack_info;
  if (stackInfo && typeof stackInfo === 'string') {
    try { stackInfo = JSON.parse(stackInfo); } catch {}
  }

  const entrySummary = entries.map((e) => {
    let meta = e.metadata;
    if (meta && typeof meta === 'string') {
      try { meta = JSON.parse(meta); } catch {}
    }
    return `[${e.entry_type}] ${e.title ? e.title + ': ' : ''}${e.content}${meta ? ' | metadata: ' + JSON.stringify(meta) : ''} (${e.created_at})`;
  }).join('\n');

  const projectInfo = [
    `Repository: ${project.owner}/${project.repo}`,
    project.framework ? `Framework: ${project.framework}` : null,
    stackInfo ? `Stack: ${JSON.stringify(stackInfo)}` : null,
    project.status ? `Status: ${project.status}` : null,
    project.live_url ? `Live URL: ${project.live_url}` : null,
  ].filter(Boolean).join('\n');

  const client = new Anthropic();

  const message = await client.messages.create({
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: 'You are generating a .context.md file from a developer\'s build journal. The file follows the .context.md spec with sections: ## owner, ## purpose, ## constraints, ## decisions, ## ai-log, ## dependencies, ## status. Synthesize the build entries (prompts, notes, decisions, milestones, deploy events) into a coherent context file. Keep language clear and readable.',
    messages: [{
      role: 'user',
      content: `Generate a .context.md file for this project.\n\nProject info:\n${projectInfo}\n\nBuild entries:\n${entrySummary}`,
    }],
  });

  const contextContent = message.content[0].text;

  res.json({ contextFile: contextContent });
}));

module.exports = router;
