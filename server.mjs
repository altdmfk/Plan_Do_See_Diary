/**
 * Zero-dependency Hardened Static Web Server for Plan-Do-See Diary
 * Includes enterprise HTTP security headers, path-traversal prevention, and hidden-file protection.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self';",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=()'
};

const server = http.createServer((req, res) => {
  // Only allow safe HTTP methods for static files
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    res.end('405 Method Not Allowed');
    return;
  }

  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') {
    reqPath = '/index.html';
  }

  // Prevent directory traversal attacks
  const safePath = path.normalize(decodeURIComponent(reqPath)).replace(/^(\.\.[\/\\])+/, '');
  const resolvedPath = path.resolve(__dirname, `.${safePath}`);

  // Ensure path is strictly within project root and not accessing hidden/sensitive files
  if (!resolvedPath.startsWith(__dirname) || path.basename(resolvedPath).startsWith('.') || resolvedPath.includes(path.sep + '.system_generated')) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    res.end('403 Forbidden');
    return;
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.stat(resolvedPath, (statErr, stats) => {
    if (statErr || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      res.end('404 Not Found');
      return;
    }

    const headers = {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      ...SECURITY_HEADERS
    };

    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }

    const stream = fs.createReadStream(resolvedPath);
    res.writeHead(200, headers);
    stream.pipe(res);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      }
      res.end('500 Internal Server Error');
    });
  });
});

server.listen(PORT, () => {
  console.log(`\n🚀 Plan-Do-See Diary server running with hardened security headers at:`);
  console.log(`👉 http://localhost:${PORT}\n`);
});
