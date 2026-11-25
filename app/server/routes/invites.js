'use strict';

// /api/invites/:token — the invite page's API (Milestone 2). Viewing works
// signed out; accepting needs a signed-in user who matches the invite.

const express = require('express');
const { AppError } = require('../lib/app-error');
const { asyncHandler } = require('../lib/async-handler');
const { createRateLimit } = require('../lib/rate-limit');
const members = require('../services/team/members');

const viewLimit = createRateLimit({ windowMs: 60000, max: 30, message: 'Too many requests. Try again in a minute.' });
const linkLimit = createRateLimit({ windowMs: 10 * 60000, max: 5, message: 'Too many sign-in emails. Try again in a few minutes.' });
const acceptLimit = createRateLimit({ windowMs: 60000, max: 10, message: 'Too many tries. Try again in a minute.' });

function createInviteRoutes({ sendSignInLink = null, deps = null } = {}) {
  const router = express.Router();
  const inviteDeps = () => ({ ...members.defaultDeps(), sendSignInLink, ...(deps || {}) });
  // Invite links are secrets: never let a cache or referrer keep them.
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });

  router.get('/:token', viewLimit, asyncHandler(async (req, res) => {
    res.json(await members.previewInvite({ token: req.params.token, user: req.user || null }, inviteDeps()));
  }));

  router.post('/:token/sign-in-link', linkLimit, asyncHandler(async (req, res) => {
    res.json(await members.requestSignInLink({ token: req.params.token }, inviteDeps()));
  }));

  router.post('/:token/accept', acceptLimit, asyncHandler(async (req, res) => {
    if (!req.user) throw AppError.unauthorized('Sign in to accept this invite.');
    res.json(await members.acceptInvite({ token: req.params.token, user: req.user, labels: req.body?.labels }, inviteDeps()));
  }));

  return router;
}

module.exports = { createInviteRoutes };
