/** The small-signal analysis window in a browser: its controls, a derive,
 *  annotating, the form saved per design, the full-size figure, and the
 *  context menu's per-device attributes. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, sleep, browserSkip } from './harness.js';
import { amplifier, millerBuffer } from './fixtures.js';

describe('small-signal analysis', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { amp: amplifier(), other: amplifier(), miller: millerBuffer() }, width: 1500, height: 950 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const value = (id) => h.evaluate(`document.getElementById(${JSON.stringify(id)}).value`);
  const checked = (id) => h.evaluate(`document.getElementById(${JSON.stringify(id)}).checked`);
  const select = (id, text) => h.evaluate(`(() => { const s = document.getElementById(${JSON.stringify(id)}); const o = [...s.options].find((o) => o.textContent.startsWith(${JSON.stringify(text)})); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const derive = async () => { await h.click('#analysis-submit'); await sleep(400); };
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

  test('annotating writes the equations under the drawing, left-aligned, its assumptions with them', async () => {
    const before = await h.evaluate(`${h.module('editor-state.js')}.then((m) => { const b = m.editor.circuit.bounds(); return { bottom: b.y + b.h, labels: m.editor.circuit.labels.size }; })`);
    await h.click('#analysis-annotate');
    await sleep(300);
    const added = await h.evaluate(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].slice(${before.labels}).map((l) => ({ text: l.text, align: l.align, y: l.bbox().y })))`);
    assert.ok(added.length >= 2);
    assert.ok(added.every((label) => label.align === 'left' && label.y >= before.bottom), JSON.stringify(added));
    const assumptions = added.find((label) => /Assumptions/.test(label.text));
    assert.ok(assumptions && /g_\{m\}r_\{o\}/.test(assumptions.text), JSON.stringify(added.map((l) => l.text)));
    await h.key('u');
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

  test('the full-size figure closes on Escape, handing the keyboard back to the drawing', async () => {
    await derive();
    await h.click('#analysis-tab-model');
    await h.until(`!document.getElementById('analysis-model-open').disabled`);
    await h.click('#analysis-model-open');
    await h.until(`document.getElementById('model-dialog').open`, 20000);
    // A view over the one drawing: the wheel zooms it, a double-click fits it again.
    const viewBox = () => h.evaluate(`document.querySelector('#model-dialog-figure svg').getAttribute('viewBox')`);
    const fitted = await viewBox();
    await h.evaluate(`(() => { const f = document.getElementById('model-dialog-figure'); const r = f.getBoundingClientRect(); f.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, bubbles: true, cancelable: true })); })()`);
    assert.notEqual(await viewBox(), fitted);
    await h.evaluate(`(() => { const f = document.getElementById('model-dialog-figure'); const r = f.getBoundingClientRect(); f.dispatchEvent(new MouseEvent('dblclick', { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, bubbles: true })); })()`);
    assert.equal(await viewBox(), fitted);
    await h.evaluate(`document.getElementById('model-dialog').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await h.until(`!document.getElementById('model-dialog').open`);
    assert.equal(await h.evaluate(`document.activeElement?.id`), 'canvas');
    assert.equal(await h.evaluate(`document.getElementById('analysis-dialog').hidden`), false, 'the analysis window stays');
    await h.click('#analysis-tab-equations');
  });

  test('a device attribute set from the context menu applies to every selected transistor and shows as chosen', async () => {
    await h.evaluate(`window.__run('add nmos M2 --at 800 0')`);
    await h.evaluate(`${h.module('main.js')}.then((m) => { m.setSelection(['M1', 'M2']); m.render(); })`);
    const p = await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.worldToClient(-20, 0))`);
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
    await h.mouse('mousePressed', p.x, p.y, { button: 'right' });
    await h.mouse('mouseReleased', p.x, p.y, { button: 'right' });
    await h.until(`!document.querySelector('.component-context-menu').hidden`);
    const press = (text) => h.evaluate(`[...document.querySelectorAll('.component-context-menu button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)})).click()`);
    await press('Small-signal attributes');
    await press('Output resistance');
    await press('Ignore channel-length modulation');
    await sleep(100);
    const models = await h.evaluate(`${h.module('editor-state.js')}.then((m) => ['M1', 'M2'].map((r) => m.editor.circuit.components.get(r).analysis.channelLengthModulation))`);
    assert.deepEqual(models, ['ignore', 'ignore']);
    await h.mouse('mousePressed', p.x, p.y, { button: 'right' });
    await h.mouse('mouseReleased', p.x, p.y, { button: 'right' });
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
      await h.mouse('mousePressed', p.x, p.y, { button: 'right' });
      await h.mouse('mouseReleased', p.x, p.y, { button: 'right' });
      await h.until(`!document.querySelector('.component-context-menu').hidden`);
    };
    const press = (text) => h.evaluate(`[...document.querySelectorAll('.component-context-menu button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)})).click()`);
    const resistance = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.get('D9').analysis?.resistance ?? null)`);
    await menu();
    await press('Small-signal attributes');
    await press('Diode bias');
    await press('Off (open)');
    await sleep(100);
    assert.equal(await resistance(), 'infinite');
    await menu();
    await press('Small-signal attributes');
    await press('Diode bias');
    assert.equal(await h.evaluate(`[...document.querySelectorAll('.component-context-menu button')].find((b) => b.textContent.trim().startsWith('Off (open)')).getAttribute('aria-checked')`), 'true');
    await press('Forward biased');
    await sleep(100);
    assert.equal(await resistance(), null);
  });

  test('the Bode tab plots in numbers: a two-stage amplifier\'s supply rejection, too large to derive, still plots', async () => {
    await h.open('miller');
    if (await h.evaluate(`document.getElementById('analysis-dialog').hidden`)) await h.click('#btn-analysis');
    await h.until(`!document.getElementById('analysis-dialog').hidden`);
    const pick = (id, text) => h.evaluate(`(() => { const s = document.getElementById(${JSON.stringify(id)}); const o = [...s.options].find((o) => o.textContent.replace(/[_{}]/g, '').startsWith(${JSON.stringify(text)})); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); return o.value; })()`);
    await pick('analysis-input', 'VDD');
    await pick('analysis-target', 'OUT');
    await h.evaluate(`(() => { const f = document.getElementById('analysis-ac-grounds'); f.value = 'VB'; f.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    if (!await checked('analysis-parasitics')) await h.click('#analysis-parasitics');
    await h.click('#analysis-submit');
    await h.until(`!document.getElementById('analysis-result').hidden && !document.getElementById('analysis-tab-bode').disabled`, 60000);
    // The equations are out of reach; the plot is not.
    assert.match(await h.evaluate(`document.getElementById('analysis-equation').textContent`), /budget|too large/i);
    await h.click('#analysis-tab-bode');
    await h.until(`!!document.querySelector('#analysis-panel-bode .bode-figure-host svg path')`, 60000);
    assert.match(await h.evaluate(`document.querySelector('#analysis-panel-bode .bode-how').textContent`), /Solved in numbers/);
    const quantities = await h.evaluate(`[...document.querySelectorAll('#analysis-panel-bode .bode-head select option')].map((o) => o.textContent)`);
    assert.ok(quantities.includes('Voltage gain') && quantities.includes('Output impedance'), quantities.join('|'));
    // A slider for every parameter the ports reach, each moving the curve.
    const sliders = await h.evaluate(`document.querySelectorAll('#analysis-panel-bode .bode-sliders input[type=range]').length`);
    assert.ok(sliders > 10, `${sliders} sliders`);
    const corners = () => h.evaluate(`document.querySelector('#analysis-panel-bode .bode-corners').textContent`);
    const before = await corners();
    await h.evaluate(`(() => { const input = [...document.querySelectorAll('#analysis-panel-bode .bode-sliders input[type=range]')].find((i) => i.getAttribute('aria-label') === 'CC'); input.value = String(Number(input.value) + 24); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    assert.notEqual(await corners(), before, 'moving C_C moves the corners');
  });

  test('a Bode slider dragged stays under the pointer: the plot is redrawn in place, the form is not rebuilt', async () => {
    // The tab is as the last test left it: the Miller buffer's many sliders.
    const sliders = `[...document.querySelectorAll('#analysis-panel-bode .bode-sliders input[type=range]')]`;
    await h.evaluate(`${sliders}.at(-1).scrollIntoView({ block: 'start' })`);
    await sleep(200);
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
      await sleep(40);
      assert.deepEqual(await where(), before, `step ${k}`);
    }
    await h.mouse('mouseReleased', hit.x + 64, hit.y);
    assert.notEqual(await h.evaluate(`${sliders}[${hit.i}].value`), start, 'the drag moved the slider');
    assert.equal(await h.evaluate(`document.getElementById('analysis-input').options[1] === window.__option`), true, 'the form was not rebuilt');
  });
});
