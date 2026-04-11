const { createClient } = require('./lib/client');
const { requireAuth, optionalAuth, COOKIE_NAME, REFRESH_COOKIE, COOKIE_OPTIONS } = require('./lib/middleware');
const { createAuthRouter } = require('./lib/router');

module.exports = {
  createClient,
  requireAuth,
  optionalAuth,
  createAuthRouter,
  COOKIE_NAME,
  REFRESH_COOKIE,
  COOKIE_OPTIONS,
};
