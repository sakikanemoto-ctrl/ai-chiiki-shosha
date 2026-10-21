// ローカル確認用サーバー（本番の Vercel では使わない）。
// public/ を配信し、/api/* を api/ の関数に渡す。  node dev-server.mjs
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const routes = {
  '/api/listings': () => import('./api/listings.js'),
  '/api/parse': () => import('./api/parse.js'),
  '/api/draft': () => import('./api/draft.js'),
  '/api/auth': () => import('./api/auth.js'),
  '/api/deals': () => import('./api/deals.js'),
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.status = code => { res.statusCode = code; return res; };
  res.json = body => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); return res; };
  try {
    if (routes[url.pathname]) {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 1_000_000) return res.status(413).json({ error: 'too_large' }); }
      try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
      const { default: handler } = await routes[url.pathname]();
      return await handler(req, res);
    }
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.join(root, 'public', rel);
    if (!file.startsWith(path.join(root, 'public'))) return res.status(403).end();
    const data = await fs.readFile(file);
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).end('Not found');
    console.error(err);
    res.status(500).end('Server error');
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
