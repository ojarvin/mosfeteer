/**
 * Browser tests' harness: the editor served from a temporary workspace and
 * driven in headless Chromium over one CDP connection. Each `start()` uses
 * its own free ports and temporary folders and `stop()` ends only the
 * processes it started. Without a Chromium (CHROME, or chromium /
 * chromium-browser / google-chrome on the PATH) `chromePath()` is null and
 * the browser tests skip.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));

// node:test gives hooks no time limit (--test-timeout covers tests only), and
// most tests start their editor in a `before` hook: every wait in start() has
// a deadline of its own, so a stuck start fails instead of hanging the run.
// Deadlines read a monotonic clock: a suspend or a clock change never expires
// one early.
const now = () => performance.now();
const within = (promise, ms, what) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what}: no answer in ${ms} ms`)), ms); })])
    .finally(() => clearTimeout(timer));
};

// Every server and browser started here, ended with this process whatever
// way it ends, so a failed or cancelled test file leaves none behind.
const children = new Set();
process.once('exit', () => { for (const child of children) signal(child, 'SIGKILL'); });
// A browser starts in a process group of its own (`detached`) and is
// signalled as one: its renderers and helpers end with it, not after it.
const groups = new WeakSet();
const signal = (child, name) => {
  try { if (groups.has(child)) process.kill(-child.pid, name); else child.kill(name); } catch { /* gone */ }
};
const track = (child, { group = false } = {}) => {
  children.add(child);
  if (group) groups.add(child);
  child.once('exit', () => children.delete(child));
  return child;
};
/** End `child`: SIGTERM, then SIGKILL if it has not gone within `ms`. Its
 *  pipes are closed either way, so it never keeps the test process alive. */
async function end(child, ms = 5000) {
  if (child.exitCode === null && child.signalCode === null) {
    const gone = new Promise((resolve) => child.once('exit', resolve));
    signal(child, 'SIGTERM');
    try { await within(gone, ms, 'exit'); } catch { signal(child, 'SIGKILL'); await within(gone, ms, 'exit').catch(() => {}); }
  }
  for (const stream of [child.stdout, child.stderr]) stream?.destroy();
  children.delete(child);
}

// Installed before the page's own scripts: a gate on its timers, so a test can
// make a gesture's events one moment however slowly this machine delivers
// them. While held (gesture()), a timer that comes due waits; on release the
// waiting ones run, unless the gesture's own events cleared them. A right
// press and release are then a tap, not a hold, even when the release reaches
// the page later than the hold's 320 ms.
const TIMER_GATE = `(() => {
  const set = window.setTimeout.bind(window);
  const clear = window.clearTimeout.bind(window);
  const waiting = new Map();
  let held = 0;
  window.setTimeout = (fn, ms, ...args) => {
    const run = typeof fn === 'function' ? () => fn(...args) : () => (0, eval)(fn);
    const id = set(() => { if (held) waiting.set(id, run); else run(); }, ms);
    return id;
  };
  window.clearTimeout = (id) => { waiting.delete(id); clear(id); };
  window.__holdTimers = () => { held += 1; };
  window.__releaseTimers = () => {
    held = Math.max(0, held - 1);
    if (held) return;
    const due = [...waiting.values()];
    waiting.clear();
    for (const run of due) run();
  };
})();`;
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

/** Skip reason for node:test when no browser is available, or no
 *  WebSocket to drive it with (Node 22 and later have one). */
export const browserSkip = () => {
  if (typeof WebSocket !== 'function') return 'browser tests need Node 22 or later (a global WebSocket)';
  return chromePath() ? false : 'no Chromium found (set CHROME to run browser tests)';
};

