import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

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
