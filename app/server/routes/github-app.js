const crypto = require('crypto');
const express = require('express');
const { githubRepoAccess } = require('../lib/db');
const { getGithubApp } = require('../lib/github-app');
const { createRateLimit } = require('../lib/rate-limit');
const { AppError } = require('../lib/app-error');
const { asyncHandler } = require('../lib/async-handler');

// GitHub App install/authorize flow. The app's Callback URL must point at
// GET /api/github-app/callback, with "Request user authorization (OAuth)
// during installation" and "Redirect on update" enabled, so every install or
// repo-selection change comes back here with an OAuth `code`.

const router = express.Router();

const STATE_COOKIE = 'gh_app_state';
const STATE_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 15 * 60 * 1000,
  path: '/',
};

const startRateLimit = createRateLimit({ windowMs: 60000, max: 10, message: 'Too many GitHub connect attempts. Try again in a minute.' });
const callbackRateLimit = createRateLimit({ windowMs: 60000, max: 30, message: 'Too many callback attempts. Try again in a minute.' });
const readRateLimit = createRateLimit({ windowMs: 60000, max: 60, message: 'Too many requests. Try again in a minute.' });

function frontendBase(req) {
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL;
  if (process.env.NODE_ENV !== 'production') return 'http://localhost:3000';
  const proto = req?.protocol || 'https';
  const host = req?.get?.('host') || '';
  return host ? `${proto}://${host}` : '';
}

/** Same-origin relative paths only — never bounce to another site. */
function safeReturnTo(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) {
    return '/dashboard';
  }
  return raw.slice(0, 500);
}

function withStatus(path, status) {
  const [pathAndQuery, hash = ''] = path.split('#');
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  return `${pathAndQuery}${sep}github_app=${encodeURIComponent(status)}${hash ? `#${hash}` : ''}`;
}

function readStateCookie(req) {
  const raw = req.cookies?.[STATE_COOKIE];
  if (typeof raw !== 'string') return null;
  const idx = raw.indexOf('.');
  if (idx <= 0) return null;
  try {
    return {
      nonce: raw.slice(0, idx),
      returnTo: safeReturnTo(Buffer.from(raw.slice(idx + 1), 'base64url').toString('utf8')),
    };
  } catch {
    return null;
  }
}

function startFlow(buildUrl) {
  return (req, res) => {
    const base = frontendBase(req);
    const returnTo = safeReturnTo(req.query.returnTo);
    const app = getGithubApp();
    if (!app.isConfigured()) return res.redirect(`${base}${withStatus(returnTo, 'unavailable')}`);
    if (!req.user) return res.redirect(`${base}${withStatus(returnTo, 'signin_required')}`);

    const nonce = crypto.randomBytes(16).toString('hex');
    res.cookie(STATE_COOKIE, `${nonce}.${Buffer.from(returnTo).toString('base64url')}`, STATE_COOKIE_OPTS);
    return res.redirect(buildUrl(app, nonce));
  };
}

// GET /install — pick an account and the repos Takeoff may read.
router.get('/install', startRateLimit, startFlow((app, state) => app.installUrl(state)));

// GET /authorize — re-sync grants for an app that's already installed.
router.get('/authorize', startRateLimit, startFlow((app, state) => app.authorizeUrl(state)));

router.get('/callback', callbackRateLimit, asyncHandler(async (req, res) => {
  const base = frontendBase(req);
  const { code, state, setup_action: setupAction } = req.query;
  const saved = readStateCookie(req);
  res.clearCookie(STATE_COOKIE, { path: '/' });
  const back = (status) => res.redirect(`${base}${withStatus(saved?.returnTo || '/dashboard', status)}`);

  // A state we issued must come back intact. Installs started from GitHub's
  // own app page carry no state; for those the OAuth code proves the GitHub
  // identity and the Takeoff session proves ours, and the worst a forged
  // redirect can do is grant the victim access to the forger's repos.
  if (typeof state === 'string' && state && (!saved || saved.nonce !== state)) return back('state_mismatch');
  if (!req.user) return back('signin_required');
  // An org member asked an org owner to install; nothing to sync until approved.
  if (setupAction === 'request') return back('requested');
  if (typeof code !== 'string' || !code) return back('missing_code');

  try {
    const app = getGithubApp();
    const userToken = await app.exchangeUserCode(code);
    const grants = await app.listUserGrants(userToken);
    await githubRepoAccess.replaceForUser(req.user.id, grants);
    console.log(JSON.stringify({
      event: 'github_app_connected',
      userId: req.user.id,
      repos: grants.length,
      privateRepos: grants.filter((g) => g.private).length,
      setupAction: setupAction || null,
    }));
    return back('connected');
  } catch (err) {
    console.error('[github-app] callback failed:', err.message);
    return back('error');
  }
}));

// GET /repos — which repos the signed-in user has granted.
router.get('/repos', readRateLimit, asyncHandler(async (req, res) => {
  if (!req.user) throw AppError.unauthorized('Login required');
  const app = getGithubApp();
  const repos = app.isConfigured() ? await githubRepoAccess.listForUser(req.user.id) : [];
  res.json({
    configured: app.isConfigured(),
    repos: repos.map((r) => ({ fullName: r.repo_full_name, private: r.private, account: r.account_login })),
  });
}));

module.exports = router;
module.exports._internal = { safeReturnTo, withStatus };
