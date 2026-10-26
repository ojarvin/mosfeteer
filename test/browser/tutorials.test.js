/** Learn's tutorials and symbols in a browser: the switched-cap and
 *  delta-sigma tutorials started on a drawing of their own (over the Atlas
 *  too), their card following the steps -- edits, the beat on screen, and
 *  the analysis window's results; and the symbols, there to look at. */

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

  test('Learn lists every tutorial with a Start button, then the report example', async () => {
    assert.deepEqual(await h.evaluate(`[...document.querySelectorAll('#help-tutorials .help-tutorial h3')].map((e) => e.textContent)`),
      ['Draw a five-transistor OTA', 'Clock a switched-capacitor integrator', 'Analyze a delta-sigma modulator', 'Report example']);
    assert.equal(await h.evaluate(`document.querySelector('#help-tutorials [data-tutorial="ota"]').id`), 'btn-tutorial');
  });

  test('started over the Atlas, a tutorial opens in the editor', async () => {
    await h.click('#app-mark');
    await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !!s && !s.busy; })`, 10000);
    // Learn is reached from the Atlas too.
    await h.evaluate(`document.getElementById('atlas').dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))`);
    await h.until(`document.getElementById('help-dialog').open`);
    await h.evaluate(`document.querySelector('#help-dialog [data-help-tab="tutorial"]').click()`);
    await begin('ota');
    await h.until(`${h.module('atlas.js')}.then((m) => !m.atlasSnapshot())`, 5000);
    assert.equal(await h.evaluate(`document.getElementById('tutorial-card').hidden`), false);
    await h.click('#tutorial-close');
  });

  test('the switched-cap tutorial starts on its integrator and follows phases, clock, beats and the analysis', async () => {
    await begin('switched-cap');
    assert.equal(await h.evaluate(`document.getElementById('tutorial-title').textContent`), 'Tutorial · SC integrator');
    assert.deepEqual(await h.evaluate(`window.__circuit().comps.map((c) => c.refdes).filter((r) => /^S\\d/.test(r)).sort()`), ['S1', 'S2', 'S3', 'S4']);
    assert.equal(await heading(), 'Give the switches their phases');
    for (const line of ['value S1 $\\varphi_1$', 'value S3 $\\varphi_1$', 'value S2 $\\varphi_2$', 'value S4 $\\varphi_2$']) await run(line);
    await h.until(`document.querySelector('#tutorial-step h3')?.textContent === 'Draw the clock'`);
    await run('timing 1=10 2=01 --gaps 1:2');
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
    await h.until(`document.querySelector('#tutorial-step h3')?.textContent === 'Close the loop, negatively'`);
    await run('connect V.p S1.s');
    // Wired back positive, the step waits for the input to be flipped -- from the sum's menu.
    assert.equal(await heading(), 'Close the loop, negatively');
    const sum = await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.worldToClient(-800, 0))`);
    await h.mouse('mouseMoved', sum.x, sum.y, { button: 'none', buttons: 0 });
    await h.tap(sum.x, sum.y, { button: 'right' });
    await h.until(`!document.querySelector('.component-context-menu').hidden`);
    await h.evaluate(`[...document.querySelectorAll('.component-context-menu button')].find((b) => b.textContent.startsWith('Input polarity')).click()`);
    await h.evaluate(`[...document.querySelectorAll('.context-submenu[aria-label="Input polarity"] button')].find((b) => b.textContent.trim() === 's input: positive').click()`);
    await h.until(`document.querySelector('#tutorial-step h3')?.textContent === 'Find the STF and the NTF'`);
    if (await h.evaluate(`document.getElementById('analysis-dialog').hidden`)) await h.key('S');
    await h.until(`!document.getElementById('analysis-dialog').hidden && !document.getElementById('analysis-signal-flow').hidden`);
    await h.click('.signal-flow-derive');
    await h.until(`document.querySelector('#tutorial-step h3')?.textContent === 'Move a coefficient'`, 8000);
    await h.evaluate(`(() => { const i = document.querySelector('.signal-flow-coefficient[data-name="a"] .signal-flow-coefficient-value'); i.value = '0.5'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await h.until(`document.querySelector('#tutorial-step h3')?.textContent === 'Watch it in time'`, 5000);
  });
});

describe('Learn: the symbols', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start(); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  test('a symbol is there to look at: a click places nothing, hovering tells its type and pins', async () => {
    await h.key('?');
    await h.until(`document.getElementById('help-dialog').open`);
    await h.evaluate(`document.querySelector('#help-dialog [data-help-tab="symbols"]').click()`);
    await h.until(`document.querySelectorAll('#help-symbols .help-symbol').length > 20`);
    const tile = `[...document.querySelectorAll('#help-symbols .help-symbol')].find((t) => t.textContent.trim() === 'Resistor')`;
    assert.equal(await h.evaluate(`${tile}.tagName`), 'DIV', 'not a button');
    assert.match(await h.evaluate(`${tile}.title`), /type: resistor\npins: a, b/);
    const at = await h.evaluate(`(() => { const r = ${tile}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await h.mouse('mouseMoved', at.x, at.y, { button: 'none', buttons: 0 });
    await h.mouse('mousePressed', at.x, at.y);
    await h.mouse('mouseReleased', at.x, at.y);
    assert.equal(await h.evaluate(`document.getElementById('help-dialog').open`), true, 'Learn stays open');
    assert.equal(await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.mode)`), 'normal', 'no insert mode');
  });
});
