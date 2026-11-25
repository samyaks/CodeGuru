/**
 * Takeoff GitHub App — access to the specific repos a user grants.
 *
 * Required app settings on GitHub (General → Permissions & events):
 *   Repository permissions: Metadata: read; Contents: read & write (commit
 *     takeoff.yaml and agent files); Pull requests: read & write (verdict
 *     comment); Checks: read & write (verdict check run); Deployments: read
 *     (preview link in the verdict comment; optional).
 *   Subscribe to events: Push, Pull request, Check run, Check suite.
 *   The PR verdict (services/verdict) writes the comment and check run, and
 *   Check run / Check suite carry Re-run and Retry on the Takeoff check;
 *   Contents write is for the agreements milestone. Raising permissions makes
 *   each existing installation re-approve before they take effect.
 *
 * Two identities are involved:
 *   - The app itself (JWT signed with the app's private key) mints short-lived
 *     installation tokens used to read repo contents during a scan.
 *   - The user (a GitHub App user token from the OAuth `code`) is used once,
 *     at install/authorize time, to learn which repos they can actually see
 *     through each installation. We don't store that token.
 *
 * Env: GITHUB_APP_ID, GITHUB_APP_SLUG, GITHUB_APP_CLIENT_ID,
 *      GITHUB_APP_CLIENT_SECRET, and GITHUB_APP_PRIVATE_KEY (PEM; literal
 *      "\n" sequences are unescaped) or GITHUB_APP_PRIVATE_KEY_PATH.
 */

const crypto = require('crypto');
const fs = require('fs');
const github = require('@codeguru/github');
const { AppError } = require('./app-error');

const GITHUB_API = 'https://api.github.com';
// Installation tokens live 60 minutes; refresh well before so a scan that
// starts on a cached token never runs past expiry.
const TOKEN_REFRESH_MARGIN_MS = 15 * 60 * 1000;
const MAX_PAGES = 10;
// Read access a scan or PR review needs. An installation that hasn't approved
// pull_requests yet (it was added later) is minted without it.
const READ_PERMISSIONS = Object.freeze({ contents: 'read', metadata: 'read', pull_requests: 'read' });
const BASE_PERMISSIONS = Object.freeze({ contents: 'read', metadata: 'read' }); // 100 per page → up to 1,000 installations / repos each

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

/** RS256 JWT identifying the app (valid ≤10 min per GitHub's rules). */
function createAppJwt({ appId, privateKey, now = Date.now() }) {
  const iat = Math.floor(now / 1000) - 60; // allow for clock drift
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat, exp: iat + 9 * 60, iss: String(appId) }));
  const signature = crypto.createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKey, 'base64url');
  return `${header}.${payload}.${signature}`;
}

function readConfigFromEnv(env = process.env) {
  let privateKey = env.GITHUB_APP_PRIVATE_KEY ? env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n') : null;
  if (!privateKey && env.GITHUB_APP_PRIVATE_KEY_PATH) {
    privateKey = fs.readFileSync(env.GITHUB_APP_PRIVATE_KEY_PATH, 'utf8');
  }
  return {
    appId: env.GITHUB_APP_ID || null,
    slug: env.GITHUB_APP_SLUG || null,
    clientId: env.GITHUB_APP_CLIENT_ID || null,
    clientSecret: env.GITHUB_APP_CLIENT_SECRET || null,
    privateKey,
  };
}

