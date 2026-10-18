/** Net beams: with Settings → Net beams on, hovering a net draws a beam to
 *  each other net its name connects it to. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, browserSkip } from './harness.js';
import { Circuit } from '../../src/core/model.js';
import { runCommand } from '../../src/core/commands.js';

/** Three wires named OUT, apart, and one named OTHER. */
function outs() {
  const circuit = new Circuit();
  for (const line of [
    'add resistor R1 --at 0 0', 'add resistor R2 --at 400 0', 'connect R1.b R2.a --name OUT',
    'add resistor R3 --at 0 800', 'add resistor R4 --at 400 800', 'connect R3.b R4.a --name OUT',
    'add resistor R5 --at 1200 800', 'add resistor R6 --at 1600 800', 'connect R5.b R6.a --name OUT',
    'add resistor R7 --at 1200 0', 'add resistor R8 --at 1600 0', 'connect R7.b R8.a --name OTHER',
    'add ground G1 --at 0 2000', 'add resistor R9 --at 0 1760 --rot 90', 'connect R9.b G1.gnd',
    'add ground G2 --at 800 2000', 'add resistor R10 --at 800 1760 --rot 90', 'connect R10.b G2.gnd',
  ]) runCommand(circuit, line);
  return circuit.toJSON();
}

describe('net beams', { skip: browserSkip() }, () => {
  let h;
  before(async () => {
    h = await start({ docs: { outs: outs() }, width: 1400, height: 900 });
    await h.open('outs');
  });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const hover = async (x, y) => {
    const p = await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.worldToClient(${x}, ${y}))`);
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
  };
  const beams = () => h.evaluate(`document.querySelectorAll('.net-beams .net-beam').length`);

  test('are off until Settings turns them on', async () => {
    await hover(200, 0);
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.hoverTarget?.kind === 'net')`);
    assert.equal(await beams(), 0);
    assert.equal(await h.evaluate(`document.getElementById('btn-net-beams').getAttribute('aria-checked')`), 'false');
  });

  test('go from a hovered net to each other net of its name, and leave with the pointer', async () => {
    await h.evaluate(`document.getElementById('btn-net-beams').click()`);
    await hover(200, 0);
    await h.until(`document.querySelectorAll('.net-beams .net-beam').length === 2`);
    // A net named alone has nothing to reach.
    await hover(1400, 0);
    await h.until(`document.querySelectorAll('.net-beams .net-beam').length === 0`);
    await hover(1400, 800);
    await h.until(`document.querySelectorAll('.net-beams .net-beam').length === 2`);
    await hover(800, 400);
    await h.until(`document.querySelectorAll('.net-beams .net-beam').length === 0`);
  });

  test('go from a ground symbol\'s terminal to the other ground\'s', async () => {
    const g1 = await h.evaluate(`${h.module('editor-state.js')}.then((m) => { const b = m.editor.circuit.components.get('G1').bboxWorld(); return { x: b.x + b.w / 2 + 12, y: b.y + b.h - 8 }; })`);
    await hover(g1.x, g1.y);
    await h.until(`document.querySelectorAll('.net-beams .net-beam').length === 1`);
    const ends = await h.evaluate(`(() => { const d = document.querySelector('.net-beams .net-beam-core').getAttribute('d'); const p = [...d.matchAll(/[ML] (-?[\\d.]+) (-?[\\d.]+)/g)]; return [p[0], p.at(-1)].map((m) => [+m[1], +m[2]]); })()`);
    const terminals = await h.evaluate(`${h.module('editor-state.js')}.then((m) => ['G1', 'G2'].map((r) => { const t = m.editor.circuit.components.get(r).terminalWorld('gnd'); return [t.x, t.y]; }))`);
    assert.deepEqual(ends, terminals);
    await hover(800, 400);
    await h.until(`document.querySelectorAll('.net-beams .net-beam').length === 0`);
  });

  test('the command line turns them off, and the choice is kept', async () => {
    await h.evaluate(`${h.module('command-line-ui.js')}.then((m) => m.ACTIONS['net-beams']())`);
    assert.equal(await h.evaluate(`localStorage.getItem('mosfeteer.netBeams')`), '');
    await hover(200, 0);
    assert.equal(await beams(), 0);
    assert.equal(await h.evaluate(`document.getElementById('btn-net-beams').getAttribute('aria-checked')`), 'false');
  });
});
