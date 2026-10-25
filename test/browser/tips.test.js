/** Tips in a browser: selecting parts that make a cell offers Shift+Q the
 *  first time, and arranging them answers it. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, browserSkip } from './harness.js';
import { Circuit } from '../../src/core/model.js';
import { runCommand } from '../../src/core/commands.js';

function mirror() {
  const circuit = new Circuit();
  for (const line of ['add nmos MA --at 0 0', 'add nmos MB --at 480 -160', 'add ground --at 0 120', 'add ground --at 480 -40',
    'connect MA.s GROUND1.gnd', 'connect MB.s GROUND2.gnd', 'connect MA.g MB.g', 'connect MA.d MA.g']) runCommand(circuit, line);
  return circuit.toJSON();
}

describe('tips', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { amp: mirror() }, width: 1400, height: 900 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  test('selecting a mirror offers Shift+Q at once; arranging it answers the tip', async () => {
    await h.open('amp');
    await h.evaluate(`${h.module('main.js')}.then((m) => { m.setSelection(['MA', 'MB', 'GROUND1', 'GROUND2']); m.render(); })`);
    await h.until(`!document.getElementById('tip-card').hidden`);
    assert.match(await h.evaluate(`document.getElementById('tip-card').textContent`), /Shift\+Q draws the selected parts/);
    await h.key('Q', { shiftKey: true });
    await h.until(`!!document.querySelector('.arrange-picker')`);
    await h.evaluate(`document.querySelector('.arrange-picker').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    await h.until(`document.getElementById('tip-card').hidden`);
    assert.ok(await h.evaluate(`${h.module('onboarding.js')}.then((m) => m.tipStates().find((t) => t.id === 'arrange-like').retired)`));
  });
});
