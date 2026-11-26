'use strict';

// Committing actions: anything Takeoff does that writes to the repo
// (committing an agreement, accepting drift into takeoff.yaml). Viewing needs
// no GitHub account; writing does. A member who can't write (no GitHub
// connected, or no write access on the repo) gets a recommendation instead,
// and any member with write access confirms it in one click, which runs it.
//
// Actions register here with { summarize(payload), run({ project, payload, actor }) }.

const crypto = require('crypto');
const { AppError } = require('../../lib/app-error');
const { githubIdentity } = require('./identity');

const WRITE_PERMISSIONS = new Set(['admin', 'maintain', 'write']);
const actions = new Map();

function registerCommittingAction(type, { summarize, run }) {
  if (typeof type !== 'string' || !/^[a-z][a-z0-9_.]{1,60}$/.test(type)) throw new Error(`bad action type: ${type}`);
  if (typeof run !== 'function' || typeof summarize !== 'function') throw new Error('an action needs summarize() and run()');
  actions.set(type, { summarize, run });
}

function getAction(type) {
  const action = typeof type === 'string' ? actions.get(type) : null;
  if (!action) throw AppError.badRequest(`Unknown action: ${String(type).slice(0, 60)}`);
  return action;
}

function defaultDeps() {
  const { recommendations, userGithubLinks } = require('../../lib/db');
  const { getGithubApp } = require('../../lib/github-app');
  return {
    recommendations,
    userGithubLinks,
    clientForInstallation: (id, repo) => getGithubApp().clientForInstallation(id, { repo }),
    newId: () => crypto.randomUUID(),
  };
}

/**
 * Whether `user` can write to the project's repo, checked live with GitHub
 * through the project's App installation (a revoked collaborator can't
 * commit, though they keep viewing).
 * @returns {Promise<{ canWrite: boolean, githubConnected: boolean, githubLogin: string|null, reason: string|null }>}
 */
async function writeAccess(project, user, deps) {
  const identity = await githubIdentity(user, deps);
  if (!identity) return { canWrite: false, githubConnected: false, githubLogin: null, reason: 'github_not_connected' };
  const base = { githubConnected: true, githubLogin: identity.githubLogin };
  if (!project.github_installation_id) return { ...base, canWrite: false, reason: 'app_not_installed' };
  const gh = deps.clientForInstallation(Number(project.github_installation_id), project.repo);
  const { permission, canPush, githubUserId } = await gh.fetchCollaboratorPermission(project.owner, project.repo, identity.githubLogin);
  // A login can be renamed and taken by someone else: when we know the
  // account id, it must be the same account.
  if (identity.githubUserId && githubUserId && Number(githubUserId) !== Number(identity.githubUserId)) {
    return { ...base, canWrite: false, reason: 'github_account_changed' };
  }
  const canWrite = !!canPush || WRITE_PERMISSIONS.has(permission);
  return { ...base, canWrite, reason: canWrite ? null : 'no_write_access' };
}

const publicRecommendation = (r) => r && ({
  id: r.id,
  actionType: r.action_type,
  summary: r.summary,
  status: r.status,
  createdBy: r.created_by,
  createdAt: r.created_at,
  decidedBy: r.decided_by || null,
  decidedAt: r.decided_at || null,
  error: r.error || null,
});

/**
 * Run a committing action, or record it as a recommendation when the member
 * can't write to the repo.
 */
async function performCommittingAction({ project, user, type, payload = {} }, deps = defaultDeps()) {
  const action = getAction(type);
  const summary = String(action.summarize(payload) || type).slice(0, 500);
  let access;
  try {
    access = await writeAccess(project, user, deps);
  } catch (err) {
    // Can't ask GitHub right now: keep the change as a recommendation rather than lose it.
    console.warn('[team] write access check failed:', err.message);
    const identity = await githubIdentity(user, deps);
    access = { canWrite: false, githubConnected: !!identity, githubLogin: identity?.githubLogin || null, reason: 'github_check_failed' };
  }
  if (access.canWrite) {
    const result = await action.run({ project, payload, actor: { userId: user.id, githubLogin: access.githubLogin } });
    return { status: 'done', result: result ?? null };
  }
  const rec = await deps.recommendations.create({
    id: deps.newId(), projectId: project.id, actionType: type, payload, summary, createdBy: user.id,
  });
  return {
    status: 'recommended',
    recommendation: publicRecommendation(rec),
    githubConnected: access.githubConnected,
    reason: access.reason,
  };
}

