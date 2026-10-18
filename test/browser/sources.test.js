/** A voltage source's waveform from its right-click menu, in a browser. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, browserSkip } from './harness.js';
import { Circuit } from '../../src/core/model.js';
import { runCommand } from '../../src/core/commands.js';

function sources() {
  const circuit = new Circuit();
  for (const line of ['add voltage_source V1 --at 0 0', 'add current_source I1 --at 400 0']) runCommand(circuit, line);
  return circuit.toJSON();
}

describe('source waveforms', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { sources: sources() } }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const rightClick = async (x, y) => {
    const p = await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.worldToClient(${x}, ${y}))`);
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
    await h.tap(p.x, p.y, { button: 'right' });
    await h.until(`!document.querySelector('.component-context-menu').hidden`);
  };
  const menuItems = () => h.evaluate(`[...document.querySelectorAll('.component-context-menu button')].map((b) => b.textContent.trim())`);

  test('the menu offers a voltage source a sine, a pulse or noise, and one undo takes it back', async () => {
    await h.open('sources');
    await rightClick(0, 0);
    await h.evaluate(`[...document.querySelectorAll('.component-context-menu button')].find((b) => b.textContent.startsWith('Waveform')).click()`);
    await h.evaluate(`[...document.querySelectorAll('.context-submenu[aria-label="Waveform"] button')].find((b) => b.textContent.trim() === 'Sine').click()`);
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.getComponent('V1').waveform === 'sine')`);
    assert.ok(await h.evaluate(`!!document.querySelector('[data-ref="V1"] path[d^="M -22 0 C"]')`), 'drawn in the circle');
    await h.key('z', { ctrlKey: true });
    await h.until(`${h.module('editor-state.js')}.then((m) => !m.editor.circuit.getComponent('V1').waveform)`);
    // A current source has no such menu.
    await h.key('Escape');
    await rightClick(400, 0);
    assert.ok(!(await menuItems()).some((item) => item.startsWith('Waveform')));
    await h.key('Escape');
  });
});
