'use strict';

// /api/projects/:id/team — members, invites and recommendations (Milestone 2).
// Mounted behind requireAuth + the memberships middleware.

const express = require('express');
const { deployments } = require('../lib/db');
const { AppError } = require('../lib/app-error');
const { asyncHandler } = require('../lib/async-handler');
const { createRateLimit } = require('../lib/rate-limit');
const { checkProjectAccess } = require('../lib/helpers');
const members = require('../services/team/members');
const committing = require('../services/team/committing');
const { recommendations } = require('../lib/db');

const byUser = (req) => req.user?.id || req.ip;
const readLimit = createRateLimit({ windowMs: 60000, max: 60, keyFn: byUser, message: 'Too many requests. Try again in a minute.' });
const writeLimit = createRateLimit({ windowMs: 60000, max: 20, keyFn: byUser, message: 'Too many changes. Try again in a minute.' });
const inviteLimit = createRateLimit({ windowMs: 60 * 60000, max: 30, keyFn: byUser, message: 'Too many invites this hour. Try again later.' });

/**
 * @param {object} [opts]
 * @param {(email: string, redirectTo: string) => Promise<void>} [opts.sendSignInLink]
 * @param {object} [opts.deps] overrides for the member service deps (tests)
 */
function createTeamRoutes({ sendSignInLink = null, deps = null, settleAgreements } = {}) {
  const router = express.Router({ mergeParams: true });
  // After someone leaves, proposals everyone left has agreed to are accepted.
  const settle = settleAgreements !== undefined
    ? settleAgreements
    : (deps ? null : (args) => require('../services/agreements').settleOpen(args));
  const teamDeps = () => ({ ...members.defaultDeps(), sendSignInLink, ...(deps || {}) });

  async function loadProject(req) {
    if (!req.user) throw AppError.unauthorized('Sign in to see this project.');
    const project = await (deps?.deployments || deployments).findById(req.params.id);
    if (!project) throw AppError.notFound('Project not found');
    checkProjectAccess(project, req);
    return project;
  }

  router.get('/', readLimit, asyncHandler(async (req, res) => {
    const project = await loadProject(req);
    const d = teamDeps();
    const team = await members.getTeam({ project, user: req.user }, d);
    const recs = await (d.recommendations || recommendations).listPending(project.id);
    res.json({ ...team, recommendations: recs.map(committing.publicRecommendation) });
  }));

  router.post('/invites', inviteLimit, asyncHandler(async (req, res) => {
    const project = await loadProject(req);
    const out = await members.createInvite({ project, user: req.user, body: req.body }, teamDeps());
    res.status(201).json(out);
  }));

  router.delete('/invites/:inviteId', writeLimit, asyncHandler(async (req, res) => {
    const project = await loadProject(req);
    res.json(await members.revokeInvite({ project, user: req.user, inviteId: req.params.inviteId }, teamDeps()));
  }));

  router.patch('/me', writeLimit, asyncHandler(async (req, res) => {
    const project = await loadProject(req);
    res.json(await members.setMyLabels({ project, user: req.user, labels: req.body?.labels }, teamDeps()));
  }));

  router.delete('/members/:userId', writeLimit, asyncHandler(async (req, res) => {
    const project = await loadProject(req);
    const out = await members.removeMember({ project, user: req.user, memberId: req.params.userId }, teamDeps());
    if (settle) {
      // The commit runs as whoever is still here: the remover, else the owner.
      const actor = req.params.userId !== req.user.id ? req.user : (project.user_id ? { id: project.user_id } : null);
      if (actor) void Promise.resolve(settle({ project, actor })).catch(() => {});
    }
    res.json(out);
  }));

  router.post('/recommendations/:rid/confirm', writeLimit, asyncHandler(async (req, res) => {
    const project = await loadProject(req);
    const rec = await committing.confirmRecommendation(
      { project, user: req.user, recommendationId: req.params.rid },
      deps?.committing || undefined
    );
    res.json({ recommendation: rec });
  }));

  router.post('/recommendations/:rid/dismiss', writeLimit, asyncHandler(async (req, res) => {
    const project = await loadProject(req);
    const rec = await committing.dismissRecommendation(
      { project, user: req.user, recommendationId: req.params.rid },
      deps?.committing || undefined
    );
    res.json({ recommendation: rec });
  }));

  return router;
}

module.exports = { createTeamRoutes };
