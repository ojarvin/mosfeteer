/** Export data… in a browser: a plot's right-click menu shows its numbers
 *  over a preview, the traces and the format chosen, and saves them as CSV. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../../src/core/model.js';
import { start, browserSkip } from './harness.js';

function responsePlot() {
  const circuit = new Circuit();
  circuit.addAnnotation('box', {
    x: 0, y: 0, end: { x: 720, y: 440 }, style: { lineStyle: 'solid', blackTraces: true },
    plot: {
      kind: 'response', axis: 'relative', range: { low: 0, high: 2 },
      traces: [
        { label: 'H_{1}', points: [{ f: 1, db: 0 }, { f: 10, db: -3.5 }, { f: 100, db: -20 }] },
        { label: 'H_{2}', points: [{ f: 1, db: -1 }, { f: 10, db: -2 }, { f: 100, db: -3 }] },
      ],
    },
  });
  return circuit.toJSON();
}

describe('plot export', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { plot: responsePlot() } }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const button = (scope, text) => `[...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)}))`;

  test('a plot\'s right-click Export data… saves the traces chosen, in the format chosen', async () => {
    await h.open('plot');
    const p = await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.worldToClient(360, 220))`);
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
    await h.tap(p.x, p.y, { button: 'right' });
    await h.until(`!document.querySelector('.component-context-menu').hidden`);
    await h.evaluate(`${button('.component-context-menu', 'Export data')}.click()`);
    await h.until(`!!document.querySelector('dialog[aria-label="Export plot data"] table')`);
    const heads = () => h.evaluate(`[...document.querySelectorAll('dialog[aria-label="Export plot data"] th')].map((th) => th.textContent)`);
    assert.deepEqual(await heads(), ['ω (rad/s)', 'H_1 (dB)', 'H_2 (dB)']);
    await h.evaluate(`(() => {
      document.querySelector('[data-trace="1"]').click();
      const decimal = document.getElementById('plot-export-decimal');
      decimal.value = ',';
      decimal.dispatchEvent(new Event('change'));
    })()`);
    assert.deepEqual(await heads(), ['ω (rad/s)', 'H_1 (dB)']);
    assert.equal(await h.evaluate(`document.getElementById('plot-export-separator').value`), ';');
    // The save picker hands back a file that keeps what is written.
    await h.evaluate(`window.showSaveFilePicker = async ({ suggestedName }) => ({ name: suggestedName, createWritable: async () => ({ write: async (text) => { window.__saved = text; }, close: async () => {} }) })`);
    await h.evaluate(`${button('dialog[aria-label="Export plot data"]', 'Save')}.click()`);
    await h.until(`typeof window.__saved === 'string'`);
    assert.equal(await h.evaluate(`window.__saved`), 'ω (rad/s);H_1 (dB)\n1;0\n10;-3,5\n100;-20\n');
    assert.equal(await h.evaluate(`!!document.querySelector('dialog[aria-label="Export plot data"]')`), false);
  });
});
