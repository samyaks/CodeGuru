/**
 * Takeoff GitHub App — read-only access to the specific repos a user grants.
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
const MAX_PAGES = 10; // 100 per page → up to 1,000 installations / repos each

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

  async function mintInstallationToken(installationId) {
    const jwt = createAppJwt({ appId: config.appId, privateKey: config.privateKey, now: now() });
    const data = await githubJson(`/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      token: jwt,
    });
    const entry = { token: data.token, expiresAt: new Date(data.expires_at).getTime() };
    tokenCache.set(String(installationId), entry);
    return entry.token;
  }

  /** Cached installation token; concurrent callers share one mint. */
  async function getInstallationToken(installationId) {
    assertConfigured();
    const key = String(installationId);
    const cached = tokenCache.get(key);
    if (cached && cached.expiresAt - now() > TOKEN_REFRESH_MARGIN_MS) return cached.token;
    if (inFlight.has(key)) return inFlight.get(key);
    const pending = mintInstallationToken(key).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
    return pending;
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

  /** Repo-reading client that acts as the installation. */
  function clientForInstallation(installationId) {
    return github.createClient({ token: () => getInstallationToken(installationId) });
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
        });
      }
    }
    return grants;
  }

  return {
    isConfigured,
    getInstallationToken,
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

module.exports = { createAppJwt, createGithubApp, readConfigFromEnv, getGithubApp };
