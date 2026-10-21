/**
 * The signal-flow analysis window and the Plots window, in a browser:
 * what they show, which tabs a diagram is offered, and how settings and
 * results follow the design.
 */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, sleep, browserSkip } from './harness.js';
import { amplifier, chain, modulator } from './fixtures.js';

describe('signal-flow analysis and plots', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { modulator: modulator(), chain: chain(), amplifier: amplifier() }, width: 1500, height: 950 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const shown = (selector) => h.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return !!el && !el.hidden && !!el.offsetParent; })()`);
  const tabs = () => h.evaluate(`[...document.querySelectorAll('.plots-window .signal-flow-view button')].map((b) => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? '*' : ''))`);
  const tab = (name) => h.evaluate(`[...document.querySelectorAll('.plots-window .signal-flow-view button')].find((b) => b.textContent === ${JSON.stringify(name)}).click()`);
  const openAnalysis = async (name) => {
    await h.open(name);
    if (!await shown('#analysis-dialog')) await h.key('S');
    await h.until(`!document.getElementById('analysis-dialog').hidden`);
  };
  // Derive works as the click runs; what it draws follows in a frame or two.
  const derive = async () => { await h.click('.signal-flow-derive'); await h.settle(); };

  test('the window reads setup, results, the plots card, then coefficients and the optimizer; Annotate and Derive close its footer, Annotate offering the equations, the graph, and an update of every plot', async () => {
    await openAnalysis('modulator');
    assert.equal(await h.evaluate(`document.getElementById('analysis-dialog-title').textContent`), 'Signal-flow analysis');
    const order = await h.evaluate(`[...document.getElementById('analysis-signal-flow').children].map((c) => c.className.split(' ').find((n) => n.startsWith('signal-flow-')) || c.tagName.toLowerCase())`);
    const at = (name) => order.indexOf(name);
    for (const [a, b] of [['signal-flow-stale', 'signal-flow-results'], ['signal-flow-results', 'signal-flow-plots'], ['signal-flow-plots', 'signal-flow-coefficients'], ['signal-flow-coefficients', 'signal-flow-optimize']]) {
      assert.ok(at(a) >= 0 && at(a) < at(b), `${a} before ${b}: ${order}`);
    }
    assert.equal(await shown('.plots-window'), false, 'no plots before a Derive');
    await derive();
    const footer = await h.evaluate(`[...document.querySelectorAll('#analysis-dialog .dialog-actions button')].filter((b) => !b.classList.contains('analysis-mode-hidden') && !b.hidden).map((b) => b.textContent.trim())`);
    assert.equal(footer.at(-1), 'Derive');
    assert.ok(footer.indexOf('Annotate…') >= 0 && footer.indexOf('Annotate…') < footer.length - 1);
    await h.click('#analysis-annotate');
    await h.until(`!document.getElementById('component-context-menu').hidden`);
    assert.deepEqual(await h.evaluate(`[...document.querySelectorAll('#component-context-menu button')].map((b) => b.textContent)`), ['Everything', 'Equations', 'Graph', 'Update every plot']);
    await h.evaluate(`${h.module('context-menu.js')}.then((m) => m.closeComponentContextMenu())`);
  });

  test('Derive opens the Plots window with every view a loop with a quantizer offers', async () => {
    await h.until(`!document.querySelector('.plots-window').hidden`);
    assert.deepEqual(await tabs(), ['Magnitude*', 'Phase', 'Step', 'Locus', 'Swing', 'Loop', 'Time']);
    assert.equal(await shown('.plots-window .signal-flow-spectrum-toggle'), true, 'a quantizer: the simulated spectrum is offered');
    assert.equal(await h.evaluate(`${h.module('plots-window.js')}.then((m) => m.plotsShown())`), true);
  });

  test('the loop gain breaks only a signal on the loop, and reports its margins', async () => {
    await tab('Loop');
    await h.until(`document.querySelector('.plots-window .signal-flow-loop-body .field-hint')?.textContent.length > 0`);
    const offered = await h.evaluate(`[...document.querySelectorAll('.plots-window .signal-flow-loop-signal option')].map((o) => o.textContent)`);
    assert.equal(offered[0], 'V', 'the quantizer\'s output first');
    assert.ok(!offered.includes('U'), 'the input is not on the loop');
  });

  test('the time view runs the diagram and picks its nets in one fully shown picker', async () => {
    await tab('Time');
    await h.until(`/cycles in/.test(document.querySelector('.time-status')?.textContent || '')`, 10000);
    const picks = await h.evaluate(`[...document.querySelectorAll('.plots-window .signal-flow-time .net-pick')].map((p) => ({ name: p.textContent, on: p.querySelector('input').checked }))`);
    assert.ok(picks.length >= 5 && picks.some((p) => p.on));
    // Every row in view: the picker never scrolls on its own, and its boxes are one size.
    const picker = await h.evaluate(`(() => { const el = document.querySelector('.plots-window .signal-flow-time .net-picker'); return { scroll: el.scrollHeight, client: el.clientHeight, boxes: [...new Set([...el.querySelectorAll('input')].map((i) => i.getBoundingClientRect().width + 'x' + i.getBoundingClientRect().height))] }; })()`);
    assert.equal(picker.scroll, picker.client);
    assert.equal(picker.boxes.length, 1);
    // Unticking a net is saved with the design's windows.
    const first = picks.findIndex((p) => p.on);
    await h.evaluate(`document.querySelectorAll('.plots-window .signal-flow-time .net-pick input')[${first}].click()`);
    await h.settle();
    const saved = await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.windows.scope)`);
    assert.equal(saved.chosen, true);
  });

  test('the swing picks its nets with the same picker', async () => {
    await tab('Swing');
    await h.click('.plots-window .signal-flow-swing-run');
    await h.until(`!!document.querySelector('.plots-window .signal-flow-swing .net-picker')`, 15000);
    assert.ok(await h.evaluate(`document.querySelectorAll('.plots-window .signal-flow-swing .net-pick').length`) >= 3);
  });

  test('inline fields share one compact size', async () => {
    await tab('Locus');
    const sizes = await h.evaluate(`[...document.querySelectorAll('.plots-window .signal-flow-swing-controls :is(input[type=text], select)')].filter((e) => e.offsetParent).map((e) => Math.round(e.getBoundingClientRect().height))`);
    assert.ok(sizes.length >= 3);
    assert.deepEqual([...new Set(sizes)], [24]);
  });

  test('closed, the plots stay closed on the next Derive; Shift+W brings them back', async () => {
    await h.click('.plots-window .floating-window-close');
    await derive();
    assert.equal(await shown('.plots-window'), false);
    await h.key('W');
    await h.until(`!document.querySelector('.plots-window').hidden`);
  });

  test('a diagram without feedback or a quantizer is offered neither the loop nor the spectrum', async () => {
    await openAnalysis('chain');
    await derive();
    await tab('Magnitude');
    assert.deepEqual((await tabs()).map((t) => t.replace('*', '')), ['Magnitude', 'Phase', 'Step', 'Locus', 'Swing', 'Time']);
    assert.equal(await shown('.plots-window .signal-flow-spectrum-toggle'), false);
  });

  test('results belong to their document: another one opened starts with none', async () => {
    await openAnalysis('chain');
    await derive();
    assert.ok(await h.evaluate(`document.querySelectorAll('.signal-flow-results .signal-flow-entry').length`) > 0);
    await openAnalysis('modulator');
    assert.equal(await h.evaluate(`document.querySelectorAll('.signal-flow-results .signal-flow-entry').length`), 0);
    assert.equal(await h.evaluate(`document.querySelectorAll('.plots-window .signal-flow-legend-row').length`), 0);
  });

  test('a swing sweep still running stops when another document is opened', async () => {
    await openAnalysis('modulator');
    await derive();
    await tab('Swing');
    const before = h.exceptions().length;
    // Started, and another design shown on its first frame.
    const running = await h.evaluate(`new Promise((resolve) => {
      document.querySelector('.plots-window .signal-flow-swing-run').click();
      requestAnimationFrame(() => {
        const status = document.querySelector('.plots-window .signal-flow-swing-status').textContent;
        window.__load(${JSON.stringify(chain())});
        resolve(/Simulating/.test(status));
      });
    })`);
    assert.ok(running, 'still sweeping when the design changed');
    await sleep(1000);
    assert.deepEqual(h.exceptions().slice(before), []);
  });

  test("a circuit's plots window holds its Bode graph; a diagram's, its own plots", async () => {
    await h.open('amplifier');
    if (!await shown('.plots-window')) await h.key('W');
    await h.until(`!document.querySelector('.plots-window').hidden`);
    // Empty until a Derive in the analysis window adds a gain.
    assert.equal(await shown('.bode-plots-empty'), true);
    assert.equal(await shown('.signal-flow-plots-head'), false);
    await h.open('modulator');
    await h.until(`!!document.querySelector('.plots-window .signal-flow-plots-view')`);
    assert.equal(await shown('.bode-plots-empty'), false);
  });

  test("a result's On the graph switch takes its response off the graph and puts it back", async () => {
    await openAnalysis('modulator');
    await derive();
    const switches = `[...document.querySelectorAll('.signal-flow-results .signal-flow-entry-actions button')]`;
    const legend = () => h.evaluate(`document.querySelectorAll('.plots-window .signal-flow-legend-row').length`);
    assert.equal(await h.evaluate(`${switches}[0].getAttribute('aria-pressed')`), 'true');
    const before = await legend();
    await h.evaluate(`${switches}[0].click()`);
    assert.equal(await h.evaluate(`${switches}[0].getAttribute('aria-pressed')`), 'false');
    assert.equal(await legend(), before - 1);
    await h.evaluate(`${switches}[0].click()`);
    assert.equal(await h.evaluate(`${switches}[0].getAttribute('aria-pressed')`), 'true');
    assert.equal(await legend(), before);
  });

  test('a finished coefficient adjustment is one undo step, and undoing it keeps the results current', async () => {
    await openAnalysis('modulator');
    await derive();
    const field = `document.querySelector('.signal-flow-coefficient[data-name="k_1"] .signal-flow-coefficient-value')`;
    const before = await h.evaluate(`${field}.value`);
    // A slider dragged: many ticks, then let go.
    await h.evaluate(`(() => { const s = document.querySelector('.signal-flow-coefficient[data-name="k_1"] input[type=range]'); s.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); for (let i = 0; i < 5; i++) { s.value = String(Number(s.value) + 1); s.dispatchEvent(new Event('input', { bubbles: true })); } s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await h.settle();
    assert.notEqual(await h.evaluate(`${field}.value`), before);
    await h.key('u');
    await h.settle();
    assert.equal(await h.evaluate(`${field}.value`), before, 'one undo takes the whole adjustment back');
    assert.equal(await shown('.signal-flow-stale'), false, 'the equations are still current');
  });

  test('a long explanation folds to its first sentence', async () => {
    assert.ok(await h.evaluate(`[...document.querySelectorAll('#analysis-dialog p.field-hint .hint-more')].length`) > 0);
    const rest = `document.querySelector('#analysis-dialog p.field-hint .hint-rest')`;
    assert.equal(await h.evaluate(`${rest}.hidden`), true);
    await h.evaluate(`document.querySelector('#analysis-dialog p.field-hint .hint-more').click()`);
    assert.equal(await h.evaluate(`${rest}.hidden`), false);
  });
});
