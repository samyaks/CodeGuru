const express = require('express');
const { getDb } = require('../lib/db');

const router = express.Router();

router.get('/health', (req, res) => {
  let dbStatus = 'ok';
  let dbError;
  try {
    getDb().prepare('SELECT 1 AS ok').get();
  } catch (err) {
    dbStatus = 'error';
    dbError = err.message;
  }

  if (dbStatus === 'ok') {
    return res.json({ status: 'ok', checks: { database: 'ok' }, timestamp: new Date().toISOString() });
  }

  res.status(503).json({ status: 'degraded', checks: { database: 'error', error: dbError }, timestamp: new Date().toISOString() });
});

module.exports = router;
