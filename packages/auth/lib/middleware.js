const COOKIE_NAME = 'sb-access-token';
const REFRESH_COOKIE = 'sb-refresh-token';

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
 * Express middleware that requires a valid Supabase session.
 * Sets req.user on success, returns 401 on failure.
 */
function requireAuth(supabase) {
  return async (req, res, next) => {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      req.user = user;
      next();
    } catch {
      return res.status(401).json({ error: 'Authentication failed' });
    }
  };
}

/**
 * Express middleware that attaches user if token is present,
 * but allows unauthenticated requests through (req.user = null).
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
      req.user = error ? null : user;
    } catch {
      req.user = null;
    }
    next();
  };
}

module.exports = { requireAuth, optionalAuth, COOKIE_NAME, REFRESH_COOKIE };
