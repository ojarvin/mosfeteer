/** How the editor feels in a browser: the marquee box under the pointer
 *  in the same event, and the accent color picked under Settings. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, browserSkip } from './harness.js';
import { twoResistors } from './fixtures.js';

describe('editor feel', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { two: twoResistors() } }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  test('the marquee box is where the pointer is in the same event, before any frame is drawn', async () => {
    await h.open('two');
    // One task: press on empty canvas, move, and read the box -- no frame
    // can run in between.
    const box = await h.evaluate(`(() => {
      const canvas = document.getElementById('canvas');
      const r = canvas.getBoundingClientRect();
      const at = (x, y) => ({ bubbles: true, cancelable: true, clientX: r.left + x, clientY: r.top + y, button: 0, buttons: 1, view: window });
      canvas.dispatchEvent(new MouseEvent('mousedown', at(20, r.height - 20)));
      canvas.dispatchEvent(new MouseEvent('mousemove', at(120, r.height - 120)));
      const first = document.querySelector('#canvas .rubber-box');
      const w1 = Number(first?.getAttribute('width'));
      const shown = !!first && first.getAttribute('display') !== 'none';
      canvas.dispatchEvent(new MouseEvent('mousemove', at(220, r.height - 220)));
      const w2 = Number(document.querySelector('#canvas .rubber-box')?.getAttribute('width'));
      window.dispatchEvent(new MouseEvent('mouseup', at(220, r.height - 220)));
      return { w1, w2, shown };
    })()`);
    assert.ok(box.w1 > 0 && box.shown, JSON.stringify(box));
    assert.ok(Math.abs(box.w2 - 2 * box.w1) / box.w1 < 0.1, `twice as far, twice as wide: ${JSON.stringify(box)}`);
    await h.until(`document.querySelector('#canvas .rubber-box')?.getAttribute('display') === 'none'`);
  });

  test('Settings → Accent color changes the accent in both themes; Default brings the teal back', async () => {
    const accent = () => h.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`);
    const teal = await accent();
    assert.ok(['#0e7c7b', '#1a9e93'].includes(teal), teal);
    await h.evaluate(`document.querySelector('#settings-accent [data-accent="blue"]').click()`);
    const light = await accent(); // in the theme it started in
    assert.match(light, /^#[0-9a-f]{6}$/);
    assert.notEqual(light, teal);
    assert.equal(await h.evaluate(`document.querySelector('#settings-accent [data-accent="blue"]').getAttribute('aria-checked')`), 'true');
    const wasDark = await h.evaluate(`document.documentElement.classList.contains('dark')`);
    await h.key('D', { shiftKey: true });
    await h.until(`document.documentElement.classList.contains('dark') === ${!wasDark}`);
    const dark = await accent(); // in the other
    assert.match(dark, /^#[0-9a-f]{6}$/);
    assert.notEqual(dark, light, 'a shade for each theme');
    await h.key('D', { shiftKey: true });
    await h.until(`document.documentElement.classList.contains('dark') === ${wasDark}`);
    await h.evaluate(`document.querySelector('#settings-accent [data-accent=""]').click()`);
    assert.equal(await accent(), teal);
  });
});
