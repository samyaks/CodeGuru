const crypto = require('crypto');
const express = require('express');
const railway = require('@codeguru/railway');
const { analyses } = require('../lib/db');
const { createRateLimit } = require('../lib/rate-limit');
const { AppError } = require('../lib/app-error');

const router = express.Router();
const callbackRouter = express.Router();

const RAILWAY_OAUTH_AUTH = 'https://backboard.railway.com/oauth/auth';
const RAILWAY_OAUTH_TOKEN = 'https://backboard.railway.com/oauth/token';
const SCOPES = 'openid profile email project:viewer offline_access';
const NONCE_COOKIE_PREFIX = 'railway_oauth_nonce_';

function nonceCookieName(analysisId) {
  return `${NONCE_COOKIE_PREFIX}${String(analysisId).slice(0, 12).replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

const NONCE_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 10 * 60 * 1000,
  path: '/',
};

const connectRateLimit = createRateLimit({ windowMs: 60000, max: 10, message: 'Too many connect attempts. Try again in a minute.' });
const callbackRateLimit = createRateLimit({ windowMs: 60000, max: 30, message: 'Too many callback attempts. Try again in a minute.' });
const statusRateLimit = createRateLimit({ windowMs: 60000, max: 30, message: 'Too many status requests. Try again in a minute.' });
const disconnectRateLimit = createRateLimit({ windowMs: 60000, max: 5, message: 'Too many disconnect requests. Try again in a minute.' });
const relookupRateLimit = createRateLimit({ windowMs: 60000, max: 5, message: 'Too many lookup attempts. Try again in a minute.' });

function clientCreds() {
  const clientId = process.env.RAILWAY_CLIENT_ID;
  const clientSecret = process.env.RAILWAY_CLIENT_SECRET;
  const redirectUri = process.env.RAILWAY_OAUTH_REDIRECT_URL;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new AppError(
      'Railway OAuth is not configured. Set RAILWAY_CLIENT_ID, RAILWAY_CLIENT_SECRET, RAILWAY_OAUTH_REDIRECT_URL.',
      503,
      'SERVICE_UNAVAILABLE'
    );
  }
  return { clientId, clientSecret, redirectUri };
}

function frontendBase(req) {
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL;
  if (process.env.NODE_ENV !== 'production') return 'http://localhost:3000';
  const proto = req?.protocol || 'https';
  const host = req?.get?.('host') || '';
  return host ? `${proto}://${host}` : '';
}

function clearRailwayColumns() {
  return {
    railway_access_token: null,
    railway_refresh_token: null,
    railway_token_expires_at: null,
    railway_project_id: null,
    railway_service_id: null,
    railway_environment_id: null,
  };
}

