const { createProxyMiddleware } = require('http-proxy-middleware');

const backendProxy = createProxyMiddleware({
  target: 'http://localhost:3003',
  changeOrigin: true,
});

module.exports = function (app) {
  // Proxy /auth/* to backend EXCEPT /auth/callback, which React handles
  // (Supabase implicit OAuth sends tokens in the URL hash — only the browser can read them)
  app.use('/auth', (req, res, next) => {
    if (req.path === '/callback' || req.path.startsWith('/callback')) {
      return next();
    }
    return backendProxy(req, res, next);
  });
  app.use('/api', backendProxy);
};
