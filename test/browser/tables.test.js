/** Tables on the drawing in a browser: a math table's cells share their
 *  row's baseline, so headings with and without descenders line up. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, browserSkip } from './harness.js';
import { Circuit } from '../../src/core/model.js';
import { runCommand } from '../../src/core/commands.js';
import { partsTableLayout } from '../../src/core/parts-table.js';

/** A kT/C noise table as the calculator annotates it. */
function noiseTable() {
  const circuit = new Circuit();
  const words = (text) => `\\text{${text}}`;
  const rows = [
    [words('Switches'), words('Capacitors'), words('Phase'), words('RMS'), words('Density')].join(' & '),
    '\\hline',
    [words('S1, S3'), 'C_{S}', '\\varphi_{1}', words('140.6 µV'), `${words('132.9 nV')}/\\sqrt{\\mathrm{Hz}}`].join(' & '),
    '\\hline',
    [words('Total'), '', '', words('191.3'), words('180.8')].join(' & '),
  ];
  circuit.addLabel({ text: `$${rows.join('\n')}$`, math: true, columns: 'lllrr', x: 0, y: 0 });
  return circuit.toJSON();
}

describe('tables on the drawing', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { noise: noiseTable() }, width: 1400, height: 900 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  test('a math table spaces its rows and rules as the parts table does', async () => {
    await h.open('noise');
    await h.until(`document.querySelectorAll('#canvas .schematic-math-table mtext').length >= 5`);
    await h.settle();
    // Positions in drawing units, from the label's box: the RMS heading's
    // and the total's baselines (no descenders: their boxes end there) and
    // the rule between them.
    const measured = JSON.parse(await h.evaluate(`(() => {
      const fo = document.querySelector('#canvas foreignObject:has(.schematic-math-table)');
      const box = fo.getBoundingClientRect();
      const k = box.width / Number(fo.getAttribute('width'));
      const y = (v) => (v - box.top) / k;
      const text = (t) => [...fo.querySelectorAll('mtext')].find((m) => m.textContent === t).getBoundingClientRect();
      const rules = [...fo.querySelectorAll('.schematic-math-rule')].map((r) => { const b = r.getBoundingClientRect(); return y((b.top + b.bottom) / 2); });
      return JSON.stringify({ head: y(text('RMS').bottom), rules, total: y(text('Total').bottom) });
    })()`));
    // The parts table's: a header's baseline, its rule, the next baseline.
    const parts = new Circuit();
    for (const line of ['add capacitor C1 --value 1p']) runCommand(parts, line);
    const layout = partsTableLayout(parts, { parts: null });
    const head = layout.items.find((item) => item.role === 'head').y;
    const rule = layout.items.find((item) => item.type === 'rule').y;
    const next = layout.items.find((item) => item.role === 'name').y;
    const close = (a, b, what) => assert.ok(Math.abs(a - b) < 2, `${what}: ${a} against the parts table's ${b}`);
    close(measured.rules[0] - measured.head, rule - head, 'heading to rule');
    close(measured.total - measured.rules[1], next - rule, 'rule to the row under it');
    close((measured.total - measured.head) / 2, next - head, 'row pitch');
  });

  test('a math table\'s headings share a baseline, descenders or not', async () => {
    await h.open('noise');
    await h.until(`document.querySelectorAll('#canvas .schematic-math-table mtext').length >= 5`);
    await h.settle();
    // The same font and size: on one baseline, their boxes share a top.
    const tops = await h.evaluate(`[...document.querySelectorAll('#canvas .schematic-math-table mtext')].slice(0, 5).map((m) => m.getBoundingClientRect().top)`);
    assert.ok(Math.max(...tops) - Math.min(...tops) < 1, JSON.stringify(tops));
  });
});
