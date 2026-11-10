/** Editing on the canvas in a browser: tools and keys, placing, the view,
 *  and what an action leaves in the history. */

import { describe, before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, browserSkip } from './harness.js';
import { amplifier } from './fixtures.js';
import { Circuit } from '../../src/core/model.js';
import { runCommand } from '../../src/core/commands.js';

describe('canvas editing', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { amp: amplifier() }, width: 1400, height: 900 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });
  // Each test starts from the design as saved, every tool put down.
  beforeEach(async () => {
    await h.open('amp');
    await h.key('Escape');
    await h.key('Escape');
    await h.evaluate(`window.__load(${JSON.stringify(amplifier())})`);
    await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.fitView())`);
  });

  const state = () => h.evaluate(`Promise.all([${h.module('editor-state.js')}, ${h.module('main.js')}]).then(([s, m]) => {
    const e = s.editor;
    return { key: m.interactionState().key, mode: e.mode, wire: !!e.wire, wireSource: !!e.wire?.source, pending: e.pendingPlace?.type || null,
      query: e.insertQuery, history: e.history.length, grid: e.showGrid, crosshair: e.crosshairVisible, guides: e.guidesVisible };
  })`);
  const circuit = (expression) => h.evaluate(`${h.module('editor-state.js')}.then((m) => { const c = m.editor.circuit; return ${expression}; })`);
  const at = (x, y) => h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.worldToClient(${x}, ${y}))`);
  /** A grid point at a fraction of the view, so it is on screen. */
  const viewPoint = (fx, fy) => h.evaluate(`${h.module('editor-state.js')}.then((m) => { const v = m.editor.view; return { x: Math.round((v.x + v.w * ${fx}) / 40) * 40, y: Math.round((v.y + v.h * ${fy}) / 40) * 40 }; })`);
  const clickAt = async (x, y) => {
    const p = await at(x, y);
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
    await h.mouse('mousePressed', p.x, p.y);
    await h.mouse('mouseReleased', p.x, p.y);
    await h.settle();
  };
  const releaseAlt = () => h.evaluate(`window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }))`);
  const type = async (text) => { for (const ch of text) await h.key(ch); };
  /** Arm a placement ghost of `type` through the insert search. */
  const arm = async (query) => {
    await h.key('i');
    await type(query);
    await h.key('Enter');
    await h.until(`${h.module('editor-state.js')}.then((m) => !!m.editor.pendingPlace)`);
  };

  test('any tool is picked straight from another, dropping its uncommitted work; re-picking Wire keeps the draft', async () => {
    await h.key('w');
    await clickAt(-120, 0); // M1's gate
    assert.equal((await state()).wireSource, true);
    await h.key('w');
    assert.equal((await state()).wireSource, true, 'Wire again keeps the half-drawn wire');
    await h.key('m');
    let now = await state();
    assert.equal(now.wire, false);
    assert.equal(now.key, 'move');
    await arm('resistor');
    assert.equal((await state()).pending, 'resistor');
    await h.key('w');
    now = await state();
    assert.equal(now.pending, null, 'the ghost gave way to the wire tool');
    assert.equal(now.key, 'wire');
  });

  test('the insert search keeps every letter it is typed, tool keys included', async () => {
    await h.key('i');
    await type('wm');
    const now = await state();
    assert.equal(now.mode, 'insert');
    assert.equal(now.query, 'wm');
    await h.key('Escape');
  });

  test('view toggles answer in every mode but the insert search', async () => {
    const grid = (await state()).grid;
    for (const enter of [async () => {}, () => h.key('w'), () => h.key('m'), () => arm('capacitor')]) {
      await h.key('Escape');
      await enter();
      const before = await state();
      await h.key('#');
      assert.equal((await state()).grid, !before.grid, `# in ${before.key}`);
      await h.key('C', { shiftKey: true });
      assert.equal((await state()).crosshair, !before.crosshair, `Shift+C in ${before.key}`);
      await h.key('#');
      await h.key('C', { shiftKey: true });
    }
    await h.key('Escape');
    await h.key('Escape');
    await h.key('i');
    await h.key('#');
    assert.equal((await state()).grid, grid, 'typed into the search instead');
    assert.equal((await state()).query, '#');
    await h.key('Escape');
  });

  test('a still part placed as a pair mirrors across the axis the cursor shows, one undo for both', async () => {
    await arm('resistor');
    const pin = await viewPoint(0.75, 0.75);
    const p = await at(pin.x, pin.y);
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
    const before = await circuit('c.components.size');
    try {
      await h.key('Alt', { altKey: true });
      const q = await at(pin.x + 200, pin.y + 40);
      await h.mouse('mouseMoved', q.x, q.y, { button: 'none', buttons: 0, modifiers: 1 });
      await h.settle();
      await h.key('Enter', { altKey: true });
      await h.settle();
    } finally {
      await releaseAlt();
    }
    const placed = await circuit('[...c.components.values()].filter((p) => p.type === "resistor" && p.refdes !== "RD").map((p) => ({ x: p.transform.x, mx: p.transform.mirrorX, my: p.transform.mirrorY, r: p.transform.rotation }))');
    assert.equal(await circuit('c.components.size'), before + 2, JSON.stringify(placed));
    assert.equal(new Set(placed.map((p) => `${p.mx}${p.my}${p.r}`)).size, 2, `one of them reflected: ${JSON.stringify(placed)}`);
    await h.key('Escape');
    await h.key('Escape');
    await h.key('u');
    assert.equal(await circuit('c.components.size'), before);
  });

  test('Ctrl+R mirrors a ghost vertically while the pair is held', async () => {
    await arm('nmos');
    const mirrored = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => !!m.editor.pendingPlace.mirrorY)`);
    const before = await mirrored();
    try {
      await h.key('Alt', { altKey: true });
      await h.key('r', { ctrlKey: true, altKey: true });
      assert.equal(await mirrored(), !before);
    } finally {
      await releaseAlt();
    }
    await h.key('Escape');
  });

  test('an action that changes nothing, or is refused, leaves no history entry', async () => {
    const before = (await state()).history;
    await h.key('r'); // nothing selected to rotate
    assert.equal((await state()).history, before);
    // Renaming a part to a name another part has is refused, and nothing changes.
    await h.evaluate(`window.__run('rename RD M1')`);
    assert.equal((await state()).history, before);
    assert.equal(await circuit('c.components.has("RD")'), true);
  });

  test('arrow keys nudge a mixed selection as one edit', async () => {
    await h.evaluate(`window.__run('annotation add note 800 800')`);
    const label = await circuit('[...c.labels.values()].find((l) => l.text === "note").id');
    await h.evaluate(`${h.module('main.js')}.then((m) => { m.setSelection(['RD']); m.setLabelSelection([${JSON.stringify(label)}], undefined, true); m.render(); })`);
    const where = () => circuit(`({ rd: c.components.get('RD').transform.x, note: c.labels.get(${JSON.stringify(label)}).anchorWorld().x })`);
    const before = await where();
    const history = (await state()).history;
    await h.key('ArrowRight');
    const moved = await where();
    assert.equal(moved.rd - before.rd, 40);
    assert.equal(moved.note - before.note, 40);
    assert.equal((await state()).history, history + 1);
    await h.key('u');
    assert.deepEqual(await where(), before);
  });

  test('9 arms the highlight tool, and 8 clears every highlight', async () => {
    await h.key('9');
    assert.equal((await state()).key, 'highlight');
    await clickAt(200, -160); // the wire to VOUT
    assert.ok(await circuit('c.netHighlights.size') > 0);
    await h.key('Escape');
    await h.key('8');
    assert.equal(await circuit('c.netHighlights.size'), 0);
  });

  test('Shift+G and the Settings item turn the placement guides off and on', async () => {
    const pressed = () => h.evaluate(`document.getElementById('btn-guides').getAttribute('aria-checked')`);
    const before = (await state()).guides;
    assert.equal(await pressed(), String(before));
    await h.key('G', { shiftKey: true });
    assert.equal((await state()).guides, !before);
    assert.equal(await pressed(), String(!before));
    await h.click('#btn-settings');
    await h.click('#btn-guides');
    assert.equal((await state()).guides, before);
    assert.equal(await pressed(), String(before));
    await h.key('Escape');
  });

  test('Ctrl+E opens the export dialog', async () => {
    await h.key('e', { ctrlKey: true });
    await h.until(`document.querySelector('.export-dialog')?.open`);
    await h.evaluate(`document.querySelector('.export-dialog').close()`);
  });

  test('New starts an empty schematic directly, and fitting it shows a 30-cell planning view', async () => {
    assert.equal(await h.evaluate(`document.getElementById('btn-new-document').getAttribute('aria-haspopup')`), null);
    await h.click('#btn-new-document');
    await h.untilDiscarding(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.size === 0)`);
    await h.key('f');
    await h.settle();
    const view = await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.view)`);
    assert.ok(Math.min(view.w, view.h) >= 1200 && Math.min(view.w, view.h) < 1600, JSON.stringify(view));
  });

  test('a fitted view fits again when the window is resized', async () => {
    await h.key('f');
    await h.settle();
    const inView = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => { const v = m.editor.view; const b = m.editor.circuit.inkBounds(); return b.x >= v.x && b.y >= v.y && b.x + b.w <= v.x + v.w && b.y + b.h <= v.y + v.h; })`);
    assert.equal(await inView(), true);
    await h.send('Emulation.setDeviceMetricsOverride', { width: 700, height: 500, deviceScaleFactor: 1, mobile: false });
    await h.until(`innerWidth === 700`);
    await h.settle();
    assert.equal(await inView(), true, 'still all in view after the resize');
    await h.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await h.settle();
  });

  test('on a short window the rail runs across the top, and a fit keeps the drawing clear of it', async () => {
    await h.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 420, deviceScaleFactor: 1, mobile: false });
    await h.settle();
    await h.key('f');
    await h.settle();
    const layout = await h.evaluate(`Promise.all([${h.module('editor-state.js')}, ${h.module('canvas-view.js')}]).then(([s, v]) => {
      const rail = document.querySelector('.mode-toolbar').getBoundingClientRect();
      const b = s.editor.circuit.inkBounds();
      const top = v.worldToClient(b.x, b.y);
      const bottom = v.worldToClient(b.x + b.w, b.y + b.h);
      const pane = document.getElementById('canvas').getBoundingClientRect();
      const under = s.editor.circuit.inkRects().filter((r) => { const a = v.worldToClient(r.x, r.y); const z = v.worldToClient(r.x + r.w, r.y + r.h); return a.x < rail.right && z.x > rail.left && a.y < rail.bottom && z.y > rail.top; }).length;
      return { across: rail.width > rail.height, under, inkTop: top.y, inkBottom: bottom.y, paneTop: pane.top, paneBottom: pane.bottom, inkLeft: top.x, inkRight: bottom.x, paneLeft: pane.left, paneRight: pane.right };
    })`);
    await h.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await h.settle();
    assert.equal(layout.across, true, JSON.stringify(layout));
    // No ink under the rail; it may float over an empty part of the drawing.
    assert.equal(layout.under, 0, JSON.stringify(layout));
    assert.ok(layout.inkTop >= layout.paneTop - 1 && layout.inkBottom <= layout.paneBottom + 1, JSON.stringify(layout));
    assert.ok(layout.inkLeft >= layout.paneLeft - 1 && layout.inkRight <= layout.paneRight + 1, JSON.stringify(layout));
  });

  test('F keeps a wide drawing on the middle line beside the tool rail, and beside an open window', async () => {
    const wide = new Circuit();
    for (let k = 0; k < 30; k++) runCommand(wide, `add resistor R${k} --at ${k * 160} 0 --rot 90`);
    await h.evaluate(`window.__load(${JSON.stringify(wide.toJSON())})`);
    const fitted = () => h.evaluate(`Promise.all([${h.module('editor-state.js')}, ${h.module('canvas-view.js')}]).then(([s, v]) => {
      const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
      const b = s.editor.circuit.inkBounds();
      const a = v.worldToClient(b.x, b.y);
      const z = v.worldToClient(b.x + b.w, b.y + b.h);
      const win = document.getElementById('analysis-dialog');
      return { ink: { left: a.x, top: a.y, right: z.x, bottom: z.y }, rail: box(document.querySelector('.mode-toolbar')), pane: box(document.querySelector('.canvas-pane')), window: win.hidden ? null : box(win) };
    })`);
    const clear = (r, o) => r.right <= o.left + 1 || r.left >= o.right - 1 || r.bottom <= o.top + 1 || r.top >= o.bottom - 1;
    const middle = (r) => (r.top + r.bottom) / 2;
    // On a tall window the drawing clears the rail at the pane's middle, under it.
    await h.send('Emulation.setDeviceMetricsOverride', { width: 1263, height: 1392, deviceScaleFactor: 1, mobile: false });
    await h.until(`innerHeight === 1392`);
    await h.key('f');
    await h.settle();
    const tall = await fitted();
    await h.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await h.until(`innerHeight === 900`);
    assert.ok(tall.ink.top >= tall.rail.bottom - 1 && tall.ink.left < tall.rail.right, JSON.stringify(tall));
    assert.ok(Math.abs(middle(tall.ink) - middle(tall.pane)) <= 2, JSON.stringify(tall));
    await h.key('f');
    await h.settle();
    let at = await fitted();
    // The rail reaches below the middle line: the drawing stays on it, beside the rail.
    assert.ok(at.rail.bottom > middle(at.pane), JSON.stringify(at));
    assert.ok(Math.abs(middle(at.ink) - middle(at.pane)) <= 2, JSON.stringify(at));
    assert.ok(at.ink.left >= at.rail.right - 1 && at.ink.right <= at.pane.right + 1, JSON.stringify(at));
    const beside = at.ink.right - at.ink.left;
    await h.key('S', { shiftKey: true });
    await h.until(`!document.getElementById('analysis-dialog').hidden && !document.getElementById('analysis-dialog').classList.contains('docked')`);
    await h.key('f');
    await h.settle();
    at = await fitted();
    await h.key('S', { shiftKey: true });
    await h.until(`document.getElementById('analysis-dialog').hidden`);
    // The window stays clear of the drawing, which fits in the room left beside it.
    assert.ok(clear(at.ink, at.window) && clear(at.ink, at.rail), JSON.stringify(at));
    assert.ok(at.ink.right - at.ink.left < beside, JSON.stringify(at));
  });

  test('F lets the tool rail float over an empty corner of the drawing, which stays centred', async () => {
    // A row of parts along the bottom and a column up the right: the
    // drawing's top-left corner is empty.
    const ell = new Circuit();
    for (let k = 0; k < 12; k++) runCommand(ell, `add resistor B${k} --at ${k * 160} 0 --rot 90`);
    for (let k = 1; k < 8; k++) runCommand(ell, `add resistor C${k} --at 1760 ${-k * 160}`);
    await h.evaluate(`window.__load(${JSON.stringify(ell.toJSON())})`);
    await h.send('Emulation.setDeviceMetricsOverride', { width: 1263, height: 1392, deviceScaleFactor: 1, mobile: false });
    await h.until(`innerHeight === 1392`);
    await h.key('f');
    await h.settle();
    const at = await h.evaluate(`Promise.all([${h.module('editor-state.js')}, ${h.module('canvas-view.js')}]).then(([s, v]) => {
      const box = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
      const toScreen = (r) => { const a = v.worldToClient(r.x, r.y); const z = v.worldToClient(r.x + r.w, r.y + r.h); return { left: a.x, top: a.y, right: z.x, bottom: z.y }; };
      return { extent: toScreen(s.editor.circuit.inkBounds()), ink: s.editor.circuit.inkRects().map(toScreen),
        rail: box(document.querySelector('.mode-toolbar').getBoundingClientRect()), pane: box(document.querySelector('.canvas-pane').getBoundingClientRect()) };
    })`);
    await h.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await h.until(`innerHeight === 900`);
    const { extent, rail, pane } = at;
    const summary = JSON.stringify({ extent, rail, pane });
    // The rail is over the drawing's extent, but over none of its ink.
    assert.ok(extent.left < rail.right && extent.top < rail.bottom, summary);
    assert.ok(at.ink.every((r) => r.right <= rail.left || r.left >= rail.right || r.bottom <= rail.top || r.top >= rail.bottom), summary);
    // And the drawing is centred on the pane.
    assert.ok(Math.abs((extent.left + extent.right) / 2 - (pane.left + pane.right) / 2) <= 2, summary);
    assert.ok(Math.abs((extent.top + extent.bottom) / 2 - (pane.top + pane.bottom) / 2) <= 2, summary);
  });

  test('the shell is keyboard-reachable and speaks its status', async () => {
    const attrs = await h.evaluate(`({
      canvas: [document.getElementById('canvas').getAttribute('tabindex'), document.getElementById('canvas').getAttribute('role')],
      status: [document.getElementById('status').getAttribute('role'), document.getElementById('status').getAttribute('aria-live')],
      announce: document.getElementById('accessibility-announcement').getAttribute('aria-live'),
    })`);
    assert.deepEqual(attrs, { canvas: ['0', 'application'], status: ['status', 'polite'], announce: 'polite' });
  });

  test('the parts list rows carry the name and details, with no delete buttons', async () => {
    const rows = await h.evaluate(`[...document.querySelectorAll('#side-panel .component-list .row, #side-panel [data-panel="components"] .row')].map((r) => ({ text: r.textContent, buttons: r.querySelectorAll('button').length }))`);
    assert.ok(rows.length >= 4, JSON.stringify(rows));
    assert.ok(rows.some((r) => /RD/.test(r.text)));
    assert.ok(rows.every((r) => r.buttons === 0));
  });
});

