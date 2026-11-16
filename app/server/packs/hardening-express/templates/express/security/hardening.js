// Managed by Jibe pack hardening-express@0.1.0
// Configure with env: CORS_ORIGINS (comma-separated allowed origins).
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

function allowedOrigins() {
  return (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Call right after `const app = express()`, before any routes.
function applyHardening(app) {
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({
    origin(requestOrigin, callback) {
      // Requests with no Origin header (curl, server-to-server) are not browser CORS requests.
      if (!requestOrigin) return callback(null, true);
      return callback(null, allowedOrigins().includes(requestOrigin));
    },
  }));
  app.use(rateLimit({
    windowMs: 60 * 1000,
    limit: {{rateLimitPerMinute}},
    standardHeaders: true,
    legacyHeaders: false,
  }));
}

// Register after all routes, before app.listen. Logs details server-side only.
function hardeningErrorHandler(err, req, res, next) {
  console.error(err);
  if (res.headersSent) return next(err);
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  res.status(status).json({ error: status >= 500 ? 'Internal Server Error' : 'Request failed' });
}

module.exports = { applyHardening, hardeningErrorHandler };
