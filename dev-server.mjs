// Local development server — lets you test the WHOLE app (live view + editable
// copy) on your own machine with just Node installed. Vercel does NOT use this
// file; in production Vercel serves the static files and runs /api/doc.js itself.
//
// Run:  node dev-server.mjs   (or: npm run dev)
// Open: http://localhost:3000

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import handler from './api/doc.js';

const ROOT = process.cwd();
const PORT = process.env.PORT || 3000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // Route /api/doc through the same handler Vercel uses.
    if (url.pathname === '/api/doc') {
      if (req.method !== 'GET') {
        res.statusCode = 405;
        res.end('Method Not Allowed');
        return;
      }
      const request = new Request(url.href, { method: 'GET' });
      const response = await handler.fetch(request);
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    // Otherwise serve a static file from the project root.
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    const filePath = normalize(join(ROOT, pathname));
    if (!filePath.startsWith(ROOT + sep) && filePath !== ROOT) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }
    const data = await readFile(filePath);
    res.setHeader('content-type', TYPES[extname(filePath)] || 'application/octet-stream');
    res.end(data);
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      res.statusCode = 404;
      res.end('Not found');
    } else {
      res.statusCode = 500;
      res.end('Server error');
    }
  }
});

server.listen(PORT, () => {
  console.log(`\n  Doc Viewer running →  http://localhost:${PORT}\n`);
});
