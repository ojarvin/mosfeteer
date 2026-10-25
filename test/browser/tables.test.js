/** Tables on the drawing in a browser: a math table's cells share their
 *  row's baseline, so headings with and without descenders line up. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, browserSkip } from './harness.js';
import { Circuit } from '../../src/core/model.js';

/** A kT/C noise table as the calculator annotates it. */
function noiseTable() {
  const circuit = new Circuit();
  const words = (text) => `\\text{${text}}`;
  const rows = [
    [words('Switches'), words('Capacitors'), words('Phase'), words('RMS'), words('Density')].join(' & '),
    '\\hline',
    [words('S1, S3'), 'C_{S}', '\\varphi_{1}', words('140.6 µV'), `${words('132.9 nV')}/\\sqrt{\\mathrm{Hz}}`].join(' & '),
  ];
  circuit.addLabel({ text: `$${rows.join('\n')}$`, math: true, columns: 'lllrr', x: 0, y: 0 });
  return circuit.toJSON();
}

describe('tables on the drawing', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { noise: noiseTable() }, width: 1400, height: 900 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  test('a math table\'s headings share a baseline, descenders or not', async () => {
    await h.open('noise');
    await h.until(`document.querySelectorAll('#canvas .schematic-math-table mtext').length >= 5`);
    await h.settle();
    // The same font and size: on one baseline, their boxes share a top.
    const tops = await h.evaluate(`[...document.querySelectorAll('#canvas .schematic-math-table mtext')].slice(0, 5).map((m) => m.getBoundingClientRect().top)`);
    assert.ok(Math.max(...tops) - Math.min(...tops) < 1, JSON.stringify(tops));
  });
});
