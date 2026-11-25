// Invite links are secrets: keep their tokens out of the logs.
function redactUrl(url) {
  return String(url)
    .replace(/(\/api\/invites\/)[^/?#]+/g, '$1[token]')
    .replace(/(\/invite\/|%2Finvite%2F)[A-Za-z0-9_-]+/gi, '$1[token]');
}

function requestLogger() {
  return (req, res, next) => {
    if (req.path === '/health') return next();

    const start = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`${req.method} ${redactUrl(req.originalUrl)} ${res.statusCode} ${duration}ms`);
    });

    next();
  };
}

module.exports = { requestLogger, redactUrl };
