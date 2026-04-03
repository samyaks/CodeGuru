require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const healthRoutes = require('./routes/health');
const analyzeRoutes = require('./routes/analyze');
const reviewRoutes = require('./routes/reviews');
const githubRoutes = require('./routes/github');
const fixPromptRoutes = require('./routes/fix-prompts');
const { getDb, closeDb } = require('./lib/db');
const { requestLogger } = require('./lib/logger');
const { AppError } = require('./lib/app-error');

const { createClient, createAuthRouter, requireAuth } = require('@codeguru/auth');

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
      callback(new Error('Not allowed by CORS'));
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
    afterLogin: `${FRONTEND_URL}/`,
    afterLogout: `${FRONTEND_URL}/`,
  }));
}

// Public routes
app.use(healthRoutes);
app.use('/api/fix', fixPromptRoutes);
app.use('/api/analyze', analyzeRoutes);

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
    return res.status(err.statusCode).json({ error: err.message, code: err.code });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
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
    console.log(`CodeGuru server running on port ${PORT}`);
    console.log(`Health: http://localhost:${PORT}/health`);
    console.log(`API: http://localhost:${PORT}/api/analyze`);
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

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