function freePort() {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Start a server on `docs` ({ name: state }) and a browser on the editor;
 *  `folder` names the workspace folder (its name shows in the Atlas);
 *  `scale` is the display's device pixels per CSS pixel. */
export async function start({ docs = {}, width = 1400, height = 900, folder = 'ws', scale = 1, gpu = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'mosfeteer-browser-'));
  const workspace = join(root, folder);
  await mkdir(workspace, { recursive: true });
  const home = join(root, 'home');
  await mkdir(join(home, 'Pictures'), { recursive: true });
  for (const [name, state] of Object.entries(docs)) await writeFile(join(workspace, `${name}.json`), JSON.stringify(state));
  const port = await freePort();
  const server = track(spawn(process.execPath, [join(REPO, 'src/server/serve.js')], {
    cwd: REPO,
    // A home of its own: nothing a test does (an export to ~/Pictures) reaches the user's.
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PORT: String(port), SCHEMATIC_WORKSPACE: workspace, DATA_ROOT: join(root, 'data') },
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
  let out = '';
  let chrome = null;
  // A start that fails leaves nothing running: the test fails at once
  // instead of waiting out its time limit on a browser no one drives.
  const abandon = async (err) => {
    await Promise.all([chrome && end(chrome), end(server)]);
    await rm(root, { recursive: true, force: true, maxRetries: 10 });
    throw err;
  };
  await within(new Promise((resolve, reject) => {
    server.stdout.on('data', (chunk) => { out += chunk; if (out.includes('running')) resolve(); });
    server.stderr.on('data', (chunk) => { out += chunk; });
    server.once('exit', () => reject(new Error(out)));
  }), 30000, 'the server start').catch((err) => abandon(new Error(`${err.message}\n${out.trim()}`.trim())));
  // Chrome picks its own debugging port and writes it down, so two
  // browsers started at once never race for one.
  // CI runners (GitHub's Ubuntu) do not allow Chromium's sandbox.
  const sandbox = process.env.CI ? ['--no-sandbox'] : [];
  // Software drawing and nothing in the background: less for each browser
  // to do while the others run.
  const LEAN = ['--disable-gpu', '--disable-background-networking', '--disable-component-update', '--disable-extensions', '--disable-sync', '--mute-audio'];
  const launch = (attempt) => {
    const dir = join(root, attempt ? `chrome-${attempt}` : 'chrome');
    const child = track(spawn(chromePath(), ['--headless=new', ...sandbox, '--remote-debugging-port=0', `--user-data-dir=${dir}`,
      `--window-size=${width},${height}`, '--no-first-run', '--no-default-browser-check', ...LEAN, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, HOME: home }, detached: true }), { group: true });
    const launched = { child, dir, err: '' };
    child.stderr.on('data', (chunk) => { launched.err = (launched.err + chunk).slice(-2000); });
    return launched;
  };
  // A cold start can be slow when several browsers start at once on a busy
  // machine (CI starts six with the unit tests): it is given a deadline,
  // not a count of polls, and one fresh try before the test fails.
  const STARTUP_MS = 45000;
  const pageOf = async (launched) => {
    const deadline = now() + STARTUP_MS;
    let cdpPort = null;
    while (!cdpPort && now() < deadline && launched.child.exitCode === null) {
      try { cdpPort = Number((await readFile(join(launched.dir, 'DevToolsActivePort'), 'utf8')).split('\n')[0]) || null; } catch { /* not up yet */ }
      if (!cdpPort) await sleep(100);
    }
    let targets = [];
    while (cdpPort && !targets.some((t) => t.type === 'page') && now() < deadline) {
      try { targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json`, { signal: AbortSignal.timeout(5000) })).json(); } catch { /* not up yet */ }
      if (!targets.some((t) => t.type === 'page')) await sleep(100);
    }
    return { cdpPort, page: targets.find((t) => t.type === 'page') };
  };
  let launched = launch(0);
  chrome = launched.child;
  let ws;
  try {
    let { cdpPort, page } = await pageOf(launched);
    if (!page) {
      await end(launched.child);
      launched = launch(1);
      chrome = launched.child;
      ({ cdpPort, page } = await pageOf(launched));
    }
    if (!page) throw new Error(`Chromium ${cdpPort ? 'offered no page to drive' : 'did not start'}${launched.err ? `:\n${launched.err.trim()}` : ''}`);
    // A browser just started can refuse its first connection on a busy
    // machine: tried again until the startup deadline.
    const connectBy = now() + STARTUP_MS;
    for (;;) {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      const open = await within(new Promise((resolve) => {
        ws.addEventListener('open', () => resolve(true), { once: true });
        ws.addEventListener('error', () => resolve(false), { once: true });
      }), 15000, 'the connection to Chromium');
      if (open) break;
      if (now() > connectBy) throw new Error(`could not connect to Chromium${launched.err ? `:\n${launched.err.trim()}` : ''}`);
      await sleep(200);
    }
  } catch (err) {
    try { ws?.close(); } catch { /* closed */ }
    await abandon(err);
  }
  let id = 0;
  const pending = new Map();
  const logs = [];
  let crashed = null;
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') logs.push(['exception', msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text]);
    if (msg.method === 'Inspector.targetCrashed') {
      crashed = `the page crashed${launched.err ? `:\n${launched.err.trim()}` : ''}`;
      for (const answer of pending.values()) answer({ error: { message: crashed } });
      pending.clear();
    }
    if (msg.method === 'Page.javascriptDialogOpening') logs.push(['dialog', `${msg.params.type}: ${msg.params.message}`]);
    if (msg.method === 'Runtime.consoleAPICalled') logs.push([msg.params.type, msg.params.args.map((a) => a.value ?? a.description).join(' ')]);
  });
  // Every call answers within a time limit: a page that stops answering
  // fails its test instead of hanging the run.
  const send = (method, params = {}, timeout = 30000) => new Promise((resolve, reject) => {
    if (crashed) { reject(new Error(`${method}: ${crashed}`)); return; }
    const i = ++id;
    const timer = setTimeout(() => { pending.delete(i); reject(new Error(`${method}: no answer in ${timeout} ms${launched.err ? `\n  Chromium: ${launched.err.trim().split('\n').slice(-3).join('\n  ')}` : ''}`)); }, timeout);
    pending.set(i, (m) => { clearTimeout(timer); if (m.error) reject(new Error(`${method}: ${m.error.message}`)); else resolve(m.result); });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  /** Resolves once `expression` is truthy (its value), or throws after `timeout`. */
  const until = async (expression, timeout = 5000) => {
    const deadline = now() + timeout;
    for (;;) {
      try { const value = await evaluate(expression); if (value) return value; } catch { /* page still loading */ }
      if (now() > deadline) {
        // What the page shows then: an open dialog or a focused field often explains it.
        const state = await evaluate(`JSON.stringify({ dialogs: [...document.querySelectorAll('dialog[open]')].map((d) => d.id || d.className), focus: document.activeElement && (document.activeElement.id || document.activeElement.className || document.activeElement.tagName), status: document.getElementById('status-message')?.textContent })`).catch(() => 'unknown');
        throw new Error(`timed out waiting for ${expression}\n  page: ${state}`);
      }
      await sleep(50);
    }
  };
  try {
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Inspector.enable');
    // THROTTLE=8 slows the page's CPU that many times, as a busy CI runner's
    // headless Chromium is: a way to try a test against a slow machine.
    if (process.env.THROTTLE) await send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.THROTTLE) });
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
    // Motion reduced: animations and view transitions finish at once.
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: TIMER_GATE });
    // WebGL even on a software renderer, which the app otherwise declines.
    if (gpu) await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('mosfeteer.gpu', 'on');` });
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    await until(`typeof window.__circuit === 'function' && document.readyState === 'complete' && !document.getElementById('startup-cover')`, STARTUP_MS);
    await evaluate(`(() => { const a = document.getElementById('atlas'); if (a && !a.hidden) document.getElementById('atlas-close')?.click(); })()`);
  } catch (err) {
    try { ws.close(); } catch { /* closed */ }
    await abandon(err);
  }
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

  /** Wait for `expression`, discarding unsaved changes whenever the editor asks. */
  const untilDiscarding = (expression, timeout = 10000) => until(`(() => {
    const dialog = document.getElementById('switch-dialog');
    if (dialog?.open) dialog.querySelector('[value="discard"]').click();
    return ${expression};
  })()`, timeout);
  /** A key as the editor receives it on the canvas. */
  const key = (k, init = {}) => evaluate(`(() => { document.getElementById('canvas').focus(); document.getElementById('canvas').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, ...${JSON.stringify(init)} })); })()`);
  const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  /** A real mouse event; `modifiers` as CDP counts them (Alt 1, Ctrl 2, Meta 4, Shift 8). */
  const mouse = (type, x, y, { button = 'left', clickCount = 1, buttons, modifiers = 0 } = {}) => send('Input.dispatchMouseEvent', {
    type, x, y, button, clickCount, modifiers, buttons: buttons ?? (type === 'mouseReleased' ? 0 : button === 'left' ? 1 : button === 'right' ? 2 : 0),
  });
  /** Wait until the page has caught up: two frames drawn and a task run since
   *  now, so a render, resize, or layout queued before has happened. Its
   *  speed sets how long that takes; the test never guesses. (A message
   *  port, not a timer, so it works while gesture() holds the timers.) */
  const settle = () => evaluate(`new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => done(true);
    channel.port2.postMessage(0);
  })))`);
  /** Run `steps` (real input events) as one moment for the page's timers:
   *  nothing that comes due meanwhile runs until they are all handled. */
  const gesture = async (steps) => {
    await evaluate('window.__holdTimers()');
    try { await steps(); } finally { await evaluate('window.__releaseTimers()'); }
  };
  /** A press and release at one point, never mistaken for a hold. */
  const tap = (x, y, options = {}) => gesture(async () => {
    await mouse('mousePressed', x, y, options);
    await mouse('mouseReleased', x, y, options);
  });
  const screenshot = async (path, clip) => {
    const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    await writeFile(path, Buffer.from(r.data, 'base64'));
  };
  const exceptions = () => logs.filter(([type]) => type === 'exception' || type === 'error').map(([, text]) => text);
  const stop = async () => {
    try { ws.close(); } catch { /* closed */ }
    await Promise.all([end(chrome), end(server)]);
    await rm(root, { recursive: true, force: true, maxRetries: 10 });
  };
  return { send, evaluate, until, untilDiscarding, module, open, key, click, mouse, gesture, tap, settle, screenshot, exceptions, stop, logs, workspace, home, port };
}

/** The desk at rest: its snapshot the same over two frames in a row, however
 *  long a busy machine takes to get there. */
export async function stillDesk(h, timeout = 15000) {
  const deadline = now() + timeout;
  let last = '';
  for (;;) {
    await h.settle();
    const snapshot = JSON.stringify(await h.evaluate(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot())`));
    if (snapshot === last) return JSON.parse(snapshot);
    if (now() > deadline) throw new Error('the desk never came to rest');
    last = snapshot;
  }
}
