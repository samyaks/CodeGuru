/**
 * Decides which GitHub identity reads a repo for a given user.
 *
 *   1. The user granted the Takeoff GitHub App access to the repo
 *      → read as that installation (works for private repos).
 *   2. Otherwise → read with the server's GITHUB_TOKEN, but only if the repo
 *      is public. The server token can see its owner's private repos, so it
 *      must never stand in for the requesting user's own access.
 */

const github = require('@codeguru/github');
const { githubRepoAccess, deployments } = require('../lib/db');
const { getGithubApp } = require('../lib/github-app');
const { AppError } = require('../lib/app-error');

function defaultDeps() {
  return {
    accessStore: githubRepoAccess,
    app: getGithubApp(),
    publicClient: github,
    clearInstallation: (projectId) => deployments.update(projectId, { github_installation_id: null }),
  };
}

function accessError({ userId, appConfigured }) {
  if (!appConfigured) {
    return AppError.forbidden('That repository is private or doesn’t exist. Private repositories aren’t supported yet.');
  }
  if (!userId) {
    return new AppError(
      'That repository is private or doesn’t exist. Sign in with GitHub to scan a private repository.',
      401,
      'GITHUB_SIGNIN_REQUIRED',
    );
  }
  return new AppError(
    'That repository is private or doesn’t exist. Give Takeoff read-only access to it on GitHub, then try again.',
    403,
    'GITHUB_APP_REQUIRED',
  );
}

/**
 * @returns {Promise<{ client: object, installationId: number|null }>}
 *   `client` has the @codeguru/github repo-reading API.
 * @throws AppError (401 GITHUB_SIGNIN_REQUIRED / 403 GITHUB_APP_REQUIRED)
 */
async function resolveRepoAccess({ userId, owner, repo }, deps = defaultDeps()) {
  const { accessStore, app, publicClient } = deps;
  const appConfigured = app.isConfigured();

  if (userId && appConfigured) {
    const grant = await accessStore.findForUserRepo(userId, owner, repo);
    if (grant) {
      return {
        client: app.clientForInstallation(grant.installation_id),
        installationId: Number(grant.installation_id),
      };
    }
  }

  let meta = null;
  try {
    meta = await publicClient.fetchRepoMeta(owner, repo);
  } catch (err) {
    if (err.status !== 404) throw err;
  }
  if (!meta || meta.private) throw accessError({ userId, appConfigured });
  return { client: publicClient, installationId: null };
}

// Functions whose first two arguments are (owner, repo).
const REPO_SCOPED = (name) => name !== 'fetchUserRepos' && name !== 'searchRepos';

/**
 * Wraps an installation client so that when the installation is gone
 * (uninstalled or suspended), a public repo keeps reading with the server
 * token and the project stops pointing at the dead installation. A private
 * repo gets the original error: the server token must not stand in for it.
 */
function withInstallationFallback(installClient, publicClient, onGone) {
  const wrapped = {};
  for (const [name, fn] of Object.entries(installClient)) {
    if (typeof fn !== 'function' || !REPO_SCOPED(name)) {
      wrapped[name] = fn;
      continue;
    }
    wrapped[name] = async (...args) => {
      try {
        return await fn(...args);
      } catch (err) {
        if (!err || !err.installationGone) throw err;
        let isPublic = false;
        try {
          const meta = await publicClient.fetchRepoMeta(args[0], args[1]);
          isPublic = !!meta && !meta.private;
        } catch { /* can't prove it's public */ }
        if (!isPublic) throw err;
        try { await onGone(); } catch (clearErr) {
          console.warn('could not clear a dead GitHub installation:', clearErr.message);
        }
        return publicClient[name](...args);
      }
    };
  }
  return wrapped;
}

/** Client for background work on an existing project (no user present). */
function clientForProject(project, deps = defaultDeps()) {
  if (project && project.github_installation_id) {
    const installClient = deps.app.clientForInstallation(project.github_installation_id);
    return withInstallationFallback(
      installClient,
      deps.publicClient,
      () => (deps.clearInstallation ? deps.clearInstallation(project.id) : null),
    );
  }
  return deps.publicClient;
}

/**
 * The app installation that covers a repo (and so delivers its pushes), or
 * null. `knownInstallationId` is the one resolveRepoAccess() found through the
 * user's grant; without it GitHub is asked, so a repo an org owner installed
 * the app on counts even when this user hasn't authorized it.
 */
async function appInstallationForRepo({ owner, repo, knownInstallationId = null }, deps = defaultDeps()) {
  if (knownInstallationId) return Number(knownInstallationId);
  if (!deps.app.isConfigured()) return null;
  return deps.app.findRepoInstallation(owner, repo);
}

module.exports = { resolveRepoAccess, clientForProject, appInstallationForRepo };
