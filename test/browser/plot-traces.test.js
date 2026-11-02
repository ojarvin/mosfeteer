/** Traces from a file on an analysis plot, in a browser: a double-click on
 *  the plot opens its settings, never its box's text; Add file… reads a
 *  simulation in hertz and as a ratio into the plot's own units, over its
 *  curve, as one undo step. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../../src/core/model.js';
import { start, browserSkip } from './harness.js';

function responsePlot() {
  const circuit = new Circuit();
  const points = Array.from({ length: 41 }, (_, i) => { const f = 10 ** (i / 10); return { f, db: -10 * Math.log10(1 + (f / 1000) ** 2) }; });
  const box = circuit.addAnnotation('box', {
    x: 0, y: 0, end: { x: 720, y: 440 }, style: { lineStyle: 'solid', blackTraces: true },
    plot: { kind: 'response', axis: 'relative', range: { low: 0, high: 4 }, traces: [{ label: 'H', color: '#346dd8', points }] },
  });
  circuit.addLabel({ text: '$H$', math: true, parent: box.id, role: 'plot-legend', align: 'left', x: 880, y: 40, style: { color: '#346dd8' } });
  return circuit.toJSON();
}

describe('traces from a file on an analysis plot', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { plot: responsePlot() } }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const button = (scope, text) => `[...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)}))`;
  const box = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => { const box = [...m.editor.circuit.labels.values()].find((l) => l.plot); return { plot: box.plot, legend: m.editor.circuit.plotLegend(box).map((l) => l.text) }; })`);

  test('a double-click on the plot\'s middle opens its settings, not its text', async () => {
    await h.open('plot');
    await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.fitView())`);
    const p = await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.worldToClient(360, 220))`);
    await h.mouse('mousePressed', p.x, p.y, { clickCount: 1 });
    await h.mouse('mouseReleased', p.x, p.y, { clickCount: 1 });
    await h.mouse('mousePressed', p.x, p.y, { clickCount: 2 });
    await h.mouse('mouseReleased', p.x, p.y, { clickCount: 2 });
    await h.until(`!!document.querySelector('dialog[aria-label="Plot settings"][open]')`);
    assert.equal(await h.evaluate(`!!document.querySelector('.label-inline-editor')`), false);
    // An analysis plot's axes are its own: none to edit.
    assert.equal(await h.evaluate(`document.querySelectorAll('dialog[open] [data-axis-label]').length`), 0);
  });

  test('Add file… reads a simulation in hertz and as a ratio onto the plot, over its curve, one undo step', async () => {
    await h.evaluate(`(() => {
      const click = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function () {
        if (this.type !== 'file') return click.call(this);
        HTMLInputElement.prototype.click = click;
        const files = new DataTransfer();
        files.items.add(new File(['f (Hz),sim\\n1,1\\n100,0.1\\n'], 'sim.csv', { type: 'text/csv' }));
        this.files = files.files;
        this.dispatchEvent(new Event('change'));
      };
    })()`);
    await h.evaluate(`${button('dialog[aria-label="Plot settings"]', 'Add file')}.click()`);
    await h.until(`!!document.getElementById('data-plot-xunit')`);
    await h.evaluate(`(() => {
      for (const [id, value] of [['data-plot-xunit', 'Hz'], ['data-plot-yunit', 'ratio']]) {
        const field = document.getElementById(id);
        field.value = value;
        field.dispatchEvent(new Event('change'));
      }
    })()`);
    await h.evaluate(`${button('dialog[open]', 'Add to plot')}.click()`);
    await h.until(`!document.querySelector('dialog[open]')`);
    const after = await box();
    assert.equal(after.plot.traces.length, 1);
    assert.deepEqual(after.plot.extra.map((t) => t.label), ['sim']);
    assert.notEqual(after.plot.extra[0].color, '#346dd8');
    assert.deepEqual(after.plot.extra[0].points.map(([x, y]) => [Number(x.toFixed(3)), y]), [[6.283, 0], [628.319, -20]]);
    assert.deepEqual(after.legend, ['$H$', 'sim']);
    assert.ok(await h.evaluate(`[...document.querySelectorAll('#canvas .plot-annotation path')].length >= 2`));
    await h.key('z', { ctrlKey: true });
    assert.equal((await box()).plot.extra, undefined);
  });
});
