/** The timing editor's arrows, marks and spans in a browser: picking edges
 *  in the grid, the keys and buttons, a span's text, and edits to the slots
 *  carrying them along. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, browserSkip } from './harness.js';
import { Circuit } from '../../src/core/model.js';
import { runCommand } from '../../src/core/commands.js';

function clockAndQ() {
  const circuit = new Circuit();
  for (const line of ['timing --add CLK,Q', 'timing CLK=0101 Q=0011']) runCommand(circuit, line);
  return circuit.toJSON();
}

/** Two switch phases never high together: what auto would keep apart. */
function twoPhases() {
  const circuit = new Circuit();
  for (const line of ['add switch_open S1 --at 0 0', 'value S1 P1', 'add switch_open S2 --at 400 0', 'value S2 P2', 'timing P1=10 P2=01']) runCommand(circuit, line);
  return circuit.toJSON();
}

/** Two phases with the beats made from their diagram. */
function beaten() {
  const circuit = Circuit.fromJSON(twoPhases());
  runCommand(circuit, 'beat phases');
  return circuit.toJSON();
}

describe('timing diagram arrows, marks and spans', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { clocked: clockAndQ(), phased: twoPhases(), noted: clockAndQ(), beaten: beaten() }, width: 1500, height: 950 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const parts = () => h.evaluate(`window.__circuit().labels.filter((l) => l.timing?.part).map((l) => ({ part: l.timing.part, text: l.text, item: l.timing.item, curve: !!l.curve }))`);
  const notes = () => h.evaluate(`(() => { const l = window.__circuit().labels.find((x) => x.timing); return { arrows: l.timing.arrows || [], marks: l.timing.marks || [], spans: l.timing.spans || [] }; })()`);
  const gridKey = (key) => h.evaluate(`(() => { const g = document.querySelector('.timing-grid'); g.focus(); g.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true })); })()`);
  // A real click on the edge at the left of slot `slot` (0-based; the
  // empty cell after the last is the edge after it) in row `row`.
  const clickEdge = async (row, slot) => {
    const at = await h.evaluate(`(() => {
      const cell = document.querySelectorAll('.timing-grid-line')[${row}].querySelectorAll('.timing-cell')[${slot}];
      const edge = cell.querySelector('.timing-edge');
      if (!edge) return null;
      const r = edge.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    assert.ok(at, `an edge at row ${row}, slot ${slot}`);
    await h.mouse('mouseMoved', at.x, at.y, { button: 'none', buttons: 0 });
    await h.mouse('mousePressed', at.x, at.y);
    await h.mouse('mouseReleased', at.x, at.y);
  };

  test('non-overlap is a square of checkboxes: names along two sides, the diagonal blocked, none ticked at first', async () => {
    await h.open('phased');
    await h.key('K', { shiftKey: true });
    await h.until(`!!document.querySelector('.timing-dialog .timing-pairs-matrix')`);
    const matrix = () => h.evaluate(`(() => {
      const m = document.querySelector('.timing-pairs-matrix');
      return {
        top: [...m.rows[0].querySelectorAll('th[scope=col]')].map((th) => th.textContent),
        left: [...m.querySelectorAll('th[scope=row]')].map((th) => th.textContent),
        blocked: m.querySelectorAll('td.blocked').length,
        ticked: [...m.querySelectorAll('input')].map((box) => box.checked),
      };
    })()`);
    assert.deepEqual(await matrix(), { top: ['P1', 'P2'], left: ['P1', 'P2'], blocked: 2, ticked: [false, false] });
    // Either half ticks the pair, which both halves show and the diagram keeps.
    await h.evaluate(`document.querySelector('.timing-pairs-matrix input').click()`);
    await h.until(`Array.isArray(window.__circuit().labels.find((l) => l.timing)?.timing.gaps)`);
    assert.deepEqual((await matrix()).ticked, [true, true]);
    assert.deepEqual(await h.evaluate(`window.__circuit().labels.find((l) => l.timing).timing.gaps`), [['P1', 'P2']]);
    await h.evaluate(`document.querySelectorAll('.timing-pairs-matrix input')[1].click()`);
    await h.until(`window.__circuit().labels.find((l) => l.timing)?.timing.gaps === false`);
    await h.evaluate(`${h.module('beats-ui.js')}.then((m) => m.toggleTimingDialog())`);
    await h.until(`!document.querySelector('.timing-dialog .timing-pairs-matrix')`);
  });

  test('an arrow\'s plain text stands still when the design is saved and opened again', async () => {
    await h.open('noted');
    await h.evaluate(`window.__run('timing --arrow "CLK:2>Q:3=propagation delay"')`);
    const note = `window.__circuit().labels.find((l) => l.timing?.part === 'arrow-note')`;
    // Measured, then saved.
    await h.until(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].some((l) => l.timing?.part === 'arrow-note' && l.textMeasured()))`);
    const placed = await h.evaluate(`${note}.anchor`);
    for (let round = 0; round < 2; round += 1) {
      await h.evaluate(`${h.module('document-session.js')}.then((m) => m.saveCircuit())`);
      await h.open('phased');
      await h.open('noted');
      await h.until(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].some((l) => l.timing?.part === 'arrow-note' && l.textMeasured()))`);
      assert.deepEqual(await h.evaluate(`${note}.anchor`), placed, `reopened ${round + 1}`);
    }
  });

  test('the beat on screen is shaded where the diagram shows it', async () => {
    await h.open('beaten');
    const bands = () => h.evaluate(`[...document.querySelectorAll('#canvas .timing-beat rect')].map((r) => Number(r.getAttribute('x')))`);
    assert.deepEqual(await bands(), [], 'no beat, no band');
    await h.key('ArrowRight', { altKey: true });
    await h.until(`document.querySelectorAll('#canvas .timing-beat rect').length > 0`);
    const first = await bands();
    await h.key('ArrowRight', { altKey: true });
    await h.until(`(() => { const x = [...document.querySelectorAll('#canvas .timing-beat rect')].map((r) => r.getAttribute('x')).join(); return x && x !== ${JSON.stringify(first.join())}; })()`);
    // Each state's slot, and the lead it repeats into at one end.
    assert.equal(first.length, 2);
    assert.equal((await bands()).length, 2);
  });

  test('an arrow from a clicked edge to another, a mark at the cursor, a span with its text; slot edits carry them', async () => {
    await h.open('clocked');
    await h.key('K', { shiftKey: true });
    await h.until(`!!document.querySelector('.timing-dialog .timing-grid')`);
    // Only where a row changes level is there an edge: CLK 0101 rises at slot 2, Q 0011 at slot 3.
    assert.equal(await h.evaluate(`!!document.querySelectorAll('.timing-grid-line')[1].querySelectorAll('.timing-cell')[1].querySelector('.timing-edge')`), false);
    const wavesBefore = await h.evaluate(`JSON.stringify(window.__circuit().labels.filter((l) => l.timing && !l.timing.part && l.kind === 'line').map((l) => l.points))`);
    // Clicking an edge picks it without flipping a slot; a begins an arrow, a click on another edge ends it.
    await clickEdge(0, 3);
    assert.equal(await h.evaluate(`JSON.stringify(window.__circuit().labels.filter((l) => l.timing && !l.timing.part && l.kind === 'line').map((l) => l.points))`), wavesBefore);
    await gridKey('a');
    await h.until(`!!document.querySelector('.timing-edge.pending')`);
    assert.match(await h.evaluate(`document.querySelector('.timing-note-hint').textContent`), /^Arrow from CLK ↑4/);
    await clickEdge(1, 2);
    await h.until(`window.__circuit().labels.some((l) => l.timing?.part === 'arrow')`);
    assert.deepEqual((await notes()).arrows, [{ from: { row: 'CLK', at: 3 }, to: { row: 'Q', at: 2 } }]);
    assert.equal((await parts()).find((p) => p.part === 'arrow').curve, true);
    // Its text from the list, drawn after the edge it points at.
    await h.evaluate(`(() => { const i = document.querySelector('.timing-note input[aria-label="Arrow text"]'); i.value = '$t_{d}$'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await h.until(`window.__circuit().labels.some((l) => l.timing?.part === 'arrow-note' && l.text === '$t_{d}$')`);
    assert.equal((await notes()).arrows[0].text, '$t_{d}$');
    // m marks the edge at the cursor, and again takes it away.
    await clickEdge(0, 1);
    await gridKey('m');
    assert.deepEqual((await notes()).marks, [{ row: 'CLK', at: 1 }]);
    await gridKey('m');
    assert.deepEqual((await notes()).marks, []);
    await gridKey('m');
    // A span by the button, its other end by the keys; its text from the field.
    await h.click('.timing-notes button[title^="A time between"]');
    await gridKey('ArrowRight');
    await gridKey('ArrowRight');
    await gridKey('s');
    await h.until(`document.activeElement?.matches('.timing-note input')`);
    await h.evaluate(`(() => { const i = document.activeElement; i.value = '$T$'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await h.until(`window.__circuit().labels.some((l) => l.timing?.part === 'note' && l.text === '$T$')`);
    assert.deepEqual((await notes()).spans, [{ from: { row: 'CLK', at: 1 }, to: { row: 'CLK', at: 3 }, text: '$T$' }]);
    // A slot repeated before them moves them all a slot later.
    await clickEdge(0, 1);
    await gridKey('ArrowLeft');
    await gridKey('+');
    const moved = await notes();
    assert.deepEqual(moved.arrows, [{ from: { row: 'CLK', at: 4 }, to: { row: 'Q', at: 3 }, text: '$t_{d}$' }]);
    assert.deepEqual(moved.marks, [{ row: 'CLK', at: 2 }]);
    assert.deepEqual(moved.spans[0].to, { row: 'CLK', at: 4 });
    // Removed from the list, the arrow is gone from the drawing.
    await h.click('.timing-note button[aria-label="Remove the arrow"]');
    await h.until(`!window.__circuit().labels.some((l) => l.timing?.part === 'arrow')`);
    // Esc cancels an arrow begun, and leaves the window open.
    await clickEdge(0, 2);
    await gridKey('a');
    await h.evaluate(`document.querySelector('.timing-grid').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
    assert.equal(await h.evaluate(`!!document.querySelector('.timing-edge.pending')`), false);
    assert.equal(await h.evaluate(`!!document.querySelector('.timing-dialog .timing-grid')`), true);
  });
});
