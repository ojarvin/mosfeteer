/** Reference windows in a browser: the design picker with a long workspace
 *  (the list scrolls under its search field, which keeps its height); a
 *  window closed and shown again keeps its design; its keys while it has
 *  the keyboard; Clear. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, sleep, browserSkip } from './harness.js';
import { amplifier } from './fixtures.js';

describe('reference windows', { skip: browserSkip() }, () => {
  let h;
  const docs = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`design-${String(i).padStart(2, '0')}`, amplifier()]));
  before(async () => { h = await start({ docs, width: 1400, height: 900 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  test('the search field keeps its height above a list that scrolls', async () => {
    await h.open('design-00');
    await h.key('V', { shiftKey: true });
    await h.until(`!!document.querySelector('.reference-picker .context-submenu-search')`);
    const sizes = await h.evaluate(`(() => {
      const list = document.querySelector('.reference-picker');
      const search = list.querySelector('.context-submenu-search');
      return { search: search.getBoundingClientRect().height, item: list.querySelector('button').getBoundingClientRect().height, scrolls: list.scrollHeight > list.clientHeight };
    })()`);
    assert.ok(sizes.scrolls, 'the list is long enough to scroll');
    assert.ok(sizes.search >= sizes.item, JSON.stringify(sizes));
  });

  test('closed and shown again it keeps its design; pressed, f fits it and Shift+V hides it', async () => {
    await h.evaluate(`[...document.querySelectorAll('.reference-picker button')].find((b) => b.textContent.trim() === 'design-07').click()`);
    await h.until(`document.querySelector('.reference-window .reference-title')?.textContent.includes('design-07') && !document.querySelector('.reference-window .reference-picture').hidden`, 5000);
    // × on the last one hides it; Shift+V brings it back as it was.
    await h.click('.reference-window .floating-window-close');
    await h.until(`document.querySelector('.reference-window')?.hidden === true`);
    await h.key('V', { shiftKey: true });
    await h.until(`document.querySelector('.reference-window')?.hidden === false`);
    assert.match(await h.evaluate(`document.querySelector('.reference-window .reference-title').textContent`), /design-07/);
    // Escape on the drawing closes it the same way.
    await h.key('Escape');
    await h.until(`document.querySelector('.reference-window')?.hidden === true`);
    await h.key('V', { shiftKey: true });
    await h.until(`document.querySelector('.reference-window')?.hidden === false && !document.querySelector('.reference-window .reference-picture').hidden`);
    assert.match(await h.evaluate(`document.querySelector('.reference-window .reference-title').textContent`), /design-07/);
    // Pressed, it has the keyboard: zoomed in, f fits it again.
    const picture = () => h.evaluate(`document.querySelector('.reference-window .reference-picture').style.cssText`);
    await h.settle();
    const fitted = await picture();
    const at = await h.evaluate(`(() => { const r = document.querySelector('.reference-window .reference-viewport').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await h.mouse('mouseMoved', at.x, at.y, { button: 'none', buttons: 0 });
    await h.mouse('mousePressed', at.x, at.y);
    await h.mouse('mouseReleased', at.x, at.y);
    assert.equal(await h.evaluate(`document.activeElement === document.querySelector('.reference-window')`), true);
    await h.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY: -300 });
    await h.until(`document.querySelector('.reference-window .reference-picture').style.cssText !== ${JSON.stringify(fitted)}`);
    const type = (key, init = {}) => h.evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true, ...${JSON.stringify(init)} }))`);
    await type('f');
    await h.until(`document.querySelector('.reference-window .reference-picture').style.cssText === ${JSON.stringify(fitted)}`);
    await type('V', { shiftKey: true });
    await h.until(`document.querySelector('.reference-window')?.hidden === true`);
    assert.equal(await h.evaluate(`document.activeElement?.id`), 'canvas');
  });

  test('Clear empties the window, as the calculator\'s does, and the design forgets what it showed', async () => {
    await h.key('V', { shiftKey: true });
    await h.until(`document.querySelector('.reference-window')?.hidden === false && !document.querySelector('.reference-window .reference-picture').hidden`);
    const clear = '.reference-window .window-clear';
    assert.deepEqual(await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.windows.references?.items.map((item) => item.name))`), ['design-07']);
    assert.equal(await h.evaluate(`document.querySelector(${JSON.stringify(clear)}).textContent`), 'Clear');
    await h.click(clear);
    await h.until(`document.querySelector('.reference-window .reference-picture').hidden`);
    assert.match(await h.evaluate(`document.querySelector('.reference-window .reference-title').textContent`), /^Pick a design/);
    assert.match(await h.evaluate(`document.querySelector('.reference-window .reference-message').textContent`), /Pick a design from the title, or paste a picture/);
    assert.equal(await h.evaluate(`document.querySelector(${JSON.stringify(clear)}).disabled`), true);
    assert.deepEqual(await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.windows.references?.items ?? [])`), []);
  });
});