/** A member with write access runs a pending recommendation. */
async function confirmRecommendation({ project, user, recommendationId }, deps = defaultDeps()) {
  const existing = await deps.recommendations.get(project.id, recommendationId);
  if (!existing) throw AppError.notFound('Recommendation not found');
  const action = getAction(existing.action_type);
  const access = await writeAccess(project, user, deps);
  if (!access.canWrite) {
    const err = AppError.forbidden(access.githubConnected
      ? 'Confirming needs write access to the repo on GitHub.'
      : 'Connect GitHub to confirm this. Confirming needs write access to the repo.');
    err.code = access.githubConnected ? 'GITHUB_WRITE_REQUIRED' : 'GITHUB_NOT_CONNECTED';
    throw err;
  }
  const rec = await deps.recommendations.claimForConfirm(project.id, recommendationId, user.id);
  if (!rec) throw AppError.conflict('This recommendation was already confirmed or dismissed.');
  let result;
  try {
    result = await action.run({ project, payload: rec.payload || {}, actor: { userId: user.id, githubLogin: access.githubLogin } });
  } catch (err) {
    // The action failed: back to pending with the reason, so it stays on the
    // list and can be tried again. An action that can never run now (err.final)
    // closes as failed instead, so it doesn't stay on the list for good.
    const reason = String(err.message || err).slice(0, 1000);
    if (err.final) await deps.recommendations.finish(rec.id, { status: 'failed', error: reason }).catch(() => {});
    else await deps.recommendations.release(rec.id, reason).catch(() => {});
    throw err;
  }
  // The action already ran (it may have written to the repo), so a failure
  // from here on must not put it back to pending, or the next confirm would
  // run it again at once. Try the write once more; if it still fails, the
  // claim stays held like a crash mid-run, so actions must be idempotent.
  const outcome = { status: 'confirmed', result: result ?? null };
  const done = await deps.recommendations.finish(rec.id, outcome)
    .catch(() => deps.recommendations.finish(rec.id, outcome));
  return publicRecommendation(done || { ...rec, status: 'confirmed' });
}

/** The member who recommended it, the project owner, or anyone with write access can dismiss it. */
async function dismissRecommendation({ project, user, recommendationId }, deps = defaultDeps()) {
  const existing = await deps.recommendations.get(project.id, recommendationId);
  if (!existing) throw AppError.notFound('Recommendation not found');
  const isOwner = !!(project.user_id && project.user_id === user.id);
  if (existing.created_by !== user.id && !isOwner) {
    let access;
    try {
      access = await writeAccess(project, user, deps);
    } catch (err) {
      console.warn('[team] write access check failed:', err.message);
      const e = new AppError('Could not check your GitHub access just now. Try again in a minute.', 503, 'GITHUB_UNAVAILABLE');
      throw e;
    }
    if (!access.canWrite) {
      throw AppError.forbidden('Only the person who recommended this, the project owner, or someone with write access to the repo can dismiss it.');
    }
  }
  const rec = await deps.recommendations.dismiss(project.id, recommendationId, user.id);
  if (!rec) throw AppError.conflict('This recommendation was already confirmed or dismissed.');
  return publicRecommendation(rec);
}

module.exports = {
  registerCommittingAction,
  performCommittingAction,
  confirmRecommendation,
  dismissRecommendation,
  writeAccess,
  publicRecommendation,
  WRITE_PERMISSIONS,
  _actions: actions,
};