async function exchangeCode(code) {
  const { clientId, clientSecret, redirectUri } = clientCreds();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch(RAILWAY_OAUTH_TOKEN, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('[Railway] Token exchange failed:', res.status, text);
    const err = new Error(`Railway token exchange failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function refreshAccessToken(refreshToken) {
  const { clientId, clientSecret } = clientCreds();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const res = await fetch(RAILWAY_OAUTH_TOKEN, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('[Railway] Token refresh failed:', res.status, text);
    const err = new Error(`Railway token refresh failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function ensureFreshToken(analysis) {
  const expiresAt = analysis.railway_token_expires_at ? new Date(analysis.railway_token_expires_at).getTime() : 0;
  const now = Date.now();
  if (expiresAt && expiresAt - now > 60_000) {
    return analysis.railway_access_token;
  }
  if (!analysis.railway_refresh_token) {
    const err = new Error('Railway access token expired and no refresh token available');
    err.status = 401;
    throw err;
  }
  const tokens = await refreshAccessToken(analysis.railway_refresh_token);
  const newExpiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
  await analyses.update(analysis.id, {
    railway_access_token: tokens.access_token,
    railway_refresh_token: tokens.refresh_token || analysis.railway_refresh_token,
    railway_token_expires_at: newExpiresAt,
  });
  return tokens.access_token;
}

router.get('/connect', connectRateLimit, async (req, res, next) => {
  try {
    const analysisId = req.query.analysisId;
    if (!analysisId || typeof analysisId !== 'string') {
      throw AppError.badRequest('analysisId query parameter is required');
    }
    const analysis = await analyses.findById(analysisId);
    if (!analysis) throw AppError.notFound('Analysis not found');

    if (analysis.railway_access_token) {
      throw AppError.conflict('A Railway account is already connected to this analysis. Disconnect first to reconnect.');
    }

    const { clientId, redirectUri } = clientCreds();
    const nonce = crypto.randomBytes(16).toString('hex');
    const state = `${analysisId}.${nonce}`;
    res.cookie(nonceCookieName(analysisId), nonce, NONCE_COOKIE_OPTS);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: SCOPES,
      state,
      prompt: 'consent',
    });
    res.redirect(`${RAILWAY_OAUTH_AUTH}?${params.toString()}`);
  } catch (err) {
    next(err);
  }
});

router.get('/status/:analysisId', statusRateLimit, async (req, res, next) => {
  try {
    const analysis = await analyses.findById(req.params.analysisId);
    if (!analysis) throw AppError.notFound('Analysis not found');

    if (!analysis.railway_access_token) {
      return res.json({ connected: false });
    }

    if (!analysis.railway_project_id || !analysis.railway_service_id || !analysis.railway_environment_id) {
      return res.json({
        connected: true,
        matched: false,
        message: 'No Railway project found connected to this repo',
      });
    }

    let token;
    try {
      token = await ensureFreshToken(analysis);
    } catch (refreshErr) {
      const status = refreshErr.status;
      if (status >= 400 && status < 500) {
        await analyses.update(analysis.id, clearRailwayColumns());
        return res.json({ connected: false });
      }
      throw refreshErr;
    }

    const [recent, project, domains] = await Promise.all([
      railway.listDeployments(analysis.railway_service_id, analysis.railway_environment_id, 5, token),
      railway.getProject(analysis.railway_project_id, token).catch((projErr) => {
        console.error('[Railway] getProject failed:', projErr.message);
        return null;
      }),
      railway.getServiceDomains(analysis.railway_project_id, analysis.railway_service_id, analysis.railway_environment_id, token),
    ]);

    const latest = (recent && recent.length > 0) ? recent[0] : null;

    res.json({
      connected: true,
      matched: true,
      project: { id: analysis.railway_project_id, name: project?.name || null },
      service: { id: analysis.railway_service_id },
      environment: { id: analysis.railway_environment_id },
      latestDeployment: latest,
      recentDeployments: recent || [],
      domain: domains?.domain || null,
      url: domains?.url || null,
      liveUrl: domains?.url || null,
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/disconnect/:analysisId', disconnectRateLimit, async (req, res, next) => {
  try {
    const analysis = await analyses.findById(req.params.analysisId);
    if (!analysis) throw AppError.notFound('Analysis not found');
    await analyses.update(analysis.id, clearRailwayColumns());
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/relookup/:analysisId', relookupRateLimit, async (req, res, next) => {
  try {
    const analysis = await analyses.findById(req.params.analysisId);
    if (!analysis) throw AppError.notFound('Analysis not found');
    if (!analysis.railway_access_token) {
      throw AppError.badRequest('Railway is not connected for this analysis');
    }

    let token;
    try {
      token = await ensureFreshToken(analysis);
    } catch (refreshErr) {
      const status = refreshErr.status;
      if (status >= 400 && status < 500) {
        await analyses.update(analysis.id, clearRailwayColumns());
        return res.json({ connected: false });
      }
      throw refreshErr;
    }

    const repoFullName = `${analysis.owner}/${analysis.repo}`;
    const match = await railway.findProjectByRepo(token, repoFullName);

    if (!match) {
      return res.json({
        connected: true,
        matched: false,
        message: 'No Railway project found connected to this repo',
      });
    }

    await analyses.update(analysis.id, {
      railway_project_id: match.project.id,
      railway_service_id: match.service.id,
      railway_environment_id: match.environmentId,
    });

    res.json({
      connected: true,
      matched: true,
      project: { id: match.project.id, name: match.project.name || null },
      service: { id: match.service.id },
      environment: { id: match.environmentId },
      latestDeployment: null,
      recentDeployments: [],
      domain: null,
      url: null,
      liveUrl: null,
    });
  } catch (err) {
    next(err);
  }
});

callbackRouter.get('/callback', callbackRateLimit, async (req, res, next) => {
  try {
    const { code, state, error } = req.query;
    const base = frontendBase(req);

    let stateAnalysisId = '';
    let stateNonce = '';
    if (typeof state === 'string') {
      const idx = state.lastIndexOf('.');
      if (idx > 0) {
        stateAnalysisId = state.slice(0, idx);
        stateNonce = state.slice(idx + 1);
      } else {
        stateAnalysisId = state;
      }
    }

    const cookieKey = stateAnalysisId ? nonceCookieName(stateAnalysisId) : null;
    const cookieNonce = cookieKey ? req.cookies?.[cookieKey] : null;
    if (cookieKey) res.clearCookie(cookieKey, { path: '/' });

    if (error) {
      const validNonce = !!stateAnalysisId && !!cookieNonce && cookieNonce === stateNonce;
      const target = validNonce ? `/results/${encodeURIComponent(stateAnalysisId)}?railway=denied` : '/?railway=denied';
      return res.redirect(`${base}${target}`);
    }

    if (typeof code !== 'string' || !stateAnalysisId || !stateNonce) {
      throw AppError.badRequest('Missing or invalid code/state from Railway callback');
    }

    if (!cookieNonce || cookieNonce !== stateNonce) {
      throw AppError.badRequest('OAuth state mismatch. Please retry the connection.');
    }

    const analysis = await analyses.findById(stateAnalysisId);
    if (!analysis) throw AppError.notFound('Analysis not found for callback');

    const tokens = await exchangeCode(code);
    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token || null;
    const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();

    const repoFullName = `${analysis.owner}/${analysis.repo}`;
    let match = null;
    try {
      match = await railway.findProjectByRepo(accessToken, repoFullName);
    } catch (lookupErr) {
      console.error('[Railway] findProjectByRepo failed:', lookupErr.message);
    }

    const updates = {
      railway_access_token: accessToken,
      railway_refresh_token: refreshToken,
      railway_token_expires_at: expiresAt,
    };
    if (match) {
      updates.railway_project_id = match.project.id;
      updates.railway_service_id = match.service.id;
      updates.railway_environment_id = match.environmentId;
    }
    await analyses.update(stateAnalysisId, updates);

    const flag = match ? 'connected' : 'no-match';
    res.redirect(`${base}/results/${encodeURIComponent(stateAnalysisId)}?railway=${flag}`);
  } catch (err) {
    next(err);
  }
});

module.exports = { router, callbackRouter };
