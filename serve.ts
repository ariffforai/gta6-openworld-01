// SOLMAR — Streets of Fortune. A small static dev server for the game.
// Serves game/ on localhost so index.html can be played in a desktop
// browser (ES modules and the import map need HTTP, not file://).
// Node 22, standard library only, no dependencies, no network beyond
// the local loopback:
//
//   node serve.ts        # http://localhost:8901
//   node serve.ts 8080   # pick a port

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(fileURLToPath(import.meta.url));
const ROOT = join(REPO, 'game');
const PORT = Number(process.argv[2] ?? 8901);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = createServer((req, res) => {
  const raw = decodeURIComponent(req.url?.split('?')[0] ?? '/');
  const rel = raw === '/' ? 'index.html' : raw.replace(/^\/+/, '');
  const path = resolve(join(ROOT, normalize(rel)));
  // Never serve anything outside game/.
  if (!path.startsWith(ROOT + sep) && path !== ROOT) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('Forbidden\n');
    return;
  }
  if (!existsSync(path) || !statSync(path).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found\n');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(path).pipe(res);
});

server.on('error', (err) => {
  console.error(`Could not listen on port ${PORT}: ${err.message}`);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`SOLMAR dev server: http://localhost:${PORT}/ (serving game/)`);
});
