const express = require('express');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { projectEvents, deployments } = require('../lib/db');
const { createRateLimit } = require('../lib/rate-limit');
const { AppError } = require('../lib/app-error');
const { asyncHandler } = require('../lib/async-handler');

const router = express.Router();

const projectRateLimit = createRateLimit({
  windowMs: 60000,
  max: 100,
  message: 'Rate limit exceeded for this project',
  keyFn: (req) => req.body && req.body.projectId,
});

// Cache snippet.js in memory at startup
const SNIPPET_PATH = path.resolve(__dirname, '..', '..', '..', 'packages', 'analytics', 'snippet.js');
let snippetCode = '';
try {
  snippetCode = fs.readFileSync(SNIPPET_PATH, 'utf-8');
} catch (err) {
  console.warn('[collect] Could not read snippet.js at startup:', err.message);
}

const MAX_EVENTS_PER_BATCH = 50;
const MAX_STRING_LEN = 2048;
const MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000;

function truncStr(val, maxLen) {
  if (typeof val !== 'string') return null;
  return val.length > maxLen ? val.slice(0, maxLen) : val;
}

function clampTimestamp(clientTs) {
  if (!clientTs) return new Date().toISOString();
  const parsed = new Date(clientTs);
  if (isNaN(parsed.getTime())) return new Date().toISOString();
  const now = Date.now();
  if (Math.abs(parsed.getTime() - now) > MAX_TIMESTAMP_DRIFT_MS) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

const collectJsonParser = express.json({ limit: '64kb' });

router.post('/api/collect', collectJsonParser, projectRateLimit, asyncHandler(async (req, res) => {
  const { projectId, events } = req.body;

  if (!projectId || typeof projectId !== 'string') {
    throw AppError.badRequest('Missing or invalid projectId');
  }
  if (!Array.isArray(events) || events.length === 0) {
    throw AppError.badRequest('events must be a non-empty array');
  }
  if (events.length > MAX_EVENTS_PER_BATCH) {
    throw AppError.badRequest(`Maximum ${MAX_EVENTS_PER_BATCH} events per batch`);
  }

  const deployment = deployments.findById(projectId);
  if (!deployment) {
    throw AppError.badRequest('Unknown projectId');
  }

  const rows = events.map((e) => ({
    id: uuidv4(),
    project_id: projectId,
    event: truncStr(e.event, 256) || 'unknown',
    path: truncStr(e.path, MAX_STRING_LEN),
    referrer: truncStr(e.referrer, MAX_STRING_LEN),
    device: truncStr(e.device, 32),
    session_id: truncStr(e.sessionId, 128),
    metadata: e.metadata || null,
    created_at: clampTimestamp(e.timestamp),
  }));

  projectEvents.createBatch(rows);

  res.json({ ok: true, accepted: rows.length });
}));

router.get('/t.js', (req, res) => {
  if (!snippetCode) {
    return res.status(500).type('text/plain').send('// snippet not available');
  }
  res.set('Content-Type', 'application/javascript');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(snippetCode);
});

module.exports = router;
