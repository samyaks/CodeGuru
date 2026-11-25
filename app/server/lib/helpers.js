const { AppError } = require('./app-error');

/**
 * Viewing and working on a project: its owner or any member. Throws AppError
 * otherwise. Projects with no user_id are considered public.
 *
 * Members come from `req.memberProjectIds`, a Set the memberships middleware
 * loads after auth (lib/memberships.js).
 */
function checkProjectAccess(project, req) {
  if (!project.user_id) return;
  if (req.user && project.user_id === req.user.id) return;
  if (req.user && req.memberProjectIds instanceof Set && req.memberProjectIds.has(String(project.id))) return;
  throw AppError.forbidden('Forbidden');
}

/**
 * Owner-only actions (delete the project, deploy, secrets, repo webhooks,
 * public share links). Members can view everything but not these.
 */
function checkProjectOwner(project, req) {
  if (!project.user_id) return;
  if (!req.user || project.user_id !== req.user.id) {
    throw AppError.forbidden('Only the project owner can do this.');
  }
}

function isProjectOwner(project, req) {
  return !!(req.user && project.user_id && project.user_id === req.user.id);
}

/**
 * Safely parse a JSON string, returning fallback on failure.
 */
function safeParseJson(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

module.exports = { checkProjectAccess, checkProjectOwner, isProjectOwner, safeParseJson };
