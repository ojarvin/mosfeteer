/** Drawing and editing wires in a browser: what the preview shows, what a
 *  click commits, and where a wire may go. */

import { describe, before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, browserSkip } from './harness.js';
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
  const move = async (x, y, modifiers = 0) => { const p = await at(x, y); await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0, modifiers }); await h.settle(); };
  const clickAt = async (x, y) => {
    const p = await at(x, y);
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
    await h.mouse('mousePressed', p.x, p.y);
    await h.mouse('mouseReleased', p.x, p.y);
    await h.settle();
  };
  const preview = () => h.evaluate(`(() => { const d = document.querySelector('#canvas path.wire-draft')?.getAttribute('d'); return d ? d.trim().split(/\\s*[ML]\\s*/).filter(Boolean).map((pair) => { const [x, y] = pair.split(/[ ,]+/).map(Number); return { x, y }; }) : null; })()`);
  const netOf = (ref) => h.evaluate(`${h.module('editor-state.js')}.then((m) => { const [comp, term] = ${JSON.stringify(ref)}.split('.'); const n = m.editor.circuit.netOfTerminal({ comp, term }); return n ? { id: n.id, paths: n.paths(), terminals: n.terminals.map((t) => t.comp + '.' + t.term).sort() } : null; })`);

  test('a wire to a pin commits the route its preview showed, its bend centered between the pins', async () => {
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

  test('a committed wire has its preview gone at once, is not selected, and draws its own ink in under a mask that then goes', async () => {
    // With motion (the harness reduces it); put back after.
    const motion = (value) => h.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value }] });
    await motion('no-preference');
    // In the dark theme too, where a canvas `#fff` fill is repainted dark.
    await h.evaluate(`document.documentElement.classList.add('dark')`);
    try {
      await drawAndCheck(true);
    } finally {
      await motion('reduce');
      await h.evaluate(`document.documentElement.classList.remove('dark')`);
    }
    // Reduced, the wire is there at once: no mask.
    await h.evaluate(`window.__load(${JSON.stringify(twoResistors())})`);
    await h.key('Escape');
    await drawAndCheck(false);
  });

  const drawAndCheck = async (moving) => {
    await h.key('w');
    await clickAt(80, 0); // R1.b
    await move(720, 400);
    assert.ok(await preview());
    // The press that commits, and the state in the same moment.
    const p = await at(720, 400);
    await h.mouse('mousePressed', p.x, p.y);
    await h.mouse('mouseReleased', p.x, p.y);
    await h.settle();
    const now = await h.evaluate(`${h.module('editor-state.js')}.then((m) => ({
      draft: !!document.querySelector('#canvas path.wire-draft'),
      selected: m.editor.selectedNets.size,
      reveal: document.querySelectorAll('#landing-reveal-mask .landing-reveal').length,
      masked: [...document.querySelectorAll('#canvas :is(.wire-ink, .editor-overlay)')].every((el) => el.getAttribute('mask') === 'url(#landing-reveal-mask)'),
      glow: !!document.querySelector('#canvas .landing-wire'),
      // Where nothing is being drawn in, the mask lets the ink through whole.
      clear: (() => { const rect = document.querySelector('#landing-reveal-mask rect'); return !rect || getComputedStyle(rect).fill === 'rgb(255, 255, 255)'; })(),
    }))`);
    assert.deepEqual(now, { draft: false, selected: 0, reveal: moving ? 1 : 0, masked: moving, glow: false, clear: true });
    await h.until(`!document.querySelector('#landing-reveal-mask') && !document.querySelector('#canvas [mask]')`);
    assert.ok(await netOf('R2.a'), 'wired');
    await h.key('Escape');
  };

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

  const unwiredOta = async () => {
    for (const line of ['clear', 'add nmos M5 --at 0 320', 'add nmos M1 --at -240 0', 'add nmos M2 --at 240 0 --mirrorX',
      'add pmos M3 --at -240 -320 --mirrorX', 'add pmos M4 --at 240 -320']) await h.evaluate(`window.__run(${JSON.stringify(line)})`);
    await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.fitView())`);
  };
  const strokeDrag = async (type, x, y) => { const p = await at(x, y); await h.mouse(type, p.x, p.y, { modifiers: 1 }); };

  test('an Alt-drag wires what clicks on the same pins in turn would, the tail node too', async () => {
    const drawn = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.nets.values()].map((n) => ({ terminals: n.terminals.map((t) => t.comp + '.' + t.term).sort(), paths: n.paths() })).sort((a, b) => a.terminals[0].localeCompare(b.terminals[0])))`);
    await unwiredOta();
    await h.key('w');
    for (const [a, b] of [[[0, 240], [-240, 80]], [[-240, -80], [-240, -240]], [[-240, -400], [240, -400]], [[240, -240], [240, -80]], [[240, 80], [0, 240]]]) {
      await clickAt(...a);
      await clickAt(...b);
    }
    const clicked = await drawn();
    await h.key('Escape');
    await unwiredOta();
    await h.key('w');
    await h.key('Alt', { altKey: true });
    try {
      // Off the pins: the stroke catches them as the Alt snap would.
      const loop = [[20, 220], [-210, 110], [-270, -110], [-215, -260], [-260, -380], [210, -420], [270, -220], [210, -100], [260, 110], [-20, 260]];
      await strokeDrag('mouseMoved', ...loop[0]);
      await strokeDrag('mousePressed', ...loop[0]);
      for (const point of loop.slice(1)) await strokeDrag('mouseMoved', ...point);
      await strokeDrag('mouseReleased', ...loop.at(-1));
      await h.settle();
    } finally {
      await h.evaluate(`window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }))`);
    }
    assert.deepEqual(await drawn(), clicked);
    await h.key('Escape');
  });

  test('an Alt-drag in the Wire tool wires the pins it passes, as one undo entry', async () => {
    await unwiredOta();
    await h.key('w');
    await h.key('Alt', { altKey: true });
    const drag = strokeDrag;
    // The loop: tail drain, up through M1 and M3, across, down through M4 and M2, back.
    const loop = [[4, 236], [-236, 84], [-244, -80], [-240, -244], [-238, -404], [242, -400], [240, -240], [236, -80], [240, 84], [2, 240]];
    try {
      await drag('mouseMoved', ...loop[0]);
      await drag('mousePressed', ...loop[0]);
      for (const point of loop.slice(1)) await drag('mouseMoved', ...point);
      await h.settle();
      const shown = await h.evaluate(`document.querySelectorAll('#overlay .gesture-stroke-link, .gesture-stroke-link').length`);
      assert.equal(shown, 5, 'five joins are previewed');
      // Alt let go lifts the pen: the way to M3's drain wires nothing.
      await h.evaluate(`window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }))`);
      await drag('mouseMoved', 0, 0);
      await drag('mouseMoved', -240, -240);
      await h.key('Alt', { altKey: true });
      await drag('mouseMoved', -120, -320);
      await drag('mouseMoved', 120, -320);
      await drag('mouseReleased', 120, -320);
      await h.settle();
    } finally {
      await h.evaluate(`window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }))`);
    }
    const nets = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.nets.values()].map((n) => n.terminals.map((t) => t.comp + '.' + t.term).sort().join(' ')).sort())`);
    assert.deepEqual(await nets(), ['M1.d M3.d M3.g M4.g', 'M1.s M2.s M5.d', 'M2.d M4.d', 'M3.s M4.s']);
    await h.key('Escape');
    await h.key('u');
    assert.deepEqual(await nets(), []);
  });

  test('a tail node wired from one source draws the centred tee, by clicks or a stroke', async () => {
    const pair = async () => {
      for (const line of ['clear', 'add nmos M2 --at 0 -80', 'add nmos M3 --at 480 -80 --mirrorX', 'add nmos M1 --at 240 240']) await h.evaluate(`window.__run(${JSON.stringify(line)})`);
      await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.fitView())`);
    };
    const tail = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => { const net = m.editor.circuit.netOfTerminal('M1.d'); return { terminals: net.terminals.length, junctions: net.junctions }; })`);
    const want = { terminals: 3, junctions: [{ x: 240, y: 80 }] };
    await pair();
    await h.key('w');
    // Across the pair's sources, then from M3's source down to the tail drain.
    await clickAt(0, 0);
    await clickAt(480, 0);
    await clickAt(480, 0);
    await clickAt(240, 160);
    assert.deepEqual(await tail(), want);
    await h.key('Escape');
    await pair();
    await h.key('w');
    await h.key('Alt', { altKey: true });
    try {
      await strokeDrag('mouseMoved', 0, 0);
      await strokeDrag('mousePressed', 0, 0);
      for (const point of [[240, 10], [480, 0], [360, 80], [240, 160]]) await strokeDrag('mouseMoved', ...point);
      await strokeDrag('mouseReleased', 240, 160);
      await h.settle();
    } finally {
      await h.evaluate(`window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }))`);
    }
    assert.deepEqual(await tail(), want);
    await h.key('Escape');
  });

  test('Backspace mid-stroke lets go of the last pin the stroke caught', async () => {
    await unwiredOta();
    await h.key('w');
    await h.key('Alt', { altKey: true });
    const links = () => h.evaluate(`document.querySelectorAll('.gesture-stroke-link').length`);
    try {
      await strokeDrag('mouseMoved', 0, 240);
      await strokeDrag('mousePressed', 0, 240);
      await strokeDrag('mouseMoved', -120, 160);
      await strokeDrag('mouseMoved', -240, 80);
      await h.settle();
      assert.equal(await links(), 1, 'tail drain to M1\'s source is previewed');
      await h.key('Backspace', { altKey: true });
      await h.settle();
      assert.equal(await links(), 0);
      await strokeDrag('mouseReleased', -240, 80);
      await h.settle();
    } finally {
      await h.evaluate(`window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }))`);
    }
    const nets = await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.nets.size)`);
    assert.equal(nets, 0);
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
      await h.settle();
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
    await h.tap(q.x, q.y, { button: 'right' });
    await h.until(`!document.querySelector('.component-context-menu').hidden`);
    const rename = await h.evaluate(`[...document.querySelectorAll('.component-context-menu button')].find((b) => b.textContent.includes('Rename net'))?.textContent`);
    assert.ok(rename, 'the menu offers it');
    assert.doesNotMatch(rename, /dbl/i);
    await h.key('Escape');
  });

  test('in select mode a free wire end drags out more wire: on along its line, then onto a pin to close the gap', async () => {
    const dragFromTo = async ([x0, y0], [x1, y1]) => {
      const a = await at(x0, y0);
      const b = await at(x1, y1);
      await h.mouse('mouseMoved', a.x, a.y, { button: 'none', buttons: 0 });
      await h.mouse('mousePressed', a.x, a.y);
      for (let i = 1; i <= 6; i++) await h.mouse('mouseMoved', a.x + ((b.x - a.x) * i) / 6, a.y + ((b.y - a.y) * i) / 6, { button: 'left', buttons: 1 });
      await h.mouse('mouseReleased', b.x, b.y);
      await h.settle();
    };
    const junctions = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.nets.values()].flatMap((n) => n.junctions))`);
    // A stub from R2.b, ended in space with Enter.
    await h.key('w');
    await clickAt(880, 400);
    await move(1200, 400);
    await h.key('Enter');
    await h.key('Escape');
    await h.key('Escape');
    // On along its own line: the wire is longer, still one straight run.
    await dragFromTo([1200, 400], [1440, 400]);
    let net = await netOf('R2.b');
    assert.deepEqual(net.paths, [[{ x: 880, y: 400 }, { x: 1440, y: 400 }]], JSON.stringify(net.paths));
    assert.deepEqual(await junctions(), []);
    // Onto R1.b: the gap closed, the two pins one net.
    await dragFromTo([1440, 400], [80, 0]);
    net = await netOf('R2.b');
    assert.deepEqual(net.terminals, ['R1.b', 'R2.b'], JSON.stringify(net));
    // One undo step each.
    await h.key('u');
    await h.settle();
    assert.deepEqual((await netOf('R2.b')).terminals, ['R2.b']);
  });

  test('a free wire end dragged back along its wire shortens it; a selected wire\'s end moves the wire', async () => {
    const press = async ([x0, y0], [x1, y1], { release = true } = {}) => {
      const a = await at(x0, y0);
      const b = await at(x1, y1);
      await h.mouse('mouseMoved', a.x, a.y, { button: 'none', buttons: 0 });
      await h.mouse('mousePressed', a.x, a.y);
      for (let i = 1; i <= 6; i++) await h.mouse('mouseMoved', a.x + ((b.x - a.x) * i) / 6, a.y + ((b.y - a.y) * i) / 6, { button: 'left', buttons: 1 });
      await h.settle();
      if (release) { await h.mouse('mouseReleased', b.x, b.y); await h.settle(); }
      return b;
    };
    await h.key('w');
    await clickAt(880, 400);
    await move(1200, 400);
    await h.key('Enter');
    await h.key('Escape');
    await h.key('Escape');
    // Held back along it: the wire shows shortened, with no draft over it.
    const held = await press([1200, 400], [1040, 400], { release: false });
    assert.deepEqual((await netOf('R2.b')).paths, [[{ x: 880, y: 400 }, { x: 1040, y: 400 }]]);
    assert.equal(await preview(), null);
    await h.mouse('mouseReleased', held.x, held.y);
    await h.settle();
    assert.deepEqual((await netOf('R2.b')).paths, [[{ x: 880, y: 400 }, { x: 1040, y: 400 }]]);
    await h.key('u');
    await h.settle();
    assert.deepEqual((await netOf('R2.b')).paths, [[{ x: 880, y: 400 }, { x: 1200, y: 400 }]], 'one undo step');
    // Selected, its end moves the wire: down, from its pin.
    await clickAt(1040, 400);
    await press([1200, 400], [1200, 560]);
    assert.deepEqual((await netOf('R2.b')).paths, [[{ x: 880, y: 400 }, { x: 880, y: 560 }, { x: 1200, y: 560 }]]);
  });
});
