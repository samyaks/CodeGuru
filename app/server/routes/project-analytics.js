const express = require('express');
const { deployments, projectEvents } = require('../lib/db');
const { createRateLimit } = require('../lib/rate-limit');
const { AppError } = require('../lib/app-error');
const { asyncHandler } = require('../lib/async-handler');
const { checkProjectAccess } = require('../lib/helpers');

const router = express.Router({ mergeParams: true });

const readLimit = createRateLimit({
  windowMs: 60000,
  max: 30,
  message: 'Too many analytics requests. Please try again in a minute.',
});

function sinceDate(period) {
  const now = new Date();
  if (period === 'today') {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  }
  if (period === 'week') {
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  }
  // month = 30 days
  return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
}

async function loadProject(req) {
  const project = await deployments.findById(req.params.projectId);
  if (!project) throw AppError.notFound('Project not found');
  checkProjectAccess(project, req);
  return project;
}

// GET / — Overview stats
router.get('/', readLimit, asyncHandler(async (req, res) => {
  const project = await loadProject(req);
  const projectId = project.id;

  const today = sinceDate('today');
  const week = sinceDate('week');
  const month = sinceDate('month');

  const { visitors, pageviews } = await projectEvents.overviewStats(projectId, { today, week, month });

  const [pathRows, referrerRows, eventRows] = await Promise.all([
    projectEvents.aggregateByPath(projectId, { since: month }),
    projectEvents.aggregateByReferrer(projectId, { since: month }),
    projectEvents.aggregateByEvent(projectId, { since: month }),
  ]);
  const topPages = pathRows.slice(0, 10);
  const topReferrers = referrerRows.slice(0, 10);
  const topEvents = eventRows.slice(0, 10);

  const hasData = visitors.month > 0 || pageviews.month > 0;

  res.json({ visitors, pageviews, topPages, topReferrers, topEvents, hasData });
}));

// GET /events — Raw event list (paginated)
router.get('/events', readLimit, asyncHandler(async (req, res) => {
  await loadProject(req);
  const projectId = req.params.projectId;

  const { event, since, limit } = req.query;
  const opts = {};
  if (event) opts.event = event;
  if (since) opts.since = since;
  opts.limit = Math.min(parseInt(limit, 10) || 100, 500);

  const events = await projectEvents.findByProjectId(projectId, opts);
  res.json(events);
}));

// GET /setup — Setup instructions and status
router.get('/setup', readLimit, asyncHandler(async (req, res) => {
  await loadProject(req);
  const projectId = req.params.projectId;

  const eventCount = await projectEvents.countByProject(projectId, {});
  const domain = req.protocol + '://' + req.get('host');

  res.json({
    projectId,
    hasEvents: eventCount > 0,
    eventCount,
    scriptTag: `<script src="${domain}/t.js" data-project="${projectId}"></script>`,
    npmInstall: 'npm install @codeguru/analytics',
    npmUsage: `import { init } from '@codeguru/analytics';\ninit('${projectId}');`,
  });
}));

module.exports = router;
