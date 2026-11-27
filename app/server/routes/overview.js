'use strict';

// /api/projects/:id/overview — the project overview and decision log
// (Milestone 7). Mounted behind requireAuth + the memberships middleware.

const express = require('express');
const { deployments } = require('../lib/db');
const { AppError } = require('../lib/app-error');
const { asyncHandler } = require('../lib/async-handler');
const { createRateLimit } = require('../lib/rate-limit');
const { checkProjectAccess } = require('../lib/helpers');
const overview = require('../services/overview');

const byUser = (req) => req.user?.id || req.ip;
const readLimit = createRateLimit({ windowMs: 60000, max: 60, keyFn: byUser, message: 'Too many requests. Try again in a minute.' });
const exportLimit = createRateLimit({ windowMs: 60000, max: 10, keyFn: byUser, message: 'Too many downloads. Try again in a minute.' });

/**
 * @param {object} [opts]
 * @param {object} [opts.deps] overrides for the overview service deps (tests)
 */
function createOverviewRoutes({ deps = null } = {}) {
  const router = express.Router({ mergeParams: true });
  const serviceDeps = () => ({ ...overview.defaultDeps(), ...(deps || {}) });

  async function loadProject(req) {
    if (!req.user) throw AppError.unauthorized('Sign in to see this project.');
    const project = await (deps?.deployments || deployments).findById(req.params.id);
    if (!project) throw AppError.notFound('Project not found');
    checkProjectAccess(project, req);
    return project;
  }

  router.get('/', readLimit, asyncHandler(async (req, res) => {
    const project = await loadProject(req);
    res.set('Cache-Control', 'private, no-store');
    res.json(await overview.getOverview({ project, user: req.user }, serviceDeps()));
  }));

  router.get('/decisions', readLimit, asyncHandler(async (req, res) => {
    const project = await loadProject(req);
    res.set('Cache-Control', 'private, no-store');
    res.json(await overview.getDecisionLog({ project, user: req.user }, serviceDeps()));
  }));

  // The decision log as a Markdown file to download.
  router.get('/decisions.md', exportLimit, asyncHandler(async (req, res) => {
    const project = await loadProject(req);
    const d = serviceDeps();
    const log = await overview.getDecisionLog({ project, user: req.user }, d);
    const now = typeof d.now === 'function' ? d.now() : new Date();
    const file = `takeoff-decisions-${String(project.repo || 'project').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 60)}-${now.toISOString().slice(0, 10)}.md`;
    res.set('Content-Type', 'text/markdown; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${file}"`);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'private, no-store');
    res.send(overview.decisionLogMarkdown(project, log, { now }));
  }));

  return router;
}

module.exports = { createOverviewRoutes };
