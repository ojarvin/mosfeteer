/** Selecting and editing objects in a browser: stacked clicks, labels
 *  edited in place, sets dragged whole, copies, line vertices, and names. */

import { describe, before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, sleep, browserSkip } from './harness.js';
import { editing } from './fixtures.js';
import { Circuit } from '../../src/core/model.js';
import { runCommand } from '../../src/core/commands.js';

/** A rail from R1.b (0,80) down to R2.a (0,400), and R3 to its right with a
 *  wire from its pin a (320,240) that ends free at (160,160). */
function stubBesideRail() {
  const circuit = new Circuit();
  for (const line of ['add resistor R1 --at 0 0 --rot 90', 'add resistor R2 --at 0 480 --rot 90', 'connect R1.b R2.a', 'add resistor R3 --at 400 240']) runCommand(circuit, line);
  const path = [{ x: 320, y: 240 }, { x: 320, y: 160 }, { x: 160, y: 160 }];
  const net = circuit.createWireNet({ route: path, branches: [path] });
  net.terminals.push({ comp: 'R3', term: 'a' });
  return circuit.toJSON();
}

describe('selection and editing', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { edit: editing() }, width: 1400, height: 900 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });
  beforeEach(async () => {
    // An editor left open by a test is closed first.
    await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.inlineInput?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))`);
    await h.open('edit');
    await h.key('Escape');
    await h.key('Escape');
    await h.evaluate(`window.__load(${JSON.stringify(editing())})`);
    await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.fitView())`);
  });

  const ed = (expression) => h.evaluate(`${h.module('editor-state.js')}.then((m) => { const e = m.editor; const c = e.circuit; return ${expression}; })`);
  const at = (x, y) => h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.worldToClient(${x}, ${y}))`);
  const press = async (x, y, { modifiers = 0, to = null, detail = 1 } = {}) => {
    const p = await at(x, y);
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0, modifiers });
    await h.mouse('mousePressed', p.x, p.y, { modifiers, clickCount: detail });
    if (to) {
      const q = await at(to.x, to.y);
      for (let k = 1; k <= 6; k++) await h.mouse('mouseMoved', p.x + (q.x - p.x) * k / 6, p.y + (q.y - p.y) * k / 6, { buttons: 1, modifiers });
      await h.mouse('mouseReleased', q.x, q.y, { modifiers, clickCount: detail });
    } else {
      await h.mouse('mouseReleased', p.x, p.y, { modifiers, clickCount: detail });
    }
    await sleep(80);
  };
  const until = (expression) => h.until(`${h.module('editor-state.js')}.then((m) => { const e = m.editor; const c = e.circuit; return ${expression}; })`);
  const selected = () => ed(`({ parts: [...e.multi].length ? [...e.multi] : (e.selected ? [e.selected] : []), labels: [...e.selLabels].map((id) => c.labels.get(id)?.text ?? id) })`);
  const noteId = () => ed(`[...c.labels.values()].find((l) => l.text === 'note').id`);

  test('a still click on a selected object picks the next one stacked under it, and a press drags the selected one', async () => {
    // Clicks apart, as a hand makes them: two quick ones are a double-click.
    await press(0, 0);
    const first = await selected();
    await sleep(600);
    await press(0, 0);
    const second = await selected();
    assert.notDeepEqual(first, second, 'the second click picks the other object');
    const picked = [first, second].map((s) => (s.parts.includes('R1') ? 'R1' : s.labels.includes('note') ? 'note' : '?'));
    assert.deepEqual(picked.sort(), ['R1', 'note']);
    await sleep(600);
    await press(0, 0);
    assert.deepEqual(await selected(), first, 'and round again');
    // Pressed again and dragged, the selected object moves, the other stays.
    await sleep(600);
    const r1 = await ed(`c.components.get('R1').transform.y`);
    const note = await ed(`c.labels.get(${JSON.stringify(await noteId())}).anchorWorld().y`);
    await press(0, 0, { to: { x: 0, y: 160 } });
    const moved = { r1: await ed(`c.components.get('R1').transform.y`) - r1, note: await ed(`c.labels.get(${JSON.stringify(await noteId())}).anchorWorld().y`) - note };
    assert.deepEqual(Object.values(moved).sort((a, b) => a - b), [0, 160], JSON.stringify(moved));
  });

  test("the inline editor covers the label's text, stays on it when zoomed, and never scrolls the page", async () => {
    const id = await noteId();
    await h.evaluate(`${h.module('main.js')}.then((m) => { m.setLabelSelection([${JSON.stringify(id)}]); m.render(); })`);
    // Where the text is drawn (hidden while it is edited), from its own box.
    const textAt = () => h.evaluate(`Promise.all([${h.module('editor-state.js')}, ${h.module('canvas-view.js')}]).then(([s, v]) => { const ink = s.editor.circuit.labels.get(${JSON.stringify(id)}).inkRect(); const a = v.worldToClient(ink.x, ink.y); const b = v.worldToClient(ink.x + ink.w, ink.y + ink.h); return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, h: b.y - a.y }; })`);
    await h.key('t');
    await h.until(`${h.module('editor-state.js')}.then((m) => !!m.editor.inlineInput)`);
    const over = async () => {
      const o = await h.evaluate(`${h.module('editor-state.js')}.then((m) => {
        const input = m.editor.inlineInput.getBoundingClientRect();
        return { input: { x: input.x + input.width / 2, y: input.y + input.height / 2, h: input.height }, position: getComputedStyle(m.editor.inlineInput).position, scroll: [window.scrollX, window.scrollY] };
      })`);
      return { ...o, text: await textAt() };
    };
    const check = (o, when) => {
      assert.equal(o.position, 'fixed', when);
      assert.deepEqual(o.scroll, [0, 0], when);
      assert.ok(o.text, 'the label is drawn');
      assert.ok(Math.abs(o.input.y - o.text.y) <= Math.max(6, o.text.h / 2), `${when}: ${JSON.stringify(o)}`);
      assert.ok(o.input.h <= o.text.h * 3, `${when}: as tall as its text, not its grid box: ${JSON.stringify(o)}`);
    };
    check(await over(), 'opened');
    await h.evaluate(`(() => { const c = document.getElementById('canvas'); const r = c.getBoundingClientRect(); c.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, ctrlKey: true, clientX: r.x + r.width / 3, clientY: r.y + r.height / 3, bubbles: true, cancelable: true })); })()`);
    await sleep(150);
    check(await over(), 'zoomed');
    await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.inlineInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))`);
  });

  test('a set dragged whole keeps its net label on its side', async () => {
    const label = () => ed(`(() => { const l = [...c.labels.values()].find((l) => l.text === 'OUT'); return { side: l.netSide, x: l.anchorWorld().x, y: l.anchorWorld().y }; })()`);
    const before = await label();
    await h.evaluate(`${h.module('main.js')}.then((m) => { m.selectAll(); m.render(); })`);
    await h.key('m');
    await press(600, 0, { to: { x: 600, y: 240 } });
    await h.key('Escape');
    const after = await label();
    assert.equal(after.side, before.side);
    assert.equal(after.y - before.y, 240, JSON.stringify({ before, after }));
  });

  test('Ctrl on a line drags a copy of it; a Ctrl-click without a drag toggles it in the selection', async () => {
    const lines = () => ed(`[...c.labels.values()].filter((l) => l.kind === 'line').length`);
    await press(100, 400, { modifiers: 2, to: { x: 100, y: 800 } });
    assert.equal(await lines(), 2, 'a copy');
    await h.key('u');
    assert.equal(await lines(), 1);
    await press(100, 400, { modifiers: 2 });
    const id = await ed(`[...c.labels.values()].find((l) => l.kind === 'line').id`);
    assert.ok(await ed(`e.selLabels.has(${JSON.stringify(id)})`), 'toggled in');
    await press(100, 400, { modifiers: 2 });
    assert.equal(await ed(`e.selLabels.has(${JSON.stringify(id)})`), false, 'and out');
  });

  test("a box catching only some of a line's vertices picks them; they drag together and go with Delete", async () => {
    const points = () => ed(`[...c.labels.values()].find((l) => l.kind === 'line').points.map((p) => p.x + ',' + p.y)`);
    // Only the picked corner moves; the others stay.
    // A box around the corner at (200, 400) alone.
    await press(160, 320, { to: { x: 240, y: 440 } });
    assert.ok(await ed(`!!e.selectedVertices`), 'the vertex is picked');
    await press(200, 400, { to: { x: 240, y: 400 } });
    assert.deepEqual(await points(), ['0,400', '240,400', '200,560']);
    await h.key('Delete');
    assert.deepEqual(await points(), ['0,400', '200,560']);
  });

  test("renaming a net to another net's name asks first, offering to keep them separate", async () => {
    // A net sharing no part with OUT.
    for (const line of ['add resistor R4 --at 600 640', 'add resistor R5 --at 1000 640', 'connect R4.b R5.a']) await h.evaluate(`window.__run(${JSON.stringify(line)})`);
    const id = await ed(`c.netOfTerminal({ comp: 'R4', term: 'b' }).id`);
    await h.evaluate(`document.getElementById('net-option-${id}').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
    await h.until(`document.activeElement?.tagName === 'INPUT' && !!document.activeElement.closest('#side-panel')`);
    await h.evaluate(`(() => { const input = document.activeElement; input.value = 'OUT'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    await h.until(`[...document.querySelectorAll('dialog[open] button')].some((b) => b.textContent.trim() === 'Keep separate')`);
    await h.evaluate(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent.trim() === 'Keep separate').click()`);
    // The field stays open for a correction (unless the panel redrew under
    // the prompt); Esc there drops the edit -- left open, the next blur would
    // commit it again.
    await h.until(`!document.querySelector('dialog[open]')`);
    await sleep(150);
    await h.evaluate(`(() => { const input = document.querySelector('#side-panel input:focus'); if (input) input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); })()`);
    await h.until(`!document.querySelector('#side-panel input:focus') && !document.querySelector('dialog[open]')`);
    assert.notEqual(await ed(`c.nets.get(${JSON.stringify(id)}).name`), 'OUT');
  });

  test('a port is not given a name another port carries', async () => {
    const label = await ed(`c.labelOf('IN2').id`);
    await h.evaluate(`${h.module('main.js')}.then((m) => { m.setLabelSelection([${JSON.stringify(label)}]); m.render(); })`);
    await h.key('t');
    await h.until(`${h.module('editor-state.js')}.then((m) => !!m.editor.inlineInput)`);
    await h.evaluate(`${h.module('editor-state.js')}.then((m) => { const input = m.editor.inlineInput; input.value = 'IN'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })`);
    await sleep(150);
    assert.equal(await ed(`c.components.has('IN2')`), true, 'IN2 keeps its name');
    assert.match(await h.evaluate(`[...document.querySelectorAll('#log > *')].slice(-3).map((n) => n.textContent).join(' | ')`), /IN|in use|already/i);
    await h.key('Escape');
  });

  test('a copy held with Alt mirrors a second set across the axis; both commit as one, and the panel lists neither until then', async () => {
    const parts = () => ed('c.components.size');
    const before = await parts();
    await h.evaluate(`${h.module('main.js')}.then((m) => { m.setSelection(['R1']); m.render(); })`);
    await h.key('c');
    await press(-80, 0); // the source: R1, at its pin
    const ghost = () => ed('e.drag?.mode === "copyghost" ? [...e.drag.ghost.refs, ...(e.drag.ghost.mirror?.refs || [])] : []');
    const p = await at(-80, 240);
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
    await until('e.cursor.x === -80 && e.cursor.y === 240');
    await until('e.drag?.mode === "copyghost" && e.drag.ghost.refs.length === 1');
    try {
      await h.key('Alt', { altKey: true });
      const q = await at(-80, 400);
      await h.mouse('mouseMoved', q.x, q.y, { button: 'none', buttons: 0, modifiers: 1 });
      await until('e.cursor.y === 400 && !!e.drag?.ghost?.mirror');
      const refs = await ghost();
      assert.equal(refs.length, 2, 'a mirrored second set');
      const listed = await h.evaluate(`[...document.querySelectorAll('#side-panel .row')].map((r) => r.textContent)`);
      assert.ok(!refs.some((ref) => listed.some((text) => new RegExp(`\\b${ref}\\b`).test(text))), 'the ghost is not in the parts list yet');
      await h.key('Enter', { altKey: true });
    } finally {
      await h.evaluate(`window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }))`);
    }
    await h.key('Escape');
    await h.key('Escape');
    assert.equal(await parts(), before + 2);
    await h.key('u');
    assert.equal(await parts(), before, 'one undo for the pair');
  });

  test('a copied wire whose free end lands on the middle of a wire joins it there', async () => {
    await h.evaluate(`window.__load(${JSON.stringify(stubBesideRail())})`);
    await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.fitView())`);
    const stub = await ed(`c.netOfTerminal({ comp: 'R3', term: 'a' }).id`);
    await h.evaluate(`Promise.all([${h.module('main.js')}, ${h.module('editor-state.js')}]).then(([m, s]) => { m.setSelection(['R3']); s.editor.selectedWires = new Set(['${stub}:0:1', '${stub}:0:2']); m.render(); })`);
    await h.key('c');
    await press(400, 240); // the source: R3
    // Down a cell and left four: the wire's end lands on the rail at (0,240).
    const p = await at(240, 320);
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
    await until('e.drag?.mode === "copyghost" && e.cursor.x === 240 && e.cursor.y === 320');
    const rings = await h.evaluate(`${h.module('main.js')}.then((m) => m.placementJoinPoints())`);
    assert.ok(rings.some((q) => q.x === 0 && q.y === 240), `the join is ringed before the drop: ${JSON.stringify(rings)}`);
    await press(240, 320);
    await h.key('Escape');
    await h.key('Escape');
    const copy = await ed(`[...c.components.values()].find((p) => p.type === 'resistor' && p.transform.x === 240 && p.transform.y === 320)?.refdes`);
    assert.ok(copy, 'the copy landed');
    assert.equal(await ed(`c.netOfTerminal({ comp: ${JSON.stringify(copy)}, term: 'a' }) === c.netOfTerminal({ comp: 'R1', term: 'b' })`), true, 'the copied wire joined the rail');
    assert.equal(await ed(`[...c.components.values()].some((p) => p.type === 'solder' && p.transform.x === 0 && p.transform.y === 240)`), true, 'with a junction dot');
    assert.notEqual(await ed(`c.netOfTerminal({ comp: 'R3', term: 'a' }) === c.netOfTerminal({ comp: 'R1', term: 'b' })`), true, 'the source stays apart');
  });

  test('a moved wire whose free end lands on the middle of a wire joins it there', async () => {
    await h.evaluate(`window.__load(${JSON.stringify(stubBesideRail())})`);
    await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.fitView())`);
    const stub = await ed(`c.netOfTerminal({ comp: 'R3', term: 'a' }).id`);
    await h.evaluate(`Promise.all([${h.module('main.js')}, ${h.module('editor-state.js')}]).then(([m, s]) => { m.setSelection(['R3']); s.editor.selectedWires = new Set(['${stub}:0:1', '${stub}:0:2']); m.render(); })`);
    await press(400, 240, { to: { x: 240, y: 320 } });
    assert.equal(await ed(`c.components.get('R3').transform.x === 240 && c.components.get('R3').transform.y === 320`), true, 'R3 moved');
    assert.equal(await ed(`c.netOfTerminal({ comp: 'R3', term: 'a' }) === c.netOfTerminal({ comp: 'R1', term: 'b' })`), true, 'its wire joined the rail');
    assert.equal(await ed(`[...c.components.values()].some((p) => p.type === 'solder' && p.transform.x === 0 && p.transform.y === 240)`), true, 'with a junction dot');
    await h.key('u');
    assert.notEqual(await ed(`c.netOfTerminal({ comp: 'R3', term: 'a' }) === c.netOfTerminal({ comp: 'R1', term: 'b' })`), true, 'one undo takes it all back');
  });

  test('a part placed with a pin on another\'s pin joins it, and recent placements lead the insert menu', async () => {
    await h.key('i');
    for (const ch of 'resistor') await h.key(ch);
    await h.key('Enter');
    await h.until(`${h.module('editor-state.js')}.then((m) => !!m.editor.pendingPlace)`);
    // R1.b is at (80, 0): a new resistor at (160, 0) puts its a pin there.
    const p = await at(160, 0);
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
    await until('e.cursor.x === 160 && e.cursor.y === 0');
    const parts = await ed('c.components.size');
    await h.mouse('mousePressed', p.x, p.y);
    await h.mouse('mouseReleased', p.x, p.y);
    await until(`c.components.size === ${parts + 1}`);
    await h.key('Escape');
    await h.key('Escape');
    const joined = await ed(`c.netOfTerminal({ comp: 'R1', term: 'b' })?.terminals.map((t) => t.comp + '.' + t.term).sort()`);
    assert.equal(joined?.length, 2, String(JSON.stringify(joined)));
    await h.key('i');
    const groups = await h.evaluate(`[...document.querySelectorAll('.insert-menu .insert-menu-category')].map((g) => g.textContent)`);
    assert.equal(groups[0], 'Recent');
    assert.match(await h.evaluate(`document.querySelector('.insert-menu .insert-menu-group').textContent`), /[Rr]esistor/);
    await h.key('c');
    assert.notEqual(await h.evaluate(`document.querySelector('.insert-menu .insert-menu-category')?.textContent`), 'Recent', 'a search is answered by its matches alone');
    assert.equal(await h.evaluate(`getComputedStyle(document.querySelector('.insert-menu-body')).overflowY`), 'auto');
    await h.key('Escape');
  });

  test('a double-click on a part edits its name in place', async () => {
    const p = await at(600, 0); // R2's body, nothing over it
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
    await sleep(700);
    await h.mouse('mousePressed', p.x, p.y, { clickCount: 1 });
    await h.mouse('mouseReleased', p.x, p.y, { clickCount: 1 });
    await h.mouse('mousePressed', p.x, p.y, { clickCount: 2 });
    await h.mouse('mouseReleased', p.x, p.y, { clickCount: 2 });
    await h.until(`${h.module('editor-state.js')}.then((m) => !!m.editor.inlineInput)`);
    assert.match(await ed(`e.inlineInput.value`), /^R_?\{?2\}?$/);
    await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.inlineInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))`);
  });
});

