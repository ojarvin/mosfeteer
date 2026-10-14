/** The analysis window's switched-capacitor mode in a browser: suggested
 *  for an SC drawing, its phases from the timing diagram, Derive and the
 *  readout phase, its plots, and a drawing with no clock. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, browserSkip } from './harness.js';
import { scIntegrator } from './fixtures.js';

describe('switched-capacitor analysis', { skip: browserSkip() }, () => {
  let h;
  before(async () => {
    h = await start({ docs: { integrator: scIntegrator(), unclocked: scIntegrator({ timing: false }) } });
  });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const text = (selector) => h.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
  const openWindow = async () => {
    if (await h.evaluate(`document.getElementById('analysis-dialog').hidden`)) await h.key('S');
    await h.until(`!document.getElementById('analysis-dialog').hidden && !document.getElementById('analysis-switched-cap').hidden`);
  };

  test('an SC drawing opens the window in its mode, the phases from its timing diagram', async () => {
    await h.open('integrator');
    await openWindow();
    assert.equal(await text('#analysis-dialog-title'), 'Switched-capacitor analysis');
    assert.equal(await h.evaluate(`document.querySelector('.analysis-mode [data-mode="switched-cap"]').getAttribute('aria-pressed')`), 'true');
    assert.deepEqual(await h.evaluate(`[...document.querySelectorAll('.sc-phase-closed')].map((td) => td.textContent)`), ['S1, S3 closed', 'S2, S4 closed']);
  });

  test('Derive gives the integrator, read at the end of the last phase or of the one picked, and plots it', async () => {
    await openWindow();
    await h.evaluate(`document.querySelector('.sc-derive').click()`);
    await h.until(`!!document.querySelector('.sc-equation')`);
    // (C_S/C_F) / (1 - z^-1): no delay read at the end of φ2.
    assert.equal(await text('.sc-equation'), 'VOUTVIN=CSCF1−z−1');
    // Read at the end of φ1: a delay more.
    await h.evaluate(`(() => { const s = document.getElementById('sc-readout'); s.value = s.options[1].value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await h.evaluate(`document.querySelector('.sc-derive').click()`);
    await h.until(`document.querySelector('.sc-equation')?.textContent === 'VOUTVIN=CSCFz−11−z−1'`);
    assert.equal(await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.analysisValues.sc.readout)`), '$\\varphi_1$', 'the choice is the design\'s');
    // Its magnitude and phase in the Plots window.
    await h.until(`!document.querySelector('.plots-window')?.hidden && document.querySelectorAll('.sc-plots-view .plot-view path').length > 0`);
    // A capacitance's number moves the plots, not the equation.
    await h.evaluate(`(() => { const i = document.querySelector('.sc-value-input[aria-label="CS"]'); i.value = '4'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    assert.equal(await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.analysisValues.sc.values.CS)`), 4);
    assert.equal(await text('.sc-equation'), 'VOUTVIN=CSCFz−11−z−1');
  });

  test('without a timing diagram or beats it says what is missing', async () => {
    await h.open('unclocked');
    await openWindow();
    assert.match(await text('.sc-phases'), /timing diagram/);
    await h.evaluate(`document.querySelector('.sc-derive').click()`);
    await h.until(`!!document.querySelector('.sc-error')`);
    assert.match(await text('.sc-error'), /Draw a timing diagram/);
  });
});
