require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const healthRoutes = require('./routes/health');
const analyzeRoutes = require('./routes/analyze');
const takeoffRoutes = require('./routes/takeoff');
const deployRoutes = require('./routes/deploy');
const projectRoutes = require('./routes/projects');
const buildStoryRoutes = require('./routes/build-story');
const publicStoryRoutes = require('./routes/public-story');
const reviewRoutes = require('./routes/reviews');
const githubRoutes = require('./routes/github');
const fixPromptRoutes = require('./routes/fix-prompts');
const projectAnalyticsRoutes = require('./routes/project-analytics');
const collectRoutes = require('./routes/collect');
const productMapRoutes = require('./routes/product-map');
const githubWebhookRoutes = require('./routes/github-webhook');
const { recoverStaleCommitReviews } = require('./routes/github-webhook');
const { createRateLimit } = require('./lib/rate-limit');
const { getDb, closeDb } = require('./lib/db');
const { requestLogger } = require('./lib/logger');
const { AppError } = require('./lib/app-error');

const { createClient, createAuthRouter, requireAuth, optionalAuth, COOKIE_OPTIONS } = require('@codeguru/auth');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(requestLogger());

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : [process.env.FRONTEND_URL || 'http://localhost:3000', process.env.API_URL || 'http://localhost:3001'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
}));
app.use((req, res, next) => {
  if (req.path === '/api/collect') return next();
  if (req.path === '/api/github/webhook' && req.method === 'POST') {
    return express.raw({ type: 'application/json' })(req, res, next);
  }
  express.json()(req, res, next);
});
app.use(cookieParser());

// Auth setup
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;

const FRONTEND_URL = process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000');

if (supabase) {
  console.log(`[Auth] Supabase initialized. REDIRECT_URL=${process.env.SUPABASE_REDIRECT_URL || 'NOT SET'}, FRONTEND_URL=${FRONTEND_URL || '(empty/production)'}`);
  app.use(createAuthRouter({
    supabase,
    providers: ['github'],
    afterLogin: `${FRONTEND_URL}/dashboard`,
    afterLogout: `${FRONTEND_URL}/`,
  }));
} else {
  console.log(`[Auth] Supabase NOT initialized. SUPABASE_URL=${process.env.SUPABASE_URL ? 'set' : 'NOT SET'}, SUPABASE_ANON_KEY=${process.env.SUPABASE_ANON_KEY ? 'set' : 'NOT SET'}`);
}

app.post('/auth/token', express.json(), async (req, res) => {
  const { access_token, refresh_token, provider_token } = req.body;
  if (!access_token) {
    return res.status(400).json({ error: 'Missing access_token' });
  }
  if (supabase) {
    const { data: { user }, error } = await supabase.auth.getUser(access_token);
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }
  res.cookie('sb-access-token', access_token, COOKIE_OPTIONS);
  if (refresh_token) {
    res.cookie('sb-refresh-token', refresh_token, COOKIE_OPTIONS);
  }
  if (provider_token) {
    res.cookie('gh-provider-token', provider_token, COOKIE_OPTIONS);
  }
  res.json({ ok: true });
});

// Public routes
app.use(healthRoutes);
app.use(collectRoutes);
app.use('/api/github/webhook', githubWebhookRoutes);
app.use('/api/fix', fixPromptRoutes);
app.use('/api/story', publicStoryRoutes);

// GitHub re-auth with admin:repo_hook scope (for webhook auto-connect)
const reconnectRateLimit = createRateLimit({ windowMs: 60000, max: 5, message: 'Too many reconnect attempts. Please try again in a minute.' });
app.get('/auth/github/reconnect', reconnectRateLimit, (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Auth not configured' });
  const redirectUrl = process.env.SUPABASE_REDIRECT_URL;
  supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: redirectUrl,
      scopes: 'repo admin:repo_hook',
      queryParams: { prompt: 'consent' },
    },
  }).then(({ data, error }) => {
    if (error || !data?.url) {
      return res.status(500).json({ error: error?.message || 'OAuth init failed' });
    }
    res.redirect(data.url);
  }).catch((err) => res.status(500).json({ error: err.message }));
});

// Routes with optional/required auth depending on Supabase config
if (supabase) {
  app.use('/api/analyze', optionalAuth(supabase), analyzeRoutes);
  app.use('/api/takeoff', optionalAuth(supabase), takeoffRoutes);
  app.use('/api/deploy', requireAuth(supabase), deployRoutes);
  app.use('/api/projects', optionalAuth(supabase), projectRoutes);
  app.use('/api/projects/:projectId/story', requireAuth(supabase), buildStoryRoutes);
  app.use('/api/projects/:projectId/analytics', optionalAuth(supabase), projectAnalyticsRoutes);
  app.use('/api/product-map', optionalAuth(supabase), productMapRoutes);
} else {
  app.use('/api/analyze', analyzeRoutes);
  app.use('/api/takeoff', takeoffRoutes);
  app.use('/api/deploy', (req, res) => {
    res.status(503).json({ error: 'Authentication must be configured to use deploy. Set SUPABASE_URL and SUPABASE_ANON_KEY.' });
  });
  app.use('/api/projects', projectRoutes);
  app.use('/api/projects/:projectId/story', (req, res) => {
    res.status(503).json({ error: 'Authentication must be configured for BuildStory.' });
  });
  app.use('/api/projects/:projectId/analytics', projectAnalyticsRoutes);
  app.use('/api/product-map', productMapRoutes);
}

