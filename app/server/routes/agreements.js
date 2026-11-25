'use strict';

// /api/projects/:id/agreements — async team agreements (Milestone 3).
// Mounted behind requireAuth + the memberships middleware.

const express = require('express');
const { deployments } = require('../lib/db');
const { AppError } = require('../lib/app-error');
const { asyncHandler } = require('../lib/async-handler');
const { createRateLimit } = require('../lib/rate-limit');
const { checkProjectAccess } = require('../lib/helpers');
const agreements = require('../services/agreements');

const byUser = (req) => req.user?.id || req.ip;
const readLimit = createRateLimit({ windowMs: 60000, max: 60, keyFn: byUser, message: 'Too many requests. Try again in a minute.' });
const writeLimit = createRateLimit({ windowMs: 60000, max: 20, keyFn: byUser, message: 'Too many changes. Try again in a minute.' });
const proposeLimit = createRateLimit({ windowMs: 60 * 60000, max: 30, keyFn: byUser, message: 'Too many proposals this hour. Try again later.' });

/**
 * @param {object} [opts]
 * @param {object} [opts.deps] overrides for the agreement service deps (tests)
 */
function createAgreementRoutes({ deps = null } = {}) {
  const router = express.Router({ mergeParams: true });
  const serviceDeps = () => ({ ...agreements.defaultDeps(), ...(deps || {}) });

  async function loadProject(req) {
    if (!req.user) throw AppError.unauthorized('Sign in to see this project.');
    const project = await (deps?.deployments || deployments).findById(req.params.id);
    if (!project) throw AppError.notFound('Project not found');
    checkProjectAccess(project, req);
    return project;
  }

  router.get('/', readLimit, asyncHandler(async (req, res) => {
    const project = await loadProject(req);
    res.json(await agreements.listAgreements({ project, user: req.user }, serviceDeps()));
  }));

  router.post('/', proposeLimit, asyncHandler(async (req, res) => {
    const project = await loadProject(req);
    res.status(201).json(await agreements.propose({ project, user: req.user, body: req.body || {} }, serviceDeps()));
  }));

  const act = (fn) => asyncHandler(async (req, res) => {
    const project = await loadProject(req);
    res.json(await fn({ project, user: req.user, agreementId: req.params.aid, body: req.body || {} }, serviceDeps()));
  });

  router.post('/:aid/vote', writeLimit, act(agreements.vote));
  router.post('/:aid/withdraw', writeLimit, act(agreements.withdraw));
  router.post('/:aid/decide', writeLimit, act(agreements.decide));
  router.post('/:aid/retry-commit', writeLimit, act(agreements.retryCommit));

  return router;
}

module.exports = { createAgreementRoutes };
