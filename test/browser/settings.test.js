/** Settings are kept: the Display toggles come back as they were left after
 *  the editor is reloaded. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, browserSkip } from './harness.js';
import { amplifier } from './fixtures.js';

describe('settings', { skip: browserSkip() }, () => {
  let h;
  before(async () => {
    h = await start({ docs: { amp: amplifier() }, width: 1400, height: 900 });
    await h.open('amp');
  });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const ids = ['btn-grid', 'btn-guides', 'btn-crosshair', 'btn-net-beams'];
  const checked = () => h.evaluate(`${JSON.stringify(ids)}.map((id) => document.getElementById(id).getAttribute('aria-checked'))`);
  const shown = () => h.evaluate(`Promise.all([${h.module('editor-state.js')}, ${h.module('net-beams.js')}]).then(([s, b]) => [s.editor.showGrid, s.editor.guidesVisible, s.editor.crosshairVisible, b.netBeamsShown()])`);

  test('the Display toggles are kept after a reload', async () => {
    assert.deepEqual(await shown(), [true, true, false, false]);
    for (const id of ids) await h.click(`#${id}`);
    assert.deepEqual(await shown(), [false, false, true, true]);
    // Marked, so the wait below is for the reloaded page, not this one.
    await h.evaluate(`window.__beforeReload = true`);
    await h.send('Page.reload', {});
    await h.until(`!window.__beforeReload && typeof window.__circuit === 'function' && document.readyState === 'complete' && !document.getElementById('startup-cover')`, 15000);
    assert.deepEqual(await shown(), [false, false, true, true]);
    assert.deepEqual(await checked(), ['false', 'false', 'true', 'true']);
  });
});
