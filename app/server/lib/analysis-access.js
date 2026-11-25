'use strict';

// Who may read or manage an `analyses` row. Takeoff reuses the project id as
// the analysis id, and its analysis row can predate the project being claimed
// (deploying claims an ownerless project), so the owner is the analysis's
// user_id or else the project's. With no owner at all (a signed-out analysis)
// the row stays open, as it always was.

const { AppError } = require('./app-error');

// Columns never sent to the browser: Railway's OAuth tokens.
const SECRET_COLUMNS = ['railway_access_token', 'railway_refresh_token', 'railway_token_expires_at'];

async function analysisOwnerId(analysis, deps) {
  if (analysis.user_id) return analysis.user_id;
  const project = await deps.deployments.findById(analysis.id).catch(() => null);
  return project?.user_id || null;
}

function isOwner(ownerId, req) {
  return !!(req.user && ownerId && req.user.id === ownerId);
}

function isMember(analysis, req) {
  return !!(req.user && req.memberProjectIds instanceof Set && req.memberProjectIds.has(String(analysis.id)));
}

/** Reading: the owner or a member of the project. Others get 404, so ids aren't confirmed. */
async function checkAnalysisView(analysis, req, deps) {
  if (!analysis) throw AppError.notFound('Analysis not found');
  const ownerId = await analysisOwnerId(analysis, deps);
  if (!ownerId || isOwner(ownerId, req) || isMember(analysis, req)) return analysis;
  throw AppError.notFound('Analysis not found');
}

/** Connecting or changing accounts on it: the owner only. */
async function checkAnalysisManage(analysis, req, deps) {
  if (!analysis) throw AppError.notFound('Analysis not found');
  const ownerId = await analysisOwnerId(analysis, deps);
  if (!ownerId || isOwner(ownerId, req)) return analysis;
  if (isMember(analysis, req)) throw AppError.forbidden('Only the project owner can do this.');
  throw AppError.notFound('Analysis not found');
}

function publicAnalysis(analysis) {
  if (!analysis) return analysis;
  const out = { ...analysis };
  for (const c of SECRET_COLUMNS) delete out[c];
  return out;
}

module.exports = { checkAnalysisView, checkAnalysisManage, publicAnalysis, analysisOwnerId, SECRET_COLUMNS };
