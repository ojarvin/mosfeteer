/**
 * The signal-flow analysis window and the Plots window, in a browser:
 * what they show, which tabs a diagram is offered, and how settings and
 * results follow the design.
 */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, sleep, browserSkip } from './harness.js';
import { amplifier, chain, ditheredModulator, modulator } from './fixtures.js';

describe('signal-flow analysis and plots', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { modulator: modulator(), dithered: ditheredModulator(), chain: chain(), amplifier: amplifier() }, width: 1500, height: 950 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const shown = (selector) => h.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return !!el && !el.hidden && !!el.offsetParent; })()`);
  const tabs = () => h.evaluate(`[...document.querySelectorAll('.plots-window .signal-flow-view button')].map((b) => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? '*' : ''))`);
  const tab = (name) => h.evaluate(`[...document.querySelectorAll('.plots-window .signal-flow-view button')].find((b) => b.textContent === ${JSON.stringify(name)}).click()`);
  const openAnalysis = async (name) => {
    await h.open(name);
    if (!await shown('#analysis-dialog')) await h.key('S');
    await h.until(`!document.getElementById('analysis-dialog').hidden`);
  };
  const annotate = async (label) => {
    await h.click('#analysis-annotate');
    await h.until(`[...document.querySelectorAll('#component-context-menu button')].some((b) => b.textContent.startsWith(${JSON.stringify(label)}) && !b.disabled)`);
    await h.evaluate(`[...document.querySelectorAll('#component-context-menu button')].find((b) => b.textContent.startsWith(${JSON.stringify(label)})).click()`);
  };
  // Derive works as the click runs; what it draws follows in a frame or two.
  const derive = async () => { await h.click('.signal-flow-derive'); await h.settle(); };

  test('the window reads setup, results, the plots card, then coefficients and the optimizer; Annotate and Derive close its footer, Annotate offering the equations, the graph, the coefficients, and an update of all plots', async () => {
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
    assert.deepEqual(await h.evaluate(`[...document.querySelectorAll('#component-context-menu button')].map((b) => b.textContent)`), ['Everything', 'Equations', 'Graph', 'Coefficients', 'Update all plots']);
    await h.evaluate(`${h.module('context-menu.js')}.then((m) => m.closeComponentContextMenu())`);
  });

  test('the annotated equations are a row per input, each its ratio and transfer function', async () => {
    await annotate('Equations');
    const table = () => h.evaluate(`window.__circuit().labels.find((l) => l.figure?.kind === 'equations' && l.figure.source === 'signal-flow')`);
    await h.until(`!!window.__circuit().labels.find((l) => l.figure?.kind === 'equations')`);
    const label = await table();
    assert.equal(label.columns, 'l');
    const rows = label.text.split('\n');
    assert.ok(rows.length >= 2);
    for (const row of rows) assert.match(row, /^\\frac\{V\}\{.+?\} = /);
    // Drawn as a table: each row a band, its fractions apart.
    await h.until(`[...document.querySelectorAll('.schematic-math-table')].some((t) => t.querySelectorAll('.schematic-math-strut').length === ${rows.length})`);
  });

  test('Derive opens the Plots window with every view a loop with a quantizer offers', async () => {
    await h.until(`!document.querySelector('.plots-window').hidden`);
    assert.deepEqual(await tabs(), ['Magnitude*', 'Phase', 'Step', 'Locus', 'Swing', 'Loop', 'Time', 'Sweep']);
    // The log frequency axis has faint lines through each decade, without numbers.
    await h.until(`document.querySelectorAll('.plots-window .plot-grid .role-grid.faint').length > 0`);
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

  test('the plots\' settings stand in columns: every name at one left edge per column, every unit field one width', async () => {
    await tab('Time');
    const shape = await h.evaluate(`(() => { const shown = [...document.querySelectorAll('.plots-window .signal-flow-swing-controls .control-pair')].filter((e) => e.offsetParent); return { lefts: [...new Set(shown.map((e) => Math.round(e.querySelector('label').getBoundingClientRect().left)))], controls: [...new Set(shown.map((e) => Math.round(e.querySelector('.control-value').getBoundingClientRect().left)))], widths: [...new Set(shown.filter((e) => e.querySelector('.control-unit')).map((e) => Math.round(e.querySelector('input').getBoundingClientRect().width)))] }; })()`);
    assert.ok(shape.lefts.length <= 2, JSON.stringify(shape));
    assert.equal(shape.controls.length, shape.lefts.length, JSON.stringify(shape));
    assert.equal(shape.widths.length, 1, JSON.stringify(shape));
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
    assert.deepEqual((await tabs()).map((t) => t.replace('*', '')), ['Magnitude', 'Phase', 'Step', 'Locus', 'Swing', 'Time', 'Sweep']);
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

  test('a held trace stays as the sliders move, named by what differs; the spectrum holds and hides too, and the annotated plot shows or hides each curve', async () => {
    await openAnalysis('modulator');
    await h.evaluate(`${h.module('editor-state.js')}.then((m) => { m.editor.circuit.analysisValues.band = { bw: 0.01 }; m.editor.circuit.analysisValues.coefficients = { ...m.editor.circuit.analysisValues.coefficients, k_1: 1, k_2: 2 }; })`);
    await derive();
    await tab('Magnitude');
    const legend = `[...document.querySelectorAll('.plots-window .signal-flow-legend-row')].map((r) => r.querySelector('.signal-flow-legend-math').textContent.replace(/\\s+/g, ' ').trim())`;
    const before = await h.evaluate(legend);
    await h.evaluate(`document.querySelector('.plots-window .signal-flow-legend-row .signal-flow-legend-hold').click()`);
    await h.until(`${legend}.length === ${before.length + 1}`);
    assert.match((await h.evaluate(legend)).at(-1), /held/);
    // A held row has no Hold of its own.
    assert.equal(await h.evaluate(`[...document.querySelectorAll('.plots-window .signal-flow-legend-row')].at(-1).querySelector('.signal-flow-legend-hold')`), null);
    // The slider moves the live curve; the held one names the number it keeps.
    await h.evaluate(`(() => { const f = document.querySelector('.signal-flow-coefficient[data-name="k_1"] .signal-flow-coefficient-value'); f.value = '0.5'; f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await h.until(`/k_?1 ?= ?1/.test(${legend}.at(-1))`);
    // The live one beside it names its value now, for the same name.
    assert.match((await h.evaluate(legend))[0], /k_?1 ?= ?0\.5/);
    assert.equal(await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.windows.holds['signal-flow'].length)`), 1);
    // The spectrum: its row holds it and hides it; a held one stays behind.
    await h.evaluate(`(() => { const a = document.querySelector('.plots-window .signal-flow-spectrum input[aria-label="Sine amplitude, dBFS"]'); a.value = '-20'; a.dispatchEvent(new Event('change', { bubbles: true })); const c = document.querySelector('.plots-window .signal-flow-spectrum-toggle input'); if (!c.checked) c.click(); })()`);
    await h.until(`!!document.querySelector('.plots-window .signal-flow-legend-spectrum')`, 20000);
    const backgrounds = `document.querySelectorAll('.plots-window .signal-flow-graph .role-background').length`;
    assert.equal(await h.evaluate(backgrounds), 1);
    await h.evaluate(`document.querySelector('.plots-window .signal-flow-legend-spectrum .signal-flow-legend-hold').click()`);
    await h.until(`!!document.querySelector('.plots-window .signal-flow-legend-held-spectrum')`);
    assert.equal(await h.evaluate(backgrounds), 2);
    await h.evaluate(`document.querySelector('.plots-window .signal-flow-legend-spectrum input[type=checkbox]').click()`);
    await h.until(`${backgrounds} === 1`);
    await h.evaluate(`document.querySelector('.plots-window .signal-flow-legend-spectrum input[type=checkbox]').click()`);
    await h.until(`${backgrounds} === 2`);
    // On the drawing, each curve can be hidden from the plot's settings.
    await h.evaluate(`[...document.querySelectorAll('.plots-window .signal-flow-graph-actions button')].find((b) => b.textContent === 'Annotate').click()`);
    const box = `${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].find((l) => l.plot?.units === 'dBFS'))`;
    await h.until(`${box}.then((b) => !!b)`);
    const count = await h.evaluate(`${box}.then((b) => b.plot.traces.length)`);
    assert.ok(count >= 3, `${count}`);
    assert.ok(await h.evaluate(`${box}.then((b) => b.plot.traces.some((t) => t.hold))`));
    const entries = await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.plotLegend([...m.editor.circuit.labels.values()].find((l) => l.plot?.units === 'dBFS')).length)`);
    await h.evaluate(`Promise.all([${h.module('data-plot-ui.js')}, ${box}]).then(([ui, b]) => ui.openPlotSettings(b))`);
    await h.until(`document.querySelectorAll('.data-plot-dialog .data-plot-curve').length === ${count}`);
    // Its swatch picks a color (the box beside it stays as it is).
    await h.evaluate(`document.querySelector('.data-plot-dialog .data-plot-curve .swatch').click()`);
    await h.until(`!!document.querySelector('.data-plot-swatches')`);
    assert.equal(await h.evaluate(`document.querySelector('.data-plot-dialog .data-plot-curve input[type=checkbox]').checked`), true);
    await h.evaluate(`document.querySelector('.data-plot-swatches .swatch[data-value="purple"]').click()`);
    await h.evaluate(`(() => { document.querySelector('.data-plot-dialog .data-plot-curve input[type=checkbox]').click(); [...document.querySelectorAll('.data-plot-dialog button')].find((b) => b.textContent === 'Apply').click(); })()`);
    await h.until(`${box}.then((b) => b.plot.traces[0].hidden === true)`);
    assert.equal(await h.evaluate(`${box}.then((b) => b.plot.traces[0].color)`), await h.evaluate(`import('/src/core/style.js').then((m) => m.COLOR_PALETTE.purple)`));
    assert.equal(await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.plotLegend([...m.editor.circuit.labels.values()].find((l) => l.plot?.units === 'dBFS')).length)`), entries - 1);
    // Shown again, its entry is back.
    await h.evaluate(`Promise.all([${h.module('data-plot-ui.js')}, ${box}]).then(([ui, b]) => ui.openPlotSettings(b))`);
    await h.until(`!!document.querySelector('.data-plot-dialog .data-plot-curve')`);
    assert.equal(await h.evaluate(`document.querySelector('.data-plot-dialog .data-plot-curve input[type=checkbox]').checked`), false);
    await h.evaluate(`(() => { document.querySelector('.data-plot-dialog .data-plot-curve input[type=checkbox]').click(); [...document.querySelectorAll('.data-plot-dialog button')].find((b) => b.textContent === 'Apply').click(); })()`);
    await h.until(`${box}.then((b) => !b.plot.traces[0].hidden)`);
    assert.equal(await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.plotLegend([...m.editor.circuit.labels.values()].find((l) => l.plot?.units === 'dBFS')).length)`), entries);
    // Held traces are kept with the design (a discard keeps them too): let
    // go of them, so the tests after this one start without them.
    await h.evaluate(`${h.module('editor-state.js')}.then((m) => { delete m.editor.circuit.windows.holds; })`);
  });

  test('the sweep steps a coefficient, simulating each point off the page\'s thread, and plots what each run measures', async () => {
    await openAnalysis('modulator');
    await h.evaluate(`${h.module('editor-state.js')}.then((m) => { const c = m.editor.circuit; c.analysisValues.band = { bw: 0.01 }; c.analysisValues.coefficients = { ...c.analysisValues.coefficients, k_1: 1, k_2: 2 }; c.windows.sweep = { name: 'k_1', from: '1/2', to: '3k/2k', points: 5, amplitude: '-20', samples: 4096, measures: [] }; })`);
    await derive();
    await tab('Sweep');
    await h.until(`!!document.querySelector('.plots-window .sweep-run') && !document.querySelector('.plots-window .signal-flow-sweep').hidden`);
    assert.equal(await h.evaluate(`document.querySelector('.plots-window .sweep-name').value`), 'k_1');
    // From and to take expressions (1/2, 3k/2k); Sweep runs it; the busy dots and Stop while it does.
    assert.equal(await h.evaluate(`(() => { document.querySelector('.plots-window .sweep-run').click(); return document.querySelector('.plots-window .sweep-run').textContent; })()`), 'Stop');
    await h.until(`!document.querySelector('.plots-window .sweep-run').dataset.running`, 30000);
    assert.match(await h.evaluate(`document.querySelector('.plots-window .sweep-status').textContent`), /5 points of k_1 from 0\.5 to 1\.5/);
    // The SNDR by default (a band is set); every measure is offered.
    const picks = await h.evaluate(`[...document.querySelectorAll('.plots-window .sweep-measures .net-pick')].map((p) => [p.textContent.replace(/\\s+/g, ' ').trim(), p.querySelector('input').checked])`);
    assert.deepEqual(picks.slice(0, 3).map(([text]) => text), ['SNDR in band (dB)', 'Noise in band (dBFS)', 'Output tone (dBFS)']);
    assert.equal(picks[0][1], true);
    assert.ok(picks.some(([text]) => /peak/.test(text)), JSON.stringify(picks));
    assert.ok(await h.evaluate(`document.querySelectorAll('.plots-window .sweep-plot .role-curve').length`) >= 1);
    // Another measure checked joins the plot, saved with the design.
    await h.evaluate(`document.querySelectorAll('.plots-window .sweep-measures .net-pick input')[1].click()`);
    await h.until(`${h.module('editor-state.js')}.then((m) => JSON.stringify(m.editor.circuit.windows.sweep.measures) === JSON.stringify(['sndr', 'noise']))`);
    // Held, it stays as k_2 moves and the sweep runs again, named by what differs.
    await h.evaluate(`document.querySelector('.plots-window .sweep-hold').click()`);
    await h.evaluate(`(() => { const f = document.querySelector('.signal-flow-coefficient[data-name="k_2"] .signal-flow-coefficient-value'); f.value = '1.5'; f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await h.evaluate(`document.querySelector('.plots-window .sweep-run').click()`);
    await h.until(`!document.querySelector('.plots-window .sweep-run').dataset.running`, 30000);
    // Annotate puts it on the drawing as a data plot over k_1.
    await h.evaluate(`document.querySelector('.plots-window .sweep-annotate').click()`);
    const plot = await h.evaluate(`${h.module('editor-state.js')}.then((m) => { const b = [...m.editor.circuit.labels.values()].find((l) => l.plot?.kind === 'data' && l.plot.x.label === 'k_{1}'); return b ? { traces: b.plot.traces.map((t) => t.label), y: b.plot.y.label, points: b.plot.traces[0].points.length, math: m.editor.circuit.plotLegend(b).every((e) => e.math) } : null; })`);
    assert.equal(plot.points, 5);
    assert.equal(plot.traces.length, 4);
    assert.match(plot.traces[0], /k_2 = 2/);
    assert.match(plot.traces[2], /k_2 = 1\.5/);
    // SNDR (dB) and noise (dBFS) differ in unit: each trace names its own.
    assert.equal(plot.y, 'dB');
    assert.match(plot.traces[0], /SNDR in band\}\\text\{ \(dB\)\}/);
    assert.equal(plot.math, true);
    // Update all plots runs its sweeps again: the held one at k_2 = 2, the
    // live one at the coefficients now, over the same range.
    const sweepBox = `${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].find((l) => l.plot?.kind === 'data' && l.plot.sweep))`;
    const spec = await h.evaluate(`${sweepBox}.then((b) => b.plot.sweep)`);
    assert.equal(spec.runs.length, 2);
    // The held one keeps only what it differs in: the rest follows the numbers then.
    assert.deepEqual(spec.runs[0].values, { k_2: 2 });
    assert.deepEqual(spec.measures, ['sndr', 'noise']);
    const before = await h.evaluate(`${sweepBox}.then((b) => JSON.stringify(b.plot.traces))`);
    await h.evaluate(`${h.module('editor-state.js')}.then((m) => { m.editor.circuit.analysisValues.coefficients.k_2 = 1.2; })`);
    await annotate('Update all plots');
    await h.until(`${sweepBox}.then((b) => /k_2 = 1\\.2/.test(b.plot.traces[2].label))`, 60000);
    const after = await h.evaluate(`${sweepBox}.then((b) => ({ traces: b.plot.traces, legend: [...b.circuit.plotLegend(b)].map((l) => l.text), x: b.plot.x.label }))`);
    assert.equal(after.x, 'k_{1}');
    assert.equal(after.traces.length, 4);
    assert.match(after.traces[0].label, /k_2 = 2/);
    // (a point where the loop runs away at the numbers now has no value)
    assert.ok(after.traces[2].points.length >= 2);
    // The held sweep reads as it did; the live one moved.
    assert.deepEqual(after.traces[0].points, JSON.parse(before)[0].points);
    assert.notDeepEqual(after.traces[2].points, JSON.parse(before)[2].points);
    assert.deepEqual(after.traces.map((t) => t.color), JSON.parse(before).map((t) => t.color));
    assert.ok(after.legend.every((text) => text.startsWith('$')), JSON.stringify(after.legend));
  });

  // A plot's right-click menu, its item `label` chosen.
  const plotMenu = async (find, label) => {
    await h.evaluate(`Promise.all([${h.module('editor-state.js')}, ${h.module('canvas-view.js')}, ${h.module('context-menu.js')}]).then(([s, v, menu]) => {
      const box = [...s.editor.circuit.labels.values()].find(${find});
      const b = box.bbox();
      const p = v.worldToClient(b.x + b.w / 2, b.y + 2);
      menu.openContextMenuAt(p.x, p.y);
    })`);
    await h.until(`[...document.querySelectorAll('.component-context-menu:not([hidden]) button')].some((b) => b.textContent.startsWith(${JSON.stringify(label)}))`);
    await h.evaluate(`[...document.querySelectorAll('.component-context-menu:not([hidden]) button')].find((b) => b.textContent.startsWith(${JSON.stringify(label)})).click()`);
  };
  const log = () => h.evaluate(`[...document.querySelectorAll('#log > *')].map((n) => n.textContent).slice(-2).join(' | ')`);

  test('a sweep plot\'s settings are the Sweep view\'s editor on what it ran; Update plot runs it again with its progress, and Stop leaves it as it was', async () => {
    await openAnalysis('modulator');
    await h.evaluate(`${h.module('editor-state.js')}.then((m) => { const c = m.editor.circuit; c.analysisValues.band = { bw: 0.01 }; c.analysisValues.coefficients = { ...c.analysisValues.coefficients, k_1: 1, k_2: 2 }; c.windows.sweep = { name: 'k_1', from: '0.5', to: '1.5', points: 5, amplitude: '-20', samples: 4096, measures: [] }; })`);
    await derive();
    await tab('Sweep');
    await h.until(`!!document.querySelector('.plots-window .sweep-run') && !document.querySelector('.plots-window .signal-flow-sweep').hidden`);
    // The measures are offered before any sweep: the nets' peaks too.
    assert.ok(await h.evaluate(`[...document.querySelectorAll('.plots-window .sweep-measures .net-pick')].some((p) => /peak/.test(p.textContent))`));
    await h.evaluate(`document.querySelector('.plots-window .sweep-run').click()`);
    assert.equal(await h.evaluate(`document.querySelector('.plots-window .sweep-progress').hidden`), false);
    await h.until(`!document.querySelector('.plots-window .sweep-run').dataset.running`, 30000);
    assert.equal(await h.evaluate(`document.querySelector('.plots-window .sweep-progress').hidden`), true);
    await h.evaluate(`document.querySelector('.plots-window .sweep-annotate').click()`);
    const find = '(l) => l.plot?.kind === \'data\' && l.plot.sweep';
    const sweepBox = `${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].find(${find}))`;
    await h.until(`${sweepBox}.then((b) => !!b)`);
    // Its settings: the sweep's fields as it ran, over the plot's editor.
    await plotMenu(find, 'Plot settings');
    await h.until(`!!document.querySelector('.data-plot-dialog .sweep-figure')`);
    const field = (label) => `document.querySelector('.data-plot-dialog .sweep-figure [aria-label=${JSON.stringify(label)}]')`;
    assert.equal(await h.evaluate(`document.querySelector('.data-plot-dialog .sweep-name').value`), 'k_1');
    assert.equal(await h.evaluate(`${field('Points')}.value`), '5');
    assert.equal(await h.evaluate(`${field('Sine amplitude, dBFS')}.value`), '-20');
    // Fewer points: Apply sweeps first, then applies.
    await h.evaluate(`(() => { const f = ${field('Points')}; f.value = '3'; f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    assert.match(await h.evaluate(`document.querySelector('.data-plot-dialog .sweep-status').textContent`), /Apply sweeps first/);
    await h.evaluate(`[...document.querySelectorAll('.data-plot-dialog button')].find((b) => b.textContent === 'Apply').click()`);
    await h.until(`!document.querySelector('.data-plot-dialog')`, 60000);
    const after = await h.evaluate(`${sweepBox}.then((b) => ({ points: b.plot.traces[0].points.length, run: b.plot.sweep.runs.at(-1).points, count: b.plot.sweep.count, traces: b.plot.traces.length, math: b.circuit.plotLegend(b).every((e) => e.math) }))`);
    assert.deepEqual(after, { points: 3, run: 3, count: 1, traces: 1, math: true });
    // The Sweep view's own settings stay.
    assert.equal(await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.windows.sweep.points)`), 5);
    // Update plot, long: its run window shows the progress; Stop leaves it as it was.
    await h.evaluate(`${sweepBox}.then((b) => { b.plot.sweep.runs.at(-1).points = 201; b.plot.sweep.runs.at(-1).samples = 65536; })`);
    const before = await h.evaluate(`${sweepBox}.then((b) => JSON.stringify(b.plot.traces))`);
    await plotMenu(find, 'Update plot');
    await h.until(`document.getElementById('run-window-title')?.textContent === 'Update plot'`);
    await h.until(`/Point \\d+ of 201/.test(document.querySelector('.run-window-status').textContent)`);
    await h.evaluate(`document.querySelector('.run-window-stop').click()`);
    await h.until(`document.querySelector('.run-window-stop').textContent === 'Close'`, 30000);
    assert.match(await h.evaluate(`document.querySelector('.run-window-status').textContent`), /Stopped/);
    await h.until(`/left the sweep plot as it was: stopped/.test(${JSON.stringify('')} + [...document.querySelectorAll('#log > *')].map((n) => n.textContent).join(' '))`);
    assert.equal(await h.evaluate(`${sweepBox}.then((b) => JSON.stringify(b.plot.traces))`), before);
    await h.evaluate(`document.querySelector('.run-window-stop').click()`);
    // Run through, at the coefficients now.
    await h.evaluate(`${sweepBox}.then((b) => { b.plot.sweep.runs.at(-1).points = 3; b.plot.sweep.runs.at(-1).samples = 4096; })`);
    await h.evaluate(`${h.module('editor-state.js')}.then((m) => { m.editor.circuit.analysisValues.coefficients.k_2 = 1.2; })`);
    await plotMenu(find, 'Update plot');
    await h.until(`document.querySelector('.run-window-stop')?.textContent === 'Close'`, 60000);
    assert.match(await h.evaluate(`document.querySelector('.run-window-status').textContent`), /Updated the sweep plot/);
    assert.match(await log(), /updated the sweep plot/);
    assert.notEqual(await h.evaluate(`${sweepBox}.then((b) => JSON.stringify(b.plot.traces))`), before);
    await h.evaluate(`document.querySelector('.run-window-stop').click()`);
  });

  test('Update plot on a graph before any Derive says to derive first, and leaves it', async () => {
    await openAnalysis('modulator');
    await derive();
    await annotate('Graph');
    const find = '(l) => l.plot?.kind === \'response\'';
    await h.until(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].some(${find}))`);
    // The same drawing loaded again: nothing derived.
    await h.evaluate(`${h.module('editor-state.js')}.then((m) => window.__load(m.editor.circuit.toJSON()))`);
    await h.settle();
    const before = await h.evaluate(`${h.module('editor-state.js')}.then((m) => JSON.stringify([...m.editor.circuit.labels.values()].find(${find}).plot))`);
    await plotMenu(find, 'Update plot');
    await h.until(`/derive the diagram first/.test(${JSON.stringify('')} + [...document.querySelectorAll('#log > *')].map((n) => n.textContent).join(' '))`);
    assert.equal(await h.evaluate(`${h.module('editor-state.js')}.then((m) => JSON.stringify([...m.editor.circuit.labels.values()].find(${find}).plot))`), before);
    // Derived, it updates.
    await derive();
    await plotMenu(find, 'Update plot');
    await h.until(`/updated the magnitude plot/.test([...document.querySelectorAll('#log > *')].map((n) => n.textContent).join(' '))`);
    // From its settings: the edits applied, the plot updated, the window still open on it.
    await plotMenu(find, 'Plot settings');
    await h.until(`!!document.querySelector('.plot-settings-window .data-plot-update')`);
    await h.evaluate(`[...document.querySelectorAll('.plot-settings-window .data-plot-curve input[type=checkbox]')][0].click()`);
    await h.evaluate(`document.querySelector('.plot-settings-window .data-plot-update').click()`);
    await h.until(`/updated the magnitude plot.*updated the magnitude plot/.test([...document.querySelectorAll('#log > *')].map((n) => n.textContent).join(' '))`);
    await h.until(`!!document.querySelector('.plot-settings-window .data-plot-update:not([disabled])')`);
    assert.equal(await h.evaluate(`document.querySelectorAll('.plot-settings-window').length`), 1);
    assert.equal(await h.evaluate(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].find(${find}).plot.traces[0].hidden === true)`), true);
    assert.equal(await h.evaluate(`document.querySelector('.plot-settings-window .data-plot-curve input[type=checkbox]').checked`), false);
    await h.evaluate(`[...document.querySelectorAll('.plot-settings-window button')].find((b) => b.textContent === 'Cancel').click()`);
  });

  test('a swing plot updates before any Derive: the swing needs none', async () => {
    await openAnalysis('modulator');
    await derive();
    await tab('Swing');
    await h.click('.plots-window .signal-flow-swing-run');
    await h.until(`!!document.querySelector('.plots-window .signal-flow-swing .net-picker')`, 15000);
    await h.evaluate(`[...document.querySelectorAll('.plots-window .signal-flow-swing button')].find((b) => b.textContent === 'Annotate').click()`);
    const find = '(l) => l.plot?.kind === \'swing\'';
    await h.until(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].some(${find}))`);
    // The same drawing loaded again: nothing derived, the swing's sources not yet listed.
    await h.evaluate(`${h.module('editor-state.js')}.then((m) => window.__load(m.editor.circuit.toJSON()))`);
    await h.settle();
    // As on a page just opened: the Swing view never shown, its source list empty.
    await h.evaluate(`document.querySelector('.signal-flow-swing-source').replaceChildren()`);
    await plotMenu(find, 'Update plot');
    await h.until(`/updated the swing plot|left the swing plot/.test([...document.querySelectorAll('#log > *')].map((n) => n.textContent).join(' '))`, 30000);
    assert.match(await log(), /updated the swing plot/);
  });

  test('a coefficient typed as a ratio applies, again after a slider move, and is tabled as typed', async () => {
    await openAnalysis('modulator');
    await derive();
    const row = (name) => `document.querySelector('.signal-flow-coefficient[data-name="${name}"]')`;
    const type = (name, text) => h.evaluate(`(() => { const f = ${row(name)}.querySelector('.signal-flow-coefficient-value'); f.value = ${JSON.stringify(text)}; f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    const values = `${h.module('editor-state.js')}.then((m) => ({ k: m.editor.circuit.analysisValues.coefficients.k_1, text: m.editor.circuit.analysisValues.fractions?.k_1 ?? null }))`;
    await type('k_1', '5/32');
    assert.deepEqual(await h.evaluate(values), { k: 5 / 32, text: '5/32' });
    // The slider moves it; typing the same ratio back takes it back.
    await h.evaluate(`(() => { const s = ${row('k_1')}.querySelector('input[type=range]'); s.value = String(Number(s.value) + 3); s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    assert.notEqual((await h.evaluate(values)).k, 5 / 32);
    await type('k_1', '5/32');
    assert.deepEqual(await h.evaluate(values), { k: 5 / 32, text: '5/32' });
    // Any expression of numbers reads; a name without = is refused, said so.
    await type('k_1', '2^-3');
    assert.deepEqual(await h.evaluate(values), { k: 0.125, text: '2^-3' });
    await type('k_1', 'q_9/2');
    assert.equal(await h.evaluate(`${row('k_1')}.querySelector('.signal-flow-coefficient-value').classList.contains('invalid')`), true);
    assert.deepEqual(await h.evaluate(values), { k: 0.125, text: '2^-3' });
    await type('k_1', '7/32');
    await h.evaluate(`${h.module('editor-state.js')}.then((m) => { m.editor.circuit.analysisValues.links = { k_2: 'k_1' }; })`);
    await annotate('Coefficients');
    const table = `${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].find((l) => l.figure?.kind === 'coefficients')?.text || '')`;
    await h.until(`${table}.then((t) => /^k_\\{?1\\}? & 7\\/32$/m.test(t))`);
    assert.match(await h.evaluate(table), /^k_\{?2\}? & 7\/32$/m, 'a link to it is written the same');
  });

  test('over the simulated spectrum the noise curve includes the dither', async () => {
    await openAnalysis('dithered');
    await derive();
    await tab('Magnitude');
    await h.until(`!!document.querySelector('.plots-window .signal-flow-spectrum-toggle input')`);
    await h.evaluate(`(() => { const a = document.querySelector('.plots-window .signal-flow-spectrum input[aria-label="Sine amplitude, dBFS"]'); a.value = '-12'; a.dispatchEvent(new Event('change', { bubbles: true })); const c = document.querySelector('.plots-window .signal-flow-spectrum-toggle input'); if (!c.checked) c.click(); })()`);
    await h.until(`/curves at QZ1 gain/.test(document.querySelector('.plots-window .signal-flow-spectrum-status')?.textContent || '')`, 20000);
    await annotate('Graph');
    const plot = `${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].find((l) => l.plot?.kind === 'response')?.plot)`;
    await h.until(`${plot}.then((p) => !!p?.traces.some((t) => t.background))`);
    const traces = await h.evaluate(`${plot}.then((p) => p.traces.map((t) => ({ label: t.label, background: !!t.background, points: t.points.filter((q) => Math.abs(q.f - 0.25) < 0.02).map((q) => q.db) })))`);
    const level = (points) => 10 * Math.log10(points.reduce((sum, db) => sum + 10 ** (db / 10), 0) / points.length);
    const floor = level(traces.find((t) => t.background).points);
    const noise = traces.find((t) => !t.background && /Q/.test(t.label));
    assert.ok(noise, JSON.stringify(traces.map((t) => t.label)));
    assert.ok(Math.abs(level(noise.points) - floor) < 2.5, `the curve ${level(noise.points)} against the floor ${floor}`);
  });

  test('a zoomed graph annotates at its zoom, and the plot keeps those limits when updated', async () => {
    await openAnalysis('modulator');
    await h.evaluate(`${h.module('editor-state.js')}.then((m) => { const v = m.editor.circuit.analysisValues; v.coefficients = { ...v.coefficients, k_1: 1, k_2: 2 }; v.flow = { ...v.flow, spectrum: { on: false } }; })`);
    await derive();
    await tab('Magnitude');
    await h.until(`!!document.querySelector('.plots-window .signal-flow-graph .plot-view-svg')`);
    const at = await h.evaluate(`(() => { const r = document.querySelector('.plots-window .signal-flow-graph .plot-view').getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height / 2 }; })()`);
    await h.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY: -400, modifiers: 2 });
    await h.until(`!!document.querySelector('.plots-window .signal-flow-graph .plot-view-fit:not([hidden])')`);
    const view = `${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].find((l) => l.plot?.kind === 'response')?.plot.view ?? null)`;
    await annotate('Graph');
    await h.until(`${view}.then((v) => !!v)`);
    const zoomed = await h.evaluate(view);
    assert.ok(zoomed.x[0] > 0 && zoomed.x[1] > zoomed.x[0] && zoomed.y[1] > zoomed.y[0], JSON.stringify(zoomed));
    // New numbers, every plot updated: the limits stay.
    await h.evaluate(`${h.module('editor-state.js')}.then((m) => { m.editor.circuit.analysisValues.coefficients.k_2 = 1.5; })`);
    await annotate('Update all plots');
    await h.settle();
    assert.deepEqual(await h.evaluate(view), zoomed);
    // Fitted again and annotated: all of it.
    await h.click('.plots-window .signal-flow-graph .plot-view-fit');
    await annotate('Graph');
    await h.until(`${view}.then((v) => v === null)`);
  });

  test('a long explanation folds to its first sentence', async () => {
    assert.ok(await h.evaluate(`[...document.querySelectorAll('#analysis-dialog p.field-hint .hint-more')].length`) > 0);
    const rest = `document.querySelector('#analysis-dialog p.field-hint .hint-rest')`;
    assert.equal(await h.evaluate(`${rest}.hidden`), true);
    await h.evaluate(`document.querySelector('#analysis-dialog p.field-hint .hint-more').click()`);
    assert.equal(await h.evaluate(`${rest}.hidden`), false);
  });

  test('an annotated graph is drawn in black with its legend past the line samples; its menu\'s Colored traces brings the colors back', async () => {
    await openAnalysis('modulator');
    await derive();
    await h.evaluate(`${h.module('editor-state.js')}.then((m) => { const c = m.editor.circuit; for (const l of [...c.labels.values()]) if (l.plot) c.removeLabel(l.id); })`);
    await annotate('Graph');
    const plot = `${h.module('editor-state.js')}.then((m) => { const c = m.editor.circuit; const box = [...c.labels.values()].find((l) => l.plot); return box && { id: box.id, black: !!box.style.blackTraces, right: box.bbox().x + box.bbox().w, legend: c.plotLegend(box).map((l) => l.bbox().x) }; })`;
    await h.until(`${plot}.then((p) => !!p && p.legend.length > 0)`);
    const placed = await h.evaluate(plot);
    assert.equal(placed.black, true, 'a new graph is in black');
    assert.ok(placed.legend.every((x) => x >= placed.right + 3 * 40 - 1), `legend past the samples' room: ${JSON.stringify(placed)}`);
    if (placed.legend.length > 1) await h.until(`document.querySelectorAll('#canvas .plot-legend-sample').length === ${placed.legend.length}`);
    // Its context menu, on the plot.
    await h.evaluate(`Promise.all([${h.module('editor-state.js')}, ${h.module('canvas-view.js')}, ${h.module('context-menu.js')}]).then(([s, v, menu]) => {
      const b = s.editor.circuit.labels.get(${JSON.stringify(placed.id)}).bbox();
      const p = v.worldToClient(b.x + b.w / 2, b.y + 2);
      menu.openContextMenuAt(p.x, p.y);
    })`);
    await h.until(`[...document.querySelectorAll('.component-context-menu:not([hidden]) button')].some((b) => b.textContent.startsWith('Colored traces'))`);
    await h.evaluate(`[...document.querySelectorAll('.component-context-menu:not([hidden]) button')].find((b) => b.textContent.startsWith('Colored traces')).click()`);
    await h.until(`${plot}.then((p) => !p.black)`);
    const colored = await h.evaluate(plot);
    assert.deepEqual(colored.legend, placed.legend.map((x) => x - 3 * 40), 'the legend back against the box');
    await h.until(`!document.querySelector('#canvas .plot-legend-sample')`);
  });

  test('the coefficients are a table of their own, the plot legend only its traces; Update all plots moves an older plot\'s numbers to the table', async () => {
    await openAnalysis('modulator');
    await derive();
    const state = `${h.module('editor-state.js')}.then((m) => { const labels = [...m.editor.circuit.labels.values()]; const box = labels.find((l) => l.plot); return { legend: box ? labels.filter((l) => l.parent === box.id).map((l) => l.text) : null, tables: labels.filter((l) => l.figure?.kind === 'coefficients').map((l) => ({ source: l.figure.source, text: l.text, columns: l.columns })) }; })`;
    await annotate('Graph');
    await h.until(`${state}.then((s) => !!s.legend)`);
    let now = await h.evaluate(state);
    assert.ok(now.legend.length > 0);
    assert.ok(now.legend.every((text) => !/\s=\s/.test(text)), JSON.stringify(now.legend));
    assert.deepEqual(now.tables, []);
    await annotate('Coefficients');
    await h.until(`${state}.then((s) => s.tables.length === 1)`);
    now = await h.evaluate(state);
    assert.equal(now.tables[0].source, 'signal-flow');
    // As the parts and noise tables: headings, a rule, then the rows.
    assert.equal(now.tables[0].columns, 'lr');
    const lines = now.tables[0].text.split('\n');
    assert.deepEqual(lines.slice(0, 2), ['\\text{Coefficient} & \\text{Value}', '\\hline']);
    assert.match(lines[2], /^k_\{?1\}? & [-\d.]+$/);
    // Annotated again: the same table. A linked coefficient shows the
    // number it follows.
    await h.evaluate(`${h.module('editor-state.js')}.then((m) => { const v = m.editor.circuit.analysisValues; v.coefficients = { ...v.coefficients, k_1: 0.5 }; v.links = { k_2: 'k_1' }; })`);
    await annotate('Coefficients');
    await h.until(`${state}.then((s) => /^k_\\{?2\\}? & 0\\.5$/m.test(s.tables[0]?.text || ''))`);
    assert.equal((await h.evaluate(state)).tables.length, 1);
    // An older plot: its numbers under the legend, no table.
    await h.evaluate(`${h.module('editor-state.js')}.then((m) => { const c = m.editor.circuit; for (const l of [...c.labels.values()]) if (l.figure?.kind === 'coefficients') c.removeLabel(l.id); const box = [...c.labels.values()].find((l) => l.plot); c.addLabel({ text: 'k_1 = 0.5', math: true, parent: box.id, role: 'plot-legend', align: 'left', x: 0, y: 0 }); })`);
    await annotate('Update all plots');
    await h.until(`${state}.then((s) => s.tables.length === 1)`);
    now = await h.evaluate(state);
    assert.ok(now.legend.every((text) => !/\s=\s/.test(text)), JSON.stringify(now.legend));
  });

  test('an annotated spectrum has its legend entry, and its SNDR stays in the window', async () => {
    await openAnalysis('modulator');
    await h.evaluate(`${h.module('editor-state.js')}.then((m) => { m.editor.circuit.analysisValues.band = { bw: 0.01 }; })`);
    // Derive puts the analysis window's busy dots beside its title until it is done.
    const deriving = `document.querySelector('#analysis-dialog .floating-window-header .busy-dots')`;
    assert.equal(await h.evaluate(`(() => { document.querySelector('.signal-flow-derive').click(); return ${deriving}.hidden; })()`), false);
    assert.equal(await h.evaluate(`${deriving}.getAttribute('aria-label')`), 'Deriving');
    await h.until(`${deriving}.hidden`);
    await h.settle();
    await tab('Magnitude');
    // The spectrum on, at -20 dBFS (the loop runs away at -6), as its checkbox turns it on.
    await h.until(`!!document.querySelector('.plots-window .signal-flow-spectrum-toggle input')`);
    await h.evaluate(`(() => { const a = document.querySelector('.plots-window .signal-flow-spectrum input[aria-label="Sine amplitude, dBFS"]'); a.value = '-20'; a.dispatchEvent(new Event('change', { bubbles: true })); const c = document.querySelector('.plots-window .signal-flow-spectrum-toggle input'); if (!c.checked) c.click(); })()`);
    await h.until(`/SNDR/.test(document.querySelector('.plots-window .signal-flow-spectrum-status')?.textContent || '')`, 20000);
    // The curves over it are drawn at each quantizer's measured gain, as it says.
    assert.match(await h.evaluate(`document.querySelector('.plots-window .signal-flow-spectrum-status').textContent`), /curves at \w+ gain -?[\d.e-]+/);
    // Its Simulation section: the band's noise beside the SNDR, and the run's length as chosen, saved.
    assert.equal(await h.evaluate(`document.querySelector('.plots-window .signal-flow-spectrum > legend').textContent`), 'Simulation');
    assert.match(await h.evaluate(`document.querySelector('.plots-window .signal-flow-spectrum-status').textContent`), /SNDR -?[\d.]+ dB \(ENOB -?[\d.]+\), noise -[\d.]+ dBFS; 7 averages of 8192 samples/);
    // The busy dots beside the title from the ask until the spectrum is drawn.
    const dots = `document.querySelector('.plots-window .floating-window-header .busy-dots')`;
    await h.until(`${dots}.hidden`, 20000);
    assert.equal(await h.evaluate(`(() => { const s = document.querySelector('.plots-window .signal-flow-spectrum-samples'); s.value = '4096'; s.dispatchEvent(new Event('change', { bubbles: true })); return ${dots}.hidden; })()`), false);
    await h.until(`/of 4096 samples/.test(document.querySelector('.plots-window .signal-flow-spectrum-status')?.textContent || '')`, 20000);
    await h.until(`${dots}.hidden`);
    assert.equal(await h.evaluate(`${dots}.getAttribute('aria-label')`), 'Simulating');
    assert.equal(await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.analysisValues.flow.spectrum.samples)`), 4096);
    // Every curve unticked: the spectrum stays, and annotates alone.
    // The curves' boxes (the spectrum's own row hides the spectrum).
    const checks = `[...document.querySelectorAll('.plots-window .signal-flow-legend-row:not(.signal-flow-legend-spectrum, .signal-flow-legend-held-spectrum) input[type=checkbox]')]`;
    // Each click redraws the legend: one at a time.
    await h.evaluate(`(() => { for (let i = 0; i < 20; i++) { const c = ${checks}.find((c) => c.checked); if (!c) break; c.click(); } })()`);
    await h.until(`${checks}.every((c) => !c.checked)`);
    assert.equal(await shown('.plots-window .signal-flow-graph .plot-view'), true, 'the spectrum is still plotted');
    assert.equal(await h.evaluate(`[...document.querySelectorAll('.plots-window .signal-flow-graph-actions button')].find((b) => b.textContent === 'Annotate').disabled`), false);
    await annotate('Graph');
    await h.until(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].some((l) => l.plot?.units === 'dBFS' && l.plot.traces.length === 1 && l.plot.traces[0].background))`);
    await h.evaluate(`(() => { for (let i = 0; i < 20; i++) { const c = ${checks}.find((c) => !c.checked); if (!c) break; c.click(); } })()`);
    await annotate('Graph');
    const legend = `${h.module('editor-state.js')}.then((m) => { const labels = [...m.editor.circuit.labels.values()]; const box = labels.find((l) => l.plot?.units === 'dBFS'); return box ? labels.filter((l) => l.parent === box.id).map((l) => l.text) : []; })`;
    await h.until(`${legend}.then((l) => l.length > 1)`);
    const entries = await h.evaluate(legend);
    // The curves' entries, then the spectrum's last; no SNDR on the drawing.
    assert.equal(entries.at(-1), '$\\text{simulated output}$', entries.join(' | '));
    assert.ok(!entries.some((text) => text.includes('SNDR')), entries.join(' | '));
    assert.match(await h.evaluate(`document.querySelector('.plots-window .signal-flow-spectrum-status').textContent`), /SNDR/);
    // A legend that slid over the plot goes back beside it when the plot is updated.
    const column = `${h.module('editor-state.js')}.then((m) => { const labels = [...m.editor.circuit.labels.values()]; const box = labels.find((l) => l.plot?.units === 'dBFS'); const curves = m.editor.circuit.plotLegend(box).slice(0, m.editor.circuit.plotLegendCurves(box).length); return { right: box.bbox().x + box.bbox().w, left: Math.min(...curves.map((l) => l.bbox().x)) }; })`;
    const placed = await h.evaluate(column);
    await h.evaluate(`${h.module('editor-state.js')}.then((m) => { const labels = [...m.editor.circuit.labels.values()]; const box = labels.find((l) => l.plot?.units === 'dBFS'); for (const l of m.editor.circuit.plotLegend(box)) l.moveTo(l.anchor.x - 240, l.anchor.y); })`);
    await annotate('Graph');
    await h.until(`${column}.then((c) => c.left === ${placed.left})`);
    assert.ok(placed.left >= placed.right, JSON.stringify(placed));
  });
});