// Protected routes (require auth when Supabase is configured)
if (supabase) {
  app.use('/api/reviews', requireAuth(supabase), reviewRoutes);
  app.use('/api/github', requireAuth(supabase), githubRoutes);
} else {
  app.use('/api/reviews', reviewRoutes);
  app.use('/api/github', githubRoutes);
}

// Production: serve built React app as static files
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((err, req, res, _next) => {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) console.error(`[AppError] ${req.method} ${req.originalUrl}:`, err);
    return res.status(err.statusCode).json({ error: err.message, code: err.code });
  }

  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON in request body', code: 'BAD_REQUEST' });
  }

  if (err.name === 'MulterError') {
    const messages = {
      LIMIT_FILE_SIZE: `File too large (max ${(err.storageErrors?.[0]?.limit || 2097152) / 1024 / 1024}MB per file)`,
      LIMIT_FILE_COUNT: 'Too many files uploaded (max 300)',
      LIMIT_UNEXPECTED_FILE: 'Unexpected file field',
    };
    return res.status(400).json({ error: messages[err.code] || err.message, code: 'BAD_REQUEST' });
  }

  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Invalid or expired token', code: 'UNAUTHORIZED' });
  }

  console.error(
    `[UnhandledError] ${req.method} ${req.originalUrl}\n  name=${err.name}\n  code=${err.code}\n  message=${err.message}\n  stack=${err.stack}`
  );
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
  res.status(500).json({ error: message, code: 'INTERNAL_ERROR' });
});

function validateEnv() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  WARNING: ANTHROPIC_API_KEY is not set. Analysis and review features will fail.');
  }
  if (!process.env.GITHUB_TOKEN) {
    console.info('ℹ️  GITHUB_TOKEN not set. Using unauthenticated GitHub API (60 req/hr limit).');
  }
  const hasUrl = !!process.env.SUPABASE_URL;
  const hasKey = !!process.env.SUPABASE_ANON_KEY;
  if (hasUrl !== hasKey) {
    console.warn('⚠️  WARNING: Only one of SUPABASE_URL/SUPABASE_ANON_KEY is set. Auth will be disabled.');
  }
  if (hasUrl && hasKey && !process.env.SUPABASE_REDIRECT_URL) {
    console.warn('⚠️  WARNING: SUPABASE_REDIRECT_URL is not set. OAuth callbacks may fail.');
  }
  if (process.env.NODE_ENV === 'production' && !hasUrl) {
    console.error('🚨 FATAL: Running in production without SUPABASE_URL. All routes are unprotected.');
    console.error('   Set SUPABASE_URL and SUPABASE_ANON_KEY, or set NODE_ENV=development for local work.');
    process.exit(1);
  }
}

let server;

async function start() {
  getDb();
  console.log('Database pool initialized (lazy connect on first query)');

  recoverStaleCommitReviews().catch((err) =>
    console.error('[startup] recoverStaleCommitReviews failed:', err.message)
  );

  validateEnv();

  server = app.listen(PORT, () => {
    console.log(`Takeoff server running on port ${PORT}`);
    const baseUrl = process.env.API_URL || `http://localhost:${PORT}`;
    console.log(`Health: ${baseUrl}/health`);
    console.log(`API: ${baseUrl}/api/takeoff`);
    console.log(`GitHub webhook (push → commit review): POST ${baseUrl}/api/github/webhook`);
    if (supabase) {
      console.log('Auth: Supabase connected');
    } else {
      console.log('Auth: Running without Supabase (set SUPABASE_URL and SUPABASE_ANON_KEY to enable)');
    }
  });
}

async function shutdown() {
  console.log('Shutting down gracefully...');
  const forceExit = setTimeout(() => {
    console.error('Graceful shutdown timed out after 10s — forcing exit.');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  const closePool = async () => {
    try { await closeDb(); } catch (err) { console.error('closeDb failed:', err.message); }
  };
  if (server) {
    server.close(async () => {
      await closePool();
      console.log('Server closed');
      clearTimeout(forceExit);
      process.exit(0);
    });
  } else {
    await closePool();
    clearTimeout(forceExit);
    process.exit(0);
  }
}

process.on('SIGINT', () => { shutdown().catch((err) => { console.error('shutdown failed:', err); process.exit(1); }); });
process.on('SIGTERM', () => { shutdown().catch((err) => { console.error('shutdown failed:', err); process.exit(1); }); });

process.on('unhandledRejection', (reason) => {
  console.error('[UnhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[UncaughtException]', err);
  process.exit(1);
});

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
