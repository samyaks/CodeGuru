const express = require('express');
const { getDb } = require('../lib/db');

const router = express.Router();

// Liveness probe: process is up and the event loop is responsive.
// Intentionally does NOT touch the DB — on cold boot the pg pool can take
// 10–20s to establish its first connection (DNS + TLS + pooler queue on
// Supabase), and blocking /health on that causes Railway healthchecks to
// time out and restart-loop the container. Use /ready for DB readiness.
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Readiness probe: the app is able to serve DB-backed traffic. Returns 503
// while the pool is still warming up or if the DB is unreachable.
router.get('/ready', async (req, res) => {
  try {
    await getDb().query('SELECT 1 AS ok');
    res.json({ status: 'ok', checks: { database: 'ok' }, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({
      status: 'degraded',
      checks: { database: 'error', error: err.message },
      timestamp: new Date().toISOString(),
    });
  }
});

module.exports = router;
