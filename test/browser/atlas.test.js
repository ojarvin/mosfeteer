/** The Atlas and linked designs in a browser: opening and leaving the
 *  desk, its search, the pick and its kin, opening a design from it, and
 *  peeking into and diving through a linked part. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, sleep, browserSkip } from './harness.js';
import { linkedTop, tagged, wideAmplifier } from './fixtures.js';

describe('Atlas and linked designs', { skip: browserSkip() }, () => {
  let h;
  before(async () => {
    h = await start({ docs: { top: linkedTop(), child: wideAmplifier(), alpha: tagged('CA'), beta: tagged('CB') }, width: 1400, height: 900 });
  });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const snapshot = () => h.evaluate(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot())`);
  const atlasKey = (key, init = {}) => h.evaluate(`document.getElementById('atlas').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, ...${JSON.stringify(init)} }))`);
  const openDesk = async () => {
    if (!await snapshot()) await h.click('#app-mark');
    await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !!s && !s.busy && s.tiles.length > 0; })`, 10000);
  };
  const closeDesk = async () => {
    if (await snapshot()) await h.click('#atlas-mark');
    await h.until(`${h.module('atlas.js')}.then((m) => !m.atlasSnapshot())`, 10000);
  };
  const current = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.currentCircuitName)`);
  const pick = (name) => h.evaluate(`${h.module('atlas.js')}.then(async (m) => {
    // Tab steps through the designs until the one wanted is picked.
    for (let i = 0; i < 12; i++) {
      const s = m.atlasSnapshot();
      if (s.tiles.find((t) => t.selected)?.name === ${JSON.stringify(name)}) return true;
      document.getElementById('atlas').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
    }
    return false;
  })`);

  test("the toolbar's mark opens the Atlas and the Atlas's mark closes it; its theme toggle is the editor's", async () => {
    await h.open('top');
    await openDesk();
    assert.deepEqual((await snapshot()).tiles.map((t) => t.name).sort(), ['alpha', 'beta', 'child', 'top']);
    const dark = () => h.evaluate(`document.documentElement.classList.contains('dark')`);
    const was = await dark();
    await h.click('#atlas-theme');
    assert.equal(await dark(), !was);
    assert.equal(await h.evaluate(`document.getElementById('atlas-theme').getAttribute('aria-pressed')`), String(!was));
    assert.equal(await h.evaluate(`document.getElementById('btn-theme').getAttribute('aria-checked')`), String(!was));
    await h.click('#atlas-theme');
    await closeDesk();
  });

  test('the open design is marked, and the pick lifts with the designs it links to; the rest dim', async () => {
    await openDesk();
    const tiles = Object.fromEntries((await snapshot()).tiles.map((t) => [t.name, t]));
    assert.equal(tiles.top.current, true);
    assert.equal(tiles.child.current, false);
    assert.ok(await pick('top'));
    await h.until(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot().tiles.find((t) => t.name === 'top').lift > 0.99)`);
    const lifted = Object.fromEntries((await snapshot()).tiles.map((t) => [t.name, t]));
    assert.ok(lifted.child.lift > 0.1 && lifted.child.lift < 0.5, `its linked design lifts part way: ${lifted.child.lift}`);
    assert.ok(lifted.alpha.lift === 0 && lifted.alpha.dim > 0.5, 'the rest dim');
    const hint = () => h.evaluate(`document.getElementById('atlas-hint').textContent`);
    assert.match(await hint(), /^top · Enter opens/, 'the hint bar names the pick');
    await atlasKey('Escape');
    await h.until(`!/Enter opens/.test(document.getElementById('atlas-hint').textContent)`);
    assert.match(await hint(), /^Drag to move/);
  });

  test('the designs lifted with the pick float clear of its card, are picked where they float, and settle back', async () => {
    await openDesk();
    assert.ok(await pick('top'));
    await h.until(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot().tiles.find((t) => t.name === 'top').lift > 0.99)`);
    await sleep(600);
    const tiles = Object.fromEntries((await snapshot()).tiles.map((t) => [t.name, t]));
    // Each card as drawn: grown about the drawing's centre, then floated, its caption below.
    const card = (t) => {
      const grow = 1 + 0.12 * t.lift;
      return { x: t.x + (t.w * (1 - grow)) / 2 + t.float.dx, y: t.y + (t.h * (1 - grow)) / 2 + t.float.dy, w: t.w * grow, h: t.h * grow + 80 };
    };
    const a = card(tiles.top);
    const b = card(tiles.child);
    assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), `cards apart: ${JSON.stringify({ a, b })}`);
    assert.deepEqual(tiles.top.float, { dx: 0, dy: 0 }, 'the pick stays put');
    // A click where the linked design floats picks it.
    const at = await h.evaluate(`${h.module('atlas.js')}.then((m) => m.atlasWorldToClient(${b.x + b.w / 2}, ${b.y + b.h / 2}))`);
    await h.mouse('mouseMoved', at.x, at.y, { button: 'none', buttons: 0 });
    await h.mouse('mousePressed', at.x, at.y);
    await h.mouse('mouseReleased', at.x, at.y);
    await h.until(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot().tiles.find((t) => t.selected)?.name === 'child')`);
    await atlasKey('Escape');
    await h.until(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot().tiles.every((t) => t.lift === 0 && !t.float.dx && !t.float.dy))`);
  });

  test('a search marks what it finds at once and packs it together once typing pauses', async () => {
    await openDesk();
    const before = (await snapshot()).arranged;
    await h.evaluate(`(() => { const s = document.getElementById('atlas-search'); s.focus(); s.value = '#filters'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(50);
    const found = await snapshot();
    assert.deepEqual(found.tiles.filter((t) => found.search.includes(t.id)).map((t) => t.name).sort(), ['alpha', 'beta']);
    assert.equal(found.arranged, before, 'not packed while typing');
    await sleep(600);
    const packed = await snapshot();
    assert.notEqual(packed.arranged, before, 'packed after the pause');
    // Packed together: the two found designs sit side by side.
    const [a, b] = packed.tiles.filter((t) => packed.search.includes(t.id));
    const gap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h));
    assert.ok(gap <= Math.max(a.w, a.h, b.w, b.h), JSON.stringify(packed.tiles));
    await atlasKey('Escape');
    await h.evaluate(`document.getElementById('atlas-search').blur()`);
  });

  test('? opens Learn over the Atlas', async () => {
    await openDesk();
    await atlasKey('?');
    await h.until(`document.querySelector('.help-dialog')?.open`);
    assert.ok(await snapshot(), 'the Atlas stays behind it');
    await h.evaluate(`document.querySelector('.help-dialog').close()`);
  });

  test('Ctrl+E exports the desk through the export dialog, as vectors only', async () => {
    await openDesk();
    await atlasKey('e', { ctrlKey: true });
    await h.until(`document.querySelector('.export-dialog')?.open`);
    assert.equal(await h.evaluate(`document.querySelector('.export-dialog').dataset.target`), 'atlas');
    assert.equal(await h.evaluate(`[...document.querySelectorAll('.export-dialog .export-png')].every((el) => !el.offsetParent)`), true, 'no PNG for a sheet');
    await h.evaluate(`document.querySelector('.export-dialog').close()`);
  });

  test('Enter opens the picked design and leaves the Atlas', async () => {
    await openDesk();
    assert.ok(await pick('alpha'));
    await atlasKey('Enter');
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.currentCircuitName === 'alpha')`, 10000);
    await h.until(`${h.module('atlas.js')}.then((m) => !m.atlasSnapshot())`, 10000);
  });

  test('New in the Atlas starts a design, asking first about unsaved changes', async () => {
    await h.open('alpha');
    await h.evaluate(`window.__run('add resistor R9 --at 400 400')`);
    await openDesk();
    assert.equal(await h.evaluate(`document.getElementById('atlas-new-circuit').hidden`), false);
    await h.click('#atlas-new-circuit');
    await h.until(`document.getElementById('switch-dialog').open`);
    await h.click('#switch-dialog [value="discard"]');
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.size === 0 && !m.editor.currentDocumentPath)`, 10000);
    assert.equal(await snapshot(), null);
  });

  test('leaving the Atlas finishes its flight: keys and scrolls on the way neither cut it short nor leave the desk parted', async () => {
    await h.open('top');
    await h.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    try {
      await h.key('Backspace', { shiftKey: true });
      await sleep(30);
      for (const key of ['Backspace', 'Escape', 'T', 'f']) await atlasKey(key, key === 'Backspace' ? { shiftKey: true } : {});
      await h.evaluate(`document.getElementById('atlas').dispatchEvent(new WheelEvent('wheel', { deltaY: 200, bubbles: true }))`);
      await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !s || !s.busy; })`, 10000);
      await sleep(800);
      const settled = await snapshot();
      if (settled) {
        assert.equal(settled.busy, false);
        await h.click('#atlas-mark');
      }
      await h.until(`${h.module('atlas.js')}.then((m) => !m.atlasSnapshot())`, 10000);
      assert.equal(await h.evaluate(`!!document.getElementById('canvas').offsetParent`), true, 'the editor is back');
    } finally {
      await h.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    }
  });

  test("o peeks into a linked part's design; Alt+Down enters it, Alt+Up comes back and leaves the peek as it was", async () => {
    await h.open('top');
    await closeDesk();
    const frames = () => h.evaluate(`${h.module('hierarchy.js')}.then((m) => m.linkBubbleFrames().length)`);
    await h.evaluate(`${h.module('main.js')}.then((m) => { m.setSelection(['OA1']); m.render(); })`);
    assert.equal(await frames(), 0);
    await h.key('o');
    await h.until(`${h.module('hierarchy.js')}.then((m) => m.linkBubbleFrames().length === 1)`);
    // Down and back up with the peek open: open again; with it closed: closed again.
    for (const peeking of [true, false]) {
      if (!peeking) { await h.key('o'); await h.until(`${h.module('hierarchy.js')}.then((m) => m.linkBubbleFrames().length === 0)`); }
      await h.evaluate(`${h.module('main.js')}.then((m) => { m.setSelection(['OA1']); m.render(); })`);
      await h.key('ArrowDown', { altKey: true });
      await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.currentCircuitName === 'child')`, 10000);
      await h.key('ArrowUp', { altKey: true });
      await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.currentCircuitName === 'top')`, 10000);
      await sleep(200);
      assert.equal(await frames(), peeking ? 1 : 0, peeking ? 'the peek is open again' : 'and closed again');
    }
    assert.equal(await current(), 'top');
  });

  test('a double-click on a peek opens its design, without the insert menu', async () => {
    await h.open('top');
    await h.evaluate(`${h.module('main.js')}.then((m) => { m.setSelection(['OA1']); m.render(); })`);
    if (!await h.evaluate(`${h.module('hierarchy.js')}.then((m) => m.linkBubbleFrames().length)`)) await h.key('o');
    await h.until(`${h.module('hierarchy.js')}.then((m) => m.linkBubbleFrames().length === 1)`);
    const frame = await h.evaluate(`${h.module('hierarchy.js')}.then((m) => m.linkBubbleFrames()[0])`);
    const p = await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.worldToClient(${frame.x + frame.w / 2}, ${frame.y + frame.h / 2}))`);
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
    await h.mouse('mousePressed', p.x, p.y, { clickCount: 1 });
    await h.mouse('mouseReleased', p.x, p.y, { clickCount: 1 });
    await h.mouse('mousePressed', p.x, p.y, { clickCount: 2 });
    await h.mouse('mouseReleased', p.x, p.y, { clickCount: 2 });
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.currentCircuitName === 'child')`, 10000);
    await sleep(300);
    assert.equal(await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.mode)`), 'normal', 'no insert menu');
    await h.key('ArrowUp', { altKey: true });
  });
});

describe('the Atlas desk takes the window\'s shape', { skip: browserSkip() }, () => {
  const docs = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`d${i}`, i % 2 ? wideAmplifier() : tagged(`T${i}`)]));
  const spread = async (width, height) => {
    const h = await start({ docs, width, height });
    try {
      await h.open('d0');
      await h.click('#app-mark');
      await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !!s && !s.busy && s.tiles.length === 9; })`, 15000);
      const tiles = await h.evaluate(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot().tiles)`);
      const x = Math.min(...tiles.map((t) => t.x)), y = Math.min(...tiles.map((t) => t.y));
      return { w: Math.max(...tiles.map((t) => t.x + t.w)) - x, h: Math.max(...tiles.map((t) => t.y + t.h)) - y };
    } finally {
      await h.stop();
    }
  };

  test('a desk remembered wide opens tall in a narrow window', async () => {
    const h = await start({ docs, width: 1600, height: 800 });
    try {
      const shape = async () => {
        await h.click('#app-mark');
        await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !!s && !s.busy && s.tiles.length === 9; })`, 15000);
        const tiles = await h.evaluate(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot().tiles)`);
        await h.click('#atlas-mark');
        await h.until(`${h.module('atlas.js')}.then((m) => !m.atlasSnapshot())`, 15000);
        const x = Math.min(...tiles.map((t) => t.x)), y = Math.min(...tiles.map((t) => t.y));
        return { w: Math.max(...tiles.map((t) => t.x + t.w)) - x, h: Math.max(...tiles.map((t) => t.y + t.h)) - y };
      };
      await h.open('d0');
      const wide = await shape();
      assert.ok(wide.w > wide.h, `wide ${JSON.stringify(wide)}`);
      await h.send('Emulation.setDeviceMetricsOverride', { width: 700, height: 1200, deviceScaleFactor: 1, mobile: false });
      await sleep(300);
      const narrow = await shape();
      assert.ok(narrow.h > narrow.w, `narrow ${JSON.stringify(narrow)}`);
    } finally {
      await h.stop();
    }
  });

  test('a narrow window packs a fresh desk tall, a wide one wide', async () => {
    const narrow = await spread(700, 1200);
    const wide = await spread(1600, 800);
    assert.ok(narrow.h / narrow.w > wide.h / wide.w, `narrow ${JSON.stringify(narrow)}, wide ${JSON.stringify(wide)}`);
    assert.ok(narrow.h > narrow.w, `narrow ${JSON.stringify(narrow)}`);
  });
});
