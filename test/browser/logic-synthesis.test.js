/** The analysis window's synthesis mode in a browser: inputs and outputs
 *  named, the table set by clicks and keys, the equations as it fills, and
 *  Draw putting the gates and ports on the drawing; the table is kept with
 *  the design. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, browserSkip } from './harness.js';
import { Circuit } from '../../src/core/model.js';

describe('logic synthesis', { skip: browserSkip() }, () => {
  let h;
  before(async () => {
    h = await start({ docs: { empty: new Circuit().toJSON() }, width: 1500, height: 950 });
    await h.open('empty');
  });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const cellValues = (output = 0) => h.evaluate(`[...document.querySelectorAll('.synthesis-cell[data-output="${output}"]')].map((b) => b.dataset.value).join('')`);
  const setField = async (id, text) => {
    await h.evaluate(`(() => { const f = document.getElementById(${JSON.stringify(id)}); f.focus(); f.value = ${JSON.stringify(text)}; f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  };

  test('the mode starts with A and B in and Y out, all 0', async () => {
    await h.key('S');
    await h.until(`!document.getElementById('analysis-dialog').hidden`);
    await h.click('.analysis-mode [data-mode="synthesis"]');
    await h.until(`!document.getElementById('analysis-synthesis').hidden`);
    assert.equal(await h.evaluate(`document.getElementById('analysis-dialog-title').textContent`), 'Logic synthesis');
    assert.equal(await cellValues(), '0000');
    assert.match(await h.evaluate(`document.querySelector('.synthesis-results').textContent`), /Y\s*=\s*0/);
  });

  test('a click steps a cell, a key sets it and moves down; the equation follows', async () => {
    await h.click('.synthesis-cell[data-output="0"][data-row="1"]');
    assert.equal(await cellValues(), '0100');
    await h.evaluate(`(() => { const cell = document.querySelector('.synthesis-cell[data-output="0"][data-row="2"]'); cell.focus(); cell.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true })); })()`);
    assert.equal(await cellValues(), '0110');
    assert.equal(await h.evaluate(`document.activeElement.dataset.row`), '3');
    // A XOR B, a sum of two products with a complement in each.
    await h.until(`document.querySelectorAll('.synthesis-expression .mo, .synthesis-expression mo').length > 0`);
    assert.equal(await h.evaluate(`document.querySelectorAll('.synthesis-expression').length`), 1);
    assert.match(await h.evaluate(`document.querySelector('.synthesis-gates').textContent`), /2 inverters, 2 AND2, 1 OR2/);
  });

  test('another input keeps the table: each row takes the row with the same inputs', async () => {
    await setField('synthesis-inputs', 'A B, C');
    await h.until(`document.querySelectorAll('.synthesis-cell').length === 8`);
    assert.equal(await cellValues(), '00111100');
    await setField('synthesis-inputs', 'A B');
    await h.until(`document.querySelectorAll('.synthesis-cell').length === 4`);
    assert.equal(await cellValues(), '0110');
  });

  test('Draw puts the gates and ports on the drawing, read back as the table', async () => {
    await h.evaluate(`document.getElementById('synthesis-style').value = 'nand'; document.getElementById('synthesis-style').dispatchEvent(new Event('change'))`);
    await h.until(`/3 NAND2/.test(document.querySelector('.synthesis-gates').textContent)`);
    await h.click('#synthesis-draw');
    await h.until(`window.__circuit().comps.length > 5`);
    const types = await h.evaluate(`window.__circuit().comps.map((c) => c.type).sort().join(' ')`);
    assert.match(types, /input input/);
    assert.match(types, /nand2_gate nand2_gate nand2_gate/);
    assert.match(types, /output/);
    // The logic mode reads the drawing as the table that drew it.
    await h.click('.analysis-mode [data-mode="logic"]');
    await h.click('.logic-derive');
    await h.until(`document.querySelectorAll('#analysis-logic .logic-table tbody tr').length === 4`);
    assert.deepEqual(await h.evaluate(`[...document.querySelectorAll('#analysis-logic .logic-table tbody tr')].map((tr) => tr.lastChild.textContent)`), ['0', '1', '1', '0']);
    // Drawn again, the names are taken: refused, the drawing as it was.
    const before = await h.evaluate(`window.__circuit().comps.length`);
    await h.click('.analysis-mode [data-mode="synthesis"]');
    await h.click('#synthesis-draw');
    await h.until(`/already has a part named A/.test(document.body.textContent)`);
    assert.equal(await h.evaluate(`window.__circuit().comps.length`), before);
  });

  test('a bus is a column per bit, its range shown again; names by spaces', async () => {
    await setField('synthesis-outputs', 'Y T<1:0>');
    await h.until(`document.querySelectorAll('.synthesis-cell').length === 12`);
    assert.equal(await h.evaluate(`document.getElementById('synthesis-outputs').value`), 'Y T<1:0>');
    assert.deepEqual(await h.evaluate(`[...document.querySelectorAll('.synthesis-table thead th')].map((th) => th.textContent.replace(/\\s/g, ''))`), ['A', 'B', 'Y', 'T[1]', 'T[0]']);
    // Every heading centered over its column, the first too.
    assert.deepEqual(await h.evaluate(`[...new Set([...document.querySelectorAll('.synthesis-table thead th')].map((th) => getComputedStyle(th).textAlign))]`), ['center']);
    await setField('synthesis-outputs', 'Y');
    await h.until(`document.querySelectorAll('.synthesis-cell').length === 4`);
  });

  test('Annotate puts the truth table and the equations on the drawing, each once, the equations whole', async () => {
    const annotate = async (label) => {
      await h.click('#analysis-annotate');
      await h.until(`[...document.querySelectorAll('#component-context-menu button')].some((b) => b.textContent.startsWith(${JSON.stringify(label)}) && !b.disabled)`);
      await h.evaluate(`[...document.querySelectorAll('#component-context-menu button')].find((b) => b.textContent.startsWith(${JSON.stringify(label)})).click()`);
    };
    await annotate('Table');
    await h.until(`window.__circuit().labels.some((l) => l.figure?.source === 'synthesis' && l.figure.kind === 'table')`);
    const table = await h.evaluate(`window.__circuit().labels.find((l) => l.figure?.source === 'synthesis' && l.figure.kind === 'table').text`);
    assert.equal(table.split('\n').length, 6, 'names, a rule, four rows');
    await annotate('Equations');
    await h.until(`window.__circuit().labels.some((l) => l.figure?.source === 'synthesis' && l.figure.kind === 'equations')`);
    const equations = await h.evaluate(`window.__circuit().labels.find((l) => l.figure?.source === 'synthesis' && l.figure.kind === 'equations').text`);
    assert.doesNotMatch(equations, /&/, 'one column, as the other tools draw equations');
    await annotate('Table');
    await h.settle();
    assert.equal(await h.evaluate(`window.__circuit().labels.filter((l) => l.figure?.source === 'synthesis').length`), 2);
  });

  test('Z and – are kept with the design', async () => {
    await h.click('.synthesis-cell[data-output="0"][data-row="0"]');
    await h.click('.synthesis-cell[data-output="0"][data-row="0"]');
    await h.click('.synthesis-cell[data-output="0"][data-row="3"]');
    await h.click('.synthesis-cell[data-output="0"][data-row="3"]');
    await h.click('.synthesis-cell[data-output="0"][data-row="3"]');
    assert.equal(await cellValues(), 'Z11-');
    const saved = await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.analysisValues.synthesis)`);
    assert.deepEqual(saved.outputs, [{ name: 'Y', values: 'Z11-' }]);
    assert.equal(saved.style, 'nand');
    assert.match(await h.evaluate(`document.querySelector('.synthesis-results').textContent`), /driven when/);
  });
});
