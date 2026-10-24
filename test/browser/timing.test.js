/** The timing editor in a browser: its edits the design's timing, drawn
 *  once annotated and redrawn with each edit from then on; its arrows, marks, spans and breaks --
 *  picking edges in the grid, the keys and buttons, a span's text, and
 *  edits to the slots carrying them along. */

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

/** Two switch phases and no diagram. */
function undrawn() {
  const circuit = new Circuit();
  for (const line of ['add switch_open S1 --at 0 0', 'value S1 P1', 'add switch_open S2 --at 400 0', 'value S2 P2']) runCommand(circuit, line);
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
  before(async () => { h = await start({ docs: { clocked: clockAndQ(), phased: twoPhases(), undrawn: undrawn(), noted: clockAndQ(), beaten: beaten(), repeated: clockAndQ(), ramped: clockAndQ(), broken: clockAndQ() }, width: 1500, height: 950 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const parts = () => h.evaluate(`window.__circuit().labels.filter((l) => l.timing?.part).map((l) => ({ part: l.timing.part, text: l.text, item: l.timing.item, curve: !!l.curve }))`);
  // The design's timing (Circuit#timing), which the editor edits.
  const design = () => `${h.module('editor-state.js')}.then((m) => m.editor.circuit.timing)`;
  const spec = () => h.evaluate(`${design()}.then((t) => JSON.parse(JSON.stringify(t)))`);
  const specIs = (test) => `${design()}.then((t) => !!t && (${test})(t))`;
  const notes = async () => { const t = await spec(); return { arrows: t.arrows || [], marks: t.marks || [], spans: t.spans || [] }; };
  // Annotate draws the design's timing on the drawing.
  const annotate = async () => {
    await h.until(`!document.querySelector('.timing-annotate')?.disabled`);
    const before = await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.modelRevision)`);
    await h.click('.timing-annotate');
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.modelRevision !== ${before})`);
  };
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
    await h.until(specIs('(t) => Array.isArray(t.gaps)'));
    assert.deepEqual((await matrix()).ticked, [true, true]);
    assert.deepEqual((await spec()).gaps, [['P1', 'P2']]);
    await h.evaluate(`document.querySelectorAll('.timing-pairs-matrix input')[1].click()`);
    await h.until(specIs('(t) => t.gaps === false'));
    await h.evaluate(`${h.module('beats-ui.js')}.then((m) => m.toggleTimingDialog())`);
    await h.until(`!document.querySelector('.timing-dialog .timing-pairs-matrix')`);
  });

  test('an edit is the design\'s timing at once; Annotate draws it, and every edit after redraws it in place', async () => {
    await h.open('undrawn');
    await h.key('K', { shiftKey: true });
    await h.until(`!!document.querySelector('.timing-dialog .timing-grid')`);
    const drawnBits = () => h.evaluate(`window.__circuit().labels.filter((l) => l.kind === 'label' && l.timing && !l.timing.part).map((l) => l.timing.bits || '')`);
    const button = () => h.evaluate(`(() => { const b = document.querySelector('.timing-annotate'); return { hidden: b.hidden, place: document.querySelector('.timing-place').disabled }; })()`);
    assert.deepEqual(await button(), { hidden: false, place: true });
    assert.equal(await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.timing)`), null, 'opening it sets nothing');
    await gridKey('1');
    await h.until(specIs(`(t) => t.rows[0].bits === '1'`));
    assert.deepEqual(await drawnBits(), [], 'nothing drawn');
    // The clock the analyses read is the design's.
    assert.equal(await h.evaluate(`${h.module('editor-state.js')}.then(async (m) => (await import(new URL('../core/timing-diagram.js', document.querySelector('script[src="main.js"]').src).href)).timingStates(m.editor.circuit).length)`), 1);
    await annotate();
    await h.until(`window.__circuit().labels.some((l) => l.timing)`);
    assert.deepEqual(await drawnBits(), ['1', '0']);
    assert.deepEqual(await button(), { hidden: true, place: false });
    // Dragged elsewhere, it stays there through an update.
    await h.evaluate(`window.__run('timing --place')`);
    const at = await h.evaluate(`window.__circuit().labels.find((l) => l.kind === 'label' && l.timing).anchor`);
    await gridKey('0');
    await h.until(specIs(`(t) => t.rows[0].bits === '10'`));
    await h.until(`window.__circuit().labels.some((l) => l.kind === 'label' && l.timing?.bits === '10')`);
    assert.deepEqual(await h.evaluate(`window.__circuit().labels.find((l) => l.kind === 'label' && l.timing).anchor`), at);
    await h.key('K', { shiftKey: true });
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
    const wavesBefore = JSON.stringify((await spec()).rows.map((row) => row.bits));
    // Clicking an edge picks it without flipping a slot; a begins an arrow, a click on another edge ends it.
    await clickEdge(0, 3);
    assert.equal(JSON.stringify((await spec()).rows.map((row) => row.bits)), wavesBefore);
    await gridKey('a');
    await h.until(`!!document.querySelector('.timing-edge.pending')`);
    assert.match(await h.evaluate(`document.querySelector('.timing-note-hint').textContent`), /^Arrow from CLK ↑4/);
    await clickEdge(1, 2);
    await h.until(specIs('(t) => t.arrows?.length === 1'));
    assert.deepEqual((await notes()).arrows, [{ from: { row: 'CLK', at: 3 }, to: { row: 'Q', at: 2 } }]);
    // Its text from the list, drawn after the edge it points at.
    await h.evaluate(`(() => { const i = document.querySelector('.timing-note input[aria-label="Arrow text"]'); i.value = '$t_{d}$'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await h.until(specIs(`(t) => t.arrows[0].text === '$t_{d}$'`));
    await h.until(`window.__circuit().labels.some((l) => l.timing?.part === 'arrow-note' && l.text === '$t_{d}$')`);
    // The list shows the text as math while it is not typed in.
    await h.until(`!!document.querySelector('.timing-note input[aria-label="Arrow text"] + .rendered-field-view math')`);
    assert.equal((await parts()).find((p) => p.part === 'arrow').curve, true);
    // m marks the edge at the cursor, and again takes it away.
    await clickEdge(0, 1);
    await gridKey('m');
    assert.deepEqual((await notes()).marks, [{ row: 'CLK', at: 1 }]);
    await gridKey('m');
    assert.deepEqual((await notes()).marks, []);
    await gridKey('m');
    // A span by the button, its other end by the keys; its text from the field.
    await h.click('.timing-notes button[title="Span (s)"]');
    await gridKey('ArrowRight');
    await gridKey('ArrowRight');
    await gridKey('s');
    await h.until(`document.activeElement?.matches('.timing-note input')`);
    await h.evaluate(`(() => { const i = document.activeElement; i.value = '$T$'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await h.until(specIs(`(t) => t.spans?.[0]?.text === '$T$'`));
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
    await h.until(specIs('(t) => !t.arrows?.length'));
    await h.until(`!window.__circuit().labels.some((l) => l.timing?.part === 'arrow')`);
    await h.until(`window.__circuit().labels.some((l) => l.timing?.part === 'note' && l.text === '$T$')`);
    // Esc cancels an arrow begun, and leaves the window open.
    await clickEdge(0, 2);
    await gridKey('a');
    await h.evaluate(`document.querySelector('.timing-grid').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
    assert.equal(await h.evaluate(`!!document.querySelector('.timing-edge.pending')`), false);
    assert.equal(await h.evaluate(`!!document.querySelector('.timing-dialog .timing-grid')`), true);
  });

  test('an undo under the open editor is what its next edit starts from, and that edit undoes too', async () => {
    await h.open('repeated');
    // Left open by the test before, it follows the design opened.
    if (!(await h.evaluate(`!!document.querySelector('.timing-dialog .timing-grid')`))) await h.key('K', { shiftKey: true });
    await h.until(`document.querySelectorAll('.timing-grid-line')[0]?.querySelectorAll('.timing-cell:not(.new)').length === 4`);
    const bits = async (phase) => (await spec()).rows.find((row) => row.phase === phase)?.bits;
    const clk = (wave) => specIs(`(t) => t.rows.find((row) => row.phase === 'CLK')?.bits === '${wave}'`);
    const undoKey = () => h.evaluate(`document.querySelector('.timing-grid').dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }))`);
    await gridKey('*');
    await h.until(clk('01010101'));
    await undoKey();
    await h.until(clk('0101'));
    await h.until(`document.querySelectorAll('.timing-grid-line')[0].querySelectorAll('.timing-cell:not(.new)').length === 4`);
    // A slot added after the last: the four undone ones stay undone.
    await gridKey('End');
    await gridKey('1');
    await h.until(clk('01011'));
    assert.equal(await bits('Q'), '00111');
    await undoKey();
    await h.until(clk('0101'));
    assert.equal(await bits('Q'), '0011');
    await h.key('K', { shiftKey: true });
  });

  test('typing .N makes a signal analog; F2 edits a value, Hold and Taller change the row, m marks a threshold', async () => {
    await h.open('ramped');
    if (!(await h.evaluate(`!!document.querySelector('.timing-dialog .timing-grid')`))) await h.key('K', { shiftKey: true });
    await h.until(`document.querySelectorAll('.timing-grid-line')[1]?.querySelectorAll('.timing-cell:not(.new)').length === 4`);
    const name = async (phase, field) => (await spec())?.rows.find((row) => row.phase === phase)?.[field];
    const q = (test) => specIs(`(t) => { const row = t.rows.find((r) => r.phase === 'Q'); return !!row && (${test})(row); }`);
    const analogBox = () => h.evaluate(`window.__circuit().labels.find((l) => l.kind === 'box' && l.timing?.phase === 'Q')`);
    // Q's slots: 0 .5 then F2 on the third to 0.75; an arrow sets each.
    await gridKey('ArrowDown');
    await gridKey('ArrowRight');
    for (const key of ['.', '5', 'Enter']) await gridKey(key);
    await h.until(q('(row) => Array.isArray(row.values)'));
    assert.deepEqual(await name('Q', 'values'), [0, 0.5, 1, 1], 'the row analog, its 1s and 0s values');
    for (const key of ['F2', 'Backspace', '.', '7', '5', 'ArrowLeft']) await gridKey(key);
    await h.until(q('(row) => row.values?.[2] === 0.75'));
    assert.deepEqual(await name('Q', 'values'), [0, 0.5, 0.75, 1]);
    // Hold, then two cells taller.
    await h.evaluate(`[...document.querySelectorAll('.timing-dialog button')].find((b) => b.textContent === 'Hold').click()`);
    await h.until(q('(row) => row.hold === true'));
    await h.evaluate(`[...document.querySelectorAll('.timing-dialog button')].find((b) => b.textContent === 'Taller').click()`);
    await h.until(q('(row) => row.height === 4'));
    // m on the 0.5 point (the arrow that set 0.75 went back to it): a threshold.
    await gridKey('m');
    await h.until(specIs(`(t) => t.marks?.some((mark) => mark.row === 'Q' && mark.at === 1)`));
    // A switch-free signal's edge buttons do nothing on it: they are off.
    assert.equal(await h.evaluate(`[...document.querySelectorAll('.timing-dialog button')].find((b) => b.getAttribute('aria-label') === 'Fall earlier').disabled`), true);
    await h.until(`window.__circuit().labels.find((l) => l.kind === 'box' && l.timing?.phase === 'Q')?.timing.analog.thresholds?.[0]?.[1] === 0.5`);
    const wave = await analogBox();
    assert.equal(wave.end.y - wave.anchor.y, 160);
    // The editor's session is one undo step: Q is digital again, drawn
    // and in the editor.
    await h.evaluate(`document.querySelector('.timing-grid').dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }))`);
    await h.until(`!window.__circuit().labels.some((l) => l.kind === 'box' && l.timing?.phase === 'Q')`);
    await h.until(q(`(row) => row.bits === '0011'`));
    await h.until(`!document.querySelector('.timing-cell.analog')`);
    await h.key('K', { shiftKey: true });
  });

  test('b breaks the cursor\'s slot through every row, then each row, then not; slot edits carry it', async () => {
    await h.open('broken');
    if (!(await h.evaluate(`!!document.querySelector('.timing-dialog .timing-grid')`))) await h.key('K', { shiftKey: true });
    await h.until(`document.querySelectorAll('.timing-grid-line')[0]?.querySelectorAll('.timing-cell:not(.new)').length === 4`);
    const breaks = async () => (await spec())?.breaks || [];
    const drawn = () => h.evaluate(`document.querySelectorAll('#canvas .timing-break').length`);
    await gridKey('Home');
    await gridKey('ArrowRight');
    await gridKey('b');
    assert.deepEqual(await breaks(), [{ at: 1 }]);
    await h.until(`document.querySelectorAll('#canvas .timing-break').length === 1`);
    assert.match(await h.evaluate(`document.querySelector('.timing-grid-foot').textContent`), /slot 2 of 4, broken/);
    await gridKey('b');
    assert.deepEqual(await breaks(), [{ at: 1, rows: true }]);
    await h.until(`document.querySelectorAll('#canvas .timing-break').length === 2`);
    // Each row in the list switches it back.
    await h.evaluate(`[...document.querySelectorAll('.timing-note button')].find((b) => b.textContent === 'Each row').click()`);
    assert.deepEqual(await breaks(), [{ at: 1 }]);
    assert.equal(await h.evaluate(`[...document.querySelectorAll('.timing-note button')].find((b) => b.textContent === 'Each row').getAttribute('aria-pressed')`), 'false');
    // A slot repeated before it moves it on; its own slot removed takes it.
    await gridKey('ArrowLeft');
    await gridKey('+');
    assert.deepEqual(await breaks(), [{ at: 2 }]);
    await gridKey('ArrowRight');
    await gridKey('Delete');
    assert.deepEqual(await breaks(), []);
    await h.until(`document.querySelectorAll('#canvas .timing-break').length === 0`);
    assert.equal(await drawn(), 0);
    // After the last slot there is nothing to break.
    await gridKey('End');
    await gridKey('b');
    assert.match(await h.evaluate(`document.querySelector('.timing-dialog-status').textContent`), /put the cursor on one/);
    await h.key('K', { shiftKey: true });
  });
});
