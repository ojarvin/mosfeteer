/** Arrange like (Shift+Q) in a browser: the picker lists the ways the
 *  selected parts are drawn elsewhere, the open design and the workspace's
 *  other designs first, shows the highlighted one on the canvas, keeps it
 *  as one undo step, and leaves the parts as they were on Escape. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, browserSkip } from './harness.js';
import { Circuit } from '../../src/core/model.js';
import { runCommand } from '../../src/core/commands.js';

function build(lines) {
  const circuit = new Circuit();
  for (const line of lines) runCommand(circuit, line);
  return circuit.toJSON();
}

/** A current mirror drawn anyhow. */
const messy = () => build(['add nmos MA --at 0 0', 'add nmos MB --at 480 -160', 'connect MA.g MB.g', 'connect MA.d MA.g']);
/** The same topology, drawn upright: unlike the built-in mirror. */
const upright = () => build(['add nmos M1 --at 0 0', 'add nmos M2 --at 0 400', 'connect M1.g M2.g', 'connect M1.d M1.g']);

describe('arrange like', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { amp: messy(), bias: upright() }, width: 1400, height: 900 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const ed = (expression) => h.evaluate(`${h.module('editor-state.js')}.then((m) => { const e = m.editor; const c = e.circuit; return ${expression}; })`);
  const picker = () => h.evaluate(`${h.module('arrange-ui.js')}.then((m) => m.arrangePickerState())`);
  const pickerKey = (key) => h.evaluate(`document.querySelector('.arrange-picker').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))`);
  const places = () => ed(`['MA', 'MB'].map((ref) => { const t = c.components.get(ref).transform; return [t.x, t.y, t.mirrorX]; })`);
  const select = () => h.evaluate(`${h.module('main.js')}.then((m) => m.setSelection(['MA', 'MB']))`);

  test('Shift+Q lists the workspace\'s drawing first, then the built-in one, and shows the first on the canvas', async () => {
    await h.open('amp');
    const before = await places();
    await select();
    await h.key('Q', { shiftKey: true });
    await h.until(`${h.module('arrange-ui.js')}.then((m) => !!m.arrangePickerState())`);
    const state = await picker();
    assert.deepEqual(state.candidates.map((c) => c.source), ['bias', 'NMOS current mirror']);
    assert.deepEqual(state.candidates[0].parts, ['M1', 'M2']);
    const shown = await places();
    assert.equal(shown[1][0] - shown[0][0], 0, 'upright, as in bias');
    assert.equal(shown[1][1] - shown[0][1], 400);
    assert.equal(await h.evaluate(`document.activeElement === document.querySelector('.arrange-picker')`), true);
    // Each card shows the drawing it comes from.
    await h.until(`[...document.querySelectorAll('.arrange-picker-picture')].every((img) => img.src.startsWith('data:image/svg+xml'))`);
    await pickerKey('Escape');
    await h.until(`!document.querySelector('.arrange-picker')`);
    assert.deepEqual(await places(), before, 'Escape leaves the parts as they were');
  });

  test('the arrow keys show the next way; Enter keeps it as one undo step', async () => {
    const before = await places();
    await select();
    await h.key('Q', { shiftKey: true });
    await h.until(`${h.module('arrange-ui.js')}.then((m) => !!m.arrangePickerState())`);
    await pickerKey('ArrowDown');
    assert.equal((await picker()).index, 1);
    const shown = await places();
    assert.equal(shown[0][2], true, 'the built-in mirror turns MA to face MB');
    assert.equal(shown[1][0] - shown[0][0], 400);
    await pickerKey('Enter');
    await h.until(`!document.querySelector('.arrange-picker')`);
    assert.deepEqual(await places(), shown);
    assert.deepEqual(await ed(`[...e.multi].sort()`), ['MA', 'MB'], 'the parts stay selected');
    await h.key('u');
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.get('MA').transform.x === ${before[0][0]})`);
    assert.deepEqual(await places(), before);
  });

  test('a single part is not arranged, and says how', async () => {
    await h.evaluate(`${h.module('main.js')}.then((m) => m.setSelection(['MA']))`);
    await h.key('Q', { shiftKey: true });
    await h.settle();
    assert.equal(await picker(), null);
    assert.match(await h.evaluate(`document.querySelector('.status-hint, #status-hint, .status-message')?.textContent || ''`), /select two or more/);
  });
});
