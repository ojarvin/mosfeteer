/**
 * Browser tests' harness: the editor served from a temporary workspace and
 * driven in headless Chromium over one CDP connection. Each `start()` uses
 * its own free ports and temporary folders and `stop()` ends only the
 * processes it started. Without a Chromium (CHROME, or chromium /
 * chromium-browser / google-chrome on the PATH) `chromePath()` is null and
 * the browser tests skip.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let found;
export function chromePath() {
  if (found !== undefined) return found;
  found = process.env.CHROME || null;
  for (const name of ['chromium', 'chromium-browser', 'google-chrome']) {
    if (found) break;
    const which = spawnSync('which', [name], { encoding: 'utf8' });
    if (which.status === 0) found = which.stdout.trim();
  }
  return found;
}

/** Skip reason for node:test when no browser is available. */
export const browserSkip = () => (chromePath() ? false : 'no Chromium found (set CHROME to run browser tests)');

function freePort() {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Start a server on `docs` ({ name: state }) and a browser on the editor. */
export async function start({ docs = {}, width = 1400, height = 900 } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'mosfeteer-browser-'));
  const workspace = join(root, 'ws');
  await mkdir(workspace, { recursive: true });
  for (const [name, state] of Object.entries(docs)) await writeFile(join(workspace, `${name}.json`), JSON.stringify(state));
  const port = await freePort();
  const server = spawn(process.execPath, [join(REPO, 'src/server/serve.js')], {
    cwd: REPO,
    env: { ...process.env, PORT: String(port), SCHEMATIC_WORKSPACE: workspace, DATA_ROOT: join(root, 'data') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (chunk) => { out += chunk; if (out.includes('running')) resolve(); });
    server.stderr.on('data', (chunk) => { out += chunk; });
    server.once('exit', () => reject(new Error(out)));
  });
  const cdpPort = await freePort();
  const chrome = spawn(chromePath(), ['--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${join(root, 'chrome')}`,
    `--window-size=${width},${height}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  let targets = [];
  for (let i = 0; i < 100 && !targets.some((t) => t.type === 'page'); i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json(); } catch { /* not up yet */ }
    if (!targets.some((t) => t.type === 'page')) await sleep(100);
  }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') logs.push(['exception', msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text]);
    if (msg.method === 'Runtime.consoleAPICalled') logs.push([msg.params.type, msg.params.args.map((a) => a.value ?? a.description).join(' ')]);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  // Motion reduced: animations and view transitions finish at once.
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  /** Resolves once `expression` is truthy (its value), or throws after `timeout`. */
  const until = async (expression, timeout = 5000) => {
    const end = Date.now() + timeout;
    for (;;) {
      try { const value = await evaluate(expression); if (value) return value; } catch { /* page still loading */ }
      if (Date.now() > end) throw new Error(`timed out waiting for ${expression}`);
      await sleep(50);
    }
  };
  await until(`typeof window.__circuit === 'function' && document.readyState === 'complete' && !document.getElementById('startup-cover')`, 15000);
  await evaluate(`(() => { const a = document.getElementById('atlas'); if (a && !a.hidden) document.getElementById('atlas-close')?.click(); })()`);
  /** An editor module, the same instance the page runs: `module('main.js')`. */
  const module = (file) => `import(new URL(${JSON.stringify(file)}, document.querySelector('script[src="main.js"]').src).href)`;
  /** Open a workspace document by name (discarding unsaved changes when
   *  asked) and wait for it to show. */
  const open = async (name) => {
    const path = join(workspace, `${name}.json`);
    await evaluate(`window.__opened = false; void ${module('document-session.js')}.then((m) => m.openDocumentPath(${JSON.stringify(path)})).finally(() => { window.__opened = true; })`);
    await until(`(() => {
      const dialog = document.getElementById('switch-dialog');
      if (dialog?.open) dialog.querySelector('[value="discard"]').click();
      return window.__opened;
    })()`, 10000);
    await until(`${module('editor-state.js')}.then((m) => m.editor.currentDocumentPath === ${JSON.stringify(path)})`);
    await sleep(100);
  };

  /** A key as the editor receives it on the canvas. */
  const key = (k, init = {}) => evaluate(`(() => { document.getElementById('canvas').focus(); document.getElementById('canvas').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, ...${JSON.stringify(init)} })); })()`);
  const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  /** A real mouse event; `modifiers` as CDP counts them (Alt 1, Ctrl 2, Meta 4, Shift 8). */
  const mouse = (type, x, y, { button = 'left', clickCount = 1, buttons, modifiers = 0 } = {}) => send('Input.dispatchMouseEvent', {
    type, x, y, button, clickCount, modifiers, buttons: buttons ?? (type === 'mouseReleased' ? 0 : button === 'left' ? 1 : button === 'right' ? 2 : 0),
  });
  const screenshot = async (path, clip) => {
    const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    await writeFile(path, Buffer.from(r.data, 'base64'));
  };
  const exceptions = () => logs.filter(([type]) => type === 'exception' || type === 'error').map(([, text]) => text);
  const stop = async () => {
    try { ws.close(); } catch { /* closed */ }
    chrome.kill('SIGTERM');
    server.kill('SIGTERM');
    await sleep(200);
    await rm(root, { recursive: true, force: true });
  };
  return { send, evaluate, until, module, open, key, click, mouse, screenshot, exceptions, stop, logs, workspace, port };
}
