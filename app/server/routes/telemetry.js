const express = require('express');
const { createRateLimit } = require('../lib/rate-limit');
const { AppError } = require('../lib/app-error');
const { asyncHandler } = require('../lib/async-handler');
const {
  validateWaitlist,
  validateEvents,
  addToWaitlist,
  recordEvents,
} = require('../lib/telemetry');

// Two routers so app.js can mount each at its exact path without running
// optionalAuth on every other /api request.
const waitlistRouter = express.Router();
const eventsRouter = express.Router();

const waitlistRateLimit = createRateLimit({
  windowMs: 60_000,
  max: 5,
  message: 'Too many signups from this address. Try again in a minute.',
});

const eventsRateLimit = createRateLimit({
  windowMs: 60_000,
  max: 60,
  message: 'Too many events.',
  keyFn: (req) => (req.body && req.body.sessionId) || req.ip,
});

const smallJson = express.json({ limit: '16kb' });

// POST /api/waitlist  { email, source?, note? }
waitlistRouter.post('/', smallJson, waitlistRateLimit, asyncHandler(async (req, res) => {
  const parsed = validateWaitlist(req.body);
  if (!parsed.ok) throw AppError.badRequest(parsed.error);
  const { created } = await addToWaitlist({ ...parsed.value, userId: req.user?.id || null });
  res.status(created ? 201 : 200).json({ ok: true, created });
}));

// POST /api/events  { sessionId, events: [{ event, projectId?, path?, referrer?, metadata? }] }
eventsRouter.post('/', smallJson, eventsRateLimit, asyncHandler(async (req, res) => {
  const parsed = validateEvents(req.body);
  if (!parsed.ok) throw AppError.badRequest(parsed.error);
  const n = await recordEvents({ ...parsed.value, userId: req.user?.id || null });
  res.status(202).json({ ok: true, recorded: n });
}));

module.exports = { waitlistRouter, eventsRouter };
