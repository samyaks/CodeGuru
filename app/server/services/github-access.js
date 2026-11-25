/**
 * Decides which GitHub identity reads a repo for a given user.
 *
 *   1. The user granted the Takeoff GitHub App access to the repo
 *      → read as that installation (works for private repos).
 *   2. Otherwise → read with the server's GITHUB_TOKEN, but only if the repo
 *      is public. The server token can see its owner's private repos, so it
 *      must never stand in for the requesting user's own access.
 *
 * The same rule holds for background work on a saved project
 * (clientForProject): the project's owner needs a current grant, or the repo
 * must be public. Installation tokens are scoped to the one repo, read-only.
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
    setInstallation: (projectId, installationId) => deployments.update(projectId, { github_installation_id: installationId }),
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

/** A GitHub failure other than "not found" (rate limit, outage) as a clear AppError. */
function upstreamError(err) {
  if (err instanceof AppError) return err;
  if (err && (err.status === 403 || err.status === 429)) {
    return new AppError('GitHub is rate-limiting requests right now. Try again in a few minutes.', 429, 'GITHUB_RATE_LIMITED');
  }
  return new AppError('GitHub didn’t respond as expected. Try again in a minute.', 502, 'GITHUB_UNAVAILABLE');
}

/** Repo metadata read with the server token, or null when GitHub says 404. */
async function publicMeta(publicClient, owner, repo) {
  try {
    return await publicClient.fetchRepoMeta(owner, repo);
  } catch (err) {
    if (err && err.status === 404) return null;
    throw upstreamError(err);
  }
}

/**
 * @returns {Promise<{ client: object, installationId: number|null, private: boolean }>}
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
        client: withInstallationFallback(
          app.clientForInstallation(grant.installation_id, { repo }),
          publicClient,
          () => null,
        ),
        installationId: Number(grant.installation_id),
        private: !!grant.private,
      };
    }
  }

  const meta = await publicMeta(publicClient, owner, repo);
  if (!meta || meta.private) throw accessError({ userId, appConfigured });
  return { client: publicClient, installationId: null, private: false };
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

/**
 * Client for background work on an existing project (no user present).
 * Decided lazily, on the first call, by the same rule as resolveRepoAccess
 * with the project's owner as the user: a current grant reads through that
 * installation; otherwise only a public repo is read, with the server token.
 * A project that lost its grant (uninstall, removed from the org, re-sync)
 * stops reading the private repo.
 */
function clientForProject(project, deps = defaultDeps()) {
  const { publicClient } = deps;
  if (!project || !project.owner || !project.repo) return publicClient;
  let resolved = null;
  const resolve = () => {
    if (!resolved) {
      resolved = (async () => {
        const { owner, repo } = project;
        const appConfigured = deps.app.isConfigured();
        if (project.user_id && appConfigured) {
          const grant = await deps.accessStore.findForUserRepo(project.user_id, owner, repo);
          if (grant) {
            const installationId = Number(grant.installation_id);
            if (deps.setInstallation && Number(project.github_installation_id) !== installationId) {
              try { await deps.setInstallation(project.id, installationId); } catch (err) {
                console.warn('could not record a project’s GitHub installation:', err.message);
              }
            }
            return withInstallationFallback(
              deps.app.clientForInstallation(installationId, { repo }),
              publicClient,
              () => (deps.clearInstallation ? deps.clearInstallation(project.id) : null),
            );
          }
        }
        const meta = await publicMeta(publicClient, owner, repo);
        if (!meta || meta.private) {
          if (project.github_installation_id && deps.clearInstallation) {
            try { await deps.clearInstallation(project.id); } catch { /* best effort */ }
          }
          throw accessError({ userId: project.user_id || null, appConfigured });
        }
        return publicClient;
      })();
      // A failed decision (e.g. a GitHub outage) is retried on the next call.
      resolved.catch(() => { resolved = null; });
    }
    return resolved;
  };
  const client = {};
  for (const [name, fn] of Object.entries(publicClient)) {
    if (typeof fn !== 'function') { client[name] = fn; continue; }
    client[name] = REPO_SCOPED(name)
      ? async (...args) => (await resolve())[name](...args)
      : fn;
  }
  return client;
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
