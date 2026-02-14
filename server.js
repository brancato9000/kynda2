import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Proxy /api/claude → Anthropic API (keeps key server-side)
app.use('/api/claude', (req, res, next) => {
  req.headers['x-api-key'] = process.env.ANTHROPIC_API_KEY;
  req.headers['anthropic-version'] = '2023-06-01';
  next();
}, createProxyMiddleware({
  target: 'https://api.anthropic.com',
  changeOrigin: true,
  pathRewrite: { '^/api/claude': '/v1/messages' },
}));

// Serve built frontend
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Kynda running at http://localhost:${PORT}`);
});
