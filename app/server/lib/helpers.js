const { AppError } = require('./app-error');

/**
 * Returns null if the request is allowed, throws AppError otherwise.
 * Projects with no user_id are considered public.
 */
function checkProjectAccess(project, req) {
  if (!project.user_id) return;
  if (!req.user || project.user_id !== req.user.id) {
    throw AppError.forbidden('Forbidden');
  }
}

/**
 * Safely parse a JSON string, returning fallback on failure.
 */
function safeParseJson(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

module.exports = { checkProjectAccess, safeParseJson };
