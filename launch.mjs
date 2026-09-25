#!/usr/bin/env node
/**
 * Mosfeteer launcher. Needs only Node.js (>= 18); no `npm install`.
 *
 *   node launch.mjs                      start (or reuse) the app and open it
 *   node launch.mjs <folder>             use <folder> as the workspace
 *   node launch.mjs <file.json>  open a document
 *   node launch.mjs --install            add a desktop/application-menu entry
 *   node launch.mjs --uninstall          remove that entry
 *   node launch.mjs --no-browser         start the server without opening a window
 *
 * The server stops by itself shortly after the last editor window closes.
 * Environment: PORT (default 47280), DATA_ROOT (settings and logs, default
 * `data/`), MOSFETEER_BROWSER ("default" to skip the app-style
 * Chromium window, or a browser executable path).
 */

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(process.env.DATA_ROOT || join(ROOT, 'data'));
const LOG = join(DATA, 'launcher.log');
const APP_NAME = 'Mosfeteer';

function log(line) {
  console.log(line);
  try {
    mkdirSync(DATA, { recursive: true });
    appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
  } catch { /* logging is best effort */ }
}

const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
  log(`${APP_NAME} needs Node.js 18 or newer (found ${process.version}).`);
  process.exit(1);
}

// ----- desktop entry ----------------------------------------------------------

const linuxDesktopFile = () => join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'applications', 'mosfeteer.desktop');
const macAppBundle = () => join(homedir(), 'Applications', `${APP_NAME}.app`);
const quoteDesktopArg = (value) => `"${String(value).replace(/(["`$\\])/g, '\\$1')}"`;
const quoteShell = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

async function install() {
  // GUI sessions often lack the shell PATH that finds Node (nvm, mise, ...),
  // so entries run the Node binary running now by its absolute path. Run
  // --install again if a Node upgrade removes that binary.
  const node = process.execPath;
  const launcher = join(ROOT, 'launch.mjs');
  if (process.platform === 'linux') {
    const file = linuxDesktopFile();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, [
      '[Desktop Entry]',
      'Type=Application',
      `Name=${APP_NAME}`,
      'Comment=Draw and analyze circuit schematics',
      `Exec=${quoteDesktopArg(node)} ${quoteDesktopArg(launcher)} %f`,
      `Icon=${join(ROOT, 'src', 'web', 'icon.svg')}`,
      'Terminal=false',
      'Categories=Development;Electronics;Engineering;',
      '',
    ].join('\n'));
    await chmod(file, 0o755);
    spawnSync('update-desktop-database', [dirname(file)], { stdio: 'ignore' });
    log(`Installed ${file}. ${APP_NAME} now appears in your application launcher.`);
  } else if (process.platform === 'darwin') {
    const bundle = macAppBundle();
    await mkdir(join(bundle, 'Contents', 'MacOS'), { recursive: true });
    await writeFile(join(bundle, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>${APP_NAME}</string>
  <key>CFBundleIdentifier</key><string>io.github.mosfeteer</string>
  <key>CFBundleExecutable</key><string>mosfeteer</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSUIElement</key><true/>
</dict></plist>
`);
    const executable = join(bundle, 'Contents', 'MacOS', 'mosfeteer');
    await writeFile(executable, `#!/bin/sh\nexec ${quoteShell(node)} ${quoteShell(launcher)} "$@"\n`);
    await chmod(executable, 0o755);
    log(`Installed ${bundle}. Open it from Finder, Launchpad, or Spotlight.`);
  } else {
    log(`On Windows, double-click "${join(ROOT, `${APP_NAME}.cmd`)}" or create a shortcut to it.`);
  }
}

async function uninstall() {
  const target = process.platform === 'linux' ? linuxDesktopFile() : process.platform === 'darwin' ? macAppBundle() : null;
  if (!target) return;
  await rm(target, { recursive: true, force: true });
  log(`Removed ${target}.`);
}

// ----- browser ----------------------------------------------------------------

/** A Chromium-family browser can open the editor as a standalone app window. */
async function chromiumBrowser() {
  if (process.env.MOSFETEER_BROWSER === 'default') return null;
  const { findChromium } = await import('./src/server/browser.js');
  return findChromium();
}

function detached(command, args) {
  return new Promise((resolveSpawn) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', () => resolveSpawn(false));
    child.once('spawn', () => { child.unref(); resolveSpawn(true); });
  });
}

async function openBrowser(url) {
  const chromium = await chromiumBrowser();
  if (chromium && await detached(chromium, [`--app=${url}`, '--new-window'])) return;
  const opened = process.platform === 'darwin' ? await detached('open', [url])
    : process.platform === 'win32' ? await detached('cmd', ['/c', 'start', '', url.replace(/&/g, '^&')])
      : await detached('xdg-open', [url]);
  if (!opened) log(`Open ${url} in your browser.`);
}

// ----- server -----------------------------------------------------------------

async function waitUntilStopped(port, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!await runningInstance(port)) return true;
    await new Promise((done) => setTimeout(done, 200));
  }
  return false;
}

async function runningInstance(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
    const data = await response.json();
    return data.app === 'mosfeteer' ? data : null;
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node launch.mjs [folder | document.json] [--install | --uninstall | --no-browser]');
    return;
  }
  if (args.includes('--install')) return install();
  if (args.includes('--uninstall')) return uninstall();
  const noBrowser = args.includes('--no-browser');
  const target = args.find((arg) => !arg.startsWith('--'));

  let workspace = null;
  let openPath = null;
  if (target) {
    const path = resolve(target.replace(/^file:\/\//, ''));
    if (existsSync(path) && statSync(path).isDirectory()) workspace = path;
    else if (existsSync(path)) openPath = path;
    else throw new Error(`"${path}" does not exist`);
  }

  const preferred = Number(process.env.PORT) || 47280;
  let url = null;
  for (let port = preferred; port < preferred + 20 && !url; port += 1) {
    const existing = await runningInstance(port);
    if (existing) {
      if (existing.root !== ROOT) continue; // another checkout of the app
      const { codeFingerprint } = await import('./src/server/fingerprint.js');
      if (existing.version !== codeFingerprint(ROOT)) {
        // Started from older code: replace it on the same port, so open editor
        // windows reconnect and per-origin browser storage is kept.
        log(`${APP_NAME} was updated since the running server started; restarting it.`);
        try { process.kill(existing.pid, 'SIGTERM'); } catch { /* already gone */ }
        if (!await waitUntilStopped(port)) throw new Error(`could not stop the outdated server (pid ${existing.pid}); close it and try again`);
        port -= 1; // retry this port
        continue;
      }
      url = `http://127.0.0.1:${port}/`;
      if (workspace) {
        await fetch(`${url}api/workspace`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: workspace }) });
      }
      log(`${APP_NAME} is already running at ${url}`);
      break;
    }
    const { startApp } = await import('./src/server/app.js');
    try {
      const app = await startApp({ port, dataRoot: DATA, workspace, exitWhenIdle: !noBrowser, log });
      url = app.url;
      log(`${APP_NAME} running at ${url}`);
      log(`Workspace: ${app.workspace()}`);
      if (!noBrowser) log('Close the editor window to stop the server.');
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
    }
  }
  if (!url) throw new Error(`no free port between ${preferred} and ${preferred + 19}`);
  if (noBrowser) return;
  await openBrowser(openPath ? `${url}?open=${encodeURIComponent(openPath)}` : url);
}

main().catch((error) => {
  log(`${APP_NAME} could not start: ${error.message}`);
  process.exitCode = 1;
});
