const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function (app) {
  const target = 'http://localhost:4000';
  const opts = { target, changeOrigin: true };
  app.use('/api', createProxyMiddleware(opts));
  app.use('/downloads', createProxyMiddleware(opts));
};
