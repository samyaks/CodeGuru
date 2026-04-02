const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { fixPrompts, fixPromptEvents } = require('../lib/db');
const { createRateLimit } = require('../lib/rate-limit');

const router = express.Router();

const rateLimit = createRateLimit({ windowMs: 60000, max: 60, message: 'Too many requests. Try again in a minute.' });

router.get('/:shortId', rateLimit, (req, res) => {
  const prompt = fixPrompts.findByShortId(req.params.shortId);
  if (!prompt) return res.status(404).json({ error: 'Fix prompt not found or expired' });

  res.json({
    short_id: prompt.short_id, file_path: prompt.file_path,
    line_start: prompt.line_start, line_end: prompt.line_end,
    issue_category: prompt.issue_category, issue_title: prompt.issue_title,
    issue_description: prompt.issue_description, severity: prompt.severity,
    code_snippet: prompt.code_snippet,
    reference_file_path: prompt.reference_file_path,
    reference_snippet: prompt.reference_snippet,
    related_files: safeParseJson(prompt.related_files, []),
    full_prompt: prompt.full_prompt,
    created_at: prompt.created_at, expires_at: prompt.expires_at,
  });
});

router.post('/:shortId/events', rateLimit, express.json(), (req, res) => {
  const prompt = fixPrompts.findByShortId(req.params.shortId);
  if (!prompt) return res.status(404).json({ error: 'Fix prompt not found or expired' });

  const { event_type, deeplink_target } = req.body;
  const validTypes = ['page_view', 'copy_prompt', 'deeplink_click', 'feedback_up', 'feedback_down'];
  if (!event_type || !validTypes.includes(event_type)) {
    return res.status(400).json({ error: `event_type must be one of: ${validTypes.join(', ')}` });
  }

  fixPromptEvents.create({
    id: uuidv4(), fix_prompt_id: prompt.id,
    event_type, deeplink_target: deeplink_target || null,
    created_at: new Date().toISOString(),
  });

  res.json({ message: 'Event recorded' });
});

function safeParseJson(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

module.exports = router;
