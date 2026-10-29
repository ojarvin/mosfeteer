/** The analysis window's logic mode in a browser: suggested for a drawing
 *  of gates, its signals found before Derive, the truth table and the
 *  equations, both annotated, and a state table with a flip-flop. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, browserSkip } from './harness.js';
import { Circuit } from '../../src/core/model.js';
import { runCommand } from '../../src/core/commands.js';

function build(lines) {
  const circuit = new Circuit();
  for (const line of lines) runCommand(circuit, line);
  return circuit.toJSON();
}
const halfAdder = () => build([
  'add input A --at -400 -40', 'add input B --at -400 40', 'add xor2_gate U1 --at 0 -200', 'add and2_gate U2 --at 0 200',
  'add output S --at 400 -200', 'add output C --at 400 200',
  'connect A.p U1.a', 'connect B.p U1.b', 'connect A.p U2.a', 'connect B.p U2.b', 'connect U1.y S.p', 'connect U2.y C.p',
]);
const toggle = () => build([
  'add dff U1 --at 0 0', 'add xor2_gate U2 --at -600 -40', 'add input T --at -1000 -80', 'add input CLK --at -1000 200', 'add output Q --at 400 -40',
  'connect T.p U2.a', 'connect U2.y U1.D', 'connect U1.Q Q.p', 'connect U1.Q U2.b', 'connect CLK.p U1.CLK',
]);

const ripple = () => {
  const lines = ['add input CLK --at -400 40'];
  for (let i = 1; i <= 3; i++) lines.push(`add dff_qb U${i} --at ${(i - 1) * 600} 0`, `connect U${i}.QB U${i}.D`);
  return build([...lines, 'connect CLK.p U1.CLK', 'connect U1.Q U2.CLK', 'connect U2.Q U3.CLK']);
};
const gated = () => build([
  'add dff U1 --at 0 0', 'add and2_gate U2 --at -600 40', 'add input CLK --at -1000 0', 'add input EN --at -1000 80', 'add input D --at -400 -80',
  'connect CLK.p U2.a', 'connect EN.p U2.b', 'connect U2.y U1.CLK', 'connect D.p U1.D',
]);

describe('logic analysis', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { adder: halfAdder(), toggle: toggle(), ripple: ripple(), gated: gated() }, width: 1500, height: 950 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const openWindow = async () => {
    if (await h.evaluate(`document.getElementById('analysis-dialog').hidden`)) await h.key('S');
    await h.until(`!document.getElementById('analysis-dialog').hidden && !document.getElementById('analysis-logic').hidden`);
  };
  const annotate = async (label) => {
    await h.click('#analysis-annotate');
    await h.until(`[...document.querySelectorAll('#component-context-menu button')].some((b) => b.textContent.startsWith(${JSON.stringify(label)}) && !b.disabled)`);
    await h.evaluate(`[...document.querySelectorAll('#component-context-menu button')].find((b) => b.textContent.startsWith(${JSON.stringify(label)})).click()`);
  };
  const cells = () => h.evaluate(`[...document.querySelectorAll('.logic-table tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent).join(''))`);

  test('a drawing of gates opens the window in the logic mode, its signals listed; Derive gives the table and the equations', async () => {
    await h.open('adder');
    await openWindow();
    assert.equal(await h.evaluate(`document.getElementById('analysis-dialog-title').textContent`), 'Logic analysis');
    assert.deepEqual(await h.evaluate(`[...document.querySelectorAll('.logic-signal-row')].map((row) => row.textContent)`), ['InputsA, B', 'OutputsC, S']);
    await h.click('.logic-derive');
    await h.until(`document.querySelectorAll('.logic-table tbody tr').length === 4`);
    assert.deepEqual(await cells(), ['0000', '0101', '1001', '1110']);
    assert.equal(await h.evaluate(`document.querySelectorAll('.logic-expression math').length`), 2);
  });

  test('Annotate puts the truth table and the equations on the drawing, each once', async () => {
    await annotate('Table');
    await h.until(`window.__circuit().labels.some((l) => l.figure?.source === 'logic' && l.figure.kind === 'table')`);
    const tableLabel = await h.evaluate(`window.__circuit().labels.find((l) => l.figure?.source === 'logic' && l.figure.kind === 'table')`);
    assert.equal(tableLabel.text.split('\n').length, 6, 'names, a rule, four rows');
    await annotate('Equations');
    await h.until(`window.__circuit().labels.some((l) => l.figure?.source === 'logic' && l.figure.kind === 'equations')`);
    await annotate('Table');
    await h.settle();
    assert.equal(await h.evaluate(`window.__circuit().labels.filter((l) => l.figure?.source === 'logic').length`), 2);
  });

  test('a flip-flop makes a state table: the state on the left, its next state on the right, the clock named', async () => {
    await h.open('toggle');
    await openWindow();
    assert.deepEqual(await h.evaluate(`[...document.querySelectorAll('.logic-signal-row')].map((row) => row.textContent)`), ['InputsT', 'Outputsnone', 'StateQ', 'ClockCLK']);
    await h.click('.logic-derive');
    await h.until(`document.querySelector('.logic-title')?.textContent === 'State transition table'`);
    assert.deepEqual(await cells(), ['000', '011', '101', '110']);
    assert.match(await h.evaluate(`document.querySelector('.logic-results').textContent`), /rising edge of CLK/);
  });

  test('a ripple counter: a row is one period of the clock, the stages rippling', async () => {
    await h.open('ripple');
    await openWindow();
    await h.click('.logic-derive');
    await h.until(`document.querySelectorAll('.logic-table tbody tr').length === 8`);
    assert.match(await h.evaluate(`document.querySelector('.logic-results').textContent`), /After each period of CLK.*rippling through.*glitch-free/);
  });

  test('a gated clock leaves the clock open: picked in the window, and saved with the design', async () => {
    await h.open('gated');
    await openWindow();
    await h.until(`!!document.getElementById('logic-clock')`);
    assert.deepEqual(await h.evaluate(`[...document.querySelectorAll('#logic-clock option')].map((o) => o.value)`), ['', 'CLK', 'EN']);
    await h.evaluate(`(() => { const s = document.getElementById('logic-clock'); s.value = 'CLK'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    assert.equal(await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.toJSON().analysisValues?.logic?.clock)`), 'CLK');
    await h.click('.logic-derive');
    await h.until(`document.querySelectorAll('.logic-table tbody tr').length === 8`);
    assert.deepEqual(await h.evaluate(`[...document.querySelectorAll('.logic-signal-row')].map((row) => row.textContent)`), ['InputsD, EN', 'Outputsnone', 'StateU1.Q']);
  });
});
