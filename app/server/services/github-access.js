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
const { githubRepoAccess } = require('../lib/db');
const { getGithubApp } = require('../lib/github-app');
const { AppError } = require('../lib/app-error');

function defaultDeps() {
  return { accessStore: githubRepoAccess, app: getGithubApp(), publicClient: github };
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

/** Client for background work on an existing project (no user present). */
function clientForProject(project, deps = defaultDeps()) {
  if (project && project.github_installation_id) {
    return deps.app.clientForInstallation(project.github_installation_id);
  }
  return deps.publicClient;
}

module.exports = { resolveRepoAccess, clientForProject };
