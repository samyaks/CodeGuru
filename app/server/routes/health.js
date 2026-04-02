const express = require('express');
const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.get('/api/info', (req, res) => {
  res.json({
    name: 'CodeGuru API',
    status: 'ok',
    version: '0.1.0',
  });
});

module.exports = router;
