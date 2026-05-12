// v2 Security Report public share links — Phase 3 slice (b).
//
// Three routers, each with a different auth posture:
//
//   ownerRouter   POST   /                  (auth)   create a new share
//                 GET    /                  (auth)   list active shares
//                 mounted at /api/v2/projects/:id/security-shares
//
//   slugRouter    DELETE /:slug             (auth)   revoke a share
//                 mounted at /api/v2/security-shares
//
//   publicRouter  GET    /:slug             (none)   fetch the report
//                 mounted at /api/v2/security-shared
//
// Why split: the project-scoped owner router uses `mergeParams` so it
// can read `req.params.id` and authorize against `deployments`. The
// slug-scoped revoke router needs to look the share up first and
// resolve to its project, which is cleaner as a top-level mount. The
// public router has zero auth — its whole job is to be reachable by
// anyone holding the link.

const express = require('express');
const { suggestions, deployments, securityShares } = require('../../lib/db');
const { AppError } = require('../../lib/app-error');
const { asyncHandler } = require('../../lib/async-handler');
const { checkProjectAccess } = require('../../lib/helpers');
const { createRateLimit } = require('../../lib/rate-limit');
const { toGap, groupGaps } = require('../../services/v2/gap-mapper');
const { computeSecurityScore } = require('../../services/security/score');
const { listDetectorNames } = require('../../services/security');
const crypto = require('crypto');

const TOP_RISKS_LIMIT = 5;

// ── Rate limits ────────────────────────────────────────────────────
//
// Stricter on the create endpoint (an authed user spamming new links
// is unusual and worth pushing back on); generous on the public read
// endpoint to keep legitimate sharing snappy. The public read is
// keyed on IP, so a single share post going viral isn't kneecapped
// by one bot — only that bot is rate-limited.

const createLimit = createRateLimit({
  windowMs: 60_000,
  max: 10,
  message: 'Too many share-link requests. Please slow down.',
});

const ownerReadLimit = createRateLimit({
  windowMs: 60_000,
  max: 60,
  message: 'Too many requests. Please try again in a minute.',
});

const revokeLimit = createRateLimit({
  windowMs: 60_000,
  max: 30,
  message: 'Too many revoke requests. Please slow down.',
});

const publicLimit = createRateLimit({
  windowMs: 60_000,
  max: 60,
  message: 'Too many requests. Please try again in a minute.',
});

// ── Helpers ────────────────────────────────────────────────────────

function pruneInternalFields(gap) {
  const {
    rawCategory: _r,
    priority: _p,
    type: _t,
    affectedFiles: _af,
    jobLinks: _jl,
    mapEntityId: _me,
    mapJobId: _mj,
    ...publicFields
  } = gap;
  return publicFields;
}

async function loadProjectAndAuthorize(req) {
  const project = await deployments.findById(req.params.id);
  if (!project) throw AppError.notFound('Project not found');
  checkProjectAccess(project, req);
  return project;
}

function publicShareDto(share) {
  return {
    slug: share.slug,
    redactRepo: !!share.redact_repo,
    expiresAt: share.expires_at || null,
    createdAt: share.created_at,
  };
}

/**
 * Build the public payload for a redacted-or-not share view. Centralized
 * so the public read route and the create-then-return-preview path
 * stay in lockstep — a redaction bug here is a privacy bug, so there
 * must be exactly one place that decides what the world sees.
 */
async function buildSharedReport(share, project) {
  const unaddressed = await suggestions.findV2SecurityGapsByProjectId(project.id);
  const { score, severityBreakdown, totalUnaddressed } = computeSecurityScore(unaddressed);
  const allMapped = unaddressed.map(toGap);

  const topRisks = allMapped.slice(0, TOP_RISKS_LIMIT).map(pruneInternalFields);

  // Group the full set so the shared view can render the collapsible
  // "All security gaps" section without a second fetch (the v2 /gaps
  // endpoint requires auth and we can't hit it from a public client).
  const grouped = groupGaps(allMapped);
  const groupedPublic = {
    broken:  grouped.broken.map(pruneInternalFields),
    missing: grouped.missing.map(pruneInternalFields),
    infra:   grouped.infra.map(pruneInternalFields),
  };

  // Redaction. We hide the strings that identify the project (repo URL,
  // owner, repo name, free-form description) and replace the display
  // name with a stable, opaque tag derived from the slug. We do NOT
  // redact file paths in findings — those are part of the report's
  // signal, and standard project paths like `src/auth/login.js` don't
  // identify a specific company. If a project genuinely needs file
  // paths hidden, that's a different feature.
  const projectDto = share.redact_repo
    ? {
        // Same slug → same tag, so re-opening the link shows a stable
        // identity and screenshots remain interpretable.
        name: `Project · ${
          crypto.createHash('sha256').update(share.slug).digest('hex').slice(0, 6)
        }`,
        repo: null,
        repoUrl: null,
        framework: null,
        description: null,
        lastAnalyzed: project.updated_at || null,
      }
    : {
        name: project.repo || project.repo_url || 'Project',
        repo: project.repo || null,
        repoUrl: project.repo_url || null,
        framework: project.framework || null,
        description: project.description || null,
        lastAnalyzed: project.updated_at || null,
      };

  return {
    share: publicShareDto(share),
    project: projectDto,
    score,
    severityBreakdown,
    totalUnaddressed,
    topRisks,
    allSecurityGaps: groupedPublic,
    detectors: listDetectorNames(),
  };
}

