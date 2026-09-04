/**
 * Tiny static file server for the schematic-spawner web UI.
 * Serves the repo root as the document root so that /src/web/index.html
 * is the page URL. Uses only node:http and node:fs.
 */

import { createServer } from 'node:http';
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Circuit } from '../core/model.js';
import { runCommand } from '../core/commands.js';
import { svgString } from '../core/render.js';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 8080;

// Repo root = two levels up from this file (src/web/serve.js).
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)), '..');
const CIRCUITS_ROOT = resolve(process.env.CIRCUITS_ROOT || join(ROOT, 'circuits'));
const DATA_ROOT = resolve(process.env.DATA_ROOT || join(ROOT, 'data'));
const ACTIVE_FILE = resolve(process.env.ACTIVE_FILE || join(DATA_ROOT, 'active.json'));

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

function decodedCircuitName(value) {
  try {
    return circuitName(decodeURIComponent(value));
  } catch {
    return null;
  }
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

  const cmdMatch = url.pathname.match(/^\/api\/circuits\/([^/]+)\/cmd$/);
  if (cmdMatch) {
    const name = decodedCircuitName(cmdMatch[1]);
    if (!name) { json(res, 400, { error: 'invalid circuit name' }); return true; }
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); res.end(); return true; }
    try {
      const body = await requestBody(req);
      const rawCmd = body.cmd;
      if (rawCmd === undefined || rawCmd === null) {
        json(res, 400, { error: 'missing "cmd" field (string or newline-separated string)' });
        return true;
      }
      // Accept a single string OR a string of newline-separated lines OR a string[].
      const lines = Array.isArray(rawCmd)
        ? rawCmd.map((s) => String(s)).filter((s) => s.trim() !== '')
        : String(rawCmd).split('\n').map((s) => s.trim()).filter((s) => s !== '');
      const circuit = await loadOrCreateCircuit(name);
      const results = [];
      let mutated = false;
      for (const line of lines) {
        try {
          const r = runCommand(circuit, line);
          results.push({ ok: true, text: r.text, json: r.json, mutated: !!r.mutated });
          if (r.mutated) mutated = true;
        } catch (err) {
          results.push({ ok: false, error: err.message, line });
          break; // stop on first error so state is consistent
        }
      }
      if (mutated) await saveCircuit(circuit, name);
      await setActive(name); // any command (even a read-only one) selects the circuit
      json(res, 200, { name, mutated, results, state: circuit.toJSON() });
    } catch (err) {
      json(res, 400, { error: `could not run command: ${err.message}` });
    }
    return true;
  }

  const match = url.pathname.match(/^\/api\/circuits\/([^/]+)$/);
  if (!match) return false;
  const name = decodedCircuitName(match[1]);
  if (!name) {
    json(res, 400, { error: 'invalid circuit name' });
    return true;
  }
  const dir = resolve(CIRCUITS_ROOT, name);
  const statePath = join(dir, 'circuit.json');

  if (req.method === 'DELETE') {
    try {
      const entry = await lstat(dir);
      // Refuse to remove anything other than an actual persisted circuit
      // directory. In particular, do not follow a symlink outside CIRCUITS_ROOT.
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        json(res, 404, { error: 'circuit not found' });
        return true;
      }
      await rm(dir, { recursive: true, force: false });
    } catch (err) {
      if (err.code === 'ENOENT') {
        json(res, 404, { error: 'circuit not found' });
      } else {
        json(res, 500, { error: `could not delete circuit: ${err.message}` });
      }
      return true;
    }
    if (activeName === name) await setActive('');
    json(res, 200, { name, deleted: true });
    return true;
  }

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
      await saveCircuit(circuit, name);
      json(res, 200, { name, files: ['circuit.json', 'circuit.svg'] });
    } catch (err) {
      const hint = err.message.includes('unknown component type')
        ? '; restart the server after changing the symbol registry'
        : '';
      json(res, 400, { error: `could not save circuit: ${err.message}${hint}` });
    }
    return true;
  }

  res.writeHead(405, { Allow: 'GET, PUT, DELETE' });
  res.end();
  return true;
}

/** Active-circuit state — the circuit the agent is currently driving.
 *  Persisted to data/active.json so a server restart preserves the selection.
 *  Browser clients poll /api/active to auto-load whatever the agent edits. */
let activeName = '';

async function loadActive() {
  try {
    const data = JSON.parse(await readFile(ACTIVE_FILE, 'utf8'));
    if (typeof data.active === 'string' && circuitName(data.active)) activeName = data.active;
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`warning: could not read ${ACTIVE_FILE}: ${err.message}`);
  }
}

async function setActive(name) {
  if (name === activeName) return;
  activeName = name;
  try {
    await mkdir(DATA_ROOT, { recursive: true });
    const tmp = ACTIVE_FILE + '.tmp';
    await writeFile(tmp, JSON.stringify({ active: name, ts: Date.now() }));
    await rename(tmp, ACTIVE_FILE);
  } catch (err) {
    console.error(`warning: could not persist active circuit: ${err.message}`);
  }
}

async function handleActiveApi(req, res, url) {
  if (url.pathname !== '/api/active') return false;
  if (req.method === 'GET') {
    json(res, 200, { active: activeName });
    return true;
  }
  if (req.method === 'PUT' || req.method === 'POST') {
    try {
      const body = await requestBody(req);
      const name = circuitName(body && body.active);
      if (!name) { json(res, 400, { error: 'invalid circuit name' }); return true; }
      await setActive(name);
      json(res, 200, { active: activeName });
    } catch (err) {
      json(res, 400, { error: `could not set active: ${err.message}` });
    }
    return true;
  }
  if (req.method === 'DELETE') {
    activeName = '';
    try { await writeFile(ACTIVE_FILE, JSON.stringify({ active: '', ts: Date.now() })); } catch {}
    json(res, 200, { active: '' });
    return true;
  }
  res.writeHead(405, { Allow: 'GET, PUT, POST, DELETE' });
  res.end();
  return true;
}

async function loadOrCreateCircuit(name) {
  const statePath = join(CIRCUITS_ROOT, name, 'circuit.json');
  try {
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    return Circuit.fromJSON(state);
  } catch (err) {
    if (err.code === 'ENOENT') return new Circuit();
    throw err;
  }
}

async function saveCircuit(circuit, name) {
  const dir = resolve(CIRCUITS_ROOT, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'circuit.json'), JSON.stringify(circuit.toJSON(), null, 2));
  await writeFile(join(dir, 'circuit.svg'), svgString(circuit, {
    grid: true, terminals: false, junctions: false, background: true, netNames: true,
  }));
}

const server = createServer(async (req, res) => {
  const noCache = { 'Cache-Control': 'no-store, max-age=0' };
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/api/active') {
      if (await handleActiveApi(req, res, url)) return;
    }
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

mkdir(CIRCUITS_ROOT, { recursive: true }).then(() => loadActive()).then(() => {
  server.listen(PORT, HOST, () => {
    console.log(`Schematic Spawner running at http://${HOST}:${PORT}/src/web/index.html`);
    if (activeName) console.log(`Active circuit: ${activeName}`);
  });
}).catch((err) => {
  console.error(`Could not initialize circuits directory: ${err.message}`);
  process.exitCode = 1;
});
