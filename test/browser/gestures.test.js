/** Pointer gestures in a browser: a pin dragged into a wire and quick-add,
 *  a part dropped on a wire, the right press (menu, radial, zoom), the
 *  knife, hovering, and the side panel's find, replace, and check. */

import { describe, before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, sleep, browserSkip } from './harness.js';
import { amplifier, editing } from './fixtures.js';

describe('gestures', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { amp: amplifier(), edit: editing() }, width: 1400, height: 900 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });
  const fresh = async (name, state) => {
    await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.inlineInput?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))`);
    await h.evaluate(`[...document.querySelectorAll('.floating-window:not([hidden]) .floating-window-close')].forEach((b) => b.click())`);
    await h.open(name);
    await h.key('Escape');
    await h.key('Escape');
    await h.evaluate(`window.__load(${JSON.stringify(state)})`);
    await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.fitView())`);
  };
  beforeEach(() => fresh('amp', amplifier()));

  const ed = (expression) => h.evaluate(`${h.module('editor-state.js')}.then((m) => { const e = m.editor; const c = e.circuit; return ${expression}; })`);
  const at = (x, y) => h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.worldToClient(${x}, ${y}))`);
  const drag = async (from, to, { button = 'left', modifiers = 0, steps = 6, holdMs = 0 } = {}) => {
    const a = await at(from.x, from.y);
    const b = await at(to.x, to.y);
    await h.mouse('mouseMoved', a.x, a.y, { button: 'none', buttons: 0, modifiers });
    await h.mouse('mousePressed', a.x, a.y, { button, modifiers });
    if (holdMs) await sleep(holdMs);
    for (let k = 1; k <= steps; k++) await h.mouse('mouseMoved', a.x + (b.x - a.x) * k / steps, a.y + (b.y - a.y) * k / steps, { buttons: button === 'right' ? 2 : 1, modifiers });
    await h.mouse('mouseReleased', b.x, b.y, { button, modifiers });
    await sleep(100);
  };

  test('a pin dragged into space draws a wire and offers quick-add there; a pick places and wires it as one step', async () => {
    const history = await ed('e.history.length');
    await drag({ x: 0, y: -400 }, { x: 400, y: -400 }); // RD.a, out to the right
    await h.until(`!!document.querySelector('.quick-add:not([hidden])')`);
    await h.evaluate(`(() => { const input = document.querySelector('.quick-add-input'); input.value = 'capacitor'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    await h.until(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.components.values()].some((c) => c.type === 'capacitor'))`);
    const cap = await ed(`[...c.components.values()].find((p) => p.type === 'capacitor').refdes`);
    const net = await ed(`c.netOfTerminal({ comp: 'RD', term: 'a' }).terminals.map((t) => t.comp).sort()`);
    assert.ok(net.includes(cap), `wired to RD.a: ${net}`);
    assert.equal(await ed('e.history.length'), history + 1, 'one undo step');
    await h.key('u');
    assert.equal(await ed(`[...c.components.values()].some((p) => p.type === 'capacitor')`), false);
  });

  test('a lone part dropped onto a straight wire goes in series with it', async () => {
    // The wire from the junction to VOUT runs along y = -160 from x = 0 to 400.
    await h.evaluate(`window.__run('add resistor RS --at 200 400')`);
    await drag({ x: 200, y: 400 }, { x: 200, y: -160 });
    const a = await ed(`c.netOfTerminal({ comp: 'RS', term: 'a' })?.terminals.map((t) => t.comp).sort()`);
    const b = await ed(`c.netOfTerminal({ comp: 'RS', term: 'b' })?.terminals.map((t) => t.comp).sort()`);
    assert.ok(a && b && a.join() !== b.join(), JSON.stringify({ a, b }));
    assert.ok([...a, ...b].includes('VOUT'), 'between the stage and VOUT');
  });

  test('a right tap on a part opens its menu on release; a hold opens the radial menu; a right drag zooms to a box', async () => {
    const p = await at(0, -320);
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
    await h.mouse('mousePressed', p.x, p.y, { button: 'right' });
    assert.equal(await h.evaluate(`document.querySelector('.component-context-menu').hidden`), true, 'not on the press');
    await h.mouse('mouseReleased', p.x, p.y, { button: 'right' });
    await h.until(`!document.querySelector('.component-context-menu').hidden`);
    await h.key('Escape');
    await h.mouse('mousePressed', p.x, p.y, { button: 'right' });
    await sleep(450);
    assert.ok(await h.evaluate(`document.querySelectorAll('.radial-item').length`) > 0, 'held: the radial menu');
    await h.mouse('mouseReleased', p.x, p.y, { button: 'right' });
    await h.key('Escape');
    await sleep(100);
    const before = await ed('e.view.w');
    await drag({ x: -200, y: -500 }, { x: 200, y: -100 }, { button: 'right' });
    assert.ok(await ed('e.view.w') < before * 0.8, 'zoomed into the box');
  });

  test('the radial menu fits what is under the press: the paper, a pin, a part, a wire', async () => {
    const items = async (x, y) => {
      const p = await at(x, y);
      await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
      await h.mouse('mousePressed', p.x, p.y, { button: 'right' });
      await sleep(450);
      const labels = await h.evaluate(`[...document.querySelectorAll('.radial-item')].map((i) => i.textContent.trim())`);
      await h.key('Escape');
      await h.mouse('mouseReleased', p.x, p.y, { button: 'right' });
      await sleep(120);
      await h.key('Escape');
      return labels;
    };
    const paper = await h.evaluate(`${h.module('editor-state.js')}.then((m) => { const v = m.editor.view; return { x: Math.round((v.x + v.w * 0.9) / 40) * 40, y: Math.round((v.y + v.h * 0.85) / 40) * 40 }; })`);
    assert.equal((await items(paper.x, paper.y)).length, 8, 'the paper: a part palette in eight places');
    const pin = await items(-120, 0); // M1's gate
    for (const label of ['Supply', 'Ground', 'Port', 'Wire']) assert.ok(pin.some((t) => t.includes(label)), `${label} in ${pin}`);
    const wire = await items(200, -160);
    assert.ok(wire.some((t) => /Name net/.test(t)) && wire.some((t) => /Highlight/.test(t)), `${wire}`);
  });

  test('a Ctrl-drag copies a part and leaves the clipboard as it was', async () => {
    await h.evaluate(`${h.module('main.js')}.then((m) => { m.setSelection(['VIN']); m.copySelection?.(); })`);
    const clipboard = await ed('JSON.stringify(e.clipboard)');
    const parts = await ed('c.components.size');
    await drag({ x: 0, y: -320 }, { x: 600, y: -320 }, { modifiers: 2 });
    assert.equal(await ed('c.components.size'), parts + 1);
    assert.equal(await ed('JSON.stringify(e.clipboard)'), clipboard);
  });

  test('a short between two named nets asks which name to keep; a script records it for the check instead', async () => {
    await h.evaluate(`${h.module('editor-state.js')}.then((m) => { m.editor.circuit.renameNet(m.editor.circuit.netOfTerminal({ comp: 'VIN', term: 'p' }), 'A'); m.editor.circuit.renameNet(m.editor.circuit.netOfTerminal({ comp: 'VOUT', term: 'p' }), 'B'); })`);
    await h.key('w');
    const a = await at(-200, 0);
    await h.mouse('mouseMoved', a.x, a.y, { button: 'none', buttons: 0 });
    await h.mouse('mousePressed', a.x, a.y);
    await h.mouse('mouseReleased', a.x, a.y);
    // Up, then along to the wire to VOUT, and Enter joins it there.
    for (const [x, y] of [[-200, -160], [200, -160]]) {
      const b = await at(x, y);
      await h.mouse('mouseMoved', b.x, b.y, { button: 'none', buttons: 0 });
      await h.mouse('mousePressed', b.x, b.y);
      await h.mouse('mouseReleased', b.x, b.y);
      await sleep(60);
    }
    await h.key('Enter');
    await h.until(`${h.module('editor-state.js')}.then((m) => { const names = m.editor.pendingNetNameChoice?.names || []; return names.includes('A') && names.includes('B'); })`, 5000);
    // Cancelled, the short is undone: the two nets stay apart.
    await h.key('Escape');
    await sleep(200);
    // (A port alone on its net carries the net's name: VIN is A now, VOUT B.)
    assert.notEqual(await ed(`c.netOfTerminal({ comp: 'A', term: 'p' }).id`), await ed(`c.netOfTerminal({ comp: 'B', term: 'p' }).id`));
    // The same short from a script keeps one name and notes the other.
    await fresh('amp', amplifier());
    const warnings = await h.evaluate(`${h.module('editor-state.js')}.then((m) => { const c = m.editor.circuit; c.renameNet(c.netOfTerminal({ comp: 'VIN', term: 'p' }), 'A'); c.renameNet(c.netOfTerminal({ comp: 'VOUT', term: 'p' }), 'B'); window.__run('connect A.p B.p'); return c.netNameWarnings.length; })`);
    assert.equal(await h.evaluate(`!!document.querySelector('dialog[open]')`), false, 'no prompt');
    assert.ok(warnings > 0);
  });

  test('a tool picked on the rail with the pointer hands the keyboard back to the drawing; the wire shapes are in its flyout', async () => {
    await h.evaluate(`(() => { const b = document.getElementById('btn-mode-move'); b.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })); })()`);
    assert.equal(await h.evaluate(`document.activeElement?.id`), 'canvas');
    assert.equal(await h.evaluate(`document.getElementById('btn-mode-wire').getAttribute('aria-controls')`), 'wire-flyout');
    assert.ok(await h.evaluate(`!!document.getElementById('wire-flyout')`));
    await h.key('Escape');
  });

  test("hovering a wire lights its net's row; hovering a part's body lights the part's row", async () => {
    const hover = async (x, y) => { const p = await at(x, y); await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 }); await sleep(120); };
    await hover(200, -160);
    const nets = await h.evaluate(`[...document.querySelectorAll('#side-panel .row.hover')].map((r) => r.textContent)`);
    assert.ok(nets.some((t) => /VOUT/.test(t)), `${nets}`);
    await hover(0, -320);
    const parts = await h.evaluate(`[...document.querySelectorAll('#side-panel .row.hover')].map((r) => r.dataset.refdes).filter(Boolean)`);
    assert.deepEqual(parts, ['RD']);
  });

  test('the knife deletes whatever it cuts: a part, a wire, a note -- each stroke one undo step', async () => {
    await fresh('edit', editing());
    await h.key('Delete');
    const count = () => ed('({ parts: c.components.size, wires: [...c.nets.values()].reduce((n, net) => n + net.paths().length, 0), note: [...c.labels.values()].some((l) => l.text === "note") })');
    const before = await count();
    // Down through R3's body (x = 1000), then through the OUT wire (x = 800), then across the note.
    await drag({ x: 1000, y: -240 }, { x: 1000, y: 240 }, { modifiers: 8 });
    assert.equal((await count()).parts, before.parts - 1, 'the part');
    await drag({ x: 840, y: -240 }, { x: 840, y: 240 }, { modifiers: 8 });
    assert.ok((await count()).wires < before.wires, 'the wire');
    await drag({ x: -10, y: -60 }, { x: 10, y: 60 }, { modifiers: 8 });
    assert.equal((await count()).note, false, 'the note');
    await h.key('Escape');
    for (let k = 0; k < 3; k++) await h.key('u');
    assert.deepEqual(await count(), before, 'three strokes, three undo steps');
  });

  test('find lists matching label text; Ctrl+H replaces it in one undo step; Escape ends both', async () => {
    await h.key('f', { ctrlKey: true });
    await h.until(`document.activeElement?.id === 'panel-filter'`);
    await h.evaluate(`(() => { const f = document.getElementById('panel-filter'); f.value = 'VOUT'; f.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(150);
    assert.ok(await h.evaluate(`document.querySelectorAll('#text-matches-list .row').length`) > 0);
    await h.evaluate(`document.getElementById('panel-filter').dispatchEvent(new KeyboardEvent('keydown', { key: 'h', ctrlKey: true, bubbles: true }))`);
    await h.until(`!document.getElementById('panel-replace').hidden`);
    await h.evaluate(`(() => { const r = document.getElementById('panel-replace-input'); r.value = 'OUTPUT'; r.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const history = await ed('e.history.length');
    await h.click('#panel-replace-all');
    await sleep(150);
    assert.equal(await ed(`c.components.has('OUTPUT')`), true, 'renamed through the model');
    assert.equal(await ed('e.history.length'), history + 1);
    await h.evaluate(`document.getElementById('panel-replace-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    assert.deepEqual(await h.evaluate(`[document.getElementById('panel-filter').value, document.getElementById('panel-replace-input').value]`), ['', '']);
    await h.key('u');
  });

  test('the status chip runs a check when there is none, and shows the report when there is', async () => {
    assert.equal(await h.evaluate(`!!document.querySelector('header.toolbar #btn-check')`), false, 'not in the toolbar');
    await h.click('#status-check');
    await h.until(`${h.module('editor-state.js')}.then((m) => !!m.editor.lastCheckReport)`);
    await h.evaluate(`document.body.classList.add('side-panel-collapsed')`);
    await h.click('#status-check');
    await sleep(200);
    assert.equal(await h.evaluate(`!!document.getElementById('check-summary').offsetParent`), true, 'the report, in the panel');
  });

  test('Ctrl+F brings a hidden panel back to find in it', async () => {
    await h.key('P', { shiftKey: true });
    await sleep(150);
    await h.key('f', { ctrlKey: true });
    await h.until(`document.activeElement?.id === 'panel-filter' && !!document.getElementById('panel-filter').offsetParent`);
    await h.key('Escape');
  });
});
