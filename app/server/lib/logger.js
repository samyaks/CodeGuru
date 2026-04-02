function requestLogger() {
  return (req, res, next) => {
    if (req.path === '/health') return next();

    const start = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
    });

    next();
  };
}

module.exports = { requestLogger };
