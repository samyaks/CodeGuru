'use strict';

// /api/projects/:id/drift — the drift review (Milestone 5).
// Mounted behind requireAuth + the memberships middleware.

const express = require('express');
const { deployments } = require('../lib/db');
const { AppError } = require('../lib/app-error');
const { asyncHandler } = require('../lib/async-handler');
const { createRateLimit } = require('../lib/rate-limit');
const { checkProjectAccess } = require('../lib/helpers');
const drift = require('../services/drift');

const byUser = (req) => req.user?.id || req.ip;
const readLimit = createRateLimit({ windowMs: 60000, max: 60, keyFn: byUser, message: 'Too many requests. Try again in a minute.' });
const writeLimit = createRateLimit({ windowMs: 60000, max: 10, keyFn: byUser, message: 'Too many decisions. Try again in a minute.' });

/**
 * @param {object} [opts]
 * @param {object} [opts.deps] overrides for the drift service deps (tests)
 */
function createDriftRoutes({ deps = null } = {}) {
  const router = express.Router({ mergeParams: true });
  const serviceDeps = () => ({ ...drift.defaultDeps(), ...(deps || {}) });

  async function loadProject(req) {
    if (!req.user) throw AppError.unauthorized('Sign in to see this project.');
    const project = await (deps?.deployments || deployments).findById(req.params.id);
    if (!project) throw AppError.notFound('Project not found');
    checkProjectAccess(project, req);
    return project;
  }

  router.get('/', readLimit, asyncHandler(async (req, res) => {
    const project = await loadProject(req);
    res.json(await drift.listDrift({ project, user: req.user }, serviceDeps()));
  }));

  router.get('/:pr', readLimit, asyncHandler(async (req, res) => {
    const project = await loadProject(req);
    res.json(await drift.getReview({ project, user: req.user, prNumber: req.params.pr }, serviceDeps()));
  }));

  const act = (fn) => asyncHandler(async (req, res) => {
    const project = await loadProject(req);
    res.json(await fn({ project, user: req.user, prNumber: req.params.pr, body: req.body || {} }, serviceDeps()));
  });
  router.post('/:pr/accept', writeLimit, act(drift.accept));
  router.post('/:pr/send-back', writeLimit, act(drift.sendBack));
  router.post('/decisions/:did/retry', writeLimit, asyncHandler(async (req, res) => {
    const project = await loadProject(req);
    res.json(await drift.retryDecision({ project, user: req.user, decisionId: req.params.did }, serviceDeps()));
  }));

  return router;
}

module.exports = { createDriftRoutes };
