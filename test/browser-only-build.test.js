import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

// The generated browser-only bundle, with its modules reachable but the DOM
// entry point left unrun.
async function bundleRequire() {
  const source = await readFile(new URL('../browser-only/browser-only.js', import.meta.url), 'utf8');
  const entry = '  __require("src/web/main.js");';
  assert.ok(source.includes(entry), 'bundle entry point moved');
  const context = {};
  runInNewContext(source.replace(entry, '  globalThis.__require = __require;'), context);
  return context.__require;
}

test('browser-only bundle keeps imports live across the beats/model cycle', async () => {
  const require = await bundleRequire();
  const { Circuit } = require('src/core/model.js');
  const { runCommand } = require('src/core/commands.js');
  const { phaseBeats } = require('src/core/beats.js');
  const circuit = new Circuit();
  runCommand(circuit, 'add switch_open S1 --at 0 0');
  runCommand(circuit, 'add switch_open S2 --at 400 0');
  circuit.components.get('S1').value = 'phi1';
  circuit.components.get('S2').value = 'phi2';
  assert.equal(phaseBeats(circuit), 2);
  assert.equal(circuit.beats.map((beat) => beat.name).join(), 'phi1,phi2');
});

test('browser-only bundle publishes every exported function, generators included', async () => {
  const require = await bundleRequire();
  const { readdir } = await import('node:fs/promises');
  const source = await readFile(new URL('../browser-only/browser-only.js', import.meta.url), 'utf8');
  const missing = [];
  for (const dir of ['src/core', 'src/core/analysis', 'src/core/components', 'src/web']) {
    for (const name of await readdir(new URL(`../${dir}/`, import.meta.url))) {
      if (!name.endsWith('.js')) continue;
      const id = `${dir}/${name}`;
      // Only modules the bundle carries (the entry point's import graph).
      if (!source.includes(`__modules[${JSON.stringify(id)}]`) || id === 'src/web/main.js') continue;
      const text = await readFile(new URL(`../${id}`, import.meta.url), 'utf8');
      const names = [...text.matchAll(/^export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
      if (!names.length) continue;
      let exports;
      try { exports = require(id); } catch { continue; } // a module that needs the DOM to load
      for (const fn of names) if (typeof exports[fn] !== 'function') missing.push(`${id} ${fn}`);
    }
  }
  assert.deepEqual(missing, []);
  // The rounding search, a generator, runs from the bundle.
  const { polishSearch } = require('src/core/analysis/rounding.js');
  assert.equal(typeof polishSearch({ free: [] }, { own: {}, snapped: { fractions: {}, groups: [] } }).next, 'function');
});

test('browser-only bundle carries the optimizer worker, which scores in a blob worker', async () => {
  const source = await readFile(new URL('../browser-only/browser-only.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../browser-only/index.html', import.meta.url), 'utf8');
  assert.match(html, /worker-src blob:/);
  const context = {};
  runInNewContext(source.replace('  __require("src/web/main.js");', ''), context);
  const worker = context.__MOSFETEER_WORKER_SOURCE;
  assert.equal(typeof worker, 'string');
  // Run it as a worker would: messages in, messages out.
  const sent = [];
  let listener = null;
  const self = { addEventListener: (type, fn) => { if (type === 'message') listener = fn; }, postMessage: (data) => sent.push(data) };
  runInNewContext(worker, { self });
  const { Circuit } = await import('../src/core/model.js');
  const { runCommand } = await import('../src/core/commands.js');
  const circuit = new Circuit();
  for (const line of ['add input U --at 0 0', 'add gain K1 --at 400 0 --value k', 'add output V --at 800 0', 'connect U.p K1.in', 'connect K1.out V.p']) runCommand(circuit, line);
  listener({ data: { type: 'init', circuit: circuit.toJSON(), problem: { output: 'V', sources: { U: 'input' }, band: { f0: 0, bw: 0.01 }, values: { k: 1 }, setup: { specs: [{ action: 'maximize', measure: 'average', input: 'U', band: 'signal' }] } } } });
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0])), { type: 'ready', ok: true, error: null });
  listener({ data: { type: 'evaluate', id: 7, batch: [{ k: 2 }] } });
  assert.equal(sent[1].id, 7);
  assert.ok(Math.abs(sent[1].scores[0].specs[0] - 20 * Math.log10(2)) < 1e-6);
});
