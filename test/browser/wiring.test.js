/** Drawing and editing wires in a browser: what the preview shows, what a
 *  click commits, and where a wire may go. */

import { describe, before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, sleep, browserSkip } from './harness.js';
import { twoResistors } from './fixtures.js';

describe('wiring', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { two: twoResistors() }, width: 1400, height: 900 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });
  beforeEach(async () => {
    await h.open('two');
    await h.key('Escape');
    await h.key('Escape');
    await h.evaluate(`window.__load(${JSON.stringify(twoResistors())})`);
    await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.fitView())`);
  });

  const at = (x, y) => h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.worldToClient(${x}, ${y}))`);
  const move = async (x, y, modifiers = 0) => { const p = await at(x, y); await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0, modifiers }); await sleep(40); };
  const clickAt = async (x, y) => {
    const p = await at(x, y);
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
    await h.mouse('mousePressed', p.x, p.y);
    await h.mouse('mouseReleased', p.x, p.y);
    await sleep(60);
  };
  const preview = () => h.evaluate(`(() => { const d = document.querySelector('#canvas path.wire-draft')?.getAttribute('d'); return d ? d.trim().split(/\\s*[ML]\\s*/).filter(Boolean).map((pair) => { const [x, y] = pair.split(/[ ,]+/).map(Number); return { x, y }; }) : null; })()`);
  const netOf = (ref) => h.evaluate(`${h.module('editor-state.js')}.then((m) => { const [comp, term] = ${JSON.stringify(ref)}.split('.'); const n = m.editor.circuit.netOfTerminal({ comp, term }); return n ? { id: n.id, paths: n.paths(), terminals: n.terminals.map((t) => t.comp + '.' + t.term).sort() } : null; })`);

  test('a wire to a pin commits the route its preview showed, its bend centred between the pins', async () => {
    await h.key('w');
    await clickAt(80, 0); // R1.b
    await move(720, 400); // R2.a
    const shown = await preview();
    assert.ok(shown && shown.length >= 3, JSON.stringify(shown));
    await clickAt(720, 400);
    const net = await netOf('R1.b');
    assert.deepEqual(net.terminals, ['R1.b', 'R2.a']);
    assert.deepEqual(net.paths[0], shown);
    // The bend sits half way: a route as far from both pins as it can be.
    const vertical = net.paths[0].slice(1).findIndex((p, i) => p.x === net.paths[0][i].x && p.y !== net.paths[0][i].y);
    assert.equal(net.paths[0][vertical].x, 400, JSON.stringify(net.paths[0]));
  });

  test('a wire drawn to a free wire end meets it at its tip', async () => {
    // A stub from R2.b, ended in space with Enter.
    await h.key('w');
    await clickAt(880, 400);
    await move(1200, 400);
    await h.key('Enter');
    await h.key('Escape');
    const stub = await netOf('R2.b');
    assert.ok(stub && stub.paths[0].some((p) => p.x === 1200 && p.y === 400), JSON.stringify(stub));
    await h.key('w');
    await clickAt(-80, 0); // R1.a
    await move(1200, 400);
    const shown = await preview();
    assert.deepEqual(shown.at(-1), { x: 1200, y: 400 });
    await clickAt(1200, 400);
    const joined = await netOf('R1.a');
    assert.deepEqual(joined.terminals, ['R1.a', 'R2.b'], 'one net, through the end');
    // It arrives at the tip instead of running along the stub.
    const overlapping = joined.paths.flatMap((path) => path.slice(1).map((p, i) => [path[i], p]))
      .filter(([a, b]) => a.y === 400 && b.y === 400 && Math.min(a.x, b.x) < 1200 && Math.max(a.x, b.x) > 880);
    assert.equal(overlapping.length, 1, JSON.stringify(joined.paths));
  });

  test('with Alt held a wire snaps to the nearest pin', async () => {
    await h.key('w');
    await clickAt(80, 0);
    await h.key('Alt', { altKey: true });
    try {
      await move(735, 418, 1); // near R2.a, off the grid point
      const cursor = await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.cursor)`);
      assert.deepEqual(cursor, { x: 720, y: 400 });
    } finally {
      await h.evaluate(`window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }))`);
    }
    await h.key('Escape');
  });

  test('a part rotated keeps the wire at its other part as drawn: only its own leg moves', async () => {
    await h.evaluate(`window.__run('connect R1.b R2.a')`);
    await h.evaluate(`window.__run('add resistor R3 --at 0 800')`);
    await h.evaluate(`window.__run('connect R2.b R3.b')`);
    const before = await netOf('R2.b');
    await h.evaluate(`${h.module('main.js')}.then((m) => { m.setSelection(['R1']); m.render(); })`);
    await h.key('r');
    const after = await netOf('R2.b');
    assert.deepEqual(after.paths, before.paths, 'the R2-R3 wire is untouched');
    const moved = await netOf('R1.b');
    assert.deepEqual(moved.terminals, ['R1.b', 'R2.a']);
  });

  test('a wire segment dragged into a part is put back on release; dragged to clear space it stays', async () => {
    await h.evaluate(`window.__run('connect R1.b R2.a')`);
    const route = (await netOf('R1.b')).paths;
    const path = route[0];
    const k = path.slice(1).findIndex((p, n) => p.x === path[n].x && p.y !== path[n].y);
    const x = path[k].x; // the route's upright, from y = 0 to 400
    // R3 stands 160 to its right, its body across y = 120..280.
    await h.evaluate(`window.__run('add resistor R3 --at ${x + 160} 200 --rot 90')`);
    const drag = async (dx) => {
      const from = await at(x, 200);
      const to = await at(x + dx, 200);
      await h.mouse('mouseMoved', from.x, from.y, { button: 'none', buttons: 0 });
      await h.mouse('mousePressed', from.x, from.y);
      for (let n = 1; n <= 6; n++) await h.mouse('mouseMoved', from.x + (to.x - from.x) * n / 6, from.y, { buttons: 1 });
      await h.mouse('mouseReleased', to.x, to.y);
      await sleep(100);
    };
    await drag(160);
    assert.deepEqual((await netOf('R1.b')).paths, route, 'dropped through R3: put back');
    await drag(200);
    const moved = (await netOf('R1.b')).paths[0];
    assert.ok(moved.filter((p) => p.x === x + 200).length === 2, `dropped clear past it: kept ${JSON.stringify(moved)}`);
  });

  test('the net list renames a net on a double-click; the canvas menu offers Rename without promising one', async () => {
    await h.evaluate(`window.__run('connect R1.b R2.a')`);
    const id = (await netOf('R1.b')).id;
    await h.evaluate(`document.getElementById(${JSON.stringify(`net-option-${id}`)}).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
    await h.until(`!!document.activeElement && document.activeElement.tagName === 'INPUT' && !!document.activeElement.closest('#side-panel')`);
    await h.evaluate(`document.activeElement.blur()`);
    const net = await netOf('R1.b');
    const mid = net.paths[0][1];
    const q = await at(mid.x, mid.y);
    await h.mouse('mouseMoved', q.x, q.y, { button: 'none', buttons: 0 });
    await h.mouse('mousePressed', q.x, q.y, { button: 'right' });
    await h.mouse('mouseReleased', q.x, q.y, { button: 'right' });
    await h.until(`!document.querySelector('.component-context-menu').hidden`);
    const rename = await h.evaluate(`[...document.querySelectorAll('.component-context-menu button')].find((b) => b.textContent.includes('Rename net'))?.textContent`);
    assert.ok(rename, 'the menu offers it');
    assert.doesNotMatch(rename, /dbl/i);
    await h.key('Escape');
  });
});
