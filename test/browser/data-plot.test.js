/** A data plot in a browser: More → Data plot… reads a chosen file, its
 *  guesses shown, an axis named and a trace colored from the palette, and
 *  the plot placed with its legend; its right-click Plot settings… sets an
 *  axis's scale and name, takes a trace off, and keeps the zoom, as one
 *  undo step. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../../src/core/model.js';
import { runCommand } from '../../src/core/commands.js';
import { start, browserSkip } from './harness.js';

const FILE = 'Messung 3\nf;Ua;Ub\n1;0,5;2\n10;0,25;20\n100;0,125;200\n1000;0,0625;2000\n10000;0,03125;20000\n';

function parts() {
  const circuit = new Circuit();
  runCommand(circuit, 'add resistor R1 --at 0 0');
  return circuit.toJSON();
}

describe('data plot', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { data: parts() } }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const editor = (expression) => h.evaluate(`${h.module('editor-state.js')}.then((m) => { const editor = m.editor; return ${expression}; })`);
  const plot = () => editor(`(() => { const box = [...editor.circuit.labels.values()].find((l) => l.plot); return box ? { id: box.id, plot: box.plot, legend: editor.circuit.plotLegend(box).map((l) => l.text), box: box.bbox() } : null; })()`);
  const button = (scope, text) => `[...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)}))`;

  test('More → Data plot… reads the chosen file as it guesses, and places the plot with its legend', async () => {
    await h.open('data');
    // The file picker hands over this file.
    await h.evaluate(`(() => {
      const click = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function () {
        if (this.type !== 'file') return click.call(this);
        HTMLInputElement.prototype.click = click;
        const files = new DataTransfer();
        files.items.add(new File([${JSON.stringify(FILE)}], 'messung.csv', { type: 'text/csv' }));
        this.files = files.files;
        this.dispatchEvent(new Event('change'));
      };
    })()`);
    await h.evaluate(`document.getElementById('btn-data-plot').click()`);
    await h.until(`!!document.querySelector('.data-plot-dialog .plot-view svg path')`);
    const read = await h.evaluate(`({
      separator: document.getElementById('data-plot-separator').value,
      decimal: document.getElementById('data-plot-decimal').value,
      skip: document.getElementById('data-plot-skip').value,
      xscale: document.querySelector('[data-axis-scale="x"]').value,
      heads: [...document.querySelectorAll('.data-plot-table th')].map((th) => th.textContent),
    })`);
    assert.deepEqual(read, { separator: ';', decimal: ',', skip: '2', xscale: 'log', heads: ['f', 'Ua', 'Ub'] });
    // Named and colored there, from the palette.
    await h.evaluate(`(() => {
      const name = document.querySelector('[data-axis-label="x"]');
      name.value = 'f (Hz)';
      name.dispatchEvent(new Event('input'));
      document.querySelector('.data-plot-trace > .swatch').click();
    })()`);
    // The palette opens over the swatch, its current color right on it, and adds no row.
    const over = await h.evaluate(`(() => {
      const at = document.querySelector('.data-plot-trace > .swatch').getBoundingClientRect();
      const current = document.querySelector('.data-plot-swatches [aria-checked="true"]').getBoundingClientRect();
      return { dx: Math.round(current.x - at.x), dy: Math.round(current.y - at.y), rows: document.querySelectorAll('.data-plot-trace').length };
    })()`);
    assert.deepEqual(over, { dx: 0, dy: 0, rows: 2 });
    await h.evaluate(`document.querySelector('.data-plot-swatches [data-value="crimson"]').click()`);
    assert.equal(await h.evaluate(`document.querySelectorAll('.data-plot-swatches').length`), 0);
    assert.equal(await h.evaluate(`document.querySelectorAll('.data-plot-dialog input[type="color"]').length`), 0);
    await h.evaluate(`${button('.data-plot-dialog', 'Place')}.click()`);
    await h.until(`!document.querySelector('.data-plot-dialog')`);
    const placed = await plot();
    assert.equal(placed.plot.kind, 'data');
    assert.equal(placed.plot.file, 'messung.csv');
    assert.deepEqual(placed.plot.traces[0].points, [[1, 0.5], [10, 0.25], [100, 0.125], [1000, 0.0625], [10000, 0.03125]]);
    assert.deepEqual(placed.legend, ['Ua', 'Ub']);
    assert.equal(placed.plot.x.label, 'f (Hz)');
    assert.equal(placed.plot.traces[0].color, '#cd2a46');
    assert.ok(await h.evaluate(`document.querySelectorAll('#canvas .plot-annotation').length > 0`), 'drawn');
  });

  test('Plot settings… sets an axis, takes a trace off, and keeps the zoom, as one undo step', async () => {
    const before = await plot();
    const p = await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.worldToClient(${before.box.x + before.box.w / 2}, ${before.box.y + before.box.h / 2}))`);
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
    await h.tap(p.x, p.y, { button: 'right' });
    await h.until(`!document.querySelector('.component-context-menu').hidden`);
    await h.evaluate(`${button('.component-context-menu', 'Plot settings')}.click()`);
    await h.until(`!!document.querySelector('.data-plot-dialog .plot-view svg path')`);
    await h.evaluate(`(() => {
      const scale = document.querySelector('[data-axis-scale="y"]');
      scale.value = 'log';
      scale.dispatchEvent(new Event('change'));
      const name = document.querySelector('[data-axis-label="y"]');
      name.value = 'U (V)';
      name.dispatchEvent(new Event('input'));
      document.querySelectorAll('.data-plot-trace-remove')[1].click();
    })()`);
    // The wheel zooms along x only with Shift.
    const svg = await h.evaluate(`(() => { const r = document.querySelector('.data-plot-dialog .plot-view svg').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await h.evaluate(`document.querySelector('.data-plot-dialog .plot-view svg').dispatchEvent(new WheelEvent('wheel', { deltaY: -400, clientX: ${svg.x}, clientY: ${svg.y}, shiftKey: true, bubbles: true, cancelable: true }))`);
    await h.evaluate(`${button('.data-plot-dialog', 'Apply')}.click()`);
    await h.until(`!document.querySelector('.data-plot-dialog')`);
    const after = await plot();
    assert.deepEqual(after.plot.y, { label: 'U (V)', scale: 'log' });
    assert.deepEqual(after.legend, ['Ua']);
    assert.equal(after.plot.traces.length, 1);
    const [low, high] = after.plot.view.x;
    assert.ok(low > 1 && high < 10000 && low < high, `${low} ${high}`);
    await h.key('z', { ctrlKey: true });
    const undone = await plot();
    assert.deepEqual(undone.plot, before.plot);
    assert.deepEqual(undone.legend, ['Ua', 'Ub']);
  });

  test('a legend entry renamed on the drawing keeps its left edge beside the plot, and names its trace', async () => {
    const id = (await editor(`editor.circuit.plotLegend([...editor.circuit.labels.values()].find((l) => l.plot))[0].id`));
    const left = () => editor(`editor.circuit.labels.get(${JSON.stringify(id)}).bbox().x`);
    for (const text of ['A much longer name', 'Ua']) {
      const before = await left();
      await h.evaluate(`window.__run(${JSON.stringify(`annotation rename ${id} "${text}"`)})`);
      await h.until(`${h.module('editor-state.js')}.then((m) => !!m.editor.circuit.labels.get(${JSON.stringify(id)})._renderedTextBounds)`);
      assert.equal(await left(), before, text);
    }
    assert.equal((await plot()).plot.traces[0].label, 'Ua');
  });
});