// ── ownerRouter ────────────────────────────────────────────────────

const ownerRouter = express.Router({ mergeParams: true });

// POST /api/v2/projects/:id/security-shares
//
// Mint a new share link. Authed callers only. The created_by column
// records the caller's user id (or null on a Supabase-disabled
// deployment) for later auditing — the revoke endpoint authorizes off
// the project's user_id, not this column, so a project owner can
// always revoke a link their teammate created.
ownerRouter.post('/', createLimit, asyncHandler(async (req, res) => {
  const project = await loadProjectAndAuthorize(req);
  const redactRepo = req.body && typeof req.body.redactRepo === 'boolean'
    ? req.body.redactRepo
    : false;
  const share = await securityShares.create({
    projectId: project.id,
    createdBy: req.user?.id || null,
    redactRepo,
  });
  res.status(201).json({ share: publicShareDto(share) });
}));

// GET /api/v2/projects/:id/security-shares
//
// List active shares for the project. The modal calls this on open.
ownerRouter.get('/', ownerReadLimit, asyncHandler(async (req, res) => {
  const project = await loadProjectAndAuthorize(req);
  const rows = await securityShares.listActiveByProjectId(project.id);
  res.json({ shares: rows.map(publicShareDto) });
}));

// ── slugRouter ─────────────────────────────────────────────────────

const slugRouter = express.Router();

// DELETE /api/v2/security-shares/:slug
//
// Revoke a share. The caller must have access to the share's project.
// Idempotent: a 404 means the slug never existed; an already-revoked
// slug returns 200 with `{ revoked: true, alreadyRevoked: true }`
// rather than a confusing 404 — helps clients with stale UI state.
slugRouter.delete('/:slug', revokeLimit, asyncHandler(async (req, res) => {
  const existing = await securityShares.findBySlug(req.params.slug);
  if (!existing) throw AppError.notFound('Share link not found');

  const project = await deployments.findById(existing.project_id);
  if (!project) throw AppError.notFound('Share link not found');
  checkProjectAccess(project, req);

  if (existing.revoked_at) {
    return res.json({ revoked: true, alreadyRevoked: true });
  }
  const updated = await securityShares.revoke(req.params.slug);
  if (!updated) {
    // Lost a race against a concurrent revoke — treat as success.
    return res.json({ revoked: true, alreadyRevoked: true });
  }
  res.json({ revoked: true, alreadyRevoked: false });
}));

// ── publicRouter ───────────────────────────────────────────────────

const publicRouter = express.Router();

// GET /api/v2/security-shared/:slug
//
// PUBLIC. No auth required. Returns the bundled report payload (project
// metadata + score + breakdown + top risks + all security gaps +
// detectors). Honors the share's redact_repo flag.
//
// Status semantics:
//   200 — active share, payload returned
//   404 — slug never existed
//   410 — slug existed but is revoked or expired (Gone)
publicRouter.get('/:slug', publicLimit, asyncHandler(async (req, res) => {
  const slug = req.params.slug;

  const active = await securityShares.findActiveBySlug(slug);
  if (!active) {
    const any = await securityShares.findBySlug(slug);
    if (!any) throw AppError.notFound('Share link not found');
    // Existed but is revoked or expired. 410 is the precise status.
    throw new AppError('This share link is no longer active', 410, 'GONE');
  }

  const project = await deployments.findById(active.project_id);
  if (!project) {
    // Project was deleted but the share row outlived the cascade. In
    // practice the FK ON DELETE CASCADE prevents this, but guard
    // anyway because a 500 here would be a poor UX for a public link.
    throw new AppError('This share link is no longer active', 410, 'GONE');
  }

  const payload = await buildSharedReport(active, project);
  res.json(payload);
}));

module.exports = { ownerRouter, slugRouter, publicRouter };
