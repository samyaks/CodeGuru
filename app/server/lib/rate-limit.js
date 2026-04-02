function createRateLimit({ windowMs = 60000, max = 20, message = 'Too many requests. Please try again later.' } = {}) {
  const hits = new Map();

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now - entry.windowStart > windowMs) hits.delete(key);
    }
  }, windowMs);
  cleanup.unref();

  return function rateLimit(req, res, next) {
    const key = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || now - entry.windowStart > windowMs) {
      hits.set(key, { windowStart: now, count: 1 });
      return next();
    }

    entry.count++;
    if (entry.count > max) {
      return res.status(429).json({ error: message });
    }
    next();
  };
}

module.exports = { createRateLimit };
