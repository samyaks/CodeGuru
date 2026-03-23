const express = require('express');
const router = express.Router();

router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Code Reviewer',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

router.get('/', (req, res) => {
  res.json({
    message: 'Code Reviewer API',
    description: 'AI-powered first-pass code review for PRs and repositories',
    endpoints: [
      'GET  /health',
      'POST /api/reviews',
      'GET  /api/reviews',
      'GET  /api/reviews/:id',
      'GET  /api/reviews/:id/stream',
      'PATCH /api/reviews/:id',
      'PATCH /api/reviews/:id/files/:fileId',
    ],
  });
});

module.exports = router;
