/**
 * Chromium-family browser discovery, shared by the launcher (app-style window)
 * and export (headless vector PDF printing).
 */

import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { svgPixelSize } from '../core/render.js';

function onPath(names, env) {
  const dirs = String(env.PATH || '').split(delimiter).filter(Boolean);
  for (const name of names) {
    for (const dir of dirs) {
      const candidate = join(dir, name);
      try { if (statSync(candidate).isFile()) return candidate; } catch { /* keep looking */ }
    }
  }
  return null;
}

/**
 * Path of an installed Chromium-family browser, or null. MOSFETEER_BROWSER
 * may name an executable; the value "default" is a launcher preference only.
 */
export function findChromium({ platform = process.platform, env = process.env } = {}) {
  const configured = env.MOSFETEER_BROWSER;
  if (configured && configured !== 'default') return configured;
  if (platform === 'darwin') {
    return ['Google Chrome', 'Chromium', 'Microsoft Edge', 'Brave Browser', 'Vivaldi']
      .map((app) => `/Applications/${app}.app/Contents/MacOS/${app}`)
      .find((path) => existsSync(path)) || null;
  }
  if (platform === 'win32') {
    const roots = [env['PROGRAMFILES(X86)'], env.PROGRAMFILES, env.LOCALAPPDATA].filter(Boolean);
    const relative = ['Microsoft\\Edge\\Application\\msedge.exe', 'Google\\Chrome\\Application\\chrome.exe'];
    for (const root of roots) for (const rel of relative) if (existsSync(join(root, rel))) return join(root, rel);
    return null;
  }
  return onPath(['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable', 'brave', 'brave-browser', 'vivaldi'], env);
}

/**
 * Print an SVG to a one-page vector PDF sized to the drawing, using headless
 * Chromium with a throwaway profile (so it never attaches to a running browser).
 */
export async function printSvgToPdf(svg, { browser = findChromium(), timeoutMs = 60_000 } = {}) {
  if (!browser) throw Object.assign(new Error('no Chromium-family browser found'), { code: 'no-browser' });
  const { width, height } = svgPixelSize(svg);
  const work = await mkdtemp(join(tmpdir(), 'mosfeteer-pdf-'));
  try {
    const page = join(work, 'page.html');
    const out = join(work, 'out.pdf');
    // The SVG is rendered by a real browser, so the page denies scripts and
    // every external load; only the inline drawing and its inline styles run.
    await writeFile(page, `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><style>@page{size:${width}px ${height}px;margin:0}html,body{margin:0;padding:0;background:#fff}svg{display:block;width:${width}px;height:${height}px}</style></head><body>${svg}</body></html>`);
    await new Promise((resolve, reject) => {
      const child = spawn(browser, [
        '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        `--user-data-dir=${join(work, 'profile')}`, '--no-pdf-header-footer',
        `--print-to-pdf=${out}`, pathToFileURL(page).href,
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000); });
      const timer = setTimeout(() => { child.kill(); reject(new Error('PDF printing timed out')); }, timeoutMs);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => {
        clearTimeout(timer);
        if (code === 0 && existsSync(out)) resolve();
        else reject(new Error(`PDF printing failed (${code}): ${stderr.trim().split('\n').pop() || 'no output'}`));
      });
    });
    return await readFile(out);
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
