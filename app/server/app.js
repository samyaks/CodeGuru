require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const healthRoutes = require('./routes/health');
const analyzeRoutes = require('./routes/analyze');
const reviewRoutes = require('./routes/reviews');
const githubRoutes = require('./routes/github');
const fixPromptRoutes = require('./routes/fix-prompts');
const { getDb } = require('./lib/db');

const { createClient, createAuthRouter, requireAuth } = require('@codeguru/auth');

const app = express();
const PORT = process.env.PORT || 3001;

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

app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  getDb();
  console.log('Database initialized');

  app.listen(PORT, () => {
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

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