describe('the sweep along a design\'s wires', { skip: browserSkip() }, () => {
  test('a design shown sweeps its wires once with light and leaves no trace; reduced motion skips it', async () => {
    const h = await start({ docs: { amp: amplifier() } });
    try {
      await h.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
      await h.open('amp');
      await h.until(`!!document.querySelector('svg.wire-sweep path[stroke^="url"]')`, 5000);
      // It runs over the drawing's own wire ink, in the drawing's frame.
      assert.equal(await h.evaluate(`document.querySelector('svg.wire-sweep path:last-child').getAttribute('d') === document.querySelector('#canvas svg path.wire-ink, .canvas svg path.wire-ink')?.getAttribute('d')`), true);
      assert.equal(await h.evaluate(`document.querySelector('svg.wire-sweep').getAttribute('viewBox') === document.querySelector('svg.wire-sweep').parentNode.querySelector('svg:not(.wire-sweep):not(.math-layer)').getAttribute('viewBox')`), true);
      await h.until(`!document.querySelector('svg.wire-sweep')`, 5000);
      await h.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await h.evaluate(`window.__load(${JSON.stringify(amplifier())})`);
      await new Promise((resolve) => setTimeout(resolve, 600));
      assert.equal(await h.evaluate(`!!document.querySelector('svg.wire-sweep')`), false);
      assert.deepEqual(h.exceptions(), []);
    } finally {
      await h.stop();
    }
  });
});
