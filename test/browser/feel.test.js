/** How the editor feels in a browser: the marquee box under the pointer
 *  in the same event, the chrome stepping back while a part is dragged,
 *  and the accent color picked under Settings. */

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
      const w1 = parseFloat(first?.style.width);
      const shown = !!first && !first.hidden;
      canvas.dispatchEvent(new MouseEvent('mousemove', at(220, r.height - 220)));
      const w2 = parseFloat(document.querySelector('#canvas .rubber-box')?.style.width);
      window.dispatchEvent(new MouseEvent('mouseup', at(220, r.height - 220)));
      return { w1, w2, shown };
    })()`);
    assert.ok(box.w1 > 0 && box.shown, JSON.stringify(box));
    assert.ok(Math.abs(box.w2 - 2 * box.w1) / box.w1 < 0.1, `twice as far, twice as wide: ${JSON.stringify(box)}`);
    await h.until(`document.querySelector('#canvas .rubber-box')?.hidden === true`);
  });

  test('while a part is dragged the chrome steps back; a selection box leaves it; letting go brings it back', async () => {
    await h.open('two');
    const quiet = `document.documentElement.hasAttribute('data-chrome-quiet')`;
    const railOpacity = `Number(getComputedStyle(document.querySelector('.mode-toolbar')).opacity)`;
    // R1's body: between its two pins.
    const p = await h.evaluate(`Promise.all([${h.module('editor-state.js')}, ${h.module('canvas-view.js')}]).then(([s, v]) => {
      const [a, b] = s.editor.circuit.components.get('R1').worldTerminals();
      return v.worldToClient((a.x + b.x) / 2, (a.y + b.y) / 2);
    })`);
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
    await h.mouse('mousePressed', p.x, p.y);
    assert.equal(await h.evaluate(quiet), false, 'a press alone is not a drag');
    for (let i = 1; i <= 4; i++) await h.mouse('mouseMoved', p.x + 30 * i, p.y + 20 * i);
    await h.until(quiet);
    await h.until(`${railOpacity} < 0.5`);
    await h.mouse('mouseReleased', p.x + 120, p.y + 80);
    await h.until(`!${quiet} && ${railOpacity} === 1`);
    // A selection box from empty paper looks around: the chrome stays.
    const empty = await h.evaluate(`${h.module('canvas-view.js')}.then((v) => v.worldToClient(400, 800))`);
    await h.mouse('mouseMoved', empty.x, empty.y, { button: 'none', buttons: 0 });
    await h.mouse('mousePressed', empty.x, empty.y);
    for (let i = 1; i <= 4; i++) await h.mouse('mouseMoved', empty.x + 30 * i, empty.y - 20 * i);
    await h.settle();
    assert.equal(await h.evaluate(quiet), false);
    await h.mouse('mouseReleased', empty.x + 120, empty.y - 80);
    await h.key('Escape');
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
