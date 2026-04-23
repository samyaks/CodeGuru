const express = require('express');
const { getDb } = require('../lib/db');

const router = express.Router();

router.get('/health', async (req, res) => {
  let dbStatus = 'ok';
  let dbError;
  try {
    await getDb().query('SELECT 1 AS ok');
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
