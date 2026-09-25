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
