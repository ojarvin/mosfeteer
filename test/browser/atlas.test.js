/** The Atlas and linked designs in a browser: opening and leaving the
 *  desk, its search, the pick and its kin, opening a design from it, and
 *  peeking into and diving through a linked part. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, sleep, browserSkip } from './harness.js';
import { linkedTop, tagged, wideAmplifier, withBeats } from './fixtures.js';
import { join } from 'node:path';
import { Circuit } from '../../src/core/model.js';
import { runCommand } from '../../src/core/commands.js';

/** The desk at rest: its snapshot the same over two frames in a row, however
 *  long a busy machine takes to get there. */
async function stillDesk(h, timeout = 15000) {
  const end = Date.now() + timeout;
  let last = '';
  for (;;) {
    await h.settle();
    const now = JSON.stringify(await h.evaluate(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot())`));
    if (now === last) return JSON.parse(now);
    if (Date.now() > end) throw new Error('the desk never came to rest');
    last = now;
  }
}

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
        await h.click('#app-mark');
        await h.until(`${h.module('atlas.js')}.then((m) => !m.atlasSnapshot())`, 15000);
        const x = Math.min(...tiles.map((t) => t.x)), y = Math.min(...tiles.map((t) => t.y));
        return { w: Math.max(...tiles.map((t) => t.x + t.w)) - x, h: Math.max(...tiles.map((t) => t.y + t.h)) - y };
      };
      await h.open('d0');
      const wide = await shape();
      assert.ok(wide.w > wide.h, `wide ${JSON.stringify(wide)}`);
      await h.send('Emulation.setDeviceMetricsOverride', { width: 700, height: 1200, deviceScaleFactor: 1, mobile: false });
      await h.settle();
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

describe('the workspace check', { skip: browserSkip() }, () => {
  // system links OA1 to "opamp", renamed in a file manager to ota-v2 (its
  // file remembers it was saved as opamp), and R1 to "nothing", which no
  // design is or was called.
  const system = () => {
    const circuit = new Circuit();
    for (const line of ['add opamp OA1 --at 0 0', 'add resistor R1 --at -600 -40', 'link OA1 opamp', 'link R1 nothing']) runCommand(circuit, line);
    return circuit.toJSON();
  };
  let h;
  before(async () => {
    h = await start({ docs: { system: system(), 'ota-v2': { ...wideAmplifier(), names: ['opamp'] } }, width: 1400, height: 900 });
  });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });
  const snapshot = () => h.evaluate(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot())`);
  const link = (ref) => h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.get(${JSON.stringify(ref)}).link)`);
  const menuItems = () => h.evaluate(`[...document.querySelectorAll('#atlas-check-menu [role="menuitem"]')].map((b) => b.textContent)`);

  test('in the editor, Design Check lists the open design\'s broken links and relinks the one it can', async () => {
    await h.open('system');
    await h.evaluate(`${h.module('atlas.js')}.then((m) => { if (m.atlasSnapshot()) document.getElementById('app-mark').click(); })`);
    await h.until(`${h.module('atlas.js')}.then((m) => !m.atlasSnapshot())`, 10000);
    const report = await h.evaluate(`${h.module('design-check-ui.js')}.then((m) => m.runCheck().brokenLinks)`);
    assert.deepEqual(report, ['OA1 → opamp', 'R1 → nothing']);
    const fixes = await h.evaluate(`[...document.querySelectorAll('#check-summary .check-fix')].map((b) => b.textContent)`);
    assert.deepEqual(fixes, ['Relink to ota-v2'], 'only the link with one design saved under its name is relinked');
    await h.evaluate(`[...document.querySelectorAll('#check-summary .check-fix')].find((b) => b.textContent === 'Relink to ota-v2').click()`);
    assert.equal(await link('OA1'), 'ota-v2');
    assert.equal(await link('R1'), 'nothing');
    // One undo step puts it back.
    await h.key('z', { ctrlKey: true });
    assert.equal(await link('OA1'), 'opamp');
  });

  test('in the Atlas, Check counts what needs a look, relinks in the files, and opens a design at its broken parts', async () => {
    await h.open('ota-v2');
    await h.click('#app-mark');
    await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !!s && !s.busy; })`, 10000);
    assert.equal(await h.evaluate(`document.getElementById('atlas-check').dataset.findings`), '2');
    assert.equal(await h.evaluate(`document.getElementById('atlas-check').classList.contains('atlas-check-findings')`), true, 'amber while there is something');
    await h.click('#atlas-check');
    assert.deepEqual(await menuItems(), ['Relink system: OA1 → opamp to ota-v2', 'Open system: R1 → nothing']);
    await h.evaluate(`[...document.querySelectorAll('#atlas-check-menu [role="menuitem"]')][0].click()`);
    // Written into system's file; the desk's links follow at once.
    const { readFile } = await import('node:fs/promises');
    await h.until(`document.getElementById('atlas-check').dataset.findings === '1'`, 5000);
    const saved = JSON.parse(await readFile(join(h.workspace, 'system.json'), 'utf8'));
    assert.deepEqual(saved.components.map((c) => [c.refdes, c.link]).sort(), [['OA1', 'ota-v2'], ['R1', 'nothing']]);
    assert.deepEqual(await menuItems(), ['Open system: R1 → nothing']);
    // Opening it lands on the part to relink by hand.
    await h.evaluate(`[...document.querySelectorAll('#atlas-check-menu [role="menuitem"]')][0].click()`);
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.currentCircuitName === 'system')`, 10000);
    await h.until(`${h.module('atlas.js')}.then((m) => !m.atlasSnapshot())`, 10000);
    assert.deepEqual(await h.evaluate(`${h.module('main.js')}.then((m) => m.selectedComps().map((c) => c.refdes))`), ['R1']);
    assert.equal(await snapshot(), null);
  });
});

describe('the workspace check reads the notes\' links', { skip: browserSkip() }, () => {
  // The notes link to OpAmp (saved as opamp, renamed to ota-v2) and to
  // nowhere, which R1 links to as well.
  const system = () => {
    const circuit = new Circuit();
    for (const line of ['add resistor R1 --at -600 -40', 'link R1 nowhere']) runCommand(circuit, line);
    circuit.notes = 'Built on [[OpAmp]]; R1 is [[nowhere]] yet.';
    return circuit.toJSON();
  };
  let h;
  before(async () => {
    h = await start({ docs: { system: system(), 'ota-v2': { ...wideAmplifier(), names: ['opamp'] } }, width: 1400, height: 900 });
  });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });
  const notes = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.notes)`);
  const menuItems = () => h.evaluate(`[...document.querySelectorAll('#atlas-check-menu [role="menuitem"]')].map((b) => b.textContent)`);

  test('Design Check lists them, relinks the one it can in the notes, and shows the notes for the rest', async () => {
    await h.open('system');
    await h.evaluate(`${h.module('atlas.js')}.then((m) => { if (m.atlasSnapshot()) document.getElementById('app-mark').click(); })`);
    await h.until(`${h.module('atlas.js')}.then((m) => !m.atlasSnapshot())`, 10000);
    const report = await h.evaluate(`${h.module('design-check-ui.js')}.then((m) => m.runCheck().brokenLinks)`);
    assert.deepEqual(report, ['R1, notes → nowhere', 'notes → OpAmp']);
    await h.evaluate(`[...document.querySelectorAll('#check-summary .check-fix')].find((b) => b.textContent === 'Relink to ota-v2').click()`);
    assert.equal(await notes(), 'Built on [[ota-v2]]; R1 is [[nowhere]] yet.');
    await h.key('z', { ctrlKey: true });
    assert.equal(await notes(), 'Built on [[OpAmp]]; R1 is [[nowhere]] yet.');
    await h.evaluate(`${h.module('design-check-ui.js')}.then((m) => m.runCheck())`);
    await h.evaluate(`[...document.querySelectorAll('#check-summary .check-issue')].find((b) => b.textContent.includes('notes → nowhere')).click()`);
    await h.until(`!!document.querySelector('.notes-window:not([hidden])')`);
    assert.deepEqual(await h.evaluate(`${h.module('main.js')}.then((m) => m.selectedComps().map((c) => c.refdes))`), ['R1']);
    await h.key('N', { shiftKey: true });
  });

  test('the Atlas Check relinks the notes in the file', async () => {
    await h.open('ota-v2');
    await h.click('#app-mark');
    await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !!s && !s.busy; })`, 10000);
    assert.equal(await h.evaluate(`document.getElementById('atlas-check').dataset.findings`), '2');
    await h.click('#atlas-check');
    assert.deepEqual(await menuItems(), ['Open system: R1, notes → nowhere', 'Relink system: notes → OpAmp to ota-v2']);
    await h.evaluate(`[...document.querySelectorAll('#atlas-check-menu [role="menuitem"]')][1].click()`);
    await h.until(`document.getElementById('atlas-check').dataset.findings === '1'`, 5000);
    const { readFile } = await import('node:fs/promises');
    const saved = JSON.parse(await readFile(join(h.workspace, 'system.json'), 'utf8'));
    assert.equal(saved.notes, 'Built on [[ota-v2]]; R1 is [[nowhere]] yet.');
    assert.deepEqual(await menuItems(), ['Open system: R1, notes → nowhere']);
  });
});

describe('a design keeps its place on the desk whether or not it is open', { skip: browserSkip() }, () => {
  // The browser measures an open design's math, tighter than the size the
  // file saves: the desk must not size (and so move) a design by that.
  const withMath = () => {
    const circuit = new Circuit();
    runCommand(circuit, 'add resistor R1 --at 0 0');
    circuit.addLabel({ text: '$H(s) = \\frac{g_m}{s C_L} \\cdot \\frac{1}{1 + s / \\omega_p}$', math: true, anchor: { x: 600, y: 0 } });
    return circuit.toJSON();
  };
  let h;
  before(async () => {
    h = await start({ docs: { formula: withMath(), plain: wideAmplifier(), other: tagged('CA') }, width: 1300, height: 900 });
  });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });
  const tiles = async ({ repack = false } = {}) => {
    await h.click('#app-mark');
    await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !!s && !s.busy && s.tiles.length === 3; })`, 10000);
    if (repack) {
      await h.evaluate(`document.getElementById('atlas').dispatchEvent(new KeyboardEvent('keydown', { key: 'T', shiftKey: true, bubbles: true }))`);
      await stillDesk(h);
    }
    const s = await h.evaluate(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot())`);
    await h.click('#app-mark');
    await h.until(`${h.module('atlas.js')}.then((m) => !m.atlasSnapshot())`, 10000);
    return Object.fromEntries(s.tiles.map((t) => [t.name, { x: t.x, y: t.y, w: t.w, h: t.h }]));
  };

  test('opening and leaving designs, with no edits, moves nothing on the desk; nor does packing afresh twice', async () => {
    const { readFile } = await import('node:fs/promises');
    const file = join(h.workspace, 'formula.json');
    const before = await readFile(file, 'utf8');
    await h.open('formula');
    // Its math measured in the editor first: that is no edit.
    await h.until(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].filter((l) => l.math).every((l) => l.textMeasured()))`);
    assert.equal(await h.evaluate(`${h.module('document-session.js')}.then((m) => m.hasUnsavedChanges())`), false, 'measuring math is no change');
    assert.equal(await h.evaluate(`document.getElementById('dirty-dot').hidden`), true);
    const open = await tiles();
    await h.open('plain');
    assert.equal(await readFile(file, 'utf8'), before, 'leaving it writes nothing');
    const closed = await tiles();
    assert.deepEqual(closed, open);
    await h.open('formula');
    await h.until(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].filter((l) => l.math).every((l) => l.textMeasured()))`);
    assert.deepEqual(await tiles(), open);
    // Shift+T packs afresh; with nothing changed, again it packs the same.
    const packed = await tiles({ repack: true });
    await h.open('plain');
    assert.deepEqual(await tiles({ repack: true }), packed);
  });
});

describe('the Atlas listing', { skip: browserSkip() }, () => {
  const timed = () => {
    const circuit = new Circuit();
    runCommand(circuit, 'add resistor R1 --at 0 0');
    circuit.addLabel({ text: 'p1', x: 400, y: 0, timing: { phase: 'p1', bits: '0110' } });
    return circuit.toJSON();
  };
  let h;
  before(async () => {
    // Narrow enough that the List button sits near the right edge.
    h = await start({ docs: { top: linkedTop(), child: wideAmplifier(), alpha: { ...tagged('CA'), notes: 'A filter.' }, gamma: withBeats(), timed: timed() }, width: 1000, height: 900 });
  });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });
  const rows = () => h.evaluate(`[...document.querySelectorAll('#atlas-list-panel tbody tr')].map((tr) => [...tr.cells].map((td) => td.querySelector('.atlas-list-name')?.textContent ?? td.textContent))`);
  const names = async () => (await rows()).map((row) => row[0]);

  test('lists every design with its tags and what it holds, sorts both ways, and renames as the editor does', async () => {
    await h.open('top');
    if (!await h.evaluate(`${h.module('atlas.js')}.then((m) => !!m.atlasSnapshot())`)) await h.click('#app-mark');
    await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !!s && !s.busy && s.tiles.length === 5; })`, 10000);
    await h.click('#atlas-list');
    assert.equal(await h.evaluate(`!document.getElementById('atlas-list-panel').hidden`), true);
    assert.deepEqual(await names(), ['alpha', 'child', 'gamma', 'timed', 'top'], 'by name');
    // It stays inside the window, and a wheel over it scrolls it, not the desk.
    await h.settle();
    const fit = await h.evaluate(`(() => { const r = document.getElementById('atlas-list-panel').getBoundingClientRect(); return { left: r.left, right: r.right, width: innerWidth }; })()`);
    assert.ok(fit.left >= 0 && fit.right <= fit.width, JSON.stringify(fit));
    const view = (await h.evaluate(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot().view)`));
    const swallowed = await h.evaluate(`(() => { const ev = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }); document.querySelector('#atlas-list-panel tbody tr').dispatchEvent(ev); return ev.defaultPrevented; })()`);
    assert.equal(swallowed, false, 'the listing scrolls');
    assert.deepEqual(await h.evaluate(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot().view)`), view, 'the desk stays');
    const byName = Object.fromEntries((await rows()).map((row) => [row[0], row]));
    // name, saved, tags, beats, timing, links, notes
    assert.equal(byName.alpha[2], '#filters');
    assert.deepEqual(byName.alpha.slice(3), ['', '', '', '✓']);
    assert.deepEqual(byName.gamma.slice(3), ['✓', '', '', '']);
    assert.deepEqual(byName.timed.slice(3), ['', '✓', '', '']);
    assert.deepEqual(byName.top.slice(3), ['', '', '✓', '']);
    assert.ok(byName.top[1], 'when it was saved');
    // Name again: Z to A.
    const sortBy = (key) => h.evaluate(`[...document.querySelectorAll('#atlas-list-panel .atlas-list-sort')].find((b) => b.title === 'Sort by ${key}').click()`);
    await sortBy('name');
    assert.deepEqual(await names(), ['top', 'timed', 'gamma', 'child', 'alpha']);
    // By date, then its reverse: the same designs, opposite orders.
    await sortBy('date');
    const newest = await names();
    await sortBy('date');
    assert.deepEqual(await names(), [...newest].reverse());
    await sortBy('name');

    // A double-click renames; Esc keeps the name, and the listing open.
    const rename = (from, to, key) => h.evaluate(`(() => {
      const name = [...document.querySelectorAll('#atlas-list-panel .atlas-list-name')].find((n) => n.textContent === ${JSON.stringify(from)});
      name.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      const input = document.querySelector('#atlas-list-panel .atlas-list-edit');
      input.value = ${JSON.stringify(to)};
      input.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }));
    })()`);
    await rename('child', 'nope', 'Escape');
    assert.equal(await h.evaluate(`!document.getElementById('atlas-list-panel').hidden`), true, 'still open');
    assert.ok((await names()).includes('child'));
    await rename('child', 'child-amp', 'Enter');
    await h.until(`[...document.querySelectorAll('#atlas-list-panel .atlas-list-name')].some((n) => n.textContent === 'child-amp')`, 10000);
    assert.deepEqual(await names(), ['alpha', 'child-amp', 'gamma', 'timed', 'top']);
    // The file is renamed, and the design linking to it follows.
    const { readFile, access } = await import('node:fs/promises');
    await access(join(h.workspace, 'child-amp.json'));
    await assert.rejects(access(join(h.workspace, 'child.json')));
    const top = JSON.parse(await readFile(join(h.workspace, 'top.json'), 'utf8'));
    assert.equal(top.components.find((c) => c.refdes === 'OA1').link, 'child-amp');
    assert.equal((await h.evaluate(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot().tiles.find((t) => t.selected)?.name)`)), 'child-amp', 'picked on the desk');
  });

  test('Shift+L opens it for the keys: arrows step through the designs, # edits tags, Enter opens one', async () => {
    const atlasKey = (key, init = {}) => h.evaluate(`document.getElementById('atlas').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, ...${JSON.stringify(init)} }))`);
    const listKey = (key, init = {}) => h.evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true, ...${JSON.stringify(init)} }))`);
    const open = () => h.evaluate(`!document.getElementById('atlas-list-panel').hidden`);
    const picked = () => h.evaluate(`document.querySelector('#atlas-list-panel tr.picked .atlas-list-name')?.textContent ?? null`);
    if (await open()) await h.click('#atlas-list');
    // Let go of the pick, so the arrows start from the top.
    await atlasKey('Escape');
    await atlasKey('L', { shiftKey: true });
    assert.equal(await open(), true);
    assert.equal(await h.evaluate(`document.activeElement.id`), 'atlas-list-panel', 'it has the keys');
    assert.equal(await picked(), null);
    await listKey('ArrowDown');
    assert.equal(await picked(), 'alpha');
    await listKey('ArrowDown');
    assert.equal(await picked(), 'child-amp');
    await listKey('ArrowUp');
    assert.equal(await picked(), 'alpha');
    assert.equal((await h.evaluate(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot().tiles.find((t) => t.selected)?.name)`)), 'alpha', 'picked on the desk too');
    // # edits the picked design's tags, saved as # on the desk saves them.
    await listKey('#');
    await h.evaluate(`(() => { const input = document.querySelector('#atlas-list-panel .atlas-list-edit'); input.value = 'filters audio'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    await h.until(`[...document.querySelectorAll('#atlas-list-panel .atlas-list-tags')].some((td) => td.textContent === '#filters #audio')`, 5000);
    const { readFile } = await import('node:fs/promises');
    assert.deepEqual(JSON.parse(await readFile(join(h.workspace, 'alpha.json'), 'utf8')).tags, ['filters', 'audio']);
    // Shift+L again closes it; open again, Enter opens the picked design.
    await listKey('L', { shiftKey: true });
    assert.equal(await open(), false);
    await atlasKey('L', { shiftKey: true });
    await listKey('ArrowDown');
    await listKey('Enter');
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.currentCircuitName === 'child-amp')`, 10000);
    await h.until(`${h.module('atlas.js')}.then((m) => !m.atlasSnapshot())`, 10000);
  });

  test('Shift and Ctrl pick several; # then adds tags to each of them, never twice', async () => {
    const atlasKey = (key, init = {}) => h.evaluate(`document.getElementById('atlas').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, ...${JSON.stringify(init)} }))`);
    const listKey = (key, init = {}) => h.evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true, ...${JSON.stringify(init)} }))`);
    const picked = () => h.evaluate(`[...document.querySelectorAll('#atlas-list-panel tr.picked .atlas-list-name')].map((n) => n.textContent)`);
    await h.click('#app-mark');
    await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !!s && !s.busy; })`, 10000);
    await atlasKey('Escape');
    await atlasKey('L', { shiftKey: true });
    await listKey('ArrowDown');
    await listKey('ArrowDown', { shiftKey: true });
    await listKey('ArrowDown', { shiftKey: true });
    assert.deepEqual(await picked(), ['alpha', 'child-amp', 'gamma']);
    // The desk picks them too.
    assert.deepEqual((await h.evaluate(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot().tiles.filter((t) => t.selected).map((t) => t.name).sort())`)), ['alpha', 'child-amp', 'gamma']);
    // Ctrl+click takes one out, and puts it back.
    const click = (name, init) => h.evaluate(`[...document.querySelectorAll('#atlas-list-panel tbody tr')].find((tr) => tr.querySelector('.atlas-list-name').textContent === ${JSON.stringify(name)}).dispatchEvent(new MouseEvent('click', { bubbles: true, ...${JSON.stringify(init)} }))`);
    await click('child-amp', { ctrlKey: true });
    assert.deepEqual(await picked(), ['alpha', 'gamma']);
    await click('child-amp', { ctrlKey: true });
    assert.deepEqual(await picked(), ['alpha', 'child-amp', 'gamma']);
    await h.evaluate(`document.getElementById('atlas-list-panel').focus()`);
    await listKey('#');
    assert.equal(await h.evaluate(`document.querySelector('#atlas-list-panel .atlas-list-edit').placeholder`), 'tags to add to 3 designs');
    // alpha already has filters (and audio): it is not added twice.
    await h.evaluate(`(() => { const input = document.querySelector('#atlas-list-panel .atlas-list-edit'); input.value = 'shared filters'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    const { readFile } = await import('node:fs/promises');
    const tags = async (name) => JSON.parse(await readFile(join(h.workspace, `${name}.json`), 'utf8')).tags;
    await h.until(`[...document.querySelectorAll('#atlas-list-panel .atlas-list-tags')].filter((td) => td.textContent.includes('#shared')).length === 3`, 10000);
    assert.deepEqual(await tags('alpha'), ['filters', 'audio', 'shared']);
    assert.deepEqual(await tags('child-amp'), ['shared', 'filters']);
    assert.deepEqual(await tags('gamma'), ['shared', 'filters']);
    assert.equal(await tags('top'), undefined, 'the rest untouched');
    // A plain click picks one again.
    await click('top', {});
    assert.deepEqual(await picked(), ['top']);
    await h.click('#atlas-list');
  });
});

describe('a long Atlas listing scrolls with its keys', { skip: browserSkip() }, () => {
  let h;
  before(async () => {
    const docs = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`design-${String(i).padStart(2, '0')}`, tagged(`T${i}`)]));
    h = await start({ docs, width: 1100, height: 520 });
  });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  test('up to the top row, it shows whole below the header; down to the last, at the bottom', async () => {
    if (!await h.evaluate(`${h.module('atlas.js')}.then((m) => !!m.atlasSnapshot())`)) await h.click('#app-mark');
    await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !!s && !s.busy && s.tiles.length === 30; })`, 15000);
    await h.evaluate(`document.getElementById('atlas').dispatchEvent(new KeyboardEvent('keydown', { key: 'L', shiftKey: true, bubbles: true }))`);
    await h.settle();
    const key = (k) => h.evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }))`);
    const shows = () => h.evaluate(`(() => {
      const panel = document.getElementById('atlas-list-panel');
      const row = panel.querySelector('tr.cursor');
      const head = panel.querySelector('thead').getBoundingClientRect();
      const box = panel.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      return { name: row.querySelector('.atlas-list-name').textContent, below: r.top >= head.bottom - 0.5, inside: r.bottom <= box.bottom + 0.5, scrollTop: panel.scrollTop };
    })()`);
    await key('End');
    let at = await shows();
    assert.equal(at.name, 'design-29');
    assert.ok(at.inside && at.scrollTop > 0, JSON.stringify(at));
    for (let i = 0; i < 29; i++) {
      await key('ArrowUp');
      at = await shows();
      assert.ok(at.below && at.inside, `${at.name} in view: ${JSON.stringify(at)}`);
    }
    assert.equal(at.name, 'design-00');
    assert.equal(at.scrollTop, 0, 'all the way up');
    // Esc closes it and gives the keys back to the desk: the List button,
    // never pressed, takes no focus (and shows no focus ring).
    await key('Escape');
    await h.until(`document.getElementById('atlas-list-panel').hidden`);
    assert.equal(await h.evaluate(`document.activeElement.id`), 'atlas');
  });
});

describe('Atlas hierarchy chain', { skip: browserSkip() }, () => {
  let h;
  // top -> mid -> leaf -> deep -> deeper, and a design using top.
  const linking = (to) => {
    const circuit = new Circuit();
    for (const line of ['add opamp OA1 --at 0 0', ...(to ? [`link OA1 ${to}`] : [])]) runCommand(circuit, line);
    return circuit.toJSON();
  };
  before(async () => {
    h = await start({ docs: { top: linking('mid'), mid: linking('leaf'), leaf: linking('deep'), deep: linking('deeper'), deeper: linking(null), user: linking('top'), other: linking(null) }, width: 1400, height: 900 });
  });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  test("the pick's children lift less a level at a time, three levels down, with fainter beams", async () => {
    await h.open('top');
    await h.click('#app-mark');
    await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !!s && !s.busy && s.tiles.length === 7; })`, 10000);
    await h.evaluate(`${h.module('atlas.js')}.then(async (m) => {
      for (let i = 0; i < 12 && m.atlasSnapshot().tiles.find((t) => t.selected)?.name !== 'top'; i++) {
        document.getElementById('atlas').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        await new Promise((r) => setTimeout(r, 30));
      }
    })`);
    await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return s.tiles.find((t) => t.name === 'top').lift === 1 && s.tiles.every((t) => t.lift === 0 || t.lift > 0.05) && s.beams.length >= 4; })`);
    const s = await h.evaluate(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot())`);
    const t = Object.fromEntries(s.tiles.map((tile) => [tile.name, tile]));
    assert.ok(t.top.lift > t.mid.lift && t.mid.lift > t.leaf.lift && t.leaf.lift > t.deep.lift && t.deep.lift > 0, JSON.stringify(s.tiles.map((x) => [x.name, x.lift])));
    assert.equal(t.user.lift, t.mid.lift, 'a design using the pick lifts as its children do');
    assert.ok(t.deeper.lift === 0 && t.deeper.dim === 1 && t.other.dim === 1, 'past three levels, and off the chain, the rest lie flat and dim');
    // The pick alone at full strength; its kin a step down, the chain dimmer as it goes.
    assert.ok(t.top.dim === 0 && t.mid.dim > 0 && t.leaf.dim > t.mid.dim && t.deep.dim > t.leaf.dim, JSON.stringify(s.tiles.map((x) => [x.name, x.dim])));
    const depthOf = (from, to) => s.beams.find((b) => b.from === t[from].id && b.to === t[to].id)?.depth;
    assert.deepEqual([depthOf('top', 'mid'), depthOf('user', 'top'), depthOf('mid', 'leaf'), depthOf('leaf', 'deep'), depthOf('deep', 'deeper')], [1, 1, 2, 3, undefined]);
  });

  test('with the links hidden the pick lifts alone; shown again, its kin float back up', async () => {
    const atlasKey = (key) => h.evaluate(`document.getElementById('atlas').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))`);
    const lifts = `${h.module('atlas.js')}.then((m) => Object.fromEntries(m.atlasSnapshot().tiles.map((t) => [t.name, t])))`;
    await h.until(`${lifts}.then((t) => t.top.lift === 1 && t.mid.lift > 0)`);
    await atlasKey('l');
    await h.until(`${lifts}.then((t) => t.top.lift === 1 && ['mid', 'leaf', 'deep', 'user'].every((n) => t[n].lift === 0 && t[n].dim === 1 && !t[n].float.dx && !t[n].float.dy))`);
    await atlasKey('l');
    await h.until(`${lifts}.then((t) => t.mid.lift > 0.2 && t.deep.lift > 0)`);
  });
});
