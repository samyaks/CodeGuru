const express = require('express');
const { COOKIE_NAME, REFRESH_COOKIE, COOKIE_OPTIONS } = require('./middleware');

/**
 * Creates an Express router with auth routes backed by Supabase.
 *
 * @param {object} config
 * @param {import('@supabase/supabase-js').SupabaseClient} config.supabase
 * @param {string[]} [config.providers] - OAuth providers to enable, e.g. ['github', 'google']
 * @param {string} [config.afterLogin] - Redirect path after successful login (default: '/')
 * @param {string} [config.afterLogout] - Redirect path after logout (default: '/')
 * @param {string} [config.redirectUrl] - Full callback URL for OAuth (default: from SUPABASE_REDIRECT_URL env)
 */
function createAuthRouter(config) {
  const {
    supabase,
    providers = ['github'],
    afterLogin = '/',
    afterLogout = '/',
    redirectUrl = process.env.SUPABASE_REDIRECT_URL,
  } = config;

  const router = express.Router();

  // OAuth login — GET /auth/login?provider=github
  router.get('/auth/login', async (req, res) => {
    const provider = req.query.provider;
    console.log(`[Auth] /auth/login hit — provider=${provider}, redirectUrl=${redirectUrl}`);

    if (!provider || !providers.includes(provider)) {
      return res.status(400).json({
        error: `Invalid provider. Supported: ${providers.join(', ')}`,
      });
    }

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: redirectUrl },
    });

    if (error) {
      console.error('[Auth] signInWithOAuth error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    console.log(`[Auth] Redirecting to OAuth URL: ${data.url?.substring(0, 120)}...`);
    res.redirect(data.url);
  });

  // OAuth callback — GET /auth/callback
  router.get('/auth/callback', async (req, res, next) => {
    const code = req.query.code;
    console.log(`[Auth] /auth/callback hit — code=${code ? code.substring(0, 10) + '...' : 'MISSING'}, query=${JSON.stringify(req.query)}`);

    if (!code) {
      console.log('[Auth] No code param — falling through to SPA for hash-based auth');
      return next();
    }

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error('[Auth] exchangeCodeForSession error:', error.message);
      return res.redirect(`${afterLogin}?auth_error=${encodeURIComponent(error.message)}`);
    }

    console.log(`[Auth] Login successful — user=${data.session?.user?.email}, redirecting to ${afterLogin}`);
    res.cookie(COOKIE_NAME, data.session.access_token, COOKIE_OPTIONS);
    res.cookie(REFRESH_COOKIE, data.session.refresh_token, COOKIE_OPTIONS);
    res.redirect(afterLogin);
  });

  // Email/password signup — POST /auth/signup
  router.post('/auth/signup', express.json(), async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { data, error } = await supabase.auth.signUp({ email, password });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    if (data.session) {
      res.cookie(COOKIE_NAME, data.session.access_token, COOKIE_OPTIONS);
      res.cookie(REFRESH_COOKIE, data.session.refresh_token, COOKIE_OPTIONS);
    }

    res.json({
      user: data.user,
      message: data.session ? 'Signed up successfully' : 'Check your email for a confirmation link',
    });
  });

  // Email/password login — POST /auth/login
  router.post('/auth/login', express.json(), async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      return res.status(401).json({ error: error.message });
    }

    res.cookie(COOKIE_NAME, data.session.access_token, COOKIE_OPTIONS);
    res.cookie(REFRESH_COOKIE, data.session.refresh_token, COOKIE_OPTIONS);
    res.json({ user: data.user });
  });

  // Logout — POST /auth/logout
  router.post('/auth/logout', async (req, res) => {
    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.clearCookie(REFRESH_COOKIE, { path: '/' });

    await supabase.auth.signOut().catch(() => {});

    if (req.accepts('json')) {
      return res.json({ message: 'Logged out' });
    }
    res.redirect(afterLogout);
  });

  // Current user — GET /auth/me
  router.get('/auth/me', async (req, res) => {
    const token = (req.cookies && req.cookies[COOKIE_NAME])
      || (req.headers.authorization && req.headers.authorization.slice(7));

    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    let user = null;

    const { data, error } = await supabase.auth.getUser(token);
    if (!error && data.user) {
      user = data.user;
    } else {
      const refreshToken = req.cookies && req.cookies[REFRESH_COOKIE];
      if (refreshToken) {
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
        if (!refreshError && refreshData.session) {
          res.cookie(COOKIE_NAME, refreshData.session.access_token, COOKIE_OPTIONS);
          res.cookie(REFRESH_COOKIE, refreshData.session.refresh_token, COOKIE_OPTIONS);
          user = refreshData.session.user;
        }
      }
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    res.json({
      id: user.id,
      email: user.email,
      provider: user.app_metadata?.provider,
      avatar_url: user.user_metadata?.avatar_url,
      full_name: user.user_metadata?.full_name,
      user_name: user.user_metadata?.user_name,
    });
  });

  return router;
}

module.exports = { createAuthRouter };
