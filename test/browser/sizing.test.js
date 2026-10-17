/** The sizing window in a browser: cells picked, typed into many at once,
 *  half a size kept until the other half comes, pasting one value or a
 *  spreadsheet column, one undo step per edit, and a parts table put on the
 *  drawing that follows the sizes. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../../src/core/model.js';
import { runCommand } from '../../src/core/commands.js';
import { start, browserSkip } from './harness.js';

function parts() {
  const circuit = new Circuit();
  for (const line of [
    'add nmos M1 --at 0 0', 'add nmos M2 --at 400 0', 'add nmos M10 --at 800 0', 'add pmos M3 --at 0 -600',
    'add resistor R1 --at 400 -600', 'add capacitor C1 --at 800 -600',
  ]) runCommand(circuit, line);
  return circuit.toJSON();
}

describe('sizing window', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { sizes: parts() } }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const editor = (expression) => h.evaluate(`${h.module('editor-state.js')}.then((m) => { const editor = m.editor; return ${expression}; })`);
  const size = (refdes) => editor(`editor.circuit.components.get(${JSON.stringify(refdes)}).size`);
  const cell = (refdes, key) => `.sizing-table tr[data-refdes="${refdes}"] td[data-key="${key}"]`;
  /** A real click on a cell, Shift (8) to extend. */
  const pickCell = async (refdes, key, modifiers = 0) => {
    const { x, y } = await h.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(cell(refdes, key))}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await h.mouse('mousePressed', x, y, { modifiers });
    await h.mouse('mouseReleased', x, y, { modifiers });
  };
  const gridKey = (key, init = {}) => h.evaluate(`(document.activeElement.closest('.sizing-grid, .sizing-input') || document.querySelector('.sizing-grid')).dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true, ...${JSON.stringify(init)} }))`);
  /** Type into the cell editor (opened by the first character) and commit. */
  const type = async (text, commit = 'Enter') => {
    await gridKey(text[0]);
    await h.until(`!!document.querySelector('.sizing-input')`);
    await h.evaluate(`(() => { const input = document.querySelector('.sizing-input'); input.value = ${JSON.stringify(text)}; })()`);
    await h.evaluate(`document.querySelector('.sizing-input').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(commit)}, bubbles: true, cancelable: true }))`);
  };
  const paste = (text) => h.evaluate(`(() => {
    const data = new DataTransfer();
    data.setData('text/plain', ${JSON.stringify(text)});
    document.querySelector('.sizing-grid').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  })()`);
  const undoDepth = () => editor('editor.history.length');

  test('Shift+Z lists the transistors first, then the passives, each by name', async () => {
    await h.open('sizes');
    await h.key('Z', { shiftKey: true });
    await h.until(`!!document.querySelector('.sizing-window:not([hidden])')`);
    const order = await h.evaluate(`[...document.querySelectorAll('.sizing-table tbody tr')].map((tr) => tr.dataset.refdes)`);
    assert.deepEqual(order, ['M1', 'M2', 'M3', 'M10', 'C1', 'R1']);
    // A transistor takes no value; a resistor takes no W.
    assert.equal(await h.evaluate(`document.querySelector(${JSON.stringify(cell('M1', 'value'))}).classList.contains('sizing-none')`), true);
    assert.equal(await h.evaluate(`document.querySelector(${JSON.stringify(cell('R1', 'w'))}).classList.contains('sizing-none')`), true);
  });

  test('a W typed into three rows waits for its L; the L then sizes all three in one undo step', async () => {
    await pickCell('M1', 'w');
    await pickCell('M10', 'w', 8);
    assert.deepEqual(await editor('[...editor.multi].sort()'), ['M1', 'M10', 'M2', 'M3'], 'the range picks its parts on the canvas');
    await type('2u');
    await h.until(`document.querySelectorAll('.sizing-w.sizing-draft').length === 4`);
    assert.equal(await size('M1'), null, 'no size without L');
    await pickCell('M1', 'l');
    await pickCell('M3', 'l', 8);
    const depth = await undoDepth();
    await type('400n');
    await h.until(`${h.module('editor-state.js')}.then((m) => !!m.editor.circuit.components.get('M3').size)`);
    assert.deepEqual(await size('M2'), { w: '2u', l: '400n', m: 1, hidden: true }, 'made here: no label on the drawing');
    assert.equal(await editor(`editor.circuit.sizeLabelOf('M2')`), null);
    assert.equal(await size('M10'), null, 'outside the range: still a draft');
    assert.equal(await undoDepth(), depth + 1, 'one undo step');
    assert.equal(await h.evaluate(`document.querySelector(${JSON.stringify(cell('M2', 'w'))}).textContent`), '2u');
  });

  test('a bad length stays in the cell with the reason; Esc leaves it as it was', async () => {
    await pickCell('M1', 'w');
    await type('2q');
    await h.until(`document.querySelector('.sizing-status').dataset.kind === 'error'`);
    assert.ok(await h.evaluate(`!!document.querySelector('.sizing-input')`), 'still editing');
    await h.evaluate(`document.querySelector('.sizing-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
    assert.deepEqual(await size('M1'), { w: '2u', l: '400n', m: 1, hidden: true });
  });

  test('one value pasted fills the range; a column pasted fills down from its top', async () => {
    await pickCell('M1', 'm');
    await pickCell('M3', 'm', 8);
    await paste('4');
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.get('M3').size?.m === 4)`);
    assert.equal((await size('M2')).m, 4);
    await pickCell('M1', 'w');
    const depth = await undoDepth();
    await paste('1u\t180n\n3u\t180n\n5u\t360n\n');
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.get('M3').size?.w === '5u')`);
    assert.deepEqual(await size('M1'), { w: '1u', l: '180n', m: 4, hidden: true });
    assert.deepEqual(await size('M2'), { w: '3u', l: '180n', m: 4, hidden: true });
    assert.deepEqual(await size('M3'), { w: '5u', l: '360n', m: 4, hidden: true });
    assert.equal(await undoDepth(), depth + 1, 'one undo step');
    // A whole size typed in W sets all three; values go to passives.
    await pickCell('M10', 'w');
    await type('10u/1u x2');
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.get('M10').size?.m === 2)`);
    await pickCell('C1', 'value');
    await pickCell('R1', 'value', 8);
    await paste('1p\n10k');
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.get('R1').value === '10k')`);
    assert.equal(await editor(`editor.circuit.components.get('C1').value`), '1p');
  });

  test('the Label menu shows the size labels of every row in the range', async () => {
    assert.equal(await editor(`editor.circuit.sizeLabelOf('M1')`), null);
    const closeMenu = () => h.evaluate(`${h.module('context-menu.js')}.then((m) => m.closeComponentContextMenu())`);
    await pickCell('M1', 'label');
    await closeMenu();
    await pickCell('M2', 'label', 8);
    // A click in the range opens the editor's menu for all of it.
    await pickCell('M1', 'label');
    await h.until(`!document.getElementById('component-context-menu').hidden`);
    assert.match(await h.evaluate(`document.querySelector('#component-context-menu .context-menu-heading').textContent`), /2 parts/);
    await h.evaluate(`[...document.querySelectorAll('#component-context-menu button')].find((b) => b.textContent.startsWith('Below the name')).click()`);
    await h.until(`${h.module('editor-state.js')}.then((m) => !!m.editor.circuit.sizeLabelOf('M1') && !!m.editor.circuit.sizeLabelOf('M2'))`);
    assert.equal(await editor(`editor.circuit.sizeLabelOf('M3')`), null, 'outside the range');
    await h.until(`document.querySelector(${JSON.stringify(cell('M2', 'label'))}).textContent.startsWith('Below the name')`);
    // Typed, too: the menu's words, or their first letter.
    await pickCell('M1', 'w');
    await pickCell('M2', 'label', 8);
    await closeMenu();
    await type('h');
    await h.until(`${h.module('editor-state.js')}.then((m) => !m.editor.circuit.sizeLabelOf('M1') && !m.editor.circuit.sizeLabelOf('M2'))`);
  });

  test('a row copied with Ctrl+C pastes into every row picked with Ctrl+V, and the canvas copies and pastes no parts', async () => {
    const count = () => editor('editor.circuit.components.size');
    const before = await count();
    await pickCell('M10', 'w');
    await pickCell('M10', 'label', 8);
    // The keys stay the grid's: the browser's copy and paste events do the work.
    await gridKey('c', { ctrlKey: true });
    const copied = await h.evaluate(`(() => {
      const data = new DataTransfer();
      document.querySelector('.sizing-grid').dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
      return data.getData('text/plain');
    })()`);
    assert.equal(copied, '10u\t1u\t2\tHidden');
    await pickCell('M1', 'w');
    await pickCell('M3', 'w', 8);
    await gridKey('v', { ctrlKey: true });
    await paste(copied);
    await h.until(`${h.module('editor-state.js')}.then((m) => ['M1', 'M2', 'M3'].every((r) => m.editor.circuit.components.get(r).size?.w === '10u'))`);
    assert.deepEqual(await size('M2'), { w: '10u', l: '1u', m: 2, hidden: true });
    assert.equal(await count(), before, 'no part pasted onto the drawing');
  });

  test('Ctrl+Z in the grid undoes the last edit; Delete clears the range', async () => {
    await pickCell('R1', 'value');
    await gridKey('Delete');
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.get('R1').value === '')`);
    await gridKey('z', { ctrlKey: true });
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.get('R1').value === '10k')`);
  });

  test('Annotate puts a parts table right of the drawing that follows the sizes', async () => {
    await pickCell('M1', 'w');
    await h.click('.sizing-window .primary-action');
    await h.until(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].some((l) => l.table))`);
    const svg = () => h.evaluate(`document.querySelector('#canvas g.parts-table')?.textContent || ''`);
    await h.until(`(document.querySelector('#canvas g.parts-table')?.textContent || '').includes('10\u2009µm')`);
    assert.match(await svg(), /^WLmM110\u2009µm1\u2009µm2M210\u2009µm/);
    await h.evaluate(`window.__run('size M1 7u/180n')`);
    await h.until(`(document.querySelector('#canvas g.parts-table')?.textContent || '').includes('7\u2009µm')`);
    // Right of everything else drawn, level with its top.
    const placed = await editor(`(() => {
      const table = [...editor.circuit.labels.values()].find((l) => l.table).bbox();
      const parts = editor.circuit.inkBounds(0, { labels: (l) => !l.table });
      return table.x >= parts.x + parts.w && table.y <= parts.y;
    })()`);
    assert.equal(placed, true);
  });

  test('a passive\'s menu shows its value below the name or in its place; Edit value… types it in the sizing window', async () => {
    const rightClick = async (refdes) => {
      const p = await h.evaluate(`${h.module('editor-state.js')}.then(async (m) => { const c = m.editor.circuit.components.get(${JSON.stringify(refdes)}).transform; return (await ${h.module('canvas-view.js')}).worldToClient(c.x, c.y); })`);
      // A right press held past the hold time (a busy machine late with the
      // release) opens the quick-action ring instead: take it back, again.
      for (let attempt = 0; ; attempt++) {
        await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
        await h.mouse('mousePressed', p.x, p.y, { button: 'right' });
        await h.mouse('mouseReleased', p.x, p.y, { button: 'right' });
        try {
          await h.until(`!document.querySelector('.component-context-menu').hidden`, attempt < 2 ? 2000 : 10000);
          return;
        } catch (error) {
          if (attempt >= 2) throw error;
          await h.key('Escape');
        }
      }
    };
    const choose = (submenu, item) => h.evaluate(`(() => {
      [...document.querySelectorAll('.component-context-menu button')].find((b) => b.textContent.startsWith(${JSON.stringify(submenu)})).click();
      [...document.querySelectorAll('.context-submenu[aria-label=${JSON.stringify(submenu)}] button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(item)})).click();
    })()`);
    await h.evaluate(`window.__run('value R1 10k')`);
    await h.key('Z', { shiftKey: true });
    await h.until(`!!document.querySelector('.sizing-window[hidden]')`);
    assert.equal(await editor(`editor.circuit.valueLabelOf('R1')`), null, 'hidden by default');
    await rightClick('R1');
    await choose('Value', 'Below the name');
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.valueLabelOf('R1')?.text === '$\\\\mathrm{10\\\\,kΩ}$')`);
    await rightClick('R1');
    await choose('Value', 'Instead of the name');
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.get('R1').valueLabel === 'replace')`);
    await rightClick('R1');
    await choose('Value', 'Edit value');
    await h.until(`document.activeElement?.classList.contains('sizing-input')`);
    assert.equal(await h.evaluate(`document.querySelector(${JSON.stringify(cell('R1', 'label'))}).textContent.replace('▾', '')`), 'Instead of the name', 'the window shows it too');
    await h.evaluate(`(() => { const input = document.querySelector('.sizing-input'); input.value = '22k'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`);
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.valueLabelOf('R1')?.text === '$\\\\mathrm{22\\\\,kΩ}$')`);
  });
});
