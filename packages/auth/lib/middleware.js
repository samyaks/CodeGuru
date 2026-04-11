const COOKIE_NAME = 'sb-access-token';
const REFRESH_COOKIE = 'sb-refresh-token';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
};

function extractToken(req) {
  if (req.cookies && req.cookies[COOKIE_NAME]) {
    return req.cookies[COOKIE_NAME];
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  return null;
}

/**
 * Attempt to refresh the session using the refresh token cookie.
 * On success, sets new cookies on the response and returns the user.
 * Returns null if no refresh token or refresh fails.
 */
async function tryRefresh(supabase, req, res) {
  const refreshToken = req.cookies && req.cookies[REFRESH_COOKIE];
  if (!refreshToken) return null;

  try {
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) return null;

    res.cookie(COOKIE_NAME, data.session.access_token, COOKIE_OPTIONS);
    res.cookie(REFRESH_COOKIE, data.session.refresh_token, COOKIE_OPTIONS);
    return data.session.user;
  } catch {
    return null;
  }
}

/**
 * Express middleware that requires a valid Supabase session.
 * Sets req.user on success, returns 401 on failure.
 * Automatically refreshes expired access tokens using the refresh cookie.
 */
function requireAuth(supabase) {
  return async (req, res, next) => {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (!error && user) {
        req.user = user;
        return next();
      }
    } catch {
      // fall through to refresh attempt
    }

    const refreshedUser = await tryRefresh(supabase, req, res);
    if (refreshedUser) {
      req.user = refreshedUser;
      return next();
    }

    return res.status(401).json({ error: 'Invalid or expired token' });
  };
}

/**
 * Express middleware that attaches user if token is present,
 * but allows unauthenticated requests through (req.user = null).
 * Automatically refreshes expired access tokens using the refresh cookie.
 */
function optionalAuth(supabase) {
  return async (req, res, next) => {
    const token = extractToken(req);
    if (!token) {
      req.user = null;
      return next();
    }

    try {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (!error && user) {
        req.user = user;
        return next();
      }
    } catch {
      // fall through to refresh attempt
    }

    req.user = await tryRefresh(supabase, req, res);
    next();
  };
}

module.exports = { requireAuth, optionalAuth, COOKIE_NAME, REFRESH_COOKIE, COOKIE_OPTIONS };
