/** The switched-cap and delta-sigma tutorials in a browser: started from
 *  Learn on a drawing of their own, their card following the steps --
 *  edits, the beat on screen, and the analysis window's results. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, browserSkip } from './harness.js';

describe('the switched-cap and delta-sigma tutorials', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ width: 1500, height: 950 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const heading = () => h.evaluate(`document.querySelector('#tutorial-step h3')?.textContent`);
  const run = (line) => h.evaluate(`window.__run(${JSON.stringify(line)})`);
  const begin = async (id) => {
    await h.evaluate(`document.querySelector('#help-tutorials [data-tutorial="${id}"]').click()`);
    // A new document: nothing unsaved to ask about yet, or say discard.
    await h.evaluate(`document.querySelector('.file-dialog [data-action="discard"], dialog[open] button[value="discard"]')?.click()`);
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.tutorial?.id === ${JSON.stringify(id)})`);
  };

  test('Learn lists every tutorial with a Start button', async () => {
    assert.deepEqual(await h.evaluate(`[...document.querySelectorAll('#help-tutorials .help-tutorial h3')].map((e) => e.textContent)`),
      ['Draw a five-transistor OTA', 'Clock a switched-capacitor integrator', 'Analyse a delta-sigma modulator']);
    assert.equal(await h.evaluate(`document.querySelector('#help-tutorials [data-tutorial="ota"]').id`), 'btn-tutorial');
  });

  test('the switched-cap tutorial starts on its integrator and follows phases, clock, beats and the analysis', async () => {
    await begin('switched-cap');
    assert.equal(await h.evaluate(`document.getElementById('tutorial-title').textContent`), 'Tutorial · SC integrator');
    assert.deepEqual(await h.evaluate(`window.__circuit().comps.map((c) => c.refdes).filter((r) => /^S\\d/.test(r)).sort()`), ['S1', 'S2', 'S3', 'S4']);
    assert.equal(await heading(), 'Give the switches their phases');
    for (const line of ['value S1 $\\varphi_1$', 'value S3 $\\varphi_1$', 'value S2 $\\varphi_2$', 'value S4 $\\varphi_2$']) await run(line);
    await h.until(`document.querySelector('#tutorial-step h3')?.textContent === 'Draw the clock'`);
    await run('timing 1=10 2=01');
    await run('timing --span "1:2>2:2=$t_{nov}$"');
    await run('beat phases');
    await h.until(`document.querySelector('#tutorial-step h3')?.textContent === 'Step through the clock'`);
    // The beat on screen, a window's result: no edit, the card still moves on.
    await h.key('ArrowRight', { altKey: true });
    await h.key('ArrowRight', { altKey: true });
    await h.until(`document.querySelector('#tutorial-step h3')?.textContent === 'Find H(z)'`, 5000);
    await h.key('S');
    await h.until(`!document.getElementById('analysis-dialog').hidden && !document.getElementById('analysis-switched-cap').hidden`);
    await h.evaluate(`document.querySelector('.sc-derive').click()`);
    await h.until(`document.querySelector('#tutorial-step h3')?.textContent === 'Give the op-amp a finite gain'`, 5000);
    assert.match(await h.evaluate(`document.getElementById('tutorial-count').textContent`), /^6 \/ 7$/);
  });

  test('the delta-sigma tutorial: its loop closed, derived, a coefficient moved', async () => {
    await h.evaluate(`document.getElementById('analysis-dialog').hidden || document.querySelector('#analysis-dialog .floating-window-close')?.click()`);
    await h.evaluate(`document.querySelector('.plots-window .floating-window-close')?.click()`);
    await begin('sdm');
    assert.equal(await heading(), 'Wire the forward path');
    for (const line of ['connect S1.e K1.in', 'connect K1.out H1.in', 'connect H1.out QZ1.in']) await run(line);
    await h.until(`document.querySelector('#tutorial-step h3')?.textContent === 'Close the loop'`);
    await run('connect V.p S1.s');
    await h.until(`document.querySelector('#tutorial-step h3')?.textContent === 'Find the STF and the NTF'`);
    if (await h.evaluate(`document.getElementById('analysis-dialog').hidden`)) await h.key('S');
    await h.until(`!document.getElementById('analysis-dialog').hidden && !document.getElementById('analysis-signal-flow').hidden`);
    await h.click('.signal-flow-derive');
    await h.until(`document.querySelector('#tutorial-step h3')?.textContent === 'Move a coefficient'`, 8000);
    await h.evaluate(`(() => { const i = document.querySelector('.signal-flow-coefficient[data-name="a"] .signal-flow-coefficient-value'); i.value = '0.5'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await h.until(`document.querySelector('#tutorial-step h3')?.textContent === 'Watch it in time'`, 5000);
  });
});
