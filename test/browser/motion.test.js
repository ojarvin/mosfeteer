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
});
