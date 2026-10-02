import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const WEB = new URL('../src/web/', import.meta.url);

test('the page and the modules split out of main.js load main.js by one URL', () => {
  // A module importing main.js by another URL (a query string, another path)
  // would load a second copy of the editor.
  const html = readFileSync(new URL('index.html', WEB), 'utf8');
  assert.match(html, /<script type="module" src="main\.js"><\/script>/);
  for (const file of readdirSync(WEB).filter((name) => name.endsWith('.js'))) {
    const source = readFileSync(new URL(file, WEB), 'utf8');
    for (const [, specifier] of source.matchAll(/from\s+'([^']*main\.js[^']*)'/g)) {
      assert.equal(specifier, './main.js', `${file} imports ${specifier}`);
    }
  }
});

// The browser modules never load under the Node tests, so one that fails to
// parse or to link would only break the page. These two checks catch both
// without a browser.
const webFiles = () => readdirSync(WEB).filter((name) => name.endsWith('.js'));

test('every browser module parses (no duplicate declarations or other early errors)', async () => {
  const run = promisify(execFile);
  const failures = [];
  await Promise.all(webFiles().map((file) => run(process.execPath, ['--check', new URL(file, WEB).pathname]).catch((error) => {
    failures.push(`${file}: ${String(error.stderr).split('\n').find((line) => /Error/.test(line))}`);
  })));
  assert.deepEqual(failures, []);
});

/** The names a module exports: its declarations and export lists, and
 *  through `export * from` another module's. */
function exportedNames(url, seen = new Set()) {
  const text = readFileSync(url, 'utf8');
  const names = new Set();
  for (const m of text.matchAll(/^export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of text.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const item of m[1].split(',').map((part) => part.trim()).filter(Boolean)) names.add(item.split(/\s+as\s+/).pop());
  }
  for (const m of text.matchAll(/^export\s*\*\s*from\s*'([^']+)'/gm)) {
    const target = new URL(m[1], url);
    if (seen.has(target.href)) continue;
    seen.add(target.href);
    for (const name of exportedNames(target, seen)) names.add(name);
  }
  return names;
}

test('every named import of a browser module is exported by the module it names', () => {
  const missing = [];
  for (const file of webFiles()) {
    const url = new URL(file, WEB);
    for (const m of readFileSync(url, 'utf8').matchAll(/^import\s*\{([^}]*)\}\s*from\s*'(\.{1,2}\/[^']+)'/gm)) {
      const exported = exportedNames(new URL(m[2], url));
      for (const item of m[1].split(',').map((part) => part.trim()).filter(Boolean)) {
        const name = item.split(/\s+as\s+/)[0];
        if (!exported.has(name)) missing.push(`${file}: ${name} from ${m[2]}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});
