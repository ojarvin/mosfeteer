/** Motion that decorates without making anyone wait, with animations on:
 *  a key or a press during a view's move lands it at once, and the wire
 *  sweep a design opens with gives way to the first press. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, browserSkip } from './harness.js';
import { amplifier } from './fixtures.js';

describe('motion that never waits', { skip: browserSkip() }, () => {
  let h;
  before(async () => {
    h = await start({ docs: { amp: amplifier(), other: amplifier() }, width: 1400, height: 900 });
    // The harness reduces motion; these run with it on.
    await h.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const view = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => ({ ...m.editor.view }))`);
  const fitted = () => h.evaluate(`${h.module('canvas-view.js')}.then((m) => ({ ...m.fitTarget() }))`);
  const near = (a, b) => ['x', 'y', 'w', 'h'].every((k) => Math.abs(a[k] - b[k]) < 1e-6);

  test('a key pressed while f fits lands the view at the fit at once', async () => {
    await h.open('amp');
    // Far out, then f, then a key on the very next task.
    await h.evaluate(`Promise.all([${h.module('canvas-view.js')}, ${h.module('editor-state.js')}, ${h.module('main.js')}]).then(([v, s, m]) => { Object.assign(s.editor.view, { x: -6000, y: -6000, w: 12000, h: 8000 }); m.render(); })`);
    await h.key('f');
    await h.key('Shift');
    assert.ok(near(await view(), await fitted()), 'landed at the fit');
  });

  test('a press during a view move lands it before it acts', async () => {
    await h.evaluate(`Promise.all([${h.module('editor-state.js')}, ${h.module('main.js')}]).then(([s, m]) => { Object.assign(s.editor.view, { x: -6000, y: -6000, w: 12000, h: 8000 }); m.render(); })`);
    await h.key('f');
    const at = await h.evaluate(`(() => { const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left + 40, y: r.bottom - 40 }; })()`);
    await h.mouse('mousePressed', at.x, at.y);
    await h.mouse('mouseReleased', at.x, at.y);
    assert.ok(near(await view(), await fitted()), 'landed at the fit');
  });

  test('the wire sweep a design opens with gives way to the first press', async () => {
    await h.open('other');
    await h.until(`!!document.querySelector('#canvas .wire-sweep')`, 3000);
    const at = await h.evaluate(`(() => { const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left + 40, y: r.bottom - 40 }; })()`);
    await h.mouse('mousePressed', at.x, at.y);
    await h.mouse('mouseReleased', at.x, at.y);
    // Faded out, not run to its end: gone well before its 1.8 s crossing.
    await h.until(`!document.querySelector('#canvas .wire-sweep')`, 600);
  });
  test('a pan drops the glass blur from press to release, however still it is held, and the blur fades back in with the dimmed chrome', async () => {
    await h.open('amp');
    const glass = () => h.evaluate(`({ moving: document.documentElement.hasAttribute('data-view-moving'), filter: getComputedStyle(document.querySelector('.mode-toolbar')).backdropFilter, blur: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--glass-blur')) })`);
    assert.equal((await glass()).moving, false);
    const at = await h.evaluate(`(() => { const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await h.mouse('mouseMoved', at.x, at.y, { button: 'none', buttons: 0 });
    await h.mouse('mousePressed', at.x, at.y, { button: 'middle', buttons: 4 });
    await h.mouse('mouseMoved', at.x + 60, at.y + 20, { button: 'middle', buttons: 4 });
    const panning = await glass();
    assert.equal(panning.moving, true);
    assert.equal(panning.filter, 'none');
    // The chrome steps back while it pans, as it does while a part moves.
    assert.equal(await h.evaluate(`document.documentElement.hasAttribute('data-chrome-quiet')`), true, 'dimmed while panning');
    // Held still, it is still a pan: the blur stays off until the release.
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal((await glass()).moving, true, 'held: still moving');
    await h.mouse('mouseReleased', at.x + 60, at.y + 20, { button: 'middle', buttons: 0 });
    // At rest the mark goes; the blur then rises through values between,
    // a fade rather than a switch, to its full 14 px.
    // At the release, with the dimmed chrome: no rest to wait out.
    assert.equal((await glass()).moving, false, 'released: at once');
    assert.equal(await h.evaluate(`document.documentElement.hasAttribute('data-chrome-quiet')`), false, 'back after the release');
    const seen = await h.evaluate(`new Promise((resolve) => { const values = []; const start = performance.now(); const step = () => { values.push(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--glass-blur'))); if (performance.now() - start < 400) requestAnimationFrame(step); else resolve(values); }; step(); })`);
    assert.ok(seen.some((v) => v > 0.5 && v < 13.5), `in between: ${seen.map((v) => v.toFixed(1)).join(' ')}`);
    assert.equal(seen.at(-1), 14);
    for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1] - 1e-6, 'it only rises');
  });
  test('a wheel zoom leaves the glass blur as it is: nothing to pop back', async () => {
    await h.open('amp');
    const at = await h.evaluate(`(() => { const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    for (let i = 0; i < 4; i++) await h.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY: -120 });
    assert.equal(await h.evaluate(`document.documentElement.hasAttribute('data-view-moving')`), false);
    assert.notEqual(await h.evaluate(`getComputedStyle(document.querySelector('.mode-toolbar')).backdropFilter`), 'none');
  });
});
