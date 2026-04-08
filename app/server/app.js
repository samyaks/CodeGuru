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
const reviewRoutes = require('./routes/reviews');
const githubRoutes = require('./routes/github');
const fixPromptRoutes = require('./routes/fix-prompts');
const { getDb, closeDb } = require('./lib/db');
const { requestLogger } = require('./lib/logger');
const { AppError } = require('./lib/app-error');

const { createClient, createAuthRouter, requireAuth, optionalAuth } = require('@codeguru/auth');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(requestLogger());

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000', 'http://localhost:3001'];

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
app.use(express.json());
app.use(cookieParser());

// Auth setup
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;

const FRONTEND_URL = process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000';

if (supabase) {
  app.use(createAuthRouter({
    supabase,
    providers: ['github', 'google'],
    afterLogin: `${FRONTEND_URL}/dashboard`,
    afterLogout: `${FRONTEND_URL}/`,
  }));
}

app.get('/auth/clear', (req, res) => {
  res.clearCookie('sb-access-token', { path: '/' });
  res.clearCookie('sb-refresh-token', { path: '/' });
  res.json({ message: 'Auth cookies cleared' });
});

const TOKEN_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
};

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
  res.cookie('sb-access-token', access_token, TOKEN_COOKIE_OPTIONS);
  if (refresh_token) {
    res.cookie('sb-refresh-token', refresh_token, TOKEN_COOKIE_OPTIONS);
  }
  if (provider_token) {
    res.cookie('gh-provider-token', provider_token, TOKEN_COOKIE_OPTIONS);
  }
  res.json({ ok: true });
});

// Public routes
app.use(healthRoutes);
app.use('/api/fix', fixPromptRoutes);
app.use('/api/analyze', analyzeRoutes);

// Takeoff routes — analyze is public, deploy requires auth
if (supabase) {
  app.use('/api/takeoff', optionalAuth(supabase), takeoffRoutes);
  app.use('/api/deploy', requireAuth(supabase), deployRoutes);
  app.use('/api/projects', requireAuth(supabase), projectRoutes);
  app.use('/api/projects/:projectId/story', requireAuth(supabase), buildStoryRoutes);
} else {
  app.use('/api/takeoff', takeoffRoutes);
  app.use('/api/deploy', (req, res) => {
    res.status(503).json({ error: 'Authentication must be configured to use deploy. Set SUPABASE_URL and SUPABASE_ANON_KEY.' });
  });
  app.use('/api/projects', projectRoutes);
  app.use('/api/projects/:projectId/story', (req, res) => {
    res.status(503).json({ error: 'Authentication must be configured for BuildStory.' });
  });
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

  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Invalid or expired token', code: 'UNAUTHORIZED' });
  }

  console.error(`[UnhandledError] ${req.method} ${req.originalUrl}:`, err);
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
}

let server;

async function start() {
  getDb();
  console.log('Database initialized');

  validateEnv();

  server = app.listen(PORT, () => {
    console.log(`Takeoff server running on port ${PORT}`);
    console.log(`Health: http://localhost:${PORT}/health`);
    console.log(`API: http://localhost:${PORT}/api/takeoff`);
    if (supabase) {
      console.log('Auth: Supabase connected');
    } else {
      console.log('Auth: Running without Supabase (set SUPABASE_URL and SUPABASE_ANON_KEY to enable)');
    }
  });
}

function shutdown() {
  console.log('Shutting down gracefully...');
  if (server) {
    server.close(() => {
      closeDb();
      console.log('Server closed');
      process.exit(0);
    });
  } else {
    closeDb();
    process.exit(0);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

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
