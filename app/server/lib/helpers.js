const { AppError } = require('./app-error');

/**
 * Parse stringified JSON fields on a project row back into objects.
 * @param {object} project - DB row
 * @param {string[]} fields - column names that may contain JSON strings
 */
function parseJsonFields(project, fields) {
  const parsed = { ...project };
  for (const field of fields) {
    if (parsed[field] && typeof parsed[field] === 'string') {
      try { parsed[field] = JSON.parse(parsed[field]); } catch {}
    }
  }
  return parsed;
}

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

module.exports = { parseJsonFields, checkProjectAccess, safeParseJson };
