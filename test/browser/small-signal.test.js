/** The small-signal analysis window in a browser: its controls, a derive,
 *  annotating, the form saved per design, the model window, and the
 *  context menu's per-device attributes. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, sleep, browserSkip } from './harness.js';
import { amplifier, millerBuffer } from './fixtures.js';
import { Circuit } from '../../src/core/model.js';
import { runCommand } from '../../src/core/commands.js';

/** The amplifier with a capacitor for its load. */
function loadedAmplifier() {
  const circuit = Circuit.fromJSON(amplifier());
  for (const line of ['add capacitor CL --at 400 120 --rot 90', 'connect CL.a M1.d', 'connect CL.b GND.gnd']) runCommand(circuit, line);
  return circuit.toJSON();
}

describe('small-signal analysis', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { amp: amplifier(), other: amplifier(), miller: millerBuffer(), loaded: loadedAmplifier() }, width: 1500, height: 950 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const value = (id) => h.evaluate(`document.getElementById(${JSON.stringify(id)}).value`);
  const checked = (id) => h.evaluate(`document.getElementById(${JSON.stringify(id)}).checked`);
  const select = (id, text) => h.evaluate(`(() => { const s = document.getElementById(${JSON.stringify(id)}); const o = [...s.options].find((o) => o.textContent.startsWith(${JSON.stringify(text)})); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  // Derive works as the click runs; what it draws follows in a frame or two.
  const derive = async () => { await h.click('#analysis-submit'); await h.settle(); };
  const status = () => h.evaluate(`[...document.querySelectorAll('#log > *')].map((n) => n.textContent).slice(-3).join(' | ')`);

  test('Analyze opens the window with the canonical controls and their defaults', async () => {
    await h.open('amp');
    await h.click('#btn-analysis');
    await h.until(`!document.getElementById('analysis-dialog').hidden`);
    assert.equal(await h.evaluate(`document.getElementById('btn-analysis').getAttribute('aria-pressed')`), 'true');
    assert.equal(await h.evaluate(`document.getElementById('analysis-dialog-title').textContent`), 'Small-signal analysis');
    const nets = await h.evaluate(`[...document.getElementById('analysis-input').options].map((o) => o.textContent)`);
    assert.ok(nets.some((n) => n.startsWith('VIN')) && nets.some((n) => n.startsWith('VOUT')), nets.join('|'));
    // Each node can be picked on the drawing; every AC ground is one list, with no separate reference.
    for (const field of ['analysis-input', 'analysis-target', 'analysis-ac-grounds']) assert.ok(await h.evaluate(`!!document.querySelector('[data-analysis-pick="${field}"]')`), field);
    assert.equal(await h.evaluate(`!!document.getElementById('analysis-reference')`), false);
    assert.deepEqual(await Promise.all(['analysis-approx-body', 'analysis-approx-ro', 'analysis-approx-miller', 'analysis-approx-gmro', 'analysis-approx-dominant-pole', 'analysis-tf-av'].map(checked)), [true, false, true, true, false, true]);
    // The two groups say what they change: the model, or the equation shown.
    const groups = await h.evaluate(`Object.fromEntries([...document.querySelectorAll('#analysis-dialog fieldset')].map((f) => [f.querySelector('legend')?.textContent, [...f.querySelectorAll('input[type=checkbox]')].map((i) => i.id)]))`);
    assert.ok(groups['Model simplifications'].includes('analysis-approx-miller'));
    assert.ok(groups['Equation approximations'].includes('analysis-approx-dominant-pole'));
    const tabs = await h.evaluate(`[...document.querySelectorAll('#analysis-dialog [role=tab]')].map((t) => t.id)`);
    for (const tab of ['analysis-tab-equations', 'analysis-tab-log', 'analysis-tab-netlist']) assert.ok(tabs.includes(tab), tab);
  });

  test('deriving without an input says so; with one, the equations and the netlist show', async () => {
    await h.evaluate(`(() => { const s = document.getElementById('analysis-input'); s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await derive();
    assert.match(await status(), /Select an input node before deriving equations/);
    await select('analysis-input', 'VIN');
    await select('analysis-target', 'VOUT');
    await derive();
    await h.until(`!document.getElementById('analysis-result').hidden && document.querySelectorAll('#analysis-equation .analysis-equation-row').length > 0`);
    await h.click('#analysis-tab-netlist');
    assert.match(await h.evaluate(`document.getElementById('analysis-netlist').textContent`), /M1/);
    await h.click('#analysis-tab-equations');
  });

  test('annotating writes the equations as a table right of the circuit, its assumptions under a rule; again, it is rewritten in place', async () => {
    const tables = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].filter((l) => l.figure?.kind === 'equations').map((l) => ({ text: l.text, x: l.bbox().x, y: l.bbox().y, source: l.figure.source, columns: l.columns })))`);
    const right = await h.evaluate(`${h.module('editor-state.js')}.then((m) => { const b = m.editor.circuit.bounds(); return b.x + b.w; })`);
    await h.click('#analysis-annotate');
    await h.until(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].some((l) => l.figure?.kind === 'equations'))`);
    const [table] = await tables();
    assert.equal(table.source, 'small-signal');
    assert.equal(table.columns, 'll');
    assert.ok(table.x >= right, `right of the circuit: ${table.x} >= ${right}`);
    assert.match(table.text, /\\text\{[^}]+\} & /);
    assert.match(table.text, /\\hline\n\\text\{Assumptions\} & g_\{m\}r_\{o\}/);
    // Drawn as a table: its cells in a grid.
    await h.until(`document.querySelectorAll('#canvas .schematic-math-table').length === 1`);
    // Settled where it was put, then annotated again: the one table, where it stands.
    await h.until(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].some((l) => l.figure?.kind === 'equations' && l.textMeasured()))`);
    await h.settle();
    const [placed] = await tables();
    await h.click('#analysis-annotate');
    await h.settle();
    const again = await tables();
    assert.equal(again.length, 1);
    assert.deepEqual([again[0].x, again[0].y], [placed.x, placed.y]);
    await h.key('u');
    await h.until(`${h.module('editor-state.js')}.then((m) => ![...m.editor.circuit.labels.values()].some((l) => l.figure?.kind === 'equations'))`);
  });

  test('the form is the design\'s own: another design shows its own, this one comes back as left, and neither is unsaved by it', async () => {
    await h.click('#analysis-approx-body');
    assert.equal(await checked('analysis-approx-body'), false);
    await derive(); // the form is kept when used
    assert.equal(await h.evaluate(`${h.module('document-session.js')}.then((m) => m.hasUnsavedChanges())`), false);
    await h.open('other');
    assert.equal(await checked('analysis-approx-body'), true);
    await h.open('amp');
    if (await h.evaluate(`document.getElementById('analysis-dialog').hidden`)) await h.click('#btn-analysis');
    await h.until(`!document.getElementById('analysis-dialog').hidden`);
    assert.equal(await checked('analysis-approx-body'), false);
    assert.match(await value('analysis-input'), /./);
    await h.click('#analysis-approx-body');
  });

  test('the model opens in a window that zooms like a reference window, Place puts it under the drawing, and placing again replaces it', async () => {
    await derive();
    // Model stands in the footer with Annotate equations.
    await h.until(`!document.getElementById('analysis-model-open').hidden`);
    assert.equal(await h.evaluate(`document.getElementById('analysis-model-open').parentElement === document.getElementById('analysis-annotate').parentElement`), true);
    await h.click('#analysis-model-open');
    const win = `document.querySelector('.model-window')`;
    const picture = () => h.evaluate(`${win}.querySelector('.reference-picture').style.cssText`);
    await h.until(`${win} && !${win}.hidden && !${win}.querySelector('.reference-picture').hidden`, 20000);
    assert.match(await h.evaluate(`${win}.querySelector('.reference-title').textContent`), /Small-signal model/);
    // The reference window's view: the wheel zooms it, a double-click fits it again.
    await h.settle();
    const fitted = await picture();
    const at = await h.evaluate(`(() => { const r = ${win}.querySelector('.reference-viewport').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await h.mouse('mouseMoved', at.x, at.y, { button: 'none', buttons: 0 });
    await h.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY: -300 });
    await h.until(`${win}.querySelector('.reference-picture').style.cssText !== ${JSON.stringify(fitted)}`);
    await h.mouse('mousePressed', at.x, at.y, { clickCount: 2 });
    await h.mouse('mouseReleased', at.x, at.y, { clickCount: 2 });
    await h.until(`${win}.querySelector('.reference-picture').style.cssText === ${JSON.stringify(fitted)}`);
    // Another derive redraws the same window; it is not saved with the design.
    await derive();
    assert.equal(await h.evaluate(`document.querySelectorAll('.model-window').length`), 1);
    assert.equal(await h.evaluate(`${h.module('document-session.js')}.then((m) => m.hasUnsavedChanges())`), false);

    const parts = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.components.values()].filter((c) => c.type !== 'solder').map((c) => ({ refdes: c.refdes, drawingOnly: c.drawingOnly, y: c.bboxWorld().y })))`);
    const before = await parts();
    const bottom = await h.evaluate(`${h.module('editor-state.js')}.then((m) => { const b = m.editor.circuit.bounds(); return b.y + b.h; })`);
    await h.evaluate(`${win}.querySelector('.model-place').click()`);
    await h.until(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.components.values()].filter((c) => c.type !== 'solder').length > ${before.length})`);
    const placed = (await parts()).filter((part) => !before.some((other) => other.refdes === part.refdes));
    assert.ok(placed.length >= 3);
    assert.ok(placed.every((part) => part.drawingOnly && part.y >= bottom), JSON.stringify(placed));
    // Drawing-only parts change no equation: the result is not marked stale,
    // and a derive reads the design as before.
    await h.settle();
    assert.equal(await h.evaluate(`document.getElementById('analysis-stale').hidden`), true);
    await derive();
    assert.equal(await h.evaluate(`document.getElementById('analysis-result').hidden`), false);
    // Placed again, it replaces the one there: no more parts.
    const count = (await parts()).length;
    await h.evaluate(`${win}.querySelector('.model-place').click()`);
    await h.settle();
    assert.equal((await parts()).length, count);
    // An undo each takes the replacement, then the model, away.
    await h.key('u');
    await h.settle();
    await h.key('u');
    await h.until(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.components.values()].filter((c) => c.type !== 'solder').length === ${before.length})`);
    await h.evaluate(`${win}.querySelector('.floating-window-close').click()`);
    await h.until(`!document.querySelector('.model-window')`);
    await h.click('#analysis-tab-equations');
  });

  test('a device attribute set from the context menu applies to every selected transistor and shows as chosen', async () => {
    await h.evaluate(`window.__run('add nmos M2 --at 800 0')`);
    await h.evaluate(`${h.module('main.js')}.then((m) => { m.setSelection(['M1', 'M2']); m.render(); })`);
    // The view shifts to take in M2 after the add: aim once it holds still,
    // or the click lands on what moved under it (M1's label, say).
    const view = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => JSON.stringify(m.editor.view))`);
    for (let last = null, now = await view(); now !== last; last = now, now = (await h.settle(), await view()));
    // A grid point inside M1's body: the pick snaps to the grid, and a point
    // midway between two grid lines can round onto M1's label box.
    const p = await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.worldToClient(-80, -40))`);
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
    await h.tap(p.x, p.y, { button: 'right' });
    await h.until(`!document.querySelector('.component-context-menu').hidden`);
    const press = (text) => h.evaluate(`[...document.querySelectorAll('.component-context-menu button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)})).click()`);
    await press('Small-signal attributes');
    await press('Output resistance');
    await press('Ignore channel-length modulation');
    await h.settle();
    const models = await h.evaluate(`${h.module('editor-state.js')}.then((m) => ['M1', 'M2'].map((r) => m.editor.circuit.components.get(r).analysis.channelLengthModulation))`);
    assert.deepEqual(models, ['ignore', 'ignore']);
    await h.tap(p.x, p.y, { button: 'right' });
    await h.until(`!document.querySelector('.component-context-menu').hidden`);
    await press('Small-signal attributes');
    await press('Output resistance');
    assert.equal(await h.evaluate(`[...document.querySelectorAll('.component-context-menu button')].find((b) => b.textContent.trim().startsWith('Ignore channel-length')).getAttribute('aria-checked')`), 'true');
    await h.key('Escape');
  });

  test('a diode can be marked off from its context menu, and back to forward biased', async () => {
    // The analysis window floats over the drawing: closed, the diode is in reach.
    await h.evaluate(`document.querySelector('.analysis-dock .floating-window-close')?.click()`);
    await h.evaluate(`window.__run('add diode D9 --at 800 600')`);
    await h.evaluate(`${h.module('main.js')}.then((m) => { m.setSelection(['D9']); m.render(); })`);
    await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.fitView())`);
    const p = await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.worldToClient(800, 600))`);
    const menu = async () => {
      await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
      await h.tap(p.x, p.y, { button: 'right' });
      await h.until(`!document.querySelector('.component-context-menu').hidden`);
    };
    const press = (text) => h.evaluate(`[...document.querySelectorAll('.component-context-menu button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)})).click()`);
    const resistance = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.get('D9').analysis?.resistance ?? null)`);
    await menu();
    await press('Small-signal attributes');
    await press('Diode bias');
    await press('Off (open)');
    await h.settle();
    assert.equal(await resistance(), 'infinite');
    await menu();
    await press('Small-signal attributes');
    await press('Diode bias');
    assert.equal(await h.evaluate(`[...document.querySelectorAll('.component-context-menu button')].find((b) => b.textContent.trim().startsWith('Off (open)')).getAttribute('aria-checked')`), 'true');
    await press('Forward biased');
    await h.settle();
    assert.equal(await resistance(), null);
  });

  const bode = () => h.evaluate(`${h.module('bode-ui.js')}.then((m) => m.bodeSnapshot())`);
  const pick = (id, text) => h.evaluate(`(() => { const s = document.getElementById(${JSON.stringify(id)}); const o = [...s.options].find((o) => o.textContent.replace(/[_{}]/g, '').startsWith(${JSON.stringify(text)})); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); return o.value; })()`);
  const shown = (selector) => h.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); return !!e && !e.hidden && !!e.offsetParent; })()`);
  const plotsButton = (text) => h.evaluate(`(() => { const b = [...document.querySelectorAll('.plots-window button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)})); if (!b) return false; b.click(); return true; })()`);

  test('the analysis window reads as signal flow\'s: signals, folded options, results, plots, values; Plots, Model, Annotate equations, and Derive', async () => {
    await h.open('amp');
    if (await h.evaluate(`document.getElementById('analysis-dialog').hidden`)) await h.click('#btn-analysis');
    await h.until(`!document.getElementById('analysis-dialog').hidden`);
    const order = await h.evaluate(`[...document.querySelector('#analysis-dialog .analysis-scroll').children].filter((e) => !e.classList.contains('analysis-mode-hidden') && !e.classList.contains('signal-flow-section')).map((e) => e.id || e.className.split(' ')[0])`);
    const at = (name) => order.findIndex((entry) => entry.includes(name));
    assert.ok(at('analysis-signals') < at('analysis-options') && at('analysis-options') < at('analysis-result') && at('analysis-result') < at('analysis-values'), order.join(' | '));
    assert.equal(await h.evaluate(`document.getElementById('analysis-options').open`), false, 'the options fold away');
    assert.deepEqual(await h.evaluate(`[...document.querySelectorAll('#analysis-form > .dialog-actions > button:not(.analysis-mode-hidden)')].map((b) => b.textContent.trim())`), ['Plots', 'Model', 'Annotate equations', 'Derive']);
    // Every mode's footer is the same: Plots first, Derive last.
    const footer = () => h.evaluate(`[...document.querySelectorAll('#analysis-form > .dialog-actions > button:not(.analysis-mode-hidden)')].map((b) => b.textContent.trim())`);
    for (const mode of ['signal-flow', 'switched-cap']) {
      await h.evaluate(`document.querySelector('#analysis-dialog [data-mode="${mode}"]').click()`);
      const buttons = await footer();
      assert.equal(buttons[0], 'Plots', `${mode}: ${buttons.join(' | ')}`);
      assert.equal(buttons.at(-1), 'Derive', `${mode}: ${buttons.join(' | ')}`);
      assert.ok(!buttons.includes('Model'), `${mode}: ${buttons.join(' | ')}`);
    }
    await h.evaluate(`document.querySelector('#analysis-dialog [data-mode="circuit"]').click()`);
    // Folded, the options still say what is chosen that is not the default.
    const summary = () => h.evaluate(`document.getElementById('analysis-options-summary').textContent`);
    const before = await summary();
    assert.doesNotMatch(before, /C_gs/);
    await h.evaluate(`document.querySelector('#analysis-options > summary').click()`);
    await h.click('#analysis-parasitics');
    assert.match(await summary(), /C_gs, C_gd/);
    await h.click('#analysis-parasitics');
    assert.equal(await summary(), before);
    // The Bode tab is gone: the plots are in the Plots window.
    assert.equal(await h.evaluate(`!!document.getElementById('analysis-tab-bode')`), false);
  });

  test('the Plots window draws the gain in numbers: a two-stage amplifier too large to derive still plots', async () => {
    await h.open('miller');
    if (await h.evaluate(`document.getElementById('analysis-dialog').hidden`)) await h.click('#btn-analysis');
    await h.until(`!document.getElementById('analysis-dialog').hidden`);
    await pick('analysis-input', 'VDD');
    await pick('analysis-target', 'OUT');
    await h.evaluate(`(() => { const f = document.getElementById('analysis-ac-grounds'); f.value = 'VB'; f.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await h.evaluate(`document.getElementById('analysis-options').open = true`);
    if (!await checked('analysis-parasitics')) await h.click('#analysis-parasitics');
    await h.click('#analysis-submit');
    await h.until(`!document.getElementById('analysis-result').hidden && !document.querySelector('.plots-window')?.hidden`, 60000);
    // The equations are out of reach; the plot is not.
    assert.match(await h.evaluate(`document.getElementById('analysis-equation').textContent`), /budget|too large/i);
    await h.until(`!!document.querySelector('.plots-window .bode-plots-graph svg path')`, 60000);
    assert.deepEqual((await bode()).traces.map((t) => t.label), ['\\frac{OUT}{V_{DD}}']);
    assert.match(await h.evaluate(`document.querySelector('#analysis-values .field-hint').textContent`), /exact model/);
    // A value for every parameter the ports reach, a slider and a field each.
    const rows = await h.evaluate(`document.querySelectorAll('#analysis-values .bode-value').length`);
    assert.ok(rows > 10, `${rows} values`);
    const corners = () => h.evaluate(`document.querySelector('.plots-window .bode-corners').textContent`);
    const before = await corners();
    // Typed: C_C twice as large.
    await h.evaluate(`(() => { const f = document.querySelector('#analysis-values .bode-value[data-name="CC"] .signal-flow-coefficient-value'); f.value = '2'; f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    assert.notEqual(await corners(), before, 'a typed value moves the corners');
    assert.equal((await bode()).values.multipliers.CC, 2);
    // Its slider follows the field.
    assert.equal(await h.evaluate(`document.querySelector('#analysis-values .bode-value[data-name="CC"] input[type=range]').value`), '7');
    await h.evaluate(`document.querySelector('#analysis-values .bode-values-actions button').click()`);
    assert.deepEqual((await bode()).values.multipliers, {});
  });

  test('each Derive adds its gain beside the others; the graph shows phase, takes other quantities, and goes on the drawing', async () => {
    // The same quantity again replaces itself; another input is another trace.
    await h.click('#analysis-submit');
    await h.until(`!document.getElementById('analysis-result').hidden`, 60000);
    assert.equal((await bode()).traces.length, 1);
    await h.evaluate(`document.getElementById('analysis-options').open = true`);
    if (await checked('analysis-parasitics')) await h.click('#analysis-parasitics');
    await pick('analysis-input', 'VINP');
    await h.click('#analysis-submit');
    await h.until(`${h.module('bode-ui.js')}.then((m) => m.bodeSnapshot().traces.length === 2)`, 60000);
    const [first, second] = (await bode()).traces;
    assert.notEqual(first.color, second.color);
    assert.equal(await h.evaluate(`document.querySelectorAll('.plots-window .bode-legend .signal-flow-legend-row').length`), 2);
    // Magnitude over phase, one frequency axis: only the phase numbers it,
    // and zooming the magnitude zooms the phase with it.
    const stack = () => h.evaluate(`[...document.querySelectorAll('.plots-window .bode-plots-graph .plot-view')].map((p) => ({ cls: p.className, text: p.textContent }))`);
    const [magnitude, phase] = await stack();
    assert.match(magnitude.cls, /bode-magnitude/);
    assert.match(magnitude.text, /\(dB\)/);
    assert.doesNotMatch(magnitude.text, /𝜔/);
    assert.match(phase.cls, /bode-phase/);
    assert.match(phase.text, /°/);
    assert.match(phase.text, /𝜔/);
    assert.doesNotMatch(magnitude.text + phase.text, /\\frac/, 'axis names are not raw TeX');
    const before = (await bode()).xRanges;
    assert.deepEqual(before[0], before[1]);
    await h.evaluate(`(() => { const p = document.querySelector('.plots-window .bode-magnitude'); const r = p.getBoundingClientRect(); p.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, ctrlKey: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, bubbles: true, cancelable: true })); })()`);
    await h.until(`${h.module('bode-ui.js')}.then((m) => { const [a, b] = m.bodeSnapshot().xRanges; return a[0] !== ${before[0][0]} && a[0] === b[0] && a[1] === b[1]; })`);
    // Another quantity of the last Derive: a switch, on and off and on again.
    const pressed = (text) => h.evaluate(`[...document.querySelectorAll('.plots-window .bode-add button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)}).getAttribute('aria-pressed')`);
    assert.equal(await pressed('Voltage gain'), 'true');
    assert.equal(await pressed('Output impedance'), 'false');
    assert.equal(await plotsButton('Output impedance'), true);
    assert.deepEqual((await bode()).traces.map((t) => t.key), ['transfer', 'transfer', 'output']);
    assert.equal(await pressed('Output impedance'), 'true');
    await plotsButton('Output impedance');
    assert.deepEqual((await bode()).traces.map((t) => t.key), ['transfer', 'transfer']);
    assert.equal(await pressed('Output impedance'), 'false');
    await plotsButton('Output impedance');
    assert.deepEqual((await bode()).traces.map((t) => t.key), ['transfer', 'transfer', 'output']);
    // One trace removed, one hidden: Place sketch draws the one left shown.
    await h.evaluate(`document.querySelectorAll('.plots-window .bode-legend .signal-flow-legend-remove')[2].click()`);
    await h.evaluate(`(() => { const c = document.querySelectorAll('.plots-window .bode-legend input[type=checkbox]')[1]; c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    const boxes = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].filter((l) => l.plot).map((l) => l.plot.kind || 'sketch'))`);
    const placed = (await boxes()).length;
    assert.equal(await plotsButton('Place sketch'), true);
    await h.until(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].filter((l) => l.plot).length === ${placed + 1})`);
    // Both shown: Annotate graph puts the two curves on the drawing, named.
    await h.evaluate(`(() => { const c = document.querySelectorAll('.plots-window .bode-legend input[type=checkbox]')[1]; c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    assert.equal(await plotsButton('Annotate graph'), true);
    await h.until(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].some((l) => l.plot?.kind === 'response' && l.plot.traces.length === 2))`);
    await plotsButton('Clear graph');
    assert.deepEqual((await bode()).traces, []);
    assert.equal(await shown('#analysis-values'), false);
  });

  test('a value slider dragged stays under the pointer while the plots follow, and the form is not rebuilt', async () => {
    await h.click('#analysis-submit');
    await h.until(`${h.module('bode-ui.js')}.then((m) => m.bodeSnapshot().traces.length === 1)`, 60000);
    // The plots aside: the analysis window is in reach.
    if (await shown('.plots-window')) await h.key('W', { shiftKey: true });
    const sliders = `[...document.querySelectorAll('#analysis-values .bode-value input[type=range]')]`;
    await h.evaluate(`${sliders}.at(-1).scrollIntoView({ block: 'center' })`);
    await h.settle();
    // A slider the pointer can reach (the log covers the window's foot).
    const hit = await h.evaluate(`(() => { for (const [i, input] of ${sliders}.entries()) { const r = input.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2; if (document.elementFromPoint(x, y) === input) return { i, x, y }; } return null; })()`);
    assert.ok(hit, 'a slider in reach');
    const scrolls = `[...document.querySelectorAll('#analysis-dialog, #analysis-dialog *')].filter((e) => e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY)).map((e) => Math.round(e.scrollTop)).join(',')`;
    const where = () => h.evaluate(`({ scrolls: ${scrolls}, y: Math.round(${sliders}[${hit.i}].getBoundingClientRect().y) })`);
    await h.evaluate(`window.__option = document.getElementById('analysis-input').options[1]`);
    const before = await where();
    const start = await h.evaluate(`${sliders}[${hit.i}].value`);
    await h.mouse('mouseMoved', hit.x, hit.y, { button: 'none', buttons: 0 });
    await h.mouse('mousePressed', hit.x, hit.y);
    for (let k = 1; k <= 8; k++) {
      await h.mouse('mouseMoved', hit.x + k * 8, hit.y, { buttons: 1 });
      await h.settle();
      assert.deepEqual(await where(), before, `step ${k}`);
    }
    await h.mouse('mouseReleased', hit.x + 64, hit.y);
    assert.notEqual(await h.evaluate(`${sliders}[${hit.i}].value`), start, 'the drag moved the slider');
    assert.equal(await h.evaluate(`document.getElementById('analysis-input').options[1] === window.__option`), true, 'the form was not rebuilt');
    // One undo takes the whole drag back.
    const values = (await bode()).values;
    assert.ok(Object.keys(values.multipliers).length || values.intrinsicGain !== 30);
    await h.key('u');
    await h.settle();
    const undone = (await bode()).values;
    assert.deepEqual(undone.multipliers, {});
    assert.equal(undone.intrinsicGain, 30);
  });
  test('the poles\' time constants list on request, under their own heading, and the choice is saved', async () => {
    await h.open('loaded');
    if (await h.evaluate(`document.getElementById('analysis-dialog').hidden`)) await h.click('#btn-analysis');
    await h.until(`!document.getElementById('analysis-dialog').hidden`);
    await select('analysis-input', 'VIN');
    await select('analysis-target', 'VOUT');
    assert.equal(await checked('analysis-time-constants'), false, 'off by default');
    await h.evaluate(`(() => { const box = document.getElementById('analysis-time-constants'); box.checked = true; box.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await derive();
    await h.until(`[...document.querySelectorAll('#analysis-equation summary')].some((s) => /Time constants/.test(s.textContent))`);
    assert.match(await h.evaluate(`document.getElementById('analysis-equation').textContent`), /Sum of the time constants/i);
    assert.equal(await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.windows?.analysis?.options?.timeConstants)`), true, 'kept with the design');
    await h.open('amp');
    if (await h.evaluate(`document.getElementById('analysis-dialog').hidden`)) await h.click('#btn-analysis');
    await h.until(`!document.getElementById('analysis-dialog').hidden`);
    assert.equal(await checked('analysis-time-constants'), false, 'another design keeps its own form');
  });
});
