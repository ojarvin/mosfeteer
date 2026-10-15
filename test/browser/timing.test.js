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

describe('timing diagram arrows, marks and spans', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { clocked: clockAndQ() }, width: 1500, height: 950 }); });
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
    assert.deepEqual(moved.arrows, [{ from: { row: 'CLK', at: 4 }, to: { row: 'Q', at: 3 } }]);
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
