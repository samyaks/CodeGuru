'use strict';

// /api/projects/:id/code-index — where Ask's stored copy of the code stands
// (Milestone 8). Members see the status; only the owner can ask for a fresh
// build. File text is never served here. Mounted behind requireAuth + the
// memberships middleware.

const express = require('express');
const { deployments, codeIndex } = require('../lib/db');
const { AppError } = require('../lib/app-error');
const { asyncHandler } = require('../lib/async-handler');
const { createRateLimit } = require('../lib/rate-limit');
const { checkProjectAccess, checkProjectOwner } = require('../lib/helpers');
const { isAskEnabled } = require('../services/ask/config');

const byUser = (req) => req.user?.id || req.ip;
const readLimit = createRateLimit({ windowMs: 60000, max: 60, keyFn: byUser, message: 'Too many requests. Try again in a minute.' });
// Per project: a full build downloads the whole repo.
const rebuildLimit = createRateLimit({ windowMs: 60 * 60 * 1000, max: 3, keyFn: (req) => `project:${req.params.id}`, message: 'The code index can be rebuilt 3 times an hour. Try again later.' });
// Per owner, across all their projects, so many projects can't add up to a flood.
const ownerRebuildLimit = createRateLimit({ windowMs: 60 * 60 * 1000, max: 10, keyFn: (req) => `owner:${byUser(req)}`, message: 'You have rebuilt code indexes 10 times this hour. Try again later.' });

function publicStatus(row) {
  if (!row) return { status: 'none' };
  return {
    status: row.status,
    working: !!row.working,
    branch: row.branch,
    indexedSha: row.indexed_sha,
    fileCount: Number(row.file_count) || 0,
    textBytes: Number(row.text_bytes) || 0,
    skippedCount: Number(row.skipped_count) || 0,
    lastFullAt: row.last_full_at,
    lastUpdateAt: row.last_update_at,
    error: row.status === 'failed' || row.status === 'too_large' ? row.error : null,
  };
}

/**
 * @param {object} [opts]
 * @param {object} [opts.deps] { deployments, store, index, enabled } overrides (tests)
 */
function createCodeIndexRoutes({ deps = {} } = {}) {
  const router = express.Router({ mergeParams: true });
  const projects = () => deps.deployments || deployments;
  const store = () => deps.store || codeIndex;
  const index = () => deps.index || require('../services/code-index').getCodeIndex();
  const enabled = () => (deps.enabled ? deps.enabled() : isAskEnabled(process.env));

  async function loadProject(req) {
    if (!req.user) throw AppError.unauthorized('Sign in to see this project.');
    if (!enabled()) throw AppError.notFound('Not found');
    const project = await projects().findById(req.params.id);
    if (!project) throw AppError.notFound('Project not found');
    // A project with no owner is public to read, but has no code index.
    if (!project.user_id) throw AppError.notFound('This project has no code index.');
    checkProjectAccess(project, req);
    return project;
  }

  router.get('/', readLimit, asyncHandler(async (req, res) => {
    const project = await loadProject(req);
    res.set('Cache-Control', 'private, no-store');
    res.json(publicStatus(await store().status(project.id)));
  }));

  router.post('/rebuild', readLimit, asyncHandler(async (req, res) => {
    const project = await loadProject(req);
    checkProjectOwner(project, req);
    // Counted only once the owner check passed, so members can't use up the owner's rebuilds.
    ownerRebuildLimit(req, res, () => rebuildLimit(req, res, () => {
      index().rebuild(project).catch((err) => console.warn('code index rebuild failed:', err.message));
      res.status(202).json({ started: true });
    }));
  }));

  return router;
}

module.exports = { createCodeIndexRoutes, publicStatus };
