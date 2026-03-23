require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const healthRoutes = require('./routes/health');
const reviewRoutes = require('./routes/reviews');
const githubRoutes = require('./routes/github');
const { getDb } = require('./lib/db');

const { createClient, createAuthRouter, requireAuth, optionalAuth } = require('@codeguru/auth');

const app = express();
const PORT = process.env.PORT || 3003;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Auth setup — required
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('SUPABASE_URL and SUPABASE_ANON_KEY are required. Set them in .env');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const FRONTEND_URL = process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000';

app.use(createAuthRouter({
  supabase,
  providers: ['github', 'google'],
  afterLogin: `${FRONTEND_URL}/`,
  afterLogout: `${FRONTEND_URL}/`,
}));

app.use('/api', requireAuth(supabase));

app.use(healthRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/github', githubRoutes);

app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  getDb();
  console.log('Database initialized');

  app.listen(PORT, () => {
    console.log(`Code Reviewer server running on port ${PORT}`);
    console.log(`API: http://localhost:${PORT}/api/reviews`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
