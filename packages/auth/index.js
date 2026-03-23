const { createClient } = require('./lib/client');
const { requireAuth, optionalAuth } = require('./lib/middleware');
const { createAuthRouter } = require('./lib/router');

module.exports = {
  createClient,
  requireAuth,
  optionalAuth,
  createAuthRouter,
};
