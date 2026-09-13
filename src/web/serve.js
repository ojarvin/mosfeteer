/**
 * Tiny static file server for the schematic-spawner web UI.
 * Serves the repo root as the document root so that /src/web/index.html
 * is the page URL. Uses only node:http and node:fs.
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDocument, documentKind, loadDocument, renderDocument } from '../core/document.js';
import { runCommand } from '../core/commands.js';
import { renderAscii } from '../core/ascii.js';
import { svgString } from '../core/render.js';
import { generateCircuit, routeCircuit } from '../core/generator.js';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 8080;

// Repo root = two levels up from this file (src/web/serve.js).
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)), '..');
const CIRCUITS_ROOT = resolve(process.env.CIRCUITS_ROOT || join(ROOT, 'circuits'));
const DATA_ROOT = resolve(process.env.DATA_ROOT || join(ROOT, 'data'));
const ACTIVE_FILE = resolve(process.env.ACTIVE_FILE || join(DATA_ROOT, 'active.json'));
const generationPreviews = new Map();
const circuitLocks = new Map();
const MAX_GENERATION_PREVIEWS = 32;

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

function json(res, status, value, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    ...headers,
  });
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

function generationError(message, status = 422, code = 'generation-error') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function withCircuitLock(name, action) {
  const previous = circuitLocks.get(name);
  const run = (previous || Promise.resolve()).catch(() => {}).then(action);
  circuitLocks.set(name, run);
  return run.finally(() => {
    if (circuitLocks.get(name) === run) circuitLocks.delete(name);
  });
}

async function circuitRevision(name) {
  try {
    const info = await stat(join(CIRCUITS_ROOT, name, 'circuit.json'), { bigint: true });
    return `${info.mtimeNs.toString(36)}-${info.size.toString(36)}`;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function circuitHeaders(revision) {
  return revision ? { ETag: `"${revision}"`, 'X-Circuit-Revision': revision } : {};
}

function ifNoneMatch(req, revision) {
  if (!revision) return false;
  const value = req.headers['if-none-match'];
  if (!value) return false;
  const etag = `"${revision}"`;
  return value.split(',').some((tag) => tag.trim() === '*' || tag.trim() === revision || tag.trim() === etag);
}

async function atomicCircuitSave(name, files, { createOnly = false } = {}) {
  await mkdir(CIRCUITS_ROOT, { recursive: true });
  const dir = resolve(CIRCUITS_ROOT, name);
  const stage = join(CIRCUITS_ROOT, `.${name}.${randomUUID()}.tmp`);
  const backup = join(CIRCUITS_ROOT, `.${name}.${randomUUID()}.old`);
  await mkdir(stage);
  let staged = true;
  let replaced = false;
  try {
    for (const [fileName, content] of files) await writeFile(join(stage, fileName), content);
    try {
      await rename(dir, backup);
      replaced = true;
      if (createOnly) {
        await rename(backup, dir);
        replaced = false;
        const error = new Error('circuit already exists');
        error.code = 'EEXIST';
        throw error;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      await rename(stage, dir);
      staged = false;
    } catch (error) {
      if (replaced) {
        await rename(backup, dir).catch(() => {});
        replaced = false;
      }
      throw error;
    }
    if (replaced) await rm(backup, { recursive: true, force: true }).catch(() => {});
  } finally {
    if (staged) await rm(stage, { recursive: true, force: true }).catch(() => {});
    if (replaced) await rm(backup, { recursive: true, force: true }).catch(() => {});
  }
}

async function handleCircuitApi(req, res, url) {
  const generateMatch = url.pathname.match(/^\/api\/circuits\/([^/]+)\/generate$/);
  if (generateMatch) {
    const name = decodedCircuitName(generateMatch[1]);
    if (!name) { json(res, 400, { error: 'invalid circuit name' }); return true; }
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); res.end(); return true; }
    try {
      const body = await requestBody(req);
      const mode = body.mode || 'preview';
      if (mode !== 'preview' && mode !== 'commit') throw generationError('mode must be preview or commit', 400, 'invalid-mode');
      if (mode === 'commit') {
        const preview = body.previewId ? generationPreviews.get(body.previewId) : null;
        if (!preview || preview.target !== name || !preview.state) throw generationError('previewId is missing or does not match this circuit', 409, 'preview-required');
        const committed = loadDocument(preview.state);
        if (name === activeName) throw generationError('generated circuits cannot replace the active circuit', 409, 'circuit-exists');
        try { await stat(join(CIRCUITS_ROOT, name)); throw generationError('target circuit already exists', 409, 'circuit-exists'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        const revision = await saveNewCircuit(committed, name);
        await setActive(name);
        generationPreviews.delete(body.previewId);
        json(res, 200, { ...preview.response, mode, mutated: true, committed: true }, circuitHeaders(revision));
        return true;
      }
      const generated = routeCircuit(generateCircuit(body.spec), body.options || {});
      if (!generated.ok) {
        const error = generationError('generation candidate failed hard checks', 422, 'generation-failed');
        error.report = generated.report;
        throw error;
      }
      const candidate = {
        score: generated.metrics.score,
        issues: generated.metrics.evaluation?.issues || [],
        placement: generated.placement,
        metrics: generated.metrics,
        semantic: generated.semantic,
        report: generated.report,
      };
      const response = {
        name,
        mode,
        previewId: randomUUID(),
        mutated: mode === 'commit',
        committed: mode === 'commit',
        normalizedSpec: generated.spec,
        topology: generated.spec,
        candidate,
        semantic: generated.semantic,
        state: generated.state,
        artifacts: {
          svg: svgString(generated.circuit, { grid: true, terminals: false, junctions: false, background: true, netNames: true }),
          ascii: renderAscii(generated.circuit),
        },
      };
      generationPreviews.set(response.previewId, { target: name, state: generated.state, response });
      while (generationPreviews.size > MAX_GENERATION_PREVIEWS) generationPreviews.delete(generationPreviews.keys().next().value);
      json(res, 200, response);
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 400;
      json(res, status, { error: error.message, code: error.code || 'generation-error', report: error.report });
    }
    return true;
  }
  if (url.pathname === '/api/circuits' && req.method === 'GET') {
    let entries = [];
    try {
      entries = await readdir(CIRCUITS_ROOT, { withFileTypes: true });
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    const names = entries.filter((entry) => entry.isDirectory() && circuitName(entry.name)).map((entry) => entry.name).sort();
    const documents = await Promise.all(names.map(async (name) => {
      try {
        const state = JSON.parse(await readFile(join(CIRCUITS_ROOT, name, 'circuit.json'), 'utf8'));
        return { name, kind: documentKind(state) };
      } catch {
        return { name, kind: 'circuit' };
      }
    }));
    json(res, 200, { circuits: names, documents });
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
      const response = await withCircuitLock(name, async () => {
        const circuit = await loadOrCreateCircuit(name, body.kind);
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
        const revision = mutated ? await saveCircuitFiles(circuit, name) : await circuitRevision(name);
        await setActive(name); // any command (even a read-only one) selects the circuit
        return { name, mutated, results, state: circuit.toJSON(), revision };
      });
      const { revision, ...resultBody } = response;
      json(res, 200, resultBody, circuitHeaders(revision));
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
    return withCircuitLock(name, async () => {
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
    });
  }

  if (req.method === 'POST') {
    try {
      const body = await requestBody(req);
      const circuit = createDocument(body.kind || 'circuit');
      const revision = await saveNewCircuit(circuit, name);
      await setActive(name);
      json(res, 201, { name, kind: documentKind(circuit), files: ['circuit.json', 'circuit.svg'] }, circuitHeaders(revision));
    } catch (err) {
      json(res, err.code === 'EEXIST' ? 409 : 400, { error: `could not create circuit: ${err.message}` });
    }
    return true;
  }

  if (req.method === 'GET') {
    return withCircuitLock(name, async () => {
      try {
        const revision = await circuitRevision(name);
        if (ifNoneMatch(req, revision)) {
          res.writeHead(304, { 'Cache-Control': 'no-store, max-age=0', ...circuitHeaders(revision) });
          res.end();
          return true;
        }
        const state = JSON.parse(await readFile(statePath, 'utf8'));
        loadDocument(state); // Validate and ensure the current document can reload it.
        json(res, 200, { name, state }, circuitHeaders(revision));
      } catch (err) {
        json(res, err.code === 'ENOENT' ? 404 : 400, { error: `could not load circuit: ${err.message}` });
      }
      return true;
    });
  }

  if (req.method === 'PUT') {
    try {
      const body = await requestBody(req);
      const state = body.state;
      const circuit = loadDocument(state);
      const revision = await saveCircuit(circuit, name);
      json(res, 200, { name, files: ['circuit.json', 'circuit.svg'] }, circuitHeaders(revision));
    } catch (err) {
      const hint = err.message.includes('unknown component type')
        ? '; restart the server after changing the symbol registry'
        : '';
      json(res, 400, { error: `could not save circuit: ${err.message}${hint}` });
    }
    return true;
  }

  res.writeHead(405, { Allow: 'GET, POST, PUT, DELETE' });
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
    const active = activeName;
    const revision = active ? await withCircuitLock(active, () => circuitRevision(active)) : null;
    json(res, 200, { active }, revision ? { 'X-Active-Revision': revision } : {});
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

async function loadOrCreateCircuit(name, kind = 'circuit') {
  const statePath = join(CIRCUITS_ROOT, name, 'circuit.json');
  try {
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    return loadDocument(state);
  } catch (err) {
    if (err.code === 'ENOENT') return createDocument(kind);
    throw err;
  }
}

async function saveCircuitFiles(circuit, name, options) {
  const jsonText = JSON.stringify(circuit.toJSON(), null, 2);
  const svgText = renderDocument(circuit, {
    grid: true, terminals: false, junctions: false, background: true, netNames: true,
  });
  await atomicCircuitSave(name, [['circuit.json', jsonText], ['circuit.svg', svgText]], options);
  return circuitRevision(name);
}

async function saveNewCircuit(circuit, name) {
  return withCircuitLock(name, () => saveCircuitFiles(circuit, name, { createOnly: true }));
}

async function saveCircuit(circuit, name) {
  return withCircuitLock(name, () => saveCircuitFiles(circuit, name));
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
