/** The symmetry axis in a browser: held with k (vertical, then horizontal),
 *  every edit is made on the other side too, in the same undo step, until k
 *  releases it. */

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

  test('k holds an axis at the cursor; parts added, wired, moved, and removed on one side are on the other too', async () => {
    await h.open('pair');
    await ed('(e.cursor = { x: 0, y: 0 }, true)');
    await h.key('k');
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

    // r turns M1; its twin turns the other way, its wire the mirror image.
    await h.evaluate(`${h.module('main.js')}.then((m) => { m.setSelection(['M1']); m.render(); })`);
    await h.key('r');
    await h.settle();
    const points = (ref, mirror) => ed(`[...new Set(c.netOfTerminal({ comp: ${JSON.stringify(ref)}, term: 's' }).paths().flat().map((p) => (${mirror} ? -p.x : p.x) + ',' + p.y))].sort()`);
    assert.equal(await ed(`c.components.get('M1').transform.rotation`), 90);
    assert.deepEqual(await points(twin, false), await points('M1', true), 'the twin\'s wire is the mirror image');

    await run('rm M1');
    assert.equal(await ed(`c.components.has(${JSON.stringify(twin)})`), false, 'the twin goes too');
  });

  test('in insert mode with the axis held, Escape drops the ghost, then leaves insert mode; the axis stays', async () => {
    await h.key('i');
    for (const ch of 'nmos') await h.key(ch);
    await h.key('Enter');
    await h.until(`${h.module('editor-state.js')}.then((m) => !!m.editor.pendingPlace)`);
    await h.key('Escape');
    assert.equal(await ed('e.pendingPlace'), null);
    await h.key('Escape');
    assert.equal(await ed('e.mode'), 'normal');
    assert.ok(await h.evaluate(`${h.module('symmetry-axis.js')}.then((m) => !!m.symmetryAxis())`), 'the axis is still held');
  });

  test('k again turns the axis horizontal, about the same point; once more releases it: edits are made once', async () => {
    await h.key('k');
    assert.deepEqual(await h.evaluate(`${h.module('symmetry-axis.js')}.then((m) => m.symmetryAxis())`), { operation: 'mirrorY', pin: { x: 0, y: 0 } });
    await run('add resistor R5 --at -400 -200 --rot 90');
    assert.ok(await ed(`[...c.components.values()].some((p) => p.type === 'resistor' && p.transform.x === -400 && p.transform.y === 200)`), 'mirrored below the horizontal axis');
    await h.key('k');
    assert.equal(await h.evaluate(`${h.module('symmetry-axis.js')}.then((m) => m.symmetryAxis())`), null);
    const before = (await parts()).length;
    await run('add resistor R9 --at -800 -200');
    assert.equal((await parts()).length, before + 1);
  });
});
