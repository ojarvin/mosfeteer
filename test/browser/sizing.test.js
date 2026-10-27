/** The sizing window in a browser: cells picked, typed into many at once,
 *  half a size kept until the other half comes, pasting one value or a
 *  spreadsheet column, one undo step per edit, a parts table put on the
 *  drawing that follows the sizes, rows sorted and grouped, names renamed,
 *  links picked; and a part's menu copying its size or value onto others. */

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
  before(async () => { h = await start({ docs: { sizes: parts(), ota: new Circuit().toJSON() } }); });
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
  const rightClick = async (refdes) => {
    // The middle of the part's body, where the page has it once caught up:
    // closing the window can move the drawing's pane, and a name label may
    // stand over the part's origin.
    await h.settle();
    const p = await h.evaluate(`${h.module('editor-state.js')}.then(async (m) => { const b = m.editor.circuit.components.get(${JSON.stringify(refdes)}).bboxWorld(); return (await ${h.module('canvas-view.js')}).worldToClient(b.x + b.w / 2, b.y + b.h / 2); })`);
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
    await h.tap(p.x, p.y, { button: 'right' });
    try {
      await h.until(`!document.querySelector('.component-context-menu').hidden`);
    } catch (error) {
      const seen = await h.evaluate(`${h.module('editor-state.js')}.then((m) => JSON.stringify({ under: document.elementFromPoint(${p.x}, ${p.y})?.outerHTML.slice(0, 160), drag: m.editor.drag && m.editor.drag.mode, radial: !!document.querySelector('.radial-item'), mode: m.editor.mode, at: ${JSON.stringify(p)}, now: (() => { const c = m.editor.circuit.components.get(${JSON.stringify(refdes)}).transform; return c; })() }))`);
      throw new Error(`${error.message}\n  ${seen}`);
    }
  };
  const choose = (submenu, item) => h.evaluate(`(() => {
    [...document.querySelectorAll('.component-context-menu button')].find((b) => b.textContent.startsWith(${JSON.stringify(submenu)})).click();
    [...document.querySelectorAll('.context-submenu[aria-label=${JSON.stringify(submenu)}] button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(item)})).click();
  })()`);

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
    await h.click('.sizing-window .sizing-annotate');
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
  const shown = () => h.evaluate(`!!document.querySelector('.sizing-window:not([hidden])')`);
  const order = () => h.evaluate(`[...document.querySelectorAll('.sizing-table tbody tr[data-refdes]')].map((tr) => tr.dataset.refdes)`);
  const closeMenu = () => h.evaluate(`${h.module('context-menu.js')}.then((m) => m.closeComponentContextMenu())`);

  test('a heading sorts by its column, then the other way, then back; By type groups; both saved with the design', async () => {
    for (const line of ['size M1 2u/180n', 'size M2 400n/180n', 'size M3 10u/180n', 'size M10 1u/180n']) await h.evaluate(`window.__run(${JSON.stringify(line)})`);
    if (!await shown()) await h.key('Z', { shiftKey: true });
    await h.until(`!!document.querySelector('.sizing-window:not([hidden])')`);
    const sortBy = (head) => h.evaluate(`[...document.querySelectorAll('.sizing-sort')].find((b) => b.firstChild.textContent === ${JSON.stringify(head)}).click()`);
    await sortBy('W');
    await h.until(`document.querySelector('.sizing-table tbody tr[data-refdes]').dataset.refdes === 'M2'`);
    assert.deepEqual(await order(), ['M2', 'M10', 'M1', 'M3', 'C1', 'R1'], '400n before 1u; the rows without a W as they were');
    assert.deepEqual(await editor('editor.circuit.windows.sizing'), { sort: { key: 'w' } });
    assert.equal(await h.evaluate(`document.querySelector('.sizing-table thead th[data-key="w"]').getAttribute('aria-sort')`), 'ascending');
    // An edit leaves every row where it is.
    await pickCell('M2', 'w');
    await type('20u');
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.get('M2').size.w === '20u')`);
    assert.deepEqual(await order(), ['M2', 'M10', 'M1', 'M3', 'C1', 'R1']);
    await sortBy('W');
    await h.until(`document.querySelector('.sizing-table thead th[data-key="w"]').getAttribute('aria-sort') === 'descending'`);
    assert.deepEqual(await order(), ['M2', 'M3', 'M1', 'M10', 'C1', 'R1']);
    await sortBy('W');
    await h.until(`document.querySelector('.sizing-table tbody tr[data-refdes]').dataset.refdes === 'M1'`);
    assert.deepEqual(await order(), ['M1', 'M2', 'M3', 'M10', 'C1', 'R1'], 'the table\'s order again');
    assert.equal(await editor('editor.circuit.windows.sizing'), undefined);
    await h.click('.sizing-group-toggle');
    await h.until(`document.querySelectorAll('.sizing-table tr.sizing-group').length === 4`);
    assert.deepEqual(await h.evaluate(`[...document.querySelectorAll('.sizing-table tr.sizing-group')].map((tr) => tr.textContent)`), ['NMOS', 'PMOS', 'Resistors', 'Capacitors']);
    assert.deepEqual(await order(), ['M1', 'M2', 'M10', 'M3', 'R1', 'C1']);
    assert.deepEqual(await editor('editor.circuit.toJSON().windows.sizing'), { group: true }, 'saved with the design');
    await h.click('.sizing-group-toggle');
    await h.until(`!document.querySelector('.sizing-table tr.sizing-group')`);
  });

  test('a double-click on a name renames the part as the canvas does; a name in use keeps the field with the reason', async () => {
    const rename = (refdes, text, key = 'Enter') => h.evaluate(`(() => {
      document.querySelector('.sizing-table tr[data-refdes="${refdes}"] th.sizing-name').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      const input = document.querySelector('.sizing-rename');
      input.value = ${JSON.stringify(text)};
      input.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }));
    })()`);
    const depth = await undoDepth();
    await rename('M10', 'M_{out}');
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.has('Mout'))`);
    assert.equal(await editor(`editor.circuit.labelOf('Mout').text`), 'M_{out}');
    assert.equal(await undoDepth(), depth + 1, 'one undo step');
    assert.deepEqual(await order(), ['M1', 'M2', 'M3', 'Mout', 'C1', 'R1'], 'in its place');
    await rename('M1', 'M2');
    await h.until(`/already in use/.test(document.querySelector('.sizing-status').textContent)`);
    assert.ok(await h.evaluate(`!!document.querySelector('.sizing-rename')`), 'still renaming');
    await h.evaluate(`document.querySelector('.sizing-rename').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
    await h.until(`!document.querySelector('.sizing-rename')`);
    assert.equal(await editor(`editor.circuit.components.has('M1')`), true);
  });

  test('a Link cell picks a design from the workspace; typed or pasted, the name is taken; Delete unlinks', async () => {
    await pickCell('M1', 'link');
    await h.until(`!document.getElementById('component-context-menu').hidden`);
    await h.evaluate(`[...document.querySelectorAll('#component-context-menu button')].find((b) => b.textContent.trim() === 'ota').click()`);
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.get('M1').link === 'ota')`);
    await h.until(`document.querySelector(${JSON.stringify(cell('M1', 'link'))}).textContent.startsWith('ota')`);
    await closeMenu();
    await pickCell('M2', 'link');
    await closeMenu();
    await h.evaluate(`document.querySelector('.sizing-grid').focus()`);
    await paste('bias');
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.get('M2').link === 'bias')`);
    await gridKey('Delete');
    await h.until(`${h.module('editor-state.js')}.then((m) => !m.editor.circuit.components.get('M2').link)`);
  });

  test('a part\'s menu copies its size onto every selected transistor, and a value onto parts in the same unit', async () => {
    if (await shown()) await h.key('Z', { shiftKey: true });
    await h.until(`!!document.querySelector('.sizing-window[hidden]')`);
    await rightClick('M1');
    await choose('Sizing', 'Copy size');
    await h.evaluate(`${h.module('main.js')}.then((m) => { m.setSelection(['M2', 'M3']); m.render(); })`);
    await rightClick('M2');
    const depth = await undoDepth();
    await choose('Sizing', 'Paste size 2u/180n');
    await h.until(`${h.module('editor-state.js')}.then((m) => ['M2', 'M3'].every((r) => m.editor.circuit.components.get(r).size?.w === '2u'))`);
    assert.deepEqual(await size('M3'), { w: '2u', l: '180n', m: 1, hidden: true });
    assert.equal(await undoDepth(), depth + 1, 'one undo step');
    // A value: onto a part in its unit only.
    await h.evaluate(`window.__run('value R1 47k')`);
    await rightClick('R1');
    await choose('Value', 'Copy value');
    await rightClick('C1');
    const pasteOffered = () => h.evaluate(`(() => {
      [...document.querySelectorAll('.component-context-menu button')].find((b) => b.textContent.startsWith('Value')).click();
      return !([...document.querySelectorAll('.context-submenu[aria-label="Value"] button')].find((b) => b.textContent.trim().startsWith('Paste value')).disabled);
    })()`);
    assert.equal(await pasteOffered(), false, 'a capacitor takes no Ω');
    await closeMenu();
    await h.evaluate(`window.__run('add resistor R2 --at 400 600')`);
    await rightClick('R2');
    await choose('Value', 'Paste value');
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.get('R2').value === '47k')`);
  });
  test('a heading\'s edge dragged resizes its column alone, kept in this browser; a double-click fits it to its cells', async () => {
    if (!await shown()) await h.key('Z', { shiftKey: true });
    await h.until(`!!document.querySelector('.sizing-window:not([hidden])')`);
    const widths = () => h.evaluate(`[...document.querySelectorAll('.sizing-table thead th[data-key]')].map((th) => Math.round(th.getBoundingClientRect().width))`);
    const handle = (key) => h.evaluate(`(() => { const r = document.querySelector('.sizing-table thead th[data-key="${key}"] .sizing-resize').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    const before = await widths();
    const at = await handle('w');
    await h.mouse('mousePressed', at.x, at.y);
    await h.mouse('mouseMoved', at.x + 20, at.y);
    await h.mouse('mouseMoved', at.x + 40, at.y);
    await h.mouse('mouseReleased', at.x + 40, at.y);
    await h.until(`Math.round(document.querySelector('.sizing-table thead th[data-key="w"]').getBoundingClientRect().width) === ${before[1] + 40}`);
    const after = await widths();
    assert.deepEqual(after.filter((_, i) => i !== 1), before.filter((_, i) => i !== 1), 'the other columns as they were');
    assert.equal(JSON.parse(await h.evaluate(`localStorage.getItem('mosfeteer.sizing.columns')`)).w, before[1] + 40);
    // Made too narrow for its name, a double-click on its edge fits it.
    await h.evaluate(`window.__run('rename M1 M_long_name_here')`);
    await h.until(`!!document.querySelector('.sizing-table tr[data-refdes="M_long_name_here"]')`);
    const clipped = () => h.evaluate(`(() => { const th = document.querySelector('.sizing-table tr[data-refdes="M_long_name_here"] th.sizing-name'); return th.scrollWidth > th.clientWidth; })()`);
    assert.equal(await clipped(), true);
    const edge = await handle('name');
    for (const clickCount of [1, 2]) {
      await h.mouse('mousePressed', edge.x, edge.y, { clickCount });
      await h.mouse('mouseReleased', edge.x, edge.y, { clickCount });
    }
    await h.until(`(() => { const th = document.querySelector('.sizing-table tr[data-refdes="M_long_name_here"] th.sizing-name'); return th.scrollWidth <= th.clientWidth; })()`);
    await h.evaluate(`localStorage.removeItem('mosfeteer.sizing.columns')`);
  });
});
