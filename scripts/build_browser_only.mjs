#!/usr/bin/env node
/**
 * Build the no-server browser entry point.
 *
 * The source editor is intentionally kept as ordinary ES modules for normal
 * development. Browsers commonly block file:// module imports, though, so the
 * browser-only release gets one generated classic script plus the existing
 * stylesheet and font assets.
 */

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(ROOT, 'src', 'web', 'main.js');
const OUTPUT_DIR = join(ROOT, 'browser-only');
const modules = new Map();

function moduleId(file) {
  return relative(ROOT, file).split(sep).join('/');
}

function resolveImport(from, specifier) {
  if (!specifier.startsWith('.')) throw new Error(`browser bundle cannot resolve external import "${specifier}"`);
  const file = resolve(dirname(from), specifier);
  return extname(file) ? file : `${file}.js`;
}

function exportList(raw) {
  return raw.split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
    const [local, as, publicName] = part.split(/\s+/);
    return { local, publicName: as === 'as' ? publicName : local };
  });
}

function importBindings(specifier, dependency) {
  const source = specifier.trim();
  if (source.startsWith('{')) {
    const bindings = source.slice(1, source.lastIndexOf('}')).split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
      const [imported, as, local] = part.split(/\s+/);
      return as === 'as' ? `${imported}: ${local}` : imported;
    });
    return `const { ${bindings.join(', ')} } = __require(${JSON.stringify(dependency)});`;
  }
  if (source.startsWith('* as ')) return `const ${source.slice(5).trim()} = __require(${JSON.stringify(dependency)});`;
  throw new Error(`browser bundle encountered an unsupported import: ${specifier}`);
}

async function loadModule(file) {
  const id = moduleId(file);
  if (modules.has(id)) return id;
  let source = await readFile(file, 'utf8');
  const dependencies = [];

  source = source.replace(/(^|\n)import\s+([\s\S]*?)\s+from\s+(['"])([^'"]+)\3\s*;?/g, (whole, prefix, specifier, quote, rawDependency) => {
    const dependencyFile = resolveImport(file, rawDependency);
    const dependency = loadModuleLater(dependencyFile);
    dependencies.push(importBindings(specifier, moduleId(dependencyFile)));
    return prefix;
  });

  const exports = [];
  source = source.replace(/^export\s*{\s*([^}]+)\s*}\s*from\s*(['"])([^'"]+)\2\s*;?/gm, (_whole, raw, _quote, rawDependency) => {
    const dependencyFile = resolveImport(file, rawDependency);
    loadModuleLater(dependencyFile);
    for (const { local, publicName } of exportList(raw)) exports.push(`__exports.${publicName} = __require(${JSON.stringify(moduleId(dependencyFile))}).${local};`);
    return '';
  });
  source = source.replace(/^export\s*{\s*([^}]+)\s*};?/gm, (_whole, raw) => {
    for (const { local, publicName } of exportList(raw)) exports.push(`__exports.${publicName} = ${local};`);
    return '';
  });
  for (const match of source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) exports.push(`__exports.${match[1]} = ${match[1]};`);
  for (const match of source.matchAll(/^export\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) exports.push(`__exports.${match[1]} = ${match[1]};`);
  source = source.replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|var|class)\b)/gm, '');

  // Reserve the module before walking its imports so the runtime can handle
  // the same benign cycles as native ESM (notably model/router helpers).
  modules.set(id, { source, dependencies, exports });
  for (const dependency of dependencies) void dependency;
  return id;
}

// Loading is synchronous from the transformer's point of view; this helper
// records a promise and the caller awaits all source reads after discovery.
const pending = new Map();
function loadModuleLater(file) {
  const id = moduleId(file);
  if (!pending.has(id)) pending.set(id, loadModule(file));
  return file;
}

await loadModule(ENTRY);
while (pending.size) {
  const jobs = [...pending.values()];
  pending.clear();
  await Promise.all(jobs);
}

// Source reads finish in any order, so emit modules sorted by id: the bundle
// only registers them (each runs on first __require), and a stable order keeps
// rebuilds of unchanged sources byte-identical.
const moduleSource = [...modules.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, module]) => [
  `__modules[${JSON.stringify(id)}] = function (__require, __exports) {`,
  ...module.dependencies,
  module.source,
  ...module.exports,
  '};',
].join('\n')).join('\n\n');

const fontBytes = await readFile(join(ROOT, 'src', 'web', 'fonts', 'latinmodern-math.woff2'));
const embeddedFontUrl = `data:font/woff2;base64,${fontBytes.toString('base64')}`;

// The font address rides in the bundle, not an inline script, so the page's
// policy can refuse every inline script.
const bundle = `/* Generated by scripts/build_browser_only.mjs. Do not edit. */
globalThis.__MOSFETEER_FONT_URL = ${JSON.stringify(embeddedFontUrl)};
(function () {
  const __modules = Object.create(null);
  const __cache = Object.create(null);
  function __require(id) {
    if (__cache[id]) return __cache[id];
    const __exports = {};
    __cache[id] = __exports;
    if (!__modules[id]) throw new Error('browser bundle module not found: ' + id);
    __modules[id](__require, __exports);
    return __exports;
  }
${moduleSource}
  __require(${JSON.stringify(moduleId(ENTRY))});
}());
`;

// The page opens from file://, where browsers disagree on what 'self' covers,
// so local files are allowed by scheme. Everything else the editor loads is a
// data: URL (the embedded font, cursors, PNG rasterization); downloads are
// blob: links, which navigate rather than load. Injected markup gets no script.
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'", "script-src 'self' file:", "style-src 'self' file: 'unsafe-inline'",
  "img-src 'self' file: data:", "font-src 'self' file: data:", "connect-src data:",
  "base-uri 'none'", "form-action 'none'",
].join('; ');

const sourceHtml = await readFile(join(ROOT, 'src', 'web', 'index.html'), 'utf8');
const html = sourceHtml
  .replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n  <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`)
  .replace('<script type="module" src="main.js?v=41"></script>', '<script src="browser-only.js"></script>');
for (const marker of ['http-equiv="Content-Security-Policy"', 'src="browser-only.js"']) {
  if (!html.includes(marker)) throw new Error(`browser-only build: src/web/index.html no longer matches (${marker})`);
}

const releaseHtml = html;
await mkdir(join(OUTPUT_DIR, 'fonts'), { recursive: true });
await copyFile(join(ROOT, 'src', 'web', 'style.css'), join(OUTPUT_DIR, 'style.css'));
await copyFile(join(ROOT, 'src', 'web', 'icon.svg'), join(OUTPUT_DIR, 'icon.svg'));
await copyFile(join(ROOT, 'src', 'web', 'fonts', 'latinmodern-math.woff2'), join(OUTPUT_DIR, 'fonts', 'latinmodern-math.woff2'));
await copyFile(join(ROOT, 'src', 'web', 'fonts', 'README.md'), join(OUTPUT_DIR, 'fonts', 'README.md'));
await copyFile(join(ROOT, 'src', 'web', 'fonts', 'GUST-FONT-LICENSE.txt'), join(OUTPUT_DIR, 'fonts', 'GUST-FONT-LICENSE.txt'));
await writeFile(join(OUTPUT_DIR, 'browser-only.js'), bundle);
await writeFile(join(OUTPUT_DIR, 'index.html'), releaseHtml);
console.log(`Wrote browser-only/index.html and browser-only/browser-only.js (${modules.size} modules)`);
