/** The editor's floating windows in a browser: their one title bar, the
 *  toolbar's window group and More, docking and folding, resizing from a
 *  corner, a pasted picture, and the timing editor's words. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, sleep, browserSkip } from './harness.js';
import { linkedTop, withBeats, amplifier } from './fixtures.js';

describe('floating windows', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { beats: withBeats(), top: linkedTop(), child: amplifier() }, width: 1500, height: 950 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const shown = (selector) => h.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return !!el && !el.hidden && !!el.offsetParent; })()`);
  const closeAll = () => h.evaluate(`[...document.querySelectorAll('.floating-window:not([hidden]) .floating-window-close')].forEach((b) => b.click())`);

  test('every window has one title bar holding only its title, a dock button, and a close ×, and floats over the drawing', async () => {
    await h.open('beats');
    for (const key of ['S', 'B', 'K', 'W', 'E', 'Y', 'Z', 'V']) await h.key(key, { shiftKey: true });
    await h.key('N', { shiftKey: true });
    await h.settle();
    const windows = await h.evaluate(`[...document.querySelectorAll('.floating-window')].filter((w) => !w.hidden).map((w) => {
      const header = w.querySelector('.floating-window-header');
      const buttons = [...header.querySelectorAll(':scope > button:not(.floating-window-title)')].map((b) => b.className.split(' ')[0]);
      return { cls: w.className.split(' ')[1], headers: w.querySelectorAll('.floating-window-header').length, title: !!header.querySelector('.floating-window-title'), buttons, close: header.querySelector('.floating-window-close')?.textContent, inPane: !!w.closest('.canvas-pane'), closeButtons: [...w.querySelectorAll('button')].filter((b) => /^close$/i.test(b.textContent.trim())).length };
    })`);
    assert.ok(windows.length >= 8, JSON.stringify(windows));
    for (const w of windows) {
      assert.equal(w.headers, 1, w.cls);
      assert.equal(w.title, true, w.cls);
      assert.deepEqual(w.buttons, ['floating-window-dock', 'floating-window-close'], `${w.cls}: its actions are in its footer`);
      assert.equal(w.close, '×', w.cls);
      assert.equal(w.inPane, true, w.cls);
      assert.equal(w.closeButtons, 0, `${w.cls}: no second Close at the bottom`);
    }
    await closeAll();
  });

  test('the toolbar groups the windows, and More lists them too, even when the toolbar folds them away', async () => {
    const group = await h.evaluate(`[...document.querySelectorAll('.window-cluster > button')].map((b) => b.id)`);
    assert.deepEqual(group, ['btn-window-beats', 'btn-window-timing', 'btn-analysis', 'btn-window-plots', 'btn-window-reference', 'btn-window-calculator', 'btn-window-notes', 'btn-window-sizing', 'btn-window-history']);
    const more = await h.evaluate(`[...document.querySelectorAll('#document-menu [data-proxy-for]')].map((b) => b.dataset.proxyFor)`);
    for (const id of ['btn-analysis', 'btn-window-plots', 'btn-window-reference', 'btn-window-calculator', 'btn-window-notes', 'btn-window-sizing']) assert.ok(more.includes(id), id);
    // Each tool's tooltip is its name and its key.
    const titles = await h.evaluate(`[...document.querySelectorAll('.window-cluster > button')].map((b) => b.title)`);
    assert.deepEqual(titles, ['Beats (Shift+B)', 'Timing diagram (Shift+K)', 'Analysis (Shift+S)', 'Plots (Shift+W)', 'Reference windows (Shift+V)', 'Calculator (Shift+E)', 'Notes (Shift+N)', 'Sizing (Shift+Z)', 'History (Shift+Y)']);
    // Plots and History open from the toolbar and from their keys, and the
    // button shows the window open.
    for (const [id, key, selector] of [['btn-window-plots', 'W', '.plots-window'], ['btn-window-history', 'Y', '.history-window']]) {
      await h.click(`#${id}`);
      await h.until(`!!document.querySelector('${selector}') && !document.querySelector('${selector}').hidden && document.getElementById('${id}').getAttribute('aria-pressed') === 'true'`);
      await h.key(key, { shiftKey: true });
      await h.until(`document.querySelector('${selector}').hidden && document.getElementById('${id}').getAttribute('aria-pressed') === 'false'`);
    }
    // With room to spare each toggle says its name; with less, icons only.
    const named = () => h.evaluate(`getComputedStyle(document.getElementById('btn-window-notes')).fontSize !== '0px'`);
    await h.send('Emulation.setDeviceMetricsOverride', { width: 1900, height: 900, deviceScaleFactor: 1, mobile: false });
    await h.until(`!/windows/.test(document.querySelector('.toolbar').dataset.compact || '')`);
    assert.equal(await named(), true);
    await h.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false });
    await h.until(`/windows/.test(document.querySelector('.toolbar').dataset.compact || '')`);
    assert.equal(await named(), false);
    // A narrow window folds the group; More still opens every one of them.
    await h.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 800, deviceScaleFactor: 1, mobile: false });
    await h.until(`getComputedStyle(document.querySelector('.window-cluster')).display === 'none'`);
    assert.equal(await shown('.window-cluster'), false, 'folded away');
    await h.click('#btn-document-menu');
    await h.evaluate(`document.querySelector('#document-menu [data-proxy-for="btn-window-calculator"]').click()`);
    await h.until(`!!document.querySelector('.calculator-window:not([hidden])')`);
    await closeAll();
    await h.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
    await h.settle();
  });

  test('a window docks into the side panel and floats out again; docked, its title bar folds it', async () => {
    await h.key('E', { shiftKey: true });
    await h.until(`!!document.querySelector('.calculator-window:not([hidden])')`);
    await h.click('.calculator-window .floating-window-dock');
    assert.equal(await h.evaluate(`!!document.querySelector('.calculator-window').closest('.side-panel') && document.querySelector('.calculator-window').classList.contains('docked')`), true);
    assert.equal(await h.evaluate(`document.body.classList.contains('side-panel-collapsed')`), false, 'the panel shows it');
    const header = await h.evaluate(`(() => { const r = document.querySelector('.calculator-window .floating-window-title').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await h.mouse('mousePressed', header.x, header.y);
    await h.mouse('mouseReleased', header.x, header.y);
    await h.settle();
    assert.equal(await h.evaluate(`document.querySelector('.calculator-window').classList.contains('folded')`), true);
    assert.equal(await shown('.calculator-window .calculator-body'), false, 'folded to its title bar');
    await h.mouse('mousePressed', header.x, header.y);
    await h.mouse('mouseReleased', header.x, header.y);
    await h.settle();
    await h.click('.calculator-window .floating-window-dock');
    assert.equal(await h.evaluate(`!!document.querySelector('.calculator-window').closest('.canvas-pane')`), true, 'floating again');
    await closeAll();
  });

  test('a west or north corner grip moves that edge, not the opposite one, and stops at the tool rail', async () => {
    await h.key('E', { shiftKey: true });
    await h.until(`!!document.querySelector('.calculator-window:not([hidden])')`);
    const rect = () => h.evaluate(`(() => { const r = document.querySelector('.calculator-window').getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) }; })()`);
    const drag = async (selector, dx, dy) => {
      const at = await h.evaluate(`(() => { const r = document.querySelector('.calculator-window ${selector}').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await h.mouse('mouseMoved', at.x, at.y, { button: 'none', buttons: 0 });
      await h.mouse('mousePressed', at.x, at.y);
      for (let k = 1; k <= 5; k++) await h.mouse('mouseMoved', at.x + dx * k / 5, at.y + dy * k / 5, { buttons: 1 });
      await h.mouse('mouseReleased', at.x + dx, at.y + dy);
      await h.settle();
    };
    // Well away from the rail first.
    const start = await rect();
    await drag('.floating-window-title', 500 - start.left, 200 - start.top);
    for (const [corner, dx, dy] of [['nw', -60, 30], ['sw', -40, 30]]) {
      const before = await rect();
      await drag(`.grip-${corner}`, dx, dy);
      const after = await rect();
      assert.ok(Math.abs(after.left - (before.left + dx)) <= 2, `${corner}: the left edge follows ${JSON.stringify({ before, after })}`);
      assert.ok(Math.abs(after.right - before.right) <= 1, `${corner}: the right edge stays`);
    }
    // Moved beside the rail, a west grip dragged past it stops there; the right edge still stays.
    const rail = await h.evaluate(`Math.round(document.querySelector('.mode-toolbar').getBoundingClientRect().right)`);
    const now = await rect();
    await drag('.floating-window-title', rail + 60 - now.left, 0);
    const beside = await rect();
    await drag('.grip-nw', -200, 0);
    const pushed = await rect();
    assert.ok(pushed.left > rail && pushed.left < beside.left, `stops at the rail: ${JSON.stringify({ rail, beside, pushed })}`);
    assert.ok(Math.abs(pushed.right - beside.right) <= 1, `the right edge stays: ${JSON.stringify({ beside, pushed })}`);
    await closeAll();
  });

  test('the window with the keyboard shows it in its title bar; a reference window opens at the top left, the calculator at the bottom left', async () => {
    await h.open('beats');
    await h.key('E', { shiftKey: true });
    await h.key('V', { shiftKey: true });
    await h.until(`!!document.querySelector('.calculator-window:not([hidden])') && !!document.querySelector('.reference-window:not([hidden])')`);
    // Back in their default places, wherever the tests before left them.
    await h.evaluate(`['.calculator-window', '.reference-window'].forEach((w) => document.querySelector(w + ' .floating-window-header').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))`);
    const litNow = `[...document.querySelectorAll('.floating-window:not([hidden])')].filter((w) => getComputedStyle(w.querySelector('.floating-window-header')).backgroundColor !== 'rgba(0, 0, 0, 0)').map((w) => w.className.split(' ')[1])`;
    // The lit windows, once they settle on `expected`.
    const lit = async (expected) => {
      await h.until(`JSON.stringify(${litNow}) === ${JSON.stringify(JSON.stringify(expected))}`).catch(() => {});
      return h.evaluate(litNow);
    };
    // A key where the focus is, as typed.
    const type = (key) => h.evaluate(`(document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))`);
    await h.evaluate(`document.getElementById('canvas').focus()`);
    assert.deepEqual(await lit([]), [], 'the drawing has the keyboard');
    await h.evaluate(`document.querySelector('.calculator-window input, .calculator-window textarea, .calculator-window button').focus()`);
    assert.deepEqual(await lit(['calculator-window']), ['calculator-window']);
    await h.evaluate(`document.querySelector('.reference-window .floating-window-dock').focus()`);
    assert.deepEqual(await lit(['reference-window']), ['reference-window']);
    // Back and forth by pressing: the drawing, then a window's title bar.
    const press = async (selector, fx = 0, dx = 20) => {
      const at = await h.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width * ${fx} + ${dx}, y: r.y + r.height / 2 }; })()`);
      await h.mouse('mouseMoved', at.x, at.y, { button: 'none', buttons: 0 });
      await h.mouse('mousePressed', at.x, at.y);
      await h.mouse('mouseReleased', at.x, at.y);
    };
    await press('#canvas', 0.6, 0);
    assert.deepEqual(await lit([]), []);
    await press('.calculator-window .floating-window-title');
    assert.deepEqual(await lit(['calculator-window']), ['calculator-window']);
    await press('#canvas', 0.6, 0);
    assert.deepEqual(await lit([]), []);
    await press('.calculator-window .floating-window-title');
    assert.deepEqual(await lit(['calculator-window']), ['calculator-window']);
    // The drawing's keys wait while it has the keyboard; Escape closes it.
    const grid = () => h.evaluate(`!!document.querySelector('#canvas .grid-line')`);
    const gridBefore = await grid();
    await type('#');
    assert.equal(await grid(), gridBefore, 'no grid toggled');
    await type('Escape');
    await h.until(`!!document.querySelector('.calculator-window[hidden]')`);
    assert.equal(await h.evaluate(`document.activeElement?.id`), 'canvas');
    await h.key('E', { shiftKey: true });
    await h.until(`!!document.querySelector('.calculator-window:not([hidden])')`);
    const calc = await h.evaluate(`(() => {
      const win = document.querySelector('.calculator-window').getBoundingClientRect();
      const pane = document.querySelector('.canvas-pane').getBoundingClientRect();
      return { left: win.left - pane.left, gap: pane.bottom - win.bottom };
    })()`);
    assert.ok(calc.left < 80 && calc.gap < 30, JSON.stringify(calc));
    // Top left, beside the tool rail.
    const place = await h.evaluate(`(() => {
      const win = document.querySelector('.reference-window').getBoundingClientRect();
      const pane = document.querySelector('.canvas-pane').getBoundingClientRect();
      const rail = document.querySelector('.mode-toolbar').getBoundingClientRect();
      return { left: win.left - pane.left, top: win.top - pane.top, rail: rail.right - pane.left, mid: pane.width / 2 };
    })()`);
    assert.ok(place.left >= place.rail && place.left < place.rail + 20 && place.top < 20, JSON.stringify(place));
    await closeAll();
  });

  test('Shift+S opens the analysis with the keyboard, and Shift+S in it closes it; Esc out of the notes source keeps them lit', async () => {
    await h.open('beats');
    await closeAll();
    const litNow = `[...document.querySelectorAll('.floating-window:not([hidden])')].filter((w) => w.matches(':focus-within')).map((w) => [...w.classList].find((c) => c !== 'floating-window'))`;
    const type = (key, init = {}) => h.evaluate(`(document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true, ...${JSON.stringify(init)} }))`);
    await h.key('S', { shiftKey: true });
    await h.until(`${litNow}.length === 1`);
    assert.deepEqual(await h.evaluate(litNow), ['analysis-dock']);
    await type('S', { shiftKey: true });
    await h.until(`document.getElementById('analysis-dialog').hidden`);
    assert.equal(await h.evaluate(`document.activeElement?.id`), 'canvas');
    // The notes on Shift+N (n is free text now); an empty design's open to write.
    await h.key('N', { shiftKey: true });
    await h.until(`document.activeElement?.matches('.notes-source')`);
    assert.deepEqual(await h.evaluate(litNow), ['notes-window']);
    await type('Escape');
    await h.until(`!document.querySelector('.notes-window.editing')`);
    assert.deepEqual(await h.evaluate(litNow), ['notes-window'], 'read now, still with the keyboard');
    await type('Escape');
    await h.until(`!!document.querySelector('.notes-window[hidden]')`);
    // n picks the free-text tool.
    await h.key('n');
    await h.until(`document.getElementById('btn-mode-annotation').getAttribute('aria-pressed') === 'true'`);
    await h.key('Escape');
  });

  test('a picture pasted with the pointer over a reference window shows there, not on the drawing', async () => {
    await h.open('beats');
    await h.key('V', { shiftKey: true });
    await h.until(`!!document.querySelector('.reference-window:not([hidden])')`);
    const pictures = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].filter((l) => l.image).length)`);
    const before = await pictures();
    // A point where the reference window is the one on top.
    const over = await h.evaluate(`(() => {
      const win = document.querySelector('.reference-window');
      const r = win.getBoundingClientRect();
      for (let fy = 0.5; fy < 0.95; fy += 0.1) for (let fx = 0.5; fx < 0.95; fx += 0.1) {
        const x = r.x + r.width * fx, y = r.y + r.height * fy;
        if (win.contains(document.elementFromPoint(x, y))) return { x, y };
      }
      return null;
    })()`);
    assert.ok(over, 'the reference window shows');
    // The pointer comes in from outside the window, as a hand brings it.
    await h.mouse('mouseMoved', 5, over.y, { button: 'none', buttons: 0 });
    for (let k = 1; k <= 4; k++) await h.mouse('mouseMoved', 5 + (over.x - 5) * k / 4, over.y, { button: 'none', buttons: 0 });
    await h.evaluate(`(async () => {
      const canvas = new OffscreenCanvas(8, 8); canvas.getContext('2d').fillRect(0, 0, 8, 8);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const data = new DataTransfer();
      data.items.add(new File([blob], 'picture.png', { type: 'image/png' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    })()`);
    await h.until(`!!document.querySelector('.reference-window img, .reference-window .reference-picture')`, 5000);
    assert.equal(await pictures(), before, 'no picture pasted onto the drawing');
    await closeAll();
  });

  test('Escape in the beats window closes it, as in the other windows', async () => {
    await h.open('beats');
    await h.key('B', { shiftKey: true });
    await h.until(`!document.getElementById('beat-strip').hidden`);
    // A beat chip clicked: the focus is in the window.
    await h.evaluate(`document.querySelector('#beat-strip .beat-chip:not(.beat-chip-all)').focus()`);
    await h.evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
    await h.until(`document.getElementById('beat-strip').hidden`);
    assert.equal(await h.evaluate(`document.activeElement?.id`), 'canvas');
  });

  test('Escape on the drawing lets go of the selection first, then closes the windows one by one, the front one first', async () => {
    await h.open('beats');
    await closeAll();
    const open = () => h.evaluate(`[...document.querySelectorAll('.floating-window')].filter((w) => !w.hidden && w.offsetParent).map((w) => w.id || w.className.split(' ')[1])`);
    // Stepping through the beats opens their window by itself.
    await h.key('ArrowRight', { altKey: true });
    await h.until(`!document.getElementById('beat-strip').hidden`);
    await h.key('N', { shiftKey: true }); // and the notes, in front of it
    await h.until(`[...document.querySelectorAll('.floating-window')].filter((w) => !w.hidden && w.offsetParent).length === 2`);
    const ref = await h.evaluate(`window.__circuit().comps.find((c) => c.type !== 'solder').refdes`);
    await h.evaluate(`${h.module('main.js')}.then((m) => { m.setSelection([${JSON.stringify(ref)}]); m.render(); })`);
    const windows = await open();
    assert.ok(windows.some((w) => /notes/.test(w)) && windows.includes('beat-strip'), JSON.stringify(windows));
    await h.key('Escape');
    assert.equal(await h.evaluate(`${h.module('main.js')}.then((m) => m.selectedComps().length)`), 0, 'the selection goes first');
    assert.deepEqual(await open(), windows, 'and only it');
    await h.key('Escape');
    await h.until(`[...document.querySelectorAll('.floating-window')].filter((w) => !w.hidden && w.offsetParent).length === 1`);
    assert.equal(await h.evaluate(`document.getElementById('beat-strip').hidden`), false, 'the notes, at the front, close first');
    await h.key('Escape');
    await h.until(`document.getElementById('beat-strip').hidden`);
    assert.equal(await h.evaluate(`document.activeElement?.id`), 'canvas');
  });

  test('the timing editor says each way to and from the beats once, in plain words', async () => {
    await h.open('beats');
    await h.key('K', { shiftKey: true });
    await h.until(`!!document.querySelector('.timing-dialog:not([hidden])')`);
    const text = await h.evaluate(`document.querySelector('.timing-dialog').innerText`);
    for (const words of ['Read beats', 'Make beats', 'Move under drawing', 'Non-overlap', 'Slots', 'Cursor row', 'Signals']) assert.ok(text.includes(words), words);
    for (const old of ['From beats', 'Re-place', 'Never overlap', 'Repeat all']) assert.ok(!text.includes(old), old);
    assert.ok(await h.evaluate(`!!document.querySelector('.timing-dialog .segmented[aria-label="Falling edges"]')`));
    assert.ok(await h.evaluate(`!!document.querySelector('.timing-dialog .timing-chip[aria-pressed]')`));
    assert.match(await h.evaluate(`document.getElementById('document-menu').textContent`), /Make beats from phases/);
    await closeAll();
  });

  test('a linked part offers one set of link verbs: peek, open, and show in the Atlas', async () => {
    await h.open('top');
    const p = await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.worldToClient(0, 0))`);
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
    await h.tap(p.x, p.y, { button: 'right' });
    await h.until(`!document.querySelector('.component-context-menu').hidden`);
    const items = await h.evaluate(`[...document.querySelectorAll('.component-context-menu button')].map((b) => b.textContent.trim())`);
    for (const verb of ['Peek at child', 'Open child', 'Show child in the Atlas']) assert.equal(items.filter((i) => i.startsWith(verb)).length, 1, `${verb} in ${items}`);
    await h.key('Escape');
    // The toolbar's document group has the tags and the Atlas by the name.
    assert.deepEqual(await h.evaluate(`[...document.querySelectorAll('.document-cluster > button, .document-cluster [id="btn-tags"], .document-cluster [id="btn-atlas"]')].map((b) => b.id).filter((id) => ['btn-tags', 'btn-atlas'].includes(id))`), ['btn-tags', 'btn-atlas']);
  });
});
