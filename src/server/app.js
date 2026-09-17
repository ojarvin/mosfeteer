/**
 * Local HTTP server for the schematic-spawner editor. Uses only Node built-ins.
 *
 * Static files: the editor (`/src/web`) and the shared core (`/src/core`).
 * Document API: files addressed by absolute path, plus a workspace folder that
 * the document picker lists and new documents are saved into.
 * Command API: `/api/circuits/<name>` (read), `.../cmd`, `.../generate`, and `/api/active` for the
 * CLI; `<name>` is `<workspace>/<name>.schematic.json`.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand } from '../core/commands.js';
import { createDocument, documentKind, loadDocument } from '../core/document.js';
import { generateCircuit, routeCircuit } from '../core/generator.js';
import { svgString } from '../core/render.js';
import {
  absolutePath, browseFolder, deleteDocumentFile, describeDocument, documentNameFromPath, documentPathFor,
  fileRevision, isJsonFile, listDocuments, readDocumentFile, serializeDocument, validDocumentName, writeFileAtomic,
} from './documents.js';
import { findChromium, printSvgToPdf, svgPixelSize } from './browser.js';
import { codeFingerprint } from './fingerprint.js';
import { importLegacyCircuits, legacyElectronCircuitsDir } from './legacy-import.js';
import { pngToPdf } from './pdf-raster.js';
import { allowedHosts, checkRequest } from './request-guard.js';
import { createSettingsStore, defaultWorkspace } from './settings.js';

export const APP_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const DEFAULT_PORT = 47280;

const STATIC_DIRS = [join(APP_ROOT, 'src', 'web') + sep, join(APP_ROOT, 'src', 'core') + sep];
const MAX_GENERATION_PREVIEWS = 32;
const MIME = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.html': 'text/html',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// A CLI circuit name maps to one workspace file, so keep it shell-friendly.
function commandCircuitName(value) {
  let name;
  try { name = decodeURIComponent(value); } catch { return null; }
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name) ? name : null;
}

function httpError(message, status = 400, code) {
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

function json(res, status, value, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, max-age=0', ...headers });
  res.end(JSON.stringify(value));
}

function revisionHeaders(revision) {
  return revision ? { ETag: `"${revision}"`, 'X-Circuit-Revision': revision } : {};
}

function matchesEtag(req, revision) {
  const value = req.headers['if-none-match'];
  if (!revision || !value) return false;
  return value.split(',').some((tag) => ['*', revision, `"${revision}"`].includes(tag.trim()));
}

async function requestBody(req, limit = 10_000_000) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw httpError('request body too large', 413);
  }
  try {
    return JSON.parse(body || '{}');
  } catch {
    throw httpError('request body is not valid JSON');
  }
}

function openInFileManager(path) {
  const [command, args] = process.platform === 'darwin' ? ['open', ['-R', path]]
    : process.platform === 'win32' ? ['explorer.exe', [`/select,${path}`]]
      : ['xdg-open', [dirname(path)]];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

export async function startApp({
  host = '127.0.0.1',
  port = DEFAULT_PORT,
  dataRoot = join(APP_ROOT, 'data'),
  workspace: workspaceOverride = null,
  legacySources = [join(APP_ROOT, 'circuits'), legacyElectronCircuitsDir()],
  pdfBrowser = findChromium(),
  exitWhenIdle = false,
  onIdle = () => process.exit(0),
  log = (line) => console.log(line),
} = {}) {
  const version = codeFingerprint(APP_ROOT);
  const settings = createSettingsStore(join(dataRoot, 'settings.json'));
  await settings.load();
  if (workspaceOverride) await settings.update({ workspace: resolve(workspaceOverride) });
  const workspace = () => settings.get().workspace || defaultWorkspace();
  await mkdir(workspace(), { recursive: true });

  if (!settings.get().legacyImported && legacySources.length) {
    const imported = await importLegacyCircuits(workspace(), legacySources);
    if (imported.length) log(`Imported ${imported.length} earlier circuit(s) into ${workspace()}`);
    await settings.update({ legacyImported: true });
  }

  const locks = new Map();
  const withLock = (key, action) => {
    const run = (locks.get(key) || Promise.resolve()).catch(() => {}).then(action);
    locks.set(key, run);
    return run.finally(() => { if (locks.get(key) === run) locks.delete(key); });
  };

  // ----- active circuit (CLI) ----------------------------------------------
  const activeFile = join(dataRoot, 'active.json');
  let activeName = '';
  try {
    const data = JSON.parse(await readFile(activeFile, 'utf8'));
    if (typeof data.active === 'string' && commandCircuitName(data.active)) activeName = data.active;
  } catch { /* no active circuit */ }
  const circuitPath = (name) => documentPathFor(workspace(), name);
  async function setActive(name) {
    if (name === activeName) return;
    activeName = name;
    try {
      await mkdir(dataRoot, { recursive: true });
      await writeFile(`${activeFile}.tmp`, JSON.stringify({ active: name, ts: Date.now() }));
      await rename(`${activeFile}.tmp`, activeFile);
    } catch (error) {
      log(`warning: could not persist active circuit: ${error.message}`);
    }
  }

  // ----- sessions (auto-exit when the last editor tab closes) --------------
  const sessions = new Map();
  let everConnected = false;
  let idleSince = Date.now();
  const SESSION_TIMEOUT = 3 * 60_000; // background tabs may only tick once a minute
  const CLOSE_GRACE = 15_000; // survive a reload
  const NEVER_CONNECTED_TIMEOUT = 5 * 60_000;
  let idleTimer = null;
  if (exitWhenIdle) {
    idleTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, seen] of sessions) if (now - seen > SESSION_TIMEOUT) sessions.delete(id);
      if (sessions.size) { idleSince = now; return; }
      if (now - idleSince > (everConnected ? CLOSE_GRACE : NEVER_CONNECTED_TIMEOUT)) {
        log('No editor windows are open; stopping.');
        clearInterval(idleTimer);
        server.close();
        onIdle();
      }
    }, 2_000);
    idleTimer.unref?.();
  }

  const generationPreviews = new Map();

  async function workspaceInfo() {
    const documents = await listDocuments(workspace());
    const inWorkspace = new Set(documents.map((document) => document.path));
    const recent = [];
    for (const path of settings.get().recent) {
      if (inWorkspace.has(path)) continue;
      try {
        if ((await stat(path)).isFile()) recent.push(await describeDocument(path));
      } catch { /* moved or deleted; keep the entry in case it comes back */ }
    }
    return { workspace: workspace(), home: homedir(), sep, documents, recent };
  }

  async function handleApi(req, res, url) {
    const { pathname } = url;
    const method = req.method;

    if (pathname === '/api/health' && method === 'GET') {
      json(res, 200, { app: 'schematic-spawner', root: APP_ROOT, pid: process.pid, version });
      return;
    }

    if (pathname === '/api/session' && method === 'POST') {
      const body = await requestBody(req);
      const id = String(body.id || '');
      if (id) {
        if (body.closing) sessions.delete(id);
        else { sessions.set(id, Date.now()); everConnected = true; }
      }
      idleSince = Date.now();
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      res.end();
      return;
    }

    if (pathname === '/api/workspace') {
      if (method === 'GET') { json(res, 200, await workspaceInfo()); return; }
      if (method === 'PUT') {
        const body = await requestBody(req);
        const dir = absolutePath(body.path);
        await mkdir(dir, { recursive: true });
        if (!(await stat(dir)).isDirectory()) throw httpError(`"${dir}" is not a folder`);
        await settings.update({ workspace: dir });
        json(res, 200, await workspaceInfo());
        return;
      }
    }

    if (pathname === '/api/browse' && method === 'GET') {
      const dir = absolutePath(url.searchParams.get('dir') || workspace());
      json(res, 200, { ...(await browseFolder(dir)), home: homedir(), workspace: workspace(), sep });
      return;
    }

    if (pathname === '/api/folders' && method === 'POST') {
      const body = await requestBody(req);
      const parent = absolutePath(body.dir);
      const name = validDocumentName(body.name);
      if (!name) throw httpError('invalid folder name');
      const dir = join(parent, name);
      await mkdir(dir);
      json(res, 201, { path: dir });
      return;
    }

    if (pathname === '/api/reveal' && method === 'POST') {
      const body = await requestBody(req);
      const path = absolutePath(body.path);
      await stat(path);
      openInFileManager(path);
      json(res, 200, { path });
      return;
    }

    if (pathname === '/api/export' && method === 'POST') {
      json(res, 200, await exportFiles(await requestBody(req, 150_000_000)));
      return;
    }

    if (pathname === '/api/document') {
      if (method === 'GET') {
        const path = absolutePath(url.searchParams.get('path'));
        await withLock(path, async () => {
          const revision = await fileRevision(path);
          if (matchesEtag(req, revision)) {
            res.writeHead(304, { 'Cache-Control': 'no-store, max-age=0', ...revisionHeaders(revision) });
            res.end();
            return;
          }
          const state = await readDocumentFile(path);
          if (url.searchParams.get('open') === '1') await settings.addRecent(path);
          json(res, 200, { name: documentNameFromPath(path), path, dir: dirname(path), state }, revisionHeaders(revision));
        });
        return;
      }
      if (method === 'PUT') {
        const body = await requestBody(req);
        const path = body.path
          ? absolutePath(body.path)
          : documentPathFor(body.dir ? absolutePath(body.dir) : workspace(), body.name);
        if (!isJsonFile(path)) throw httpError('documents must be saved as .json files');
        let document;
        try {
          document = loadDocument(body.state);
        } catch (error) {
          const hint = error.message.includes('unknown component type') ? '; restart the server after changing the symbol registry' : '';
          throw httpError(`could not save document: ${error.message}${hint}`);
        }
        const revision = await withLock(path, async () => {
          await writeFileAtomic(path, serializeDocument(document), { overwrite: body.overwrite === true });
          return fileRevision(path);
        });
        await settings.addRecent(path);
        json(res, 200, { name: documentNameFromPath(path), path, dir: dirname(path), kind: documentKind(body.state) }, revisionHeaders(revision));
        return;
      }
      if (method === 'DELETE') {
        const path = absolutePath(url.searchParams.get('path'));
        await withLock(path, () => deleteDocumentFile(path));
        await settings.removeRecent(path);
        if (activeName && circuitPath(activeName) === path) await setActive('');
        json(res, 200, { path, deleted: true });
        return;
      }
    }

    if (pathname === '/api/active') {
      if (method === 'GET') {
        const active = activeName;
        const path = active ? circuitPath(active) : '';
        const revision = active ? await withLock(path, () => fileRevision(path)) : null;
        json(res, 200, { active, path }, revision ? { 'X-Active-Revision': revision } : {});
        return;
      }
      if (method === 'PUT' || method === 'POST') {
        const body = await requestBody(req);
        const name = body && typeof body.active === 'string' ? commandCircuitName(body.active) : null;
        if (!name) throw httpError('invalid circuit name');
        await setActive(name);
        json(res, 200, { active: activeName, path: circuitPath(activeName) });
        return;
      }
      if (method === 'DELETE') {
        await setActive('');
        json(res, 200, { active: '' });
        return;
      }
    }

    const readMatch = pathname.match(/^\/api\/circuits\/([^/]+)$/);
    if (readMatch && method === 'GET') {
      const name = commandCircuitName(readMatch[1]);
      if (!name) throw httpError('invalid circuit name');
      const path = circuitPath(name);
      await withLock(path, async () => {
        const revision = await fileRevision(path);
        if (matchesEtag(req, revision)) {
          res.writeHead(304, { 'Cache-Control': 'no-store, max-age=0', ...revisionHeaders(revision) });
          res.end();
          return;
        }
        json(res, 200, { name, path, state: await readDocumentFile(path) }, revisionHeaders(revision));
      });
      return;
    }

    const commandMatch = pathname.match(/^\/api\/circuits\/([^/]+)\/(cmd|generate)$/);
    if (commandMatch && method === 'POST') {
      const name = commandCircuitName(commandMatch[1]);
      if (!name) throw httpError('invalid circuit name');
      const path = circuitPath(name);
      if (commandMatch[2] === 'cmd') await runCircuitCommands(req, res, name, path);
      else await runGeneration(req, res, name, path);
      return;
    }

    if (pathname.startsWith('/api/')) {
      json(res, 404, { error: 'unknown API endpoint' });
      return;
    }
  }

  /**
   * Write rendered exports next to each other: `<dir>/<name>.svg|png|pdf`.
   * The editor renders SVG and PNG (the browser measures equation labels);
   * PDF is printed from the SVG by headless Chromium, or embeds the PNG when
   * no Chromium-family browser is installed.
   */
  async function exportFiles(body) {
    const dir = absolutePath(body.dir);
    const name = validDocumentName(body.name);
    if (!name) throw httpError('invalid export file name');
    const formats = [...new Set((Array.isArray(body.formats) ? body.formats : []).filter((format) => ['svg', 'png', 'pdf'].includes(format)))];
    if (!formats.length) throw httpError('choose at least one export format');
    const svg = typeof body.svg === 'string' ? body.svg : '';
    if (!/^\s*<svg\b/i.test(svg)) throw httpError('export is missing its SVG rendering');
    const pngMatch = typeof body.png === 'string' ? body.png.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/) : null;
    const png = pngMatch ? Buffer.from(pngMatch[1], 'base64') : null;
    if (formats.includes('png') && !png) throw httpError('export is missing its PNG rendering');

    const paths = Object.fromEntries(formats.map((format) => [format, join(dir, `${name}.${format}`)]));
    if (body.overwrite !== true) {
      const existing = [];
      for (const path of Object.values(paths)) {
        try { await stat(path); existing.push(path); } catch { /* free */ }
      }
      if (existing.length) {
        throw Object.assign(httpError(`${existing.length === 1 ? 'a file' : 'files'} with this name already exist${existing.length === 1 ? 's' : ''}`, 409, 'exists'), { existing });
      }
    }

    // Render everything before writing, so a failed PDF leaves no partial export.
    const contents = {};
    const notes = [];
    if (paths.svg) contents.svg = svg;
    if (paths.png) contents.png = png;
    if (paths.pdf) {
      try {
        contents.pdf = await printSvgToPdf(svg, { browser: pdfBrowser });
      } catch (error) {
        if (!png) throw httpError(`could not create PDF: ${error.message}`, 500);
        const { width, height } = svgPixelSize(svg);
        contents.pdf = pngToPdf(png, { widthPt: width * 0.75, heightPt: height * 0.75 });
        notes.push(error.code === 'no-browser'
          ? 'PDF contains a high-resolution image because no Chrome, Chromium, Edge, or Brave browser was found for vector output.'
          : `PDF contains a high-resolution image because vector printing failed: ${error.message}`);
      }
    }
    await mkdir(dir, { recursive: true });
    for (const [format, path] of Object.entries(paths)) await writeFileAtomic(path, contents[format]);
    return { dir, paths: Object.values(paths), notes };
  }

  async function runCircuitCommands(req, res, name, path) {
    const body = await requestBody(req);
    const rawCmd = body.cmd;
    if (rawCmd === undefined || rawCmd === null) throw httpError('missing "cmd" field (string or newline-separated string)');
    const lines = Array.isArray(rawCmd)
      ? rawCmd.map(String).filter((line) => line.trim() !== '')
      : String(rawCmd).split('\n').map((line) => line.trim()).filter(Boolean);
    const { revision, ...response } = await withLock(path, async () => {
      let circuit;
      try {
        circuit = loadDocument(await readDocumentFile(path));
      } catch (error) {
        if (error.status !== 404) throw error;
        circuit = createDocument(body.kind || 'circuit');
      }
      const results = [];
      let mutated = false;
      for (const line of lines) {
        try {
          const result = runCommand(circuit, line);
          results.push({ ok: true, text: result.text, json: result.json, mutated: !!result.mutated });
          if (result.mutated) mutated = true;
        } catch (error) {
          results.push({ ok: false, error: error.message, line });
          break; // stop on first error so state is consistent
        }
      }
      if (mutated) await writeFileAtomic(path, serializeDocument(circuit));
      await setActive(name);
      return { name, path, mutated, results, state: circuit.toJSON(), revision: await fileRevision(path) };
    });
    json(res, 200, response, revisionHeaders(revision));
  }

  async function runGeneration(req, res, name, path) {
    const body = await requestBody(req);
    const mode = body.mode || 'preview';
    if (mode !== 'preview' && mode !== 'commit') throw httpError('mode must be preview or commit', 400, 'invalid-mode');
    if (mode === 'commit') {
      const preview = body.previewId ? generationPreviews.get(body.previewId) : null;
      if (!preview || preview.target !== name || !preview.state) throw httpError('previewId is missing or does not match this circuit', 409, 'preview-required');
      const committed = loadDocument(preview.state);
      if (name === activeName) throw httpError('generated circuits cannot replace the active circuit', 409, 'circuit-exists');
      const revision = await withLock(path, async () => {
        try {
          await writeFileAtomic(path, serializeDocument(committed), { overwrite: false });
        } catch (error) {
          if (error.code === 'exists') throw httpError('target circuit already exists', 409, 'circuit-exists');
          throw error;
        }
        return fileRevision(path);
      });
      await setActive(name);
      generationPreviews.delete(body.previewId);
      json(res, 200, { ...preview.response, mode, mutated: true, committed: true }, revisionHeaders(revision));
      return;
    }
    let generated;
    try {
      generated = routeCircuit(generateCircuit(body.spec), body.options || {});
    } catch (error) {
      // Malformed specs are client errors.
      throw Object.assign(error, { status: error.status || 400, code: error.code || 'generation-error' });
    }
    if (!generated.ok) {
      throw Object.assign(httpError('generation candidate failed hard checks', 422, 'generation-failed'), { report: generated.report });
    }
    const response = {
      name,
      mode,
      previewId: randomUUID(),
      mutated: false,
      committed: false,
      normalizedSpec: generated.spec,
      topology: generated.spec,
      candidate: {
        score: generated.metrics.score,
        issues: generated.metrics.evaluation?.issues || [],
        placement: generated.placement,
        metrics: generated.metrics,
        semantic: generated.semantic,
        report: generated.report,
      },
      semantic: generated.semantic,
      state: generated.state,
      artifacts: {
        svg: svgString(generated.circuit, { grid: true, terminals: false, junctions: false, background: true, netNames: true }),
      },
    };
    generationPreviews.set(response.previewId, { target: name, state: generated.state, response });
    while (generationPreviews.size > MAX_GENERATION_PREVIEWS) generationPreviews.delete(generationPreviews.keys().next().value);
    json(res, 200, response);
  }

  async function serveStatic(req, res, url) {
    const headers = { 'Cache-Control': 'no-store, max-age=0' };
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { pathname = ''; }
    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(302, { Location: `/src/web/index.html${url.search}`, ...headers });
      res.end();
      return;
    }
    if (pathname === '/favicon.ico') pathname = '/src/web/icon.svg';
    const filePath = normalize(join(APP_ROOT, pathname));
    const allowed = STATIC_DIRS.some((dir) => filePath.startsWith(dir));
    let data;
    try {
      if (!allowed) throw new Error('not served');
      data = await readFile(filePath);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
      res.end('Not Found');
      return;
    }
    const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, ...headers });
    res.end(data);
  }

  let hosts = allowedHosts(port, host);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const api = url.pathname.startsWith('/api/');
      const refused = checkRequest({ headers: req.headers, api }, hosts);
      if (refused) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Forbidden: ${refused}`);
        return;
      }
      if (api) await handleApi(req, res, url);
      else await serveStatic(req, res, url);
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      const status = Number.isInteger(error.status) ? error.status
        : error.code === 'ENOENT' ? 404
          : error.code === 'EEXIST' ? 409
            : error.code === 'EACCES' || error.code === 'EPERM' ? 403
              : 500;
      json(res, status, { error: error.message, ...(typeof error.code === 'string' ? { code: error.code } : {}), ...(error.report ? { report: error.report } : {}), ...(error.existing ? { existing: error.existing } : {}) });
    }
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, host, () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
  const actualPort = server.address().port;
  hosts = allowedHosts(actualPort, host);
  const urlHost = ['0.0.0.0', '::'].includes(host) ? '127.0.0.1' : host.includes(':') ? `[${host}]` : host;
  const url = `http://${urlHost}:${actualPort}/`;
  return {
    server,
    url,
    port: actualPort,
    workspace,
    async close() {
      if (idleTimer) clearInterval(idleTimer);
      await new Promise((done) => server.close(() => done()));
      await settings.flush();
    },
  };
}
