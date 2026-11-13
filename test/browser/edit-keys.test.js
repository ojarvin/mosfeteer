/** The editing keys in a browser: q sets one value on what is selected or
 *  pointed at, z changes a part's type, - flips a sum input's sign, p
 *  places named ports, and the placing tools stay armed until Esc. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, browserSkip } from './harness.js';
import { modulator } from './fixtures.js';
import { Circuit } from '../../src/core/model.js';
import { runCommand } from '../../src/core/commands.js';

/** R1, R2, R3 in series; the R1–R2 net A and the R2–R3 net B, each labeled. */
function labeled() {
  const circuit = new Circuit();
  for (const line of ['add resistor R1 --at 0 0', 'add resistor R2 --at 400 0', 'add resistor R3 --at 800 0', 'connect R1.b R2.a --name A', 'connect R2.b R3.a --name B']) runCommand(circuit, line);
  for (const net of [...circuit.nets.values()]) {
    const path = net.paths()[0];
    circuit.addNetLabel(net.id, { anchor: { x: (path[0].x + path.at(-1).x) / 2, y: (path[0].y + path.at(-1).y) / 2 } });
  }
  return circuit.toJSON();
}

describe('editing keys', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { labeled: labeled(), modulator: modulator() }, width: 1400, height: 900 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const ed = (expression) => h.evaluate(`${h.module('editor-state.js')}.then((m) => { const c = m.editor.circuit; const editor = m.editor; return ${expression}; })`);
  const untilEd = (expression) => h.until(`${h.module('editor-state.js')}.then((m) => { const c = m.editor.circuit; const editor = m.editor; return ${expression}; })`);
  const main = (expression) => h.evaluate(`${h.module('main.js')}.then((m) => { ${expression}; m.render(); })`);
  /** Room on screen for the points the tests click, below the parts. */
  const roomy = async () => {
    await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.zoomToWorldRect({ x0: -400, y0: -400, x1: 1400, y1: 1200 }))`);
    await untilEd(`editor.view.w > 1800`);
    await h.settle();
  };
  /** Point at, or click, the world point (x, y). */
  const point = async (x, y) => {
    const p = await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.worldToClient(${x}, ${y}))`);
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
    return p;
  };
  const click = async (x, y) => {
    const p = await point(x, y);
    await h.mouse('mousePressed', p.x, p.y);
    await h.mouse('mouseReleased', p.x, p.y);
    await h.settle();
  };
  /** Type `text` into the open prompt and press `key` there. */
  const answer = async (text, key = 'Enter') => {
    await h.until(`!!document.querySelector('.label-prompt input')`);
    await h.evaluate(`(() => { const input = document.querySelector('.label-prompt input'); input.value = ${JSON.stringify(text)}; input.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true })); })()`);
    await h.until(`!document.querySelector('.label-prompt') || document.querySelector('.label-prompt input').value !== ${JSON.stringify(text)}`);
  };
  const prompt = () => h.evaluate(`document.querySelector('.label-prompt input')?.value ?? null`);
  const dialog = async (text) => {
    await h.until(`document.querySelector('dialog[open]')?.textContent.includes(${JSON.stringify(text)})`);
    return h.evaluate(`document.querySelector('dialog[open]').textContent`);
  };
  const press = (pattern) => h.evaluate(`[...document.querySelectorAll('dialog[open] button')].find((b) => ${pattern}.test(b.textContent)).click()`);

  test('q sets one value on all the selected parts as one undo step; with nothing selected, on the part pointed at', async () => {
    await h.open('labeled');
    await main(`m.setSelection(['R1', 'R2'])`);
    await h.key('q');
    await h.until(`document.querySelector('.label-prompt')?.textContent.includes('Value (2)')`);
    await answer('10k');
    await untilEd(`[...c.components.values()].filter((p) => p.value === '10k').length === 2`);
    assert.equal(await ed(`c.components.get('R3').value`), '');
    await h.key('u');
    await untilEd(`[...c.components.values()].every((p) => p.value !== '10k')`);
    // Nothing selected: the part under the cursor.
    await main(`m.setSelection([])`);
    await point(800, 0);
    await h.key('q');
    await answer('2k');
    await untilEd(`c.components.get('R3')?.value === '2k'`);
    // Asked again, the field starts with its value.
    await h.key('q');
    await h.until(`!!document.querySelector('.label-prompt input')`);
    assert.equal(await prompt(), '2k');
    await answer('', 'Escape');
  });

  test('q names several net labels at once, asking first: it joins their nets and says what it shorts', async () => {
    await h.open('labeled');
    const ids = await ed(`[...c.labels.values()].filter((l) => l.netId).map((l) => l.id)`);
    await main(`m.setSelection([]); m.setLabelSelection(${JSON.stringify(ids)})`);
    await h.key('q');
    await h.until(`!!document.querySelector('.label-prompt input')`);
    assert.equal(await prompt(), '', 'two names: the field starts empty');
    await answer('C');
    assert.match(await dialog('Connect named nets?'), /these 2 nets C.*This shorts R2/s);
    await press(/Keep separate/);
    assert.deepEqual(await ed(`[...c.nets.values()].map((n) => n.name).sort()`), ['A', 'B']);
    await h.key('q');
    await answer('C');
    await dialog('Connect named nets?');
    await press(/Connect/);
    await untilEd(`[...c.nets.values()].every((n) => n.name === 'C')`);
  });

  test('q refuses one name for two parts, leaving both as they were', async () => {
    await h.open('labeled');
    const names = await ed(`['R1', 'R2'].map((r) => c.labelOf(r).id)`);
    await main(`m.setSelection([]); m.setLabelSelection(${JSON.stringify(names)})`);
    await h.key('q');
    await answer('RX');
    await h.until(`[...document.querySelectorAll('#log > *')].some((n) => /cannot share the name RX/.test(n.textContent))`);
    assert.deepEqual(await ed(`['R1', 'R2'].map((r) => c.components.has(r))`), [true, true]);
  });

  test('z changes the selected part\'s type, as q did', async () => {
    await h.open('labeled');
    await main(`m.setSelection(['R1'])`);
    await h.key('z');
    await untilEd(`!!editor.quickAdd?.swap`);
    // Escape where the picker's focus is closes it.
    await h.evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await untilEd(`!editor.quickAdd`);
  });

  test('- flips the sign of the sum input under the cursor, one undo step; an unwired input is left', async () => {
    await h.open('modulator');
    const negative = () => ed(`c.components.get('S1').negativeInputs.has('s')`);
    assert.equal(await negative(), true);
    await point(-1200, 40);
    await h.key('-');
    await untilEd(`!c.components.get('S1').negativeInputs.has('s')`);
    await h.key('-');
    assert.equal(await negative(), true);
    await h.key('u');
    assert.equal(await negative(), false);
    // S1's north input is not wired: no sign to flip.
    await point(-1200, -40);
    await h.key('-');
    assert.equal(await ed(`c.components.get('S1').negativeInputs.has('n')`), false);
  });

  test('p places ports by name, p while placing steps the kind, and once the names are used it asks for more', async () => {
    await h.open('labeled');
    await roomy();
    await h.key('p');
    await answer('VA VB');
    await untilEd(`editor.pendingPlace?.type === 'input'`);
    await h.key('p');
    assert.equal(await ed(`editor.pendingPlace.type`), 'output');
    await click(0, 800);
    await click(400, 800);
    const ports = await ed(`[...c.components.values()].filter((p) => p.type === 'output').map((p) => c.labelOf(p.refdes)?.text).sort()`);
    assert.deepEqual(ports, ['VA', 'VB']);
    // The names used: the next ones, or Esc to leave.
    await h.until(`!!document.querySelector('.label-prompt input')`);
    await answer('', 'Escape');
    assert.equal(await ed(`editor.mode`), 'normal');
  });

  test('the placing tools stay armed until Esc, and a press that closes a label\'s editor places nothing', async () => {
    await h.open('labeled');
    await roomy();
    const mode = () => ed(`editor.labelMode`);
    // Free text: each placed, the next asked for.
    await h.key('n');
    await answer('first');
    await click(0, 400);
    await untilEd(`[...c.labels.values()].some((l) => l.text === 'first')`);
    await h.until(`!!document.querySelector('.label-prompt input')`);
    assert.equal(await mode(), 'annotation');
    await answer('', 'Escape');
    assert.equal(await mode(), null);
    // A line, then still the line tool.
    await h.key('L');
    await click(0, 600);
    await click(400, 600);
    await h.key('Enter');
    await untilEd(`[...c.labels.values()].some((l) => l.kind === 'line')`);
    assert.equal(await mode(), 'line');
    await h.key('Escape');
    // An arrow opens its label's editor; a press then only closes it.
    await h.key('a');
    await click(0, 800);
    await click(400, 800);
    await h.key('Enter');
    await untilEd(`!!editor.inlineInput`);
    await click(800, 1000);
    assert.equal(await ed(`editor.annotationStart`), null);
    assert.equal(await mode(), 'arrow');
    await h.key('Escape');
  });
});
