/** The loop gain in the analysis window: typed where the loop breaks (a
 *  terminal, the net that closes it), with the drawing's points offered,
 *  derived into rows; a transistor alone says what to write. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, browserSkip } from './harness.js';
import { unityOta } from './fixtures.js';

describe('loop gain where the drawing says', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { ota: unityOta() }, width: 1500, height: 950 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const select = (id, text) => h.evaluate(`(() => { const s = document.getElementById(${JSON.stringify(id)}); const o = [...s.options].find((o) => o.textContent.startsWith(${JSON.stringify(text)})); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const breakAt = (text) => h.evaluate(`(() => { const f = document.getElementById('analysis-loop-element'); f.value = ${JSON.stringify(text)}; f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const rows = () => h.evaluate(`document.getElementById('analysis-equation').textContent`);
  // The button itself: the rows above it re-render as each result lands.
  const derive = async () => { await h.evaluate(`document.getElementById('analysis-submit').click()`); await h.settle(); };

  test('the field offers the opamps, gates, and named nets, and a terminal gives T', async () => {
    await h.open('ota');
    if (await h.evaluate(`document.getElementById('analysis-dialog').hidden`)) await h.click('#btn-analysis');
    await h.until(`!document.getElementById('analysis-dialog').hidden`);
    await select('analysis-input', 'VIN');
    await select('analysis-target', 'VOUT');
    const offered = await h.evaluate(`[...document.querySelectorAll('#analysis-loop-points option')].map((o) => o.value)`);
    for (const point of ['M1.g', 'M2.g', 'M3.g', 'M4.g', 'VIN', 'VOUT']) assert.ok(offered.includes(point), `${point} in ${offered}`);
    await breakAt('M2.g');
    await derive();
    await h.until(`/loop gain at M2\\.g/i.test(document.getElementById('analysis-equation').textContent)`, 60000);
    assert.equal(await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.windows?.analysis?.loopElement)`), 'M2.g', 'kept with the design');
  });

  test('the net that closes the loop gives the same loop; a transistor alone says to name a terminal', async () => {
    const loopRows = (text) => text.slice(text.indexOf('Loop gain')).replace(/at \S+/, '');
    const atTerminal = loopRows(await rows());
    await breakAt('VOUT');
    await derive();
    await h.until(`/loop gain at VOUT/i.test(document.getElementById('analysis-equation').textContent)`, 60000);
    assert.equal(loopRows(await rows()), atTerminal);
    await breakAt('M2');
    await derive();
    // The row is TeX text: its spaces are non-breaking.
    await h.until(`/M2 is a transistor: break the loop at one of its terminals, such as M2\\.g/.test(document.getElementById('analysis-equation').textContent.replace(/\\s+/g, ' '))`, 60000);
  });
});
