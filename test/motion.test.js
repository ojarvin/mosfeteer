import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');

async function loadMotion({ system = false, stored = null } = {}) {
  const attrs = new Set();
  const store = new Map(stored === null ? [] : [['mosfeteer.reduceMotion', stored]]);
  const listeners = [];
  const query = { matches: system, addEventListener: (_type, fn) => listeners.push(fn) };
  globalThis.window = { matchMedia: () => query };
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  globalThis.document = { documentElement: { toggleAttribute: (name, on) => (on ? attrs.add(name) : attrs.delete(name)) } };
  const module = await import(`../src/web/motion.js?${Math.random()}`);
  return { module, attrs, store, query, change: () => listeners.forEach((fn) => fn()) };
}

test('reduced motion follows the system preference or the app setting', async (t) => {
  t.after(() => { delete globalThis.window; delete globalThis.localStorage; delete globalThis.document; });
  const plain = await loadMotion();
  assert.equal(plain.module.reducedMotion(), false);
  assert.equal(plain.attrs.has('data-reduce-motion'), false);
  plain.module.setReduceMotionSetting(true);
  assert.equal(plain.module.reducedMotion(), true);
  assert.equal(plain.attrs.has('data-reduce-motion'), true);
  assert.equal(plain.store.get('mosfeteer.reduceMotion'), '1');

  const remembered = await loadMotion({ stored: '1' });
  assert.equal(remembered.module.reduceMotionSetting(), true);
  assert.equal(remembered.attrs.has('data-reduce-motion'), true);

  const system = await loadMotion({ system: true });
  assert.equal(system.module.reduceMotionSetting(), false);
  assert.equal(system.module.reducedMotion(), true);
  system.query.matches = false;
  system.change();
  assert.equal(system.attrs.has('data-reduce-motion'), false);
});

test('the stylesheet keys reduced motion on the root attribute, and Settings offers it', () => {
  assert.doesNotMatch(css, /prefers-reduced-motion/);
  assert.match(css, /:root\[data-reduce-motion\] \.side-panel/);
  assert.match(css, /:root:not\(\[data-reduce-motion\]\) \.analysis-equation-value/);
  const settings = html.slice(html.indexOf('id="settings-menu"'), html.indexOf('</header>'));
  assert.match(settings, /id="btn-reduce-motion"[^>]*role="menuitemcheckbox"/);
});