function createGithubApp(config, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  const tokenCache = new Map(); // installationId → { token, expiresAt }
  const inFlight = new Map(); // installationId → Promise<string>

  function isConfigured() {
    return !!(config.appId && config.slug && config.clientId && config.clientSecret && config.privateKey);
  }

  function assertConfigured() {
    if (!isConfigured()) {
      throw new AppError(
        'GitHub App is not configured. Set GITHUB_APP_ID, GITHUB_APP_SLUG, GITHUB_APP_CLIENT_ID, '
          + 'GITHUB_APP_CLIENT_SECRET, and GITHUB_APP_PRIVATE_KEY.',
        503,
        'SERVICE_UNAVAILABLE',
      );
    }
  }

  async function githubJson(path, { method = 'GET', token, body } = {}) {
    const res = await fetchImpl(`${GITHUB_API}${path}`, {
      method,
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'CodeGuru-Reviewer',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`GitHub API ${res.status} ${method} ${path}: ${text}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  // Installation tokens are always narrowed to one repo and the permissions a
  // caller needs, so a grant for repo A can never become a token for repo B
  // or for write access the caller didn't ask for.
  function scopeKey(installationId, scope) {
    return `${installationId}|${scope.repo || ''}|${JSON.stringify(scope.permissions)}|${JSON.stringify(scope.optional || null)}`;
  }

  async function mintInstallationToken(installationId, scope) {
    const key = scopeKey(installationId, scope);
    const jwt = createAppJwt({ appId: config.appId, privateKey: config.privateKey, now: now() });
    const mint = (permissions) => githubJson(`/app/installations/${encodeURIComponent(installationId)}/access_tokens`, {
      method: 'POST',
      token: jwt,
      body: {
        ...(scope.repo ? { repositories: [scope.repo] } : {}),
        permissions,
      },
    });
    // 422: a permission the installation hasn't approved, or a repo it no
    // longer covers. Optional permissions are dropped first, then read scopes
    // fall back to plain contents/metadata (pull_requests was added later).
    const tries = [];
    if (scope.optional) tries.push({ ...scope.permissions, ...scope.optional });
    tries.push(scope.permissions);
    if (scope.permissions === READ_PERMISSIONS) tries.push(BASE_PERMISSIONS);
    let data;
    try {
      for (let i = 0; i < tries.length; i += 1) {
        try {
          data = await mint(tries[i]);
          break;
        } catch (err) {
          if (err.status !== 422 || i === tries.length - 1) throw err;
        }
      }
    } catch (err) {
      // 404: uninstalled. 403: suspended. 422: the repo isn't in this
      // installation any more. Either way it can't be read through here.
      if (err.status === 404 || err.status === 403 || err.status === 422) err.installationGone = true;
      tokenCache.delete(key);
      throw err;
    }
    const entry = { token: data.token, expiresAt: new Date(data.expires_at).getTime() };
    tokenCache.set(key, entry);
    return entry.token;
  }

  // `optional` permissions are asked for too, but dropped when the
  // installation hasn't approved them (e.g. deployments for preview links).
  function normalizeScope({ repo = null, permissions = READ_PERMISSIONS, optional = null } = {}) {
    return { repo: repo ? String(repo) : null, permissions, optional: optional && Object.keys(optional).length ? optional : null };
  }

  /** Cached installation token for one scope; concurrent callers share one mint. */
  async function getInstallationToken(installationId, scopeOpts) {
    assertConfigured();
    const id = String(installationId);
    const scope = normalizeScope(scopeOpts);
    const key = scopeKey(id, scope);
    const cached = tokenCache.get(key);
    if (cached && cached.expiresAt - now() > TOKEN_REFRESH_MARGIN_MS) return cached.token;
    if (inFlight.has(key)) return inFlight.get(key);
    const pending = mintInstallationToken(id, scope).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
    return pending;
  }

  /** Drop cached tokens for an installation (uninstalled, suspended, repos removed). */
  function forgetInstallation(installationId) {
    const prefix = `${installationId}|`;
    for (const key of [...tokenCache.keys()]) {
      if (key.startsWith(prefix)) tokenCache.delete(key);
    }
  }

  /** Id of the installation covering owner/repo, or null when the app isn't installed there. */
  async function findRepoInstallation(owner, repo) {
    assertConfigured();
    const jwt = createAppJwt({ appId: config.appId, privateKey: config.privateKey, now: now() });
    try {
      const data = await githubJson(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/installation`, { token: jwt });
      return data.id ? Number(data.id) : null;
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  /**
   * Client that acts as the installation for one repo (`repo` is the name
   * without the owner). Read-only unless `permissions` asks for more.
   */
  function clientForInstallation(installationId, scopeOpts = {}) {
    const scope = normalizeScope(scopeOpts);
    return github.createClient({
      token: () => getInstallationToken(installationId, scope),
      onUnauthorized: () => { tokenCache.delete(scopeKey(String(installationId), scope)); },
    });
  }

  function installUrl(state) {
    assertConfigured();
    return `https://github.com/apps/${encodeURIComponent(config.slug)}/installations/new?state=${encodeURIComponent(state)}`;
  }

  function authorizeUrl(state) {
    assertConfigured();
    const params = new URLSearchParams({ client_id: config.clientId, state });
    return `https://github.com/login/oauth/authorize?${params}`;
  }

  /** Exchange the OAuth `code` from the install/authorize redirect for a user token. */
  async function exchangeUserCode(code) {
    assertConfigured();
    const res = await fetchImpl('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code }),
    });
    const data = await res.json().catch(() => ({}));
    // GitHub reports a bad/expired code as 200 + { error }.
    if (!res.ok || data.error || !data.access_token) {
      const err = new Error(`GitHub code exchange failed: ${data.error_description || data.error || res.status}`);
      err.status = res.status;
      throw err;
    }
    return data.access_token;
  }

  async function paginate(path, userToken, key) {
    const items = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const sep = path.includes('?') ? '&' : '?';
      const data = await githubJson(`${path}${sep}per_page=100&page=${page}`, { token: userToken });
      const batch = Array.isArray(data[key]) ? data[key] : [];
      items.push(...batch);
      if (batch.length < 100 || items.length >= (data.total_count || 0)) break;
    }
    return items;
  }

  /**
   * Every repo the user can read through any installation of this app.
   * `/user/installations/:id/repositories` returns only repos both the
   * installation covers and the user can access, so an org member never
   * gains repos they couldn't already see on GitHub.
   */
  async function listUserGrants(userToken) {
    const user = await githubJson('/user', { token: userToken });
    const githubUserId = user && user.id ? Number(user.id) : null;
    const installations = await paginate('/user/installations', userToken, 'installations');
    const grants = [];
    for (const inst of installations) {
      const repos = await paginate(`/user/installations/${inst.id}/repositories`, userToken, 'repositories');
      for (const r of repos) {
        grants.push({
          installationId: inst.id,
          accountLogin: inst.account?.login || null,
          repoId: r.id,
          repoFullName: r.full_name,
          private: !!r.private,
          githubUserId,
        });
      }
    }
    return grants;
  }

  return {
    isConfigured,
    getInstallationToken,
    forgetInstallation,
    findRepoInstallation,
    clientForInstallation,
    installUrl,
    authorizeUrl,
    exchangeUserCode,
    listUserGrants,
  };
}

let defaultApp = null;
function getGithubApp() {
  if (!defaultApp) defaultApp = createGithubApp(readConfigFromEnv());
  return defaultApp;
}

module.exports = { createAppJwt, createGithubApp, readConfigFromEnv, getGithubApp, READ_PERMISSIONS };
