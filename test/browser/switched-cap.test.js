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
  // The analysis window's Annotate menu: open it, choose `label`.
  const annotate = async (label) => {
    await h.click('#analysis-annotate');
    await h.until(`[...document.querySelectorAll('#component-context-menu button')].some((b) => b.textContent.startsWith(${JSON.stringify(label)}) && !b.disabled)`);
    await h.evaluate(`[...document.querySelectorAll('#component-context-menu button')].find((b) => b.textContent.startsWith(${JSON.stringify(label)})).click()`);
  };

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
    // Each Derive's result on the Plots window's graph, as the Bode graph's.
    await h.until(`!document.querySelector('.plots-window')?.hidden && document.querySelectorAll('.sc-plots-view .plot-view path').length > 0`);
    assert.equal(await h.evaluate(`document.querySelectorAll('.sc-legend .signal-flow-legend-row').length`), 2, 'both readouts on the graph');
    // Magnitude over phase, the phase numbering their one axis.
    assert.deepEqual(await h.evaluate(`[...document.querySelectorAll('.sc-graph .plot-view')].map((p) => [p.classList.contains('bode-magnitude') ? 'magnitude' : 'phase', /°/.test(p.textContent), /𝑓\\/𝑓/.test(p.textContent)])`), [['magnitude', false, false], ['phase', true, true]]);
    // A capacitance is a Values row: a slider and a field. Its number moves
    // the plots, not the equation, and is the design's.
    assert.equal(await h.evaluate(`document.querySelectorAll('.sc-values .signal-flow-coefficient input[type="range"]').length`), 2);
    await h.evaluate(`(() => { const i = document.querySelector('.sc-values .signal-flow-coefficient-value[aria-label="CS: value"]'); i.value = '4'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.analysisValues.sc.values.CS === 4)`);
    assert.equal(await text('.sc-equation'), 'VOUTVIN=CSCFz−11−z−1');
    // The Bode graph's own actions: Annotate graph puts the graph on the
    // drawing, and with phase its phase as a plot of its own.
    const plots = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].filter((l) => l.kind === 'box' && l.plot).map((l) => l.plot.quantity || 'magnitude').sort())`);
    const before = (await plots()).length;
    await h.evaluate(`document.querySelector('.sc-plots-view .bode-phase-toggle input').click()`);
    await h.evaluate(`document.querySelector('.sc-plots-view .bode-annotate-graph').click()`);
    await h.until(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].filter((l) => l.kind === 'box' && l.plot).length === ${before + 2})`);
    assert.deepEqual(await plots(), ['magnitude', 'phase']);
    await h.key('z', { ctrlKey: true });
    await h.key('z', { ctrlKey: true });
    await h.evaluate(`document.querySelector('.sc-plots-view .bode-phase-toggle input').click()`);
  });

  test('a port of any kind, or any net, can be the input or the output', async () => {
    await openWindow();
    const options = (id) => h.evaluate(`[...document.querySelectorAll('#${id} optgroup')].map((g) => g.label + ': ' + [...g.querySelectorAll('option')].map((o) => o.textContent).join(', '))`);
    const output = await options('sc-output');
    assert.match(output[0], /^Ports: VOUT/);
    assert.match(output[1], /^Nets: /);
    // The virtual-ground net as the output: an integrator's input node stays
    // at ground, so H is 0 there.
    const net = await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.netOfTerminal({ comp: 'U1', term: 'im' }).id)`);
    await h.evaluate(`(() => { const s = document.getElementById('sc-output'); s.value = ${JSON.stringify(net)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await h.evaluate(`document.querySelector('.sc-derive').click()`);
    await h.until(`/=0$/.test(document.querySelector('.sc-equation')?.textContent || '')`);
    await h.evaluate(`(() => { const s = document.getElementById('sc-output'); s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  });

  test('a finite-gain op-amp: its gain in the equation, a Values row from 1 to 10^6 starting at 60 dB', async () => {
    await h.open('integrator');
    await openWindow();
    await h.evaluate(`${h.module('editor-state.js')}.then((m) => { m.editor.circuit.components.get('U1').analysis.model = 'finite-gain'; })`);
    await h.evaluate(`document.querySelector('.sc-derive').click()`);
    await h.until(`/A1/.test(document.querySelector('.sc-equation')?.textContent || '')`);
    const row = await h.evaluate(`(() => { const r = document.querySelector('.sc-values .signal-flow-coefficient[data-name="A1"]'); const s = r.querySelector('input[type="range"]'); return { value: r.querySelector('.signal-flow-coefficient-value').value, min: s.min, max: s.max }; })()`);
    assert.equal(row.value, '1000');
    assert.equal(Number(row.min), 0);
    assert.ok(Number(row.max) > 0, JSON.stringify(row));
    assert.equal(await h.evaluate(`document.querySelector('.sc-values legend').textContent`), 'Values');
    await h.evaluate(`${h.module('editor-state.js')}.then((m) => { m.editor.circuit.components.get('U1').analysis.model = undefined; })`);
  });

  test('the graph\'s legend names each trace by its ratio, not its whole equation', async () => {
    await h.open('integrator');
    await openWindow();
    await h.evaluate(`document.querySelector('.sc-derive').click()`);
    await h.until(`document.querySelectorAll('.sc-legend .signal-flow-legend-row').length > 0`);
    assert.deepEqual(await h.evaluate(`[...document.querySelectorAll('.sc-legend .signal-flow-legend-math')].map((m) => m.textContent)`), ['VOUTVIN']);
  });

  test('kT/C noise: off until asked, then a row per sampling, and the calculator\'s numbers, saved with the design', async () => {
    await h.open('integrator');
    await openWindow();
    await h.evaluate(`document.querySelector('.sc-derive').click()`);
    await h.until(`!!document.querySelector('.sc-equation')`);
    assert.equal(await h.evaluate(`!!document.querySelector('.sc-noise-result table')`), false, 'no noise unless asked');
    assert.equal(await h.evaluate(`document.querySelector('.sc-calc').hidden`), true);
    // Checking it works the noise out at once, and with each Derive after.
    await h.evaluate(`document.getElementById('sc-noise-on').click()`);
    await h.until(`!!document.querySelector('.sc-noise-result table')`, 10000);
    const rows = await h.evaluate(`[...document.querySelectorAll('.sc-noise-result tbody tr')].map((tr) => [tr.dataset.components || '', tr.firstChild.textContent])`);
    assert.deepEqual(rows, [['S1 S3 CS', 'S1, S3'], ['S2 S4 CS', 'S2, S4'], ['', 'Total']]);
    // The calculator: 1 pF at 27 °C samples sqrt(kT/C) = 64.37 µV; two such.
    await h.until(`!!document.querySelector('.sc-calc-result table')`, 10000);
    const cells = () => h.evaluate(`[...document.querySelectorAll('.sc-calc-result tbody tr')].map((tr) => [...tr.querySelectorAll('.sc-noise-value')].map((td) => td.textContent).join(' | '))`);
    assert.deepEqual(await cells(), ['64.37 µV | 91.04 nV/√Hz', '64.37 µV | 91.04 nV/√Hz', '91.04 µV | 128.7 nV/√Hz']);
    // A value typed in applies on Enter, not while it is typed; the field
    // keeps its focus. It moves the numbers, and is the design's.
    const field = `document.querySelectorAll('.sc-calc-field')[1]`;
    await h.evaluate(`(() => { const i = ${field}; i.focus(); i.value = '4p'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await h.settle();
    assert.equal(await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.analysisValues.sc.calc.values.CS ?? null)`), null, 'not while typing');
    await h.evaluate(`${field}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`);
    await h.until(`document.querySelector('.sc-calc-result tbody tr .sc-noise-value')?.textContent === '32.19 µV'`, 10000);
    assert.equal(await h.evaluate(`document.activeElement === ${field}`), true);
    assert.equal(await h.evaluate(`!!document.querySelector('.sc-equation')`), true, 'Enter in a field applies it, no Derive');
    const saved = await h.evaluate(`${h.module('editor-state.js')}.then((m) => JSON.stringify({ noise: m.editor.circuit.analysisValues.sc.noise, calc: m.editor.circuit.analysisValues.sc.calc }))`);
    assert.deepEqual(JSON.parse(saved), { noise: true, calc: { values: { CS: '4p' } } });
  });

  test('the equation and the noise are tables on the drawing, each rewritten in place when annotated again', async () => {
    const figures = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].filter((l) => l.figure).map((l) => ({ kind: l.figure.kind, source: l.figure.source, text: l.text, x: l.bbox().x, y: l.bbox().y })))`);
    await annotate('Equations');
    await h.until(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].some((l) => l.figure?.kind === 'equations'))`);
    await h.until(`!document.querySelector('.sc-calc-annotate').disabled`);
    await h.evaluate(`document.querySelector('.sc-calc-annotate').click()`);
    await h.until(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].some((l) => l.figure?.kind === 'noise'))`);
    const [equations, noise] = await figures();
    assert.equal(equations.source, 'switched-cap');
    assert.match(equations.text, /\\text\{Transfer function\} & /);
    assert.match(equations.text, /\\text\{kT\/C noise\} & /);
    assert.match(noise.text, /\\text\{Switches\} & \\text\{Capacitors\} & \\text\{Phase\} & \\text\{RMS\} & \\text\{Density\}/);
    // The capacitors as the drawing names them: C_{S}, not CS.
    assert.match(noise.text, /\\text\{S1, S3\} & C_\{S\} & /);
    assert.match(noise.text, /\\text\{Total\} &\s+&\s+& \\text\{45\.52 µV\}/);
    // Packed with the rest: clear of the circuit and of each other.
    await h.until(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].filter((l) => l.figure).every((l) => l.textMeasured()))`);
    await h.settle();
    const rects = await h.evaluate(`import(new URL('../core/figures.js', document.querySelector('script[src="main.js"]').src).href).then(async (f) => { const m = await ${h.module('editor-state.js')}; const c = m.editor.circuit; return [f.coreBounds(c), ...f.listFigures(c).map((g) => f.figureBounds(c, g))]; })`);
    const apart = (a, b) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
    rects.forEach((a, i) => rects.slice(i + 1).forEach((b) => assert.ok(apart(a, b), JSON.stringify({ a, b }))));
    // A new number, annotated again: the same table, rewritten.
    await h.evaluate(`(() => { const i = document.querySelectorAll('.sc-calc-field')[2]; i.value = '127'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await h.until(`document.querySelector('.sc-calc-result tbody tr .sc-noise-value')?.textContent !== '32.19 µV'`, 10000);
    await h.evaluate(`document.querySelector('.sc-calc-annotate').click()`);
    await h.until(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].some((l) => l.figure?.kind === 'noise' && l.text.includes('127 °C')))`);
    assert.equal((await figures()).length, 2);
  });

  test('the calculator\'s capacitances go to the sizing table and come back from it', async () => {
    const part = (refdes) => h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.get(${JSON.stringify(refdes)}).value ?? null)`);
    assert.equal(await h.evaluate(`document.querySelector('.sc-calc-sizing').hidden`), false);
    await h.evaluate(`document.querySelector('.sc-calc-write').click()`);
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.get('CS').value === '4p')`);
    assert.equal(await part('CF'), '1p', 'an empty field is its default');
    // Still each part's own symbol: the equation reads the same.
    await h.evaluate(`document.querySelector('.sc-derive').click()`);
    await h.until(`document.querySelector('.sc-equation')?.textContent === 'VOUTVIN=CSCF1−z−1'`);
    // A value set in the sizing table comes back into the field.
    await h.evaluate(`window.__run('value CF 2.2pF')`);
    await h.evaluate(`document.querySelector('.sc-calc-read').click()`);
    await h.until(`document.querySelectorAll('.sc-calc-field')[0].value === '2.2p'`);
    assert.equal(await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.analysisValues.sc.calc.values.CF)`), '2.2p');
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
