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

  test('Plot settings… places markers by key or button, drags them, takes a typed place, and the drawing shows them', async () => {
    const before = await plot();
    const p = await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.worldToClient(${before.box.x + before.box.w / 2}, ${before.box.y + before.box.h / 2}))`);
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
    await h.tap(p.x, p.y, { button: 'right' });
    await h.until(`!document.querySelector('.component-context-menu').hidden`);
    await h.evaluate(`${button('.component-context-menu', 'Plot settings')}.click()`);
    await h.until(`!!document.querySelector('.data-plot-dialog .plot-view svg path')`);
    const pane = await h.evaluate(`(() => { const r = document.querySelector('.data-plot-dialog .plot-view svg .plot-paper').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    const key = (k) => h.evaluate(`document.querySelector('.data-plot-dialog').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true }))`);
    // V over the plot: a vertical line where the pointer is; M a point on the trace nearest it.
    await h.mouse('mouseMoved', pane.x + pane.w / 2, pane.y + pane.h / 2, { button: 'none', buttons: 0 });
    await key('v');
    await key('m');
    await h.evaluate(`${button('.data-plot-marker-bar', 'Horizontal')}.click()`);
    await h.settle();
    const kinds = await h.evaluate(`[...document.querySelectorAll('.data-plot-marker-kind')].map((k) => k.textContent)`);
    assert.deepEqual(kinds, ['Vertical', 'Point', 'Horizontal']);
    assert.equal(await h.evaluate(`document.querySelectorAll('.data-plot-dialog .plot-marker-line').length`), 2);
    assert.ok(await h.evaluate(`document.querySelectorAll('.data-plot-dialog .plot-marker-value').length`) >= 4);
    // The vertical line at a typed x, an expression.
    await h.evaluate(`(() => { const f = document.querySelectorAll('.data-plot-marker-value')[0]; f.value = '2.24M/22.4k'; f.dispatchEvent(new Event('change')); })()`);
    // The horizontal line dragged down: its y falls.
    const line = await h.evaluate(`(() => { const l = [...document.querySelectorAll('.data-plot-dialog .plot-marker-line')].find((l) => l.getAttribute('y1') === l.getAttribute('y2')); const r = document.querySelector('.data-plot-dialog .plot-view svg').getBoundingClientRect(); return { x: r.x + Number(l.getAttribute('x1')) + 30, y: r.y + Number(l.getAttribute('y1')) }; })()`);
    const yBefore = await h.evaluate(`document.querySelectorAll('.data-plot-marker-value')[2].value`);
    await h.mouse('mouseMoved', line.x, line.y, { button: 'none', buttons: 0 });
    await h.mouse('mousePressed', line.x, line.y);
    await h.mouse('mouseMoved', line.x, line.y + 30, { button: 'left', buttons: 1 });
    await h.mouse('mouseReleased', line.x, line.y + 30);
    await h.settle();
    assert.ok(Number(await h.evaluate(`document.querySelectorAll('.data-plot-marker-value')[2].value`)) < Number(yBefore));
    // Each marker's Values: the point's off takes its numbers away.
    const values = () => h.evaluate(`document.querySelectorAll('.data-plot-dialog .plot-marker-value').length`);
    const shown = await values();
    assert.equal(await h.evaluate(`document.querySelectorAll('.data-plot-marker-values').length`), 3);
    await h.evaluate(`document.querySelectorAll('.data-plot-marker-values')[1].click()`);
    await h.settle();
    assert.ok(await values() < shown);
    // A label typed for the vertical line shows over the plot.
    await h.evaluate(`(() => { const f = document.querySelectorAll('.data-plot-marker-label')[0]; f.value = 'f_{c}'; f.dispatchEvent(new Event('change')); })()`);
    await h.settle();
    assert.ok(await h.evaluate(`[...document.querySelectorAll('.data-plot-dialog .plot-marker-value')].some((t) => t.textContent.normalize('NFKC') === 'fc')`));
    // Typing M in a field types it.
    assert.equal(await h.evaluate(`(() => { const f = document.querySelector('.data-plot-marker-value'); const e = new KeyboardEvent('keydown', { key: 'm', bubbles: true, cancelable: true }); f.dispatchEvent(e); return e.defaultPrevented; })()`), false);
    await h.evaluate(`${button('.data-plot-dialog', 'Apply')}.click()`);
    await h.until(`!document.querySelector('.data-plot-dialog')`);
    const after = await plot();
    assert.deepEqual(after.plot.cursors.map((c) => c.kind), ['vertical', 'point', 'horizontal']);
    assert.equal(after.plot.cursors[0].x, 100);
    assert.deepEqual(after.plot.cursors.map((c) => c.values), [undefined, false, undefined]);
    assert.deepEqual(after.plot.cursors.map((c) => c.label), ['f_{c}', undefined, undefined]);
    assert.ok(await h.evaluate(`document.querySelectorAll('#canvas .plot-annotation .plot-cursor').length`) >= 1);
    await h.key('z', { ctrlKey: true });
    assert.equal((await plot()).plot.cursors, undefined);
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

  test('a double-click on a data plot opens its settings, not its text', async () => {
    const { box } = await plot();
    const p = await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.worldToClient(${box.x + box.w / 2}, ${box.y + box.h / 2}))`);
    await h.mouse('mousePressed', p.x, p.y, { clickCount: 1 });
    await h.mouse('mouseReleased', p.x, p.y, { clickCount: 1 });
    await h.mouse('mousePressed', p.x, p.y, { clickCount: 2 });
    await h.mouse('mouseReleased', p.x, p.y, { clickCount: 2 });
    await h.until(`!!document.querySelector('.plot-settings-window')`);
    assert.equal(await h.evaluate(`!!document.querySelector('.label-inline-editor')`), false);
    await h.evaluate(`${button('.data-plot-dialog', 'Cancel')}.click()`);
    await h.until(`!document.querySelector('.data-plot-dialog')`);
  });

  test('Add file… adds another file\'s traces to the plot, under its legend, as one undo step', async () => {
    const before = await plot();
    await h.evaluate(`(() => {
      const click = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function () {
        if (this.type !== 'file') return click.call(this);
        HTMLInputElement.prototype.click = click;
        const files = new DataTransfer();
        files.items.add(new File(['f,Sim\\n1,0.4\\n10000,0.04\\n'], 'sim.csv', { type: 'text/csv' }));
        this.files = files.files;
        this.dispatchEvent(new Event('change'));
      };
    })()`);
    await h.evaluate(`${h.module('editor-state.js')}.then((s) => ${h.module('data-plot-ui.js')}.then((m) => m.openPlotSettings([...s.editor.circuit.labels.values()].find((l) => l.plot))))`);
    await h.until(`!!document.querySelector('.plot-settings-window')`);
    // The settings dialog is gone before the file's opens.
    assert.equal(await h.evaluate(`(${button('.data-plot-dialog', 'Add file')}.click(), document.querySelectorAll('.data-plot-dialog').length)`), 0);
    await h.until(`!!document.querySelector('.data-plot-dialog[open] .plot-view svg path') && ${button('.data-plot-dialog', 'Add to plot')}`);
    assert.deepEqual(await h.evaluate(`[...document.querySelectorAll('.data-plot-trace input[type="text"]')].map((i) => i.value)`), [...before.legend, 'Sim']);
    await h.evaluate(`${button('.data-plot-dialog', 'Add to plot')}.click()`);
    await h.until(`!document.querySelector('.data-plot-dialog')`);
    const after = await plot();
    assert.deepEqual(after.legend, [...before.legend, 'Sim']);
    assert.equal(after.plot.file, 'messung.csv, sim.csv');
    assert.deepEqual(after.plot.traces.at(-1).points, [[1, 0.4], [10000, 0.04]]);
    await h.key('z', { ctrlKey: true });
    assert.deepEqual((await plot()).legend, before.legend);
  });

  test('Plot settings… moves a trace down the list, to draw over the others, its legend entry with it', async () => {
    const before = await plot();
    await h.evaluate(`${h.module('editor-state.js')}.then((s) => ${h.module('data-plot-ui.js')}.then((m) => m.openPlotSettings([...s.editor.circuit.labels.values()].find((l) => l.plot))))`);
    await h.until(`!!document.querySelector('.plot-settings-window .data-plot-trace')`);
    await h.evaluate(`document.querySelector('.data-plot-trace-move[aria-label^="Move"][aria-label$="down"]').click()`);
    await h.evaluate(`${button('.data-plot-dialog', 'Apply')}.click()`);
    await h.until(`!document.querySelector('.data-plot-dialog')`);
    const after = await plot();
    const expected = [before.legend[1], before.legend[0], ...before.legend.slice(2)];
    assert.deepEqual(after.plot.traces.map((t) => t.label), expected);
    assert.deepEqual(after.legend, expected);
    await h.key('z', { ctrlKey: true });
    assert.deepEqual((await plot()).legend, before.legend);
  });
  test('Plot settings float over the drawing, one at a time: they follow their plot through undo and redo, close when it goes, and Escape closes them', async () => {
    const open = () => h.evaluate(`${h.module('editor-state.js')}.then((s) => ${h.module('data-plot-ui.js')}.then((m) => m.openPlotSettings([...s.editor.circuit.labels.values()].find((l) => l.plot))))`);
    await open();
    await h.until(`!!document.querySelector('.plot-settings-window .data-plot-trace')`);
    // A floating window, with a title bar to move it by; no modal dialog.
    assert.equal(await h.evaluate(`document.querySelector('.plot-settings-window').classList.contains('floating-window') && !!document.querySelector('.plot-settings-window .floating-window-header')`), true);
    assert.equal(await h.evaluate(`!!document.querySelector('dialog[open]')`), false);
    await open();
    assert.equal(await h.evaluate(`document.querySelectorAll('.plot-settings-window').length`), 1);
    // An edit undone and redone gives the plot back as a new object: the window follows it.
    const main = h.module('main.js');
    await h.evaluate(`Promise.all([${main}, ${h.module('editor-state.js')}]).then(([m, s]) => { m.commit(() => { s.editor.circuit.addLabel({ text: 'note', x: 4000, y: 4000 }); }); m.undo(); m.redo(); m.render(); })`);
    assert.equal(await h.evaluate(`!!document.querySelector('.plot-settings-window')`), true);
    await h.evaluate(`(() => { const f = document.querySelector('.plot-settings-window [data-axis-label="x"]'); f.value = 'Followed'; f.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await h.evaluate(`${button('.plot-settings-window', 'Apply')}.click()`);
    await h.until(`!document.querySelector('.plot-settings-window')`);
    assert.equal((await plot()).plot.x.label, 'Followed');
    await h.key('z', { ctrlKey: true });
    // Its plot deleted, it closes.
    await open();
    await h.until(`!!document.querySelector('.plot-settings-window')`);
    const id = (await plot()).id;
    await h.evaluate(`Promise.all([${main}, ${h.module('editor-state.js')}]).then(([m, s]) => { m.commit(() => { s.editor.circuit.removeLabel(${JSON.stringify(id)}); }); m.render(); })`);
    await h.until(`!document.querySelector('.plot-settings-window')`);
    assert.match(await h.evaluate(`document.getElementById('status-message').textContent`), /plot is gone/);
    await h.evaluate(`${main}.then((m) => { m.undo(); m.render(); })`);
    // Escape closes it.
    await open();
    await h.until(`!!document.querySelector('.plot-settings-window')`);
    await h.evaluate(`document.querySelector('.plot-settings-window .data-plot-marker-add').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
    await h.until(`!document.querySelector('.plot-settings-window')`);
  });
});

