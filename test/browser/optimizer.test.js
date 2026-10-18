/** The optimizer in a browser: a run's window, its controls while it
 *  searches, and the tables it reports in. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, sleep, browserSkip } from './harness.js';
import { modulator } from './fixtures.js';

describe('optimizer', { skip: browserSkip() }, () => {
  let h;
  before(async () => {
    h = await start({ docs: { modulator: modulator() }, width: 1500, height: 950 });
    await h.open('modulator');
    await h.key('S');
    await h.until(`!document.getElementById('analysis-dialog').hidden`);
    await h.click('.signal-flow-derive');
    // A band for the specs that read it.
    await h.evaluate(`(() => { const bw = document.querySelector('.signal-flow-band-field[data-key="bw"]'); bw.value = '1/64'; bw.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await h.evaluate(`document.querySelector('.signal-flow-optimize').open = true`);
  });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const optimizer = (selector) => `document.querySelector('.signal-flow-optimize ${selector}')`;

  test('the coefficient table heads its columns, and n per coefficient sits with the fractions', async () => {
    await h.evaluate(`[...document.querySelectorAll('.signal-flow-optimize label')].find((l) => l.textContent.startsWith('Make the free coefficients fractions')).querySelector('input').click()`);
    await h.settle();
    const head = await h.evaluate(`[...document.querySelectorAll('.signal-flow-optimize .signal-flow-optimize-head > *')].map((c) => c.textContent.trim())`);
    assert.deepEqual(head, ['', '', 'Min', 'Max', 'Now', 'Found']);
    assert.ok(await h.evaluate(`[...document.querySelectorAll('.signal-flow-optimize summary')].some((s) => s.textContent.startsWith('n per coefficient'))`));
    const kinds = await h.evaluate(`[...${optimizer('.signal-flow-optimize-nkind')}.options].map((o) => o.value + ':' + o.textContent)`);
    assert.deepEqual(kinds, ['max:≤', 'fixed:=']);
  });

  test('a run opens its own window with the start and progress; the explanations stay open while it searches; Stop leaves Close', async () => {
    await h.evaluate(`(() => { const f = document.querySelector('.signal-flow-optimize [aria-label="Evaluations"]'); f.value = '2000'; f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await h.click('.signal-flow-optimize-run');
    await h.until(`!!document.querySelector('.run-window')`);
    assert.equal(await h.evaluate(`document.querySelector('.run-window .floating-window-title, .run-window h2').textContent`), 'Optimizer');
    assert.equal(await h.evaluate(`document.querySelector('.run-window-stop').textContent`), 'Stop');
    // While it searches the optimizer's controls are locked, but a folded explanation still opens.
    const locked = await h.evaluate(`(() => {
      const root = document.querySelector('.signal-flow-optimize');
      const run = root.querySelector('.signal-flow-optimize-run');
      const controls = [...root.querySelectorAll('input, select, button')].filter((n) => n !== run);
      return { more: [...root.querySelectorAll('.hint-more')].map((b) => b.disabled), others: controls.filter((n) => !n.classList.contains('hint-more')).every((n) => n.disabled) };
    })()`);
    if (locked.more.length) assert.ok(locked.more.every((disabled) => !disabled));
    assert.equal(locked.others, true);
    await h.click('.run-window-stop');
    await h.until(`document.querySelector('.run-window-stop')?.textContent === 'Close'`, 20000);
    await h.click('.run-window-stop');
    await h.until(`!document.querySelector('.run-window') || document.querySelector('.run-window').hidden`);
  });

  test('a finished run reports a table of the start beside what it found', async () => {
    await h.evaluate(`(() => { const f = document.querySelector('.signal-flow-optimize [aria-label="Evaluations"]'); f.value = '50'; f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await h.click('.signal-flow-optimize-run');
    await h.until(`document.querySelector('.run-window-stop')?.textContent === 'Close'`, 60000);
    await h.click('.run-window-stop');
    await h.until(`!!document.querySelector('.signal-flow-optimize-result table')`, 10000);
    const heads = await h.evaluate(`[...document.querySelectorAll('.signal-flow-optimize-result table thead')].map((head) => [...head.querySelectorAll('th')].map((th) => th.textContent.trim()))`);
    // Kept to fractions: the fractions found, then each spec at the start and at them.
    assert.deepEqual(heads.slice(0, 2), [['', 'm/n', 'Value'], ['', 'Start', 'Fractions']]);
  });
});
