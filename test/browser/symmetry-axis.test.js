/** The symmetry axis in a browser: held with |, every edit is made on the
 *  other side too, in the same undo step, until | releases it. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, browserSkip } from './harness.js';
import { Circuit } from '../../src/core/model.js';
import { runCommand } from '../../src/core/commands.js';

const empty = () => {
  const circuit = new Circuit();
  runCommand(circuit, 'annotation add margin 1200 800');
  return circuit.toJSON();
};

describe('symmetry axis', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { pair: empty() }, width: 1400, height: 900 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const ed = (expression) => h.evaluate(`${h.module('editor-state.js')}.then((m) => { const e = m.editor; const c = e.circuit; return ${expression}; })`);
  const run = async (line) => { await h.evaluate(`window.__run(${JSON.stringify(line)})`); await h.settle(); };
  const parts = () => ed(`[...c.components.values()].filter((p) => p.type !== 'solder').map((p) => [p.type, p.transform.x, p.transform.y, p.transform.mirrorX]).sort((a, b) => a[1] - b[1] || a[2] - b[2])`);
  const terminalsOf = (ref) => ed(`(() => { const n = c.netOfTerminal(${JSON.stringify(ref)}); return n ? n.terminals.map((t) => t.comp + '.' + t.term).sort() : null; })()`);

  test('| holds an axis at the cursor; parts added, wired, moved, and removed on one side are on the other too', async () => {
    await h.open('pair');
    await ed('(e.cursor = { x: 0, y: 0 }, true)');
    await h.key('|');
    assert.deepEqual(await h.evaluate(`${h.module('symmetry-axis.js')}.then((m) => m.symmetryAxis())`), { operation: 'mirrorX', pin: { x: 0, y: 0 } });
    assert.ok(await h.evaluate(`document.querySelector('.symmetry-axis.held path') !== null`), 'the axis is drawn');
    assert.match(await h.evaluate(`document.querySelector('.status')?.textContent || ''`), /AXIS x=0: edits are mirrored/);

    await run('add nmos M1 --at -200 0');
    assert.deepEqual(await parts(), [['nmos', -200, 0, false], ['nmos', 200, 0, true]]);
    const twin = await ed(`[...c.components.values()].find((p) => p.type === 'nmos' && p.refdes !== 'M1').refdes`);

    await run('add ground G1 --at -200 120');
    await run('connect M1.s G1.gnd');
    const ground = await ed(`[...c.components.values()].find((p) => p.type === 'ground' && p.refdes !== 'G1').refdes`);
    assert.deepEqual(await terminalsOf(`${twin}.s`), [`${ground}.gnd`, `${twin}.s`].sort(), 'the wire is drawn on the other side');

    await run('move M1 -240 0');
    assert.equal(await ed(`c.components.get(${JSON.stringify(twin)}).transform.x`), 240, 'the twin follows, mirrored');
    await h.key('u');
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.get('M1').transform.x === -200)`);
    assert.equal(await ed(`c.components.get(${JSON.stringify(twin)}).transform.x`), 200, 'one undo puts both back');

    await run('rm M1');
    assert.equal(await ed(`c.components.has(${JSON.stringify(twin)})`), false, 'the twin goes too');
  });

  test('| again releases the axis: edits are made once', async () => {
    await h.key('|');
    assert.equal(await h.evaluate(`${h.module('symmetry-axis.js')}.then((m) => m.symmetryAxis())`), null);
    const before = (await parts()).length;
    await run('add resistor R1 --at -400 -200');
    assert.equal((await parts()).length, before + 1);
  });
});
