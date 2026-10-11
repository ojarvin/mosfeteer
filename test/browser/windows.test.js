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

  test('every window has one title bar, a dock button and a close × at its right, and floats over the drawing', async () => {
    await h.open('beats');
    for (const key of ['S', 'B', 'K', 'W', 'E']) await h.key(key, { shiftKey: true });
    await sleep(300);
    const windows = await h.evaluate(`[...document.querySelectorAll('.floating-window')].filter((w) => !w.hidden).map((w) => {
      const header = w.querySelector('.floating-window-header');
      const buttons = [...header.querySelectorAll(':scope > button')].map((b) => b.className.split(' ')[0]);
      return { cls: w.className.split(' ')[1], headers: w.querySelectorAll('.floating-window-header').length, title: !!header.querySelector('.floating-window-title'), last: buttons.slice(-2), close: header.querySelector('.floating-window-close')?.textContent, inPane: !!w.closest('.canvas-pane'), closeButtons: [...w.querySelectorAll('button')].filter((b) => /^close$/i.test(b.textContent.trim())).length };
    })`);
    assert.ok(windows.length >= 5, JSON.stringify(windows));
    for (const w of windows) {
      assert.equal(w.headers, 1, w.cls);
      assert.equal(w.title, true, w.cls);
      assert.deepEqual(w.last, ['floating-window-dock', 'floating-window-close'], w.cls);
      assert.equal(w.close, '×', w.cls);
      assert.equal(w.inPane, true, w.cls);
      assert.equal(w.closeButtons, 0, `${w.cls}: no second Close at the bottom`);
    }
    await closeAll();
  });

  test('the toolbar groups the windows, and More lists them too, even when the toolbar folds them away', async () => {
    const group = await h.evaluate(`[...document.querySelectorAll('.window-cluster > button')].map((b) => b.id)`);
    assert.deepEqual(group, ['btn-window-beats', 'btn-window-timing', 'btn-analysis', 'btn-window-plots', 'btn-window-reference', 'btn-window-calculator']);
    const more = await h.evaluate(`[...document.querySelectorAll('#document-menu [data-proxy-for]')].map((b) => b.dataset.proxyFor)`);
    for (const id of ['btn-analysis', 'btn-window-plots', 'btn-window-reference', 'btn-window-calculator']) assert.ok(more.includes(id), id);
    // A narrow window folds the group; More still opens every one of them.
    await h.send('Emulation.setDeviceMetricsOverride', { width: 500, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
    assert.equal(await shown('.window-cluster'), false, 'folded away');
    await h.click('#btn-document-menu');
    await h.evaluate(`document.querySelector('#document-menu [data-proxy-for="btn-window-calculator"]').click()`);
    await h.until(`!!document.querySelector('.calculator-window:not([hidden])')`);
    await closeAll();
    await h.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
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
    await sleep(100);
    assert.equal(await h.evaluate(`document.querySelector('.calculator-window').classList.contains('folded')`), true);
    assert.equal(await shown('.calculator-window .calculator-body'), false, 'folded to its title bar');
    await h.mouse('mousePressed', header.x, header.y);
    await h.mouse('mouseReleased', header.x, header.y);
    await sleep(100);
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
      await sleep(150);
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

  test('the timing editor says each way to and from the beats once, in plain words', async () => {
    await h.open('beats');
    await h.key('K', { shiftKey: true });
    await h.until(`!!document.querySelector('.timing-dialog:not([hidden])')`);
    const text = await h.evaluate(`document.querySelector('.timing-dialog').innerText`);
    for (const words of ['Read beats', 'Make beats', 'Move under drawing', 'Gaps', 'Slots', 'Cursor row', 'Signals']) assert.ok(text.includes(words), words);
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
    await h.mouse('mousePressed', p.x, p.y, { button: 'right' });
    await h.mouse('mouseReleased', p.x, p.y, { button: 'right' });
    await h.until(`!document.querySelector('.component-context-menu').hidden`);
    const items = await h.evaluate(`[...document.querySelectorAll('.component-context-menu button')].map((b) => b.textContent.trim())`);
    for (const verb of ['Peek at child', 'Open child', 'Show child in the Atlas']) assert.equal(items.filter((i) => i.startsWith(verb)).length, 1, `${verb} in ${items}`);
    await h.key('Escape');
    // The toolbar's document group has the tags and the Atlas by the name.
    assert.deepEqual(await h.evaluate(`[...document.querySelectorAll('.document-cluster > button, .document-cluster [id="btn-tags"], .document-cluster [id="btn-atlas"]')].map((b) => b.id).filter((id) => ['btn-tags', 'btn-atlas'].includes(id))`), ['btn-tags', 'btn-atlas']);
  });
});
