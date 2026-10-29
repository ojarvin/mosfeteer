/** A part's options from its right-click menu, in a browser: a voltage
 *  source's waveform, a dither's shape, a sum's input signs. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, browserSkip } from './harness.js';
import { Circuit } from '../../src/core/model.js';
import { runCommand } from '../../src/core/commands.js';

function sources() {
  const circuit = new Circuit();
  for (const line of ['add voltage_source V1 --at 0 0', 'add current_source I1 --at 400 0', 'add dither DTH1 --at 0 400 --value "rect 0.5"',
    'add gain K1 --at 400 400 --value k', 'add signal_sum S1 --at 800 400', 'connect DTH1.out K1.in', 'connect K1.out S1.w']) runCommand(circuit, line);
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

  const choose = async (submenu, item) => {
    await h.evaluate(`[...document.querySelectorAll('.component-context-menu button')].find((b) => b.textContent.startsWith(${JSON.stringify(submenu)})).click()`);
    const items = await h.evaluate(`[...document.querySelectorAll('.context-submenu[aria-label=${JSON.stringify(submenu)}] button')].map((b) => b.textContent.trim())`);
    await h.evaluate(`[...document.querySelectorAll('.context-submenu[aria-label=${JSON.stringify(submenu)}] button')].find((b) => b.textContent.trim() === ${JSON.stringify(item)}).click()`);
    return items;
  };
  const value = (ref) => h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.getComponent(${JSON.stringify(ref)}).value)`);

  test("a dither's shape is a choice in the part's options; its amplitude stays", async () => {
    await rightClick(0, 400);
    // The options are a group of their own.
    const group = await h.evaluate(`[...document.querySelectorAll('.component-context-menu > .context-menu-group')].map((g) => [...g.querySelectorAll(':scope > button')].map((b) => b.firstChild.textContent.trim()))`);
    assert.ok(group.some((items) => items.join() === 'Dither shape'), JSON.stringify(group));
    const shapes = await choose('Dither shape', 'Triangular');
    assert.deepEqual(shapes, ['Rectangular✓', 'Triangular', 'Binary', 'Ternary']);
    assert.equal(await value('DTH1'), 'tri 0.5');
  });

  test("a sum's input signs are each positive or negative; a gain has none", async () => {
    await rightClick(400, 400);
    assert.ok(!(await menuItems()).some((item) => item.startsWith('Input polarity')));
    await h.key('Escape');
    await rightClick(800, 400);
    await h.evaluate(`[...document.querySelectorAll('.component-context-menu button')].find((b) => b.textContent.startsWith('Input polarity')).click()`);
    const inputs = await h.evaluate(`[...document.querySelectorAll('.context-submenu[aria-label="Input polarity"] > button')].map((b) => b.firstChild.textContent)`);
    assert.deepEqual(inputs, ['n input', 's input', 'w input']);
    await h.evaluate(`[...document.querySelectorAll('.context-submenu[aria-label="Input polarity"] > button')].find((b) => b.firstChild.textContent === 'w input').click()`);
    assert.deepEqual(await h.evaluate(`[...document.querySelectorAll('.context-submenu[aria-label="w input"] button')].map((b) => b.textContent.trim())`), ['Positive✓', 'Negative']);
    await h.evaluate(`[...document.querySelectorAll('.context-submenu[aria-label="w input"] button')].find((b) => b.textContent.trim() === 'Negative').click()`);
    assert.equal(await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.getComponent('S1').negativeInputs.has('w'))`), true);
  });
});
