/** The Atlas and linked designs in a browser: opening and leaving the
 *  desk, its search, the pick and its kin, opening a design from it, and
 *  peeking into and diving through a linked part. (The desk's shape, the
 *  workspace check, and the listing are in atlas-desk.test.js.) */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, stillDesk, browserSkip } from './harness.js';
import { linkedTop, tagged, wideAmplifier } from './fixtures.js';
import { join } from 'node:path';

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
    if (await snapshot()) await h.click('#app-mark');
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

  // Animations on, the page's clock slowed: a flight then lasts seconds
  // however slowly a machine draws its frames (CI's headless Chromium can
  // take as long for one frame as a whole flight takes), so a test watching
  // it sees it on its way. Undone by stillness().
  const SLOWER = 0.2;
  const motion = async () => {
    await h.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await h.evaluate(`(() => {
      if (window.__realTime) return;
      const now = performance.now.bind(performance);
      const frame = window.requestAnimationFrame.bind(window);
      const t0 = now();
      window.__realTime = { now, frame };
      performance.now = () => t0 + (now() - t0) * ${SLOWER};
      window.requestAnimationFrame = (callback) => frame(() => callback(performance.now()));
    })()`);
  };
  const stillness = async () => {
    await h.evaluate(`(() => {
      if (!window.__realTime) return;
      performance.now = window.__realTime.now;
      window.requestAnimationFrame = window.__realTime.frame;
      delete window.__realTime;
    })()`);
    await h.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  };

  test("one top bar for the editor and the Atlas: the mark goes there and back, the Atlas's buttons take the editor's places, Settings stays", async () => {
    await h.open('top');
    const place = (id) => h.evaluate(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return r.width ? Math.round(r.left) : null; })()`);
    const bar = () => h.evaluate(`(() => { const r = document.querySelector('.toolbar').getBoundingClientRect(); return [r.top, r.left, r.width]; })()`);
    const before = { mark: await place('app-mark'), settings: await place('btn-settings'), atlas: await place('btn-atlas'), bar: await bar() };
    await openDesk();
    assert.deepEqual((await snapshot()).tiles.map((t) => t.name).sort(), ['alpha', 'beta', 'child', 'top']);
    // The same bar, the mark and Settings where they were; Back where Atlas was.
    assert.deepEqual(await bar(), before.bar);
    assert.equal(await place('app-mark'), before.mark);
    assert.equal(await place('btn-settings'), before.settings);
    assert.equal(await place('btn-atlas'), null, 'the editor\'s Atlas steps aside');
    // Back where Atlas is, after the title; New and Export where the editor's are.
    const order = await h.evaluate(`[...document.querySelectorAll('.toolbar .document-cluster > *, .toolbar .file-cluster > *')].filter((el) => el.getBoundingClientRect().width).map((el) => el.id || el.querySelector('button')?.id || el.className)`);
    assert.deepEqual(order.slice(0, 5), ['app-mark', 'atlas-title', 'atlas-close', 'atlas-new-circuit', 'atlas-export'], order.join(' '));
    for (const id of ['btn-save', 'btn-document-menu', 'circuit-name']) assert.equal(await place(id), null, id);
    // Opened there, the menu works as in the editor, and Esc closes it
    // without touching the desk.
    const menuOpen = () => h.evaluate(`!document.getElementById('settings-menu').hidden`);
    const pickedBefore = (await snapshot()).tiles.find((t) => t.selected)?.name;
    await h.click('#btn-settings');
    assert.equal(await menuOpen(), true);
    const dark = () => h.evaluate(`document.documentElement.classList.contains('dark')`);
    const was = await dark();
    await h.click('#btn-theme');
    assert.equal(await dark(), !was);
    assert.equal(await h.evaluate(`document.getElementById('btn-theme').getAttribute('aria-checked')`), String(!was));
    await h.evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    assert.equal(await menuOpen(), false);
    assert.equal((await snapshot()).tiles.find((t) => t.selected)?.name, pickedBefore, 'the pick stays');
    await h.click('#btn-settings');
    await h.click('#btn-theme');
    await h.click('#btn-settings');
    // After keys on the desk, a real click opens the menu with no item
    // marked as chosen; from the keyboard the first item takes focus.
    await atlasKey('Tab');
    const at = await h.evaluate(`(() => { const r = document.getElementById('btn-settings').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await h.mouse('mouseMoved', at.x, at.y, { button: 'none', buttons: 0 });
    await h.mouse('mousePressed', at.x, at.y);
    await h.mouse('mouseReleased', at.x, at.y);
    assert.equal(await menuOpen(), true);
    assert.equal(await h.evaluate(`document.activeElement.id`), 'settings-menu');
    assert.equal(await h.evaluate(`!!document.querySelector('#settings-menu :focus-visible')`), false, 'no item looks chosen');
    await h.click('#btn-settings');
    await h.click('#btn-settings');
    assert.equal(await h.evaluate(`document.activeElement.id`), 'btn-grid', 'the keyboard starts at the first item');
    await h.click('#btn-settings');
    await closeDesk();
    assert.equal(await place('atlas-close'), null, 'the editor\'s bar again');
    assert.equal(await place('btn-settings'), before.settings);
    assert.equal(await menuOpen(), false);
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

  test('after z, Tab and the arrows zoom to each design they pick; after F they only pick', async () => {
    await openDesk();
    const pane = await h.evaluate(`(() => { const r = document.getElementById('atlas').getBoundingClientRect(); return { w: r.width, h: r.height }; })()`);
    const picked = async () => (await snapshot()).tiles.find((t) => t.selected);
    const settled = () => h.until(`${h.module('atlas.js')}.then((m) => { const a = m.atlasSnapshot(); return !!a && !a.busy; })`);
    const fitted = (tile) => Math.max(tile.screen.w / pane.w, tile.screen.h / pane.h) > 0.6
      && Math.abs(tile.screen.x + tile.screen.w / 2 - pane.w / 2) < pane.w * 0.1
      && Math.abs(tile.screen.y + tile.screen.h / 2 - pane.h / 2) < pane.h * 0.15;
    assert.ok(await pick('alpha'));
    await atlasKey('z');
    await settled();
    assert.ok(fitted(await picked()), 'z zooms to the pick');
    for (const key of ['Tab', 'Tab', 'ArrowLeft']) {
      const before = (await picked()).name;
      await atlasKey(key);
      await settled();
      const now = await picked();
      assert.notEqual(now.name, before);
      assert.ok(fitted(now), `${key} zooms to ${now.name}: ${JSON.stringify(now.screen)}`);
    }
    await atlasKey('f');
    await settled();
    const desk = (await snapshot()).view;
    await atlasKey('Tab');
    await settled();
    assert.deepEqual((await snapshot()).view, desk, 'after F, Tab keeps the zoom');
    await atlasKey('Escape');
  });

  test("a link's beam ends exactly on the edge of the linked design's card", async () => {
    await openDesk();
    assert.ok(await pick('top'));
    await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return s.tiles.find((t) => t.name === 'top').lift > 0.99 && s.beams.length > 0; })`);
    await stillDesk(h);
    const s = await snapshot();
    const child = s.tiles.find((t) => t.name === 'child').id;
    const beams = s.beams.filter((b) => b.to === child);
    assert.equal(beams.length, 1, JSON.stringify(s.beams));
    const { end, card } = beams[0];
    const near = (a, b) => Math.abs(a - b) < 1e-6;
    const within = (v, lo, hi) => v >= lo - 1e-6 && v <= hi + 1e-6;
    const onSide = ((near(end.x, card.x) || near(end.x, card.x + card.w)) && within(end.y, card.y, card.y + card.h)) ||
      ((near(end.y, card.y) || near(end.y, card.y + card.h)) && within(end.x, card.x, card.x + card.w));
    assert.ok(onSide, `beam end on the card's edge: ${JSON.stringify({ end, card })}`);
    await atlasKey('Escape');
    await h.until(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot().beams.length === 0)`);
  });

  test('the hint bar names the design under the pointer, then the pick again', async () => {
    await openDesk();
    // beta lifts alone (no links), so nothing floats over alpha.
    assert.ok(await pick('beta'));
    await h.until(`/^beta #filters · Enter opens/.test(document.getElementById('atlas-hint').textContent)`);
    const tiles = (await snapshot()).tiles;
    const alpha = tiles.find((t) => t.name === 'alpha');
    const at = await h.evaluate(`${h.module('atlas.js')}.then((m) => m.atlasWorldToClient(${alpha.x + alpha.w / 2}, ${alpha.y + alpha.h / 2}))`);
    await h.mouse('mouseMoved', at.x, at.y, { button: 'none', buttons: 0 });
    await h.until(`document.getElementById('atlas-hint').textContent === 'alpha #filters · click picks · double-click opens'`);
    assert.equal(await h.evaluate(`document.querySelector('#atlas-hint .atlas-hint-name').textContent`), 'alpha', 'named as a pick is');
    // Off every design, the pick has the bar again.
    await h.mouse('mouseMoved', 30, 450, { button: 'none', buttons: 0 });
    await h.until(`/^beta #filters · Enter opens/.test(document.getElementById('atlas-hint').textContent)`);
    await atlasKey('Escape');
  });

  test('Ctrl+Shift+C copies the picked design and says the resolution it copied at', async () => {
    await openDesk();
    assert.ok(await pick('beta'));
    await h.evaluate(`(() => { window.__copied = 0; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: async (items) => { for (const item of items) { await item.getType('image/png'); window.__copied += 1; } } } }); })()`);
    await atlasKey('C', { ctrlKey: true, shiftKey: true });
    await h.until(`/^Copied/.test(document.getElementById('atlas-status').textContent)`);
    assert.equal(await h.evaluate(`document.getElementById('atlas-status').textContent`), 'Copied 1 design at 300 dpi');
    assert.equal(await h.evaluate(`window.__copied`), 1);
    // A passing message: Esc brings back the count, and so does waiting.
    await atlasKey('Escape');
    assert.match(await h.evaluate(`document.getElementById('atlas-status').textContent`), /^\d+ designs$/);
    assert.ok(await pick('beta'));
    await atlasKey('C', { ctrlKey: true, shiftKey: true });
    await h.until(`/^Copied/.test(document.getElementById('atlas-status').textContent)`);
    await h.until(`/^\\d+ designs$/.test(document.getElementById('atlas-status').textContent)`, 8000);
    await atlasKey('Escape');
  });

  test('the designs lifted with the pick float clear of its card, are picked where they float, and settle back', async () => {
    await openDesk();
    assert.ok(await pick('top'));
    await h.until(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot().tiles.find((t) => t.name === 'top').lift > 0.99)`);
    await stillDesk(h);
    const tiles = Object.fromEntries((await snapshot()).tiles.map((t) => [t.name, t]));
    // Each card as drawn: grown about the drawing's center, then floated, its caption below.
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
    await h.settle();
    const found = await snapshot();
    assert.deepEqual(found.tiles.filter((t) => found.search.includes(t.id)).map((t) => t.name).sort(), ['alpha', 'beta']);
    assert.equal(found.arranged, before, 'not packed while typing');
    await h.until(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot().arranged !== ${JSON.stringify(before)})`);
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

  test('the open design flies back from the screen onto the still desk and lands picked; opening one flies it up to the screen', async () => {
    await h.open('child');
    await closeDesk();
    await motion();
    // Every frame's flight and view, sampled in the page.
    const sample = () => h.evaluate(`${h.module('atlas.js')}.then((m) => {
      window.__samples = [];
      const step = () => {
        const s = m.atlasSnapshot();
        window.__samples.push(s && { flight: s.flight, view: s.view, busy: s.busy });
        if (window.__samples.length < 600) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    })`);
    const samples = () => h.evaluate('window.__samples');
    try {
      await sample();
      await h.key('Backspace', { shiftKey: true });
      await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !!s && !s.busy; })`, 10000);
      const entering = (await samples()).filter((s) => s?.flight);
      const flying = entering.filter((s) => s.flight.depth < 1);
      // However few frames a loaded machine draws, the design passes between.
      assert.ok(flying.some((s) => s.flight.depth > 0 && s.flight.depth < 1), `a flight: ${JSON.stringify(entering.map((s) => s.flight.depth))}`);
      assert.equal(entering[0].flight.depth, 1, 'it starts at the screen');
      // The desk only draws back a little while the design flies: no zoom
      // out from the editor's view.
      const widths = flying.map((s) => s.view.w);
      const rest = (await snapshot()).view.w;
      assert.ok(Math.max(...widths) <= rest * 1.1 + 1e-6 && Math.min(...widths) >= rest * 0.99, `${rest}: ${Math.min(...widths)}..${Math.max(...widths)}`);
      const landed = (await snapshot()).tiles.find((t) => t.name === 'child');
      assert.equal(landed.selected, true, `it lands picked: ${JSON.stringify(landed)}`);
      await h.until(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot().tiles.find((t) => t.name === 'child').lift === 1)`);

      assert.ok(await pick('alpha'));
      await sample();
      await atlasKey('Enter');
      await h.until(`${h.module('atlas.js')}.then((m) => !m.atlasSnapshot())`, 10000);
      const opening = (await samples()).filter((s) => s?.flight);
      assert.ok(opening.some((s) => s.flight.depth > 0 && s.flight.depth < 1), `a flight: ${JSON.stringify(opening.map((s) => s.flight.depth))}`);
      assert.match(opening[0].flight.id, /alpha/);
      assert.equal(opening.at(-1).flight.depth, 1, 'it reaches the screen');
      assert.equal(await current(), 'alpha');
    } finally {
      await stillness();
    }
  });

  test('Shift+Backspace mid-flight turns the flight around from where it is, every way', async () => {
    await h.open('top');
    await closeDesk();
    await motion();
    // Every frame's depth until `done`, sampled in the page; Shift+Backspace
    // pressed (to the Atlas) once the depth passes `at`.
    const run = (at, done) => h.evaluate(`${h.module('atlas.js')}.then((m) => new Promise((resolve) => {
      const depths = [];
      let turned = false;
      const step = () => {
        const s = m.atlasSnapshot();
        const depth = s?.flight ? s.flight.depth : null;
        depths.push(depth);
        if (!turned && depth !== null && ${at}) {
          turned = true;
          // As typed: Shift goes down first, and alone it is no key at all.
          document.getElementById('atlas').dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true, bubbles: true }));
          document.getElementById('atlas').dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', shiftKey: true, bubbles: true }));
        }
        if ((turned && ${done}) || depths.length > 900) resolve({ depths, turned });
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }))`);
    const after = (depths, from) => depths.slice(from).filter((d) => d !== null);
    try {
      // 1. Editor to Atlas, turned back half way: it returns to the editor.
      await h.key('Backspace', { shiftKey: true });
      let r = await run('depth < 0.6 && depth > 0.05', '!s');
      assert.ok(r.turned);
      let turnedAt = r.depths.findIndex((d) => d !== null && d < 0.6 && d > 0.05);
      let back = after(r.depths, turnedAt);
      assert.ok(back.length > 2, JSON.stringify(r.depths));
      assert.ok(back.every((d) => d >= back[0] - 0.02), `reverses from there, never toward the desk: ${back.join(' ')}`);
      // Up from where it turned (its last frame at the glass hands over to
      // the editor at once, so how near the last one seen comes depends on
      // the frame rate); the editor then has it again.
      assert.ok(back.at(-1) > back[0], `back up toward the glass: ${back.join(' ')}`);
      assert.equal(await snapshot(), null, 'the editor again');
      assert.equal(await current(), 'top');

      // 2. Atlas to the editor (Back), turned back: it lands on the desk again.
      await openDesk();
      await stillDesk(h);
      await atlasKey('Backspace');
      r = await run('depth > 0.4', 's && !s.busy && !s.flight');
      turnedAt = r.depths.findIndex((d) => d !== null && d > 0.4);
      back = after(r.depths, turnedAt);
      assert.ok(back.every((d) => d <= back[0] + 0.02), `reverses toward the desk: ${back.join(' ')}`);
      assert.ok(Math.min(...back) < 0.05, 'down to the desk');
      const desk = await snapshot();
      assert.equal(desk.busy, false);
      assert.equal(desk.tiles.find((t) => t.name === 'top').selected, true, 'its design still picked');

      // 3. Opening another design, turned back: it is never opened.
      assert.ok(await pick('alpha'));
      await atlasKey('Enter');
      r = await run('depth > 0.4', 's && !s.busy && !s.flight');
      assert.ok(r.turned);
      await h.settle();
      assert.ok(await snapshot(), 'still on the desk');
      assert.equal(await current(), 'top', 'alpha was never let in');
    } finally {
      await stillness();
      await atlasKey('Escape');
    }
  });

  test('an ordinary key leaves a flight running and acts where it lands', async () => {
    await h.open('top');
    await closeDesk();
    await motion();
    try {
      const linksOn = () => h.evaluate(`document.getElementById('atlas-links').getAttribute('aria-pressed')`);
      const before = await linksOn();
      await h.key('Backspace', { shiftKey: true });
      // L (links) pressed once the design is in flight: the flight goes on.
      const depths = await h.evaluate(`${h.module('atlas.js')}.then((m) => new Promise((resolve) => {
        const out = [];
        let pressed = false;
        const step = () => {
          const s = m.atlasSnapshot();
          const depth = s?.flight ? s.flight.depth : null;
          if (pressed) out.push(depth);
          if (!pressed && depth !== null && depth < 0.97) {
            pressed = true;
            document.getElementById('atlas').dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }));
          }
          if (out.length >= 4 || (s && !s.busy)) resolve(out);
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }))`);
      // Not finished at once: finished, the next frame would be the landing
      // itself (depth exactly 0, then none); the flight goes on instead.
      assert.ok(depths.length >= 2 && depths.slice(0, 2).every((d) => d !== null && d !== 0), `still in flight after the key: ${depths.join(' ')}`);
      await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !!s && !s.busy; })`, 10000);
      await h.until(`document.getElementById('atlas-links').getAttribute('aria-pressed') === ${JSON.stringify(before === 'true' ? 'false' : 'true')}`);
      await atlasKey('l');
      assert.equal(await linksOn(), before);
    } finally {
      await stillness();
    }
  });

  test('keys typed during a flight hurry it and act where it arrives: on the desk, or in the editor', async () => {
    await h.open('child');
    await closeDesk();
    await motion();
    try {
      // Esc on the way to the desk lets go of the design once it has landed.
      await h.key('Backspace', { shiftKey: true });
      await atlasKey('Escape');
      await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !!s && !s.busy; })`, 10000);
      await h.settle();
      const landed = await snapshot();
      assert.equal(landed.flight, null);
      assert.equal(landed.tiles.some((t) => t.selected), false, 'the Esc typed on the way let go of the pick');

      // # on the way into a design toggles the editor's grid there.
      const grid = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.showGrid)`);
      const before = await grid();
      assert.ok(await pick('alpha'));
      await atlasKey('Enter');
      await atlasKey('#');
      await h.until(`${h.module('atlas.js')}.then((m) => !m.atlasSnapshot())`, 10000);
      await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.showGrid === ${!before})`, 5000);
      assert.equal(await current(), 'alpha');
      await h.key('#');
      assert.equal(await grid(), before);
    } finally {
      await stillness();
    }
  });

  test('leaving the Atlas finishes its flight: keys and scrolls on the way neither cut it short nor leave a design in flight', async () => {
    await h.open('top');
    await h.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    try {
      await h.key('Backspace', { shiftKey: true });
      await h.settle();
      for (const key of ['Backspace', 'Escape', 'T', 'f']) await atlasKey(key, key === 'Backspace' ? { shiftKey: true } : {});
      await h.evaluate(`document.getElementById('atlas').dispatchEvent(new WheelEvent('wheel', { deltaY: 200, bubbles: true }))`);
      await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !s || !s.busy; })`, 10000);
      await stillDesk(h);
      const settled = await snapshot();
      if (settled) {
        assert.equal(settled.busy, false);
        assert.equal(settled.flight, null);
        await h.click('#app-mark');
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
      // Open again once the editor is back up; closed, it stays closed.
      if (peeking) await h.until(`${h.module('hierarchy.js')}.then((m) => m.linkBubbleFrames().length === 1)`);
      else await h.settle();
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
    await h.settle();
    assert.equal(await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.mode)`), 'normal', 'no insert menu');
    await h.key('ArrowUp', { altKey: true });
  });
});
