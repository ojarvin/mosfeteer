/**
 * Tiny static file server for the schematic-spawner web UI.
 * Serves the repo root as the document root so that /src/web/index.html
 * is the page URL. Uses only node:http and node:fs.
 */

import { createServer } from 'node:http';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Circuit } from '../core/model.js';
import { svgString } from '../core/render.js';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 8080;

// Repo root = two levels up from this file (src/web/serve.js).
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)), '..');
const CIRCUITS_ROOT = resolve(ROOT, 'circuits');

const MIME = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.html': 'text/html',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.txt': 'text/plain',
  '.ico': 'image/x-icon',
};

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, max-age=0' });
  res.end(JSON.stringify(value));
}

function circuitName(value) {
  const name = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) return null;
  return name;
}

async function requestBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 5_000_000) throw new Error('request body too large');
  }
  return JSON.parse(body || '{}');
}

async function handleCircuitApi(req, res, url) {
  if (url.pathname === '/api/circuits' && req.method === 'GET') {
    let entries = [];
    try {
      entries = await readdir(CIRCUITS_ROOT, { withFileTypes: true });
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    const names = entries.filter((entry) => entry.isDirectory() && circuitName(entry.name)).map((entry) => entry.name).sort();
    json(res, 200, { circuits: names });
    return true;
  }

  const match = url.pathname.match(/^\/api\/circuits\/([^/]+)$/);
  if (!match) return false;
  const name = circuitName(decodeURIComponent(match[1]));
  if (!name) {
    json(res, 400, { error: 'invalid circuit name' });
    return true;
  }
  const dir = resolve(CIRCUITS_ROOT, name);
  const statePath = join(dir, 'circuit.json');

  if (req.method === 'GET') {
    try {
      const state = JSON.parse(await readFile(statePath, 'utf8'));
      Circuit.fromJSON(state); // Validate and ensure the current model can reload it.
      json(res, 200, { name, state });
    } catch (err) {
      json(res, err.code === 'ENOENT' ? 404 : 400, { error: `could not load circuit: ${err.message}` });
    }
    return true;
  }

  if (req.method === 'PUT') {
    try {
      const body = await requestBody(req);
      const state = body.state;
      const circuit = Circuit.fromJSON(state);
      await mkdir(dir, { recursive: true });
      await writeFile(statePath, JSON.stringify(circuit.toJSON(), null, 2));
      await writeFile(join(dir, 'circuit.svg'), svgString(circuit, {
        grid: true, terminals: false, junctions: false, background: true, netNames: true,
      }));
      json(res, 200, { name, files: ['circuit.json', 'circuit.svg'] });
    } catch (err) {
      json(res, 400, { error: `could not save circuit: ${err.message}` });
    }
    return true;
  }

  res.writeHead(405, { Allow: 'GET, PUT' });
  res.end();
  return true;
}

const server = createServer(async (req, res) => {
  const noCache = { 'Cache-Control': 'no-store, max-age=0' };
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/circuits')) {
      if (await handleCircuitApi(req, res, url)) return;
    }
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') {
      res.writeHead(302, { Location: '/src/web/index.html', ...noCache });
      res.end();
      return;
    }

    // Resolve against the server root, refusing to escape it.
    const filePath = normalize(join(ROOT, pathname));
    if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    let target = filePath;
    try {
      const s = await stat(target);
      if (s.isDirectory()) target = join(target, 'index.html');
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const data = await readFile(target);
    const type = MIME[extname(target).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, ...noCache });
    res.end(data);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal Server Error');
  }
});

mkdir(CIRCUITS_ROOT, { recursive: true }).then(() => {
  server.listen(PORT, HOST, () => {
    console.log(`Schematic Spawner running at http://${HOST}:${PORT}/src/web/index.html`);
  });
}).catch((err) => {
  console.error(`Could not initialize circuits directory: ${err.message}`);
  process.exitCode = 1;
});
