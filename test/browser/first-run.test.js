/** A first visit in a browser: browser-only with nothing open, the empty
 *  desk leads with a folder for every design; a new design is named before
 *  its first save, which never answers with an error. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, sleep, browserSkip } from './harness.js';

describe('first visit, browser-only', { skip: browserSkip() }, () => {
  let h;
  before(async () => {
    h = await start({ width: 1400, height: 900 });
    await h.send('Page.navigate', { url: `http://127.0.0.1:${h.port}/?browser-only=1` });
    await h.until(`typeof window.__circuit === 'function' && document.readyState === 'complete' && !document.getElementById('startup-cover')`, 15000);
    await h.until(`!document.getElementById('atlas').hidden && !!document.querySelector('.atlas-empty')`, 10000);
  });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const shown = (selector) => h.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return !!el && getComputedStyle(el).display !== 'none' && !el.hidden; })()`);
  const status = () => h.evaluate(`document.getElementById('status-message').textContent`);

  test('the empty desk leads with one folder for every design, and hides what has nothing to act on', async () => {
    const card = await h.evaluate(`(() => { const c = document.querySelector('.atlas-empty'); return { heading: c.querySelector('h2').textContent, text: c.querySelector('p').textContent, buttons: [...c.querySelectorAll('.atlas-empty-actions button')].map((b) => b.textContent + (b.classList.contains('primary-action') ? '*' : '')) }; })()`);
    assert.equal(card.heading, 'Keep your designs in one folder');
    assert.match(card.text, /new designs save into it/);
    assert.deepEqual(card.buttons, ['Open folder…*', 'New design', 'Open design…']);
    assert.equal(await h.evaluate(`document.getElementById('atlas-title').textContent`), 'No folder yet');
    for (const id of ['#atlas-export', '#atlas-close', '#atlas-hint']) assert.equal(await shown(id), false, `${id} steps aside`);
  });

  test('a new design says to name it and press Enter, and where it goes', async () => {
    await h.evaluate(`[...document.querySelectorAll('.atlas-empty button')].find((b) => b.textContent === 'New design').click()`);
    await h.until(`document.getElementById('atlas').hidden && document.activeElement?.id === 'circuit-name'`, 10000);
    assert.match(await status(), /^New design: name it and press Enter, then choose where it goes/);
  });

  test('Ctrl+S before naming opens the save picker with a name to change, not an error', async () => {
    await h.evaluate(`window.__run('add resistor R1 --at 0 0')`);
    const errors = () => h.evaluate(`document.querySelectorAll('#log .error').length`);
    const before = await errors();
    await h.evaluate(`window.__picked = []; window.showSaveFilePicker = async (options) => { window.__picked.push(options.suggestedName); throw Object.assign(new Error('closed'), { name: 'AbortError' }); };`);
    await h.key('s', { ctrlKey: true });
    await h.until(`window.__picked.length === 1`);
    assert.deepEqual(await h.evaluate('window.__picked'), ['untitled.json']);
    await h.settle();
    assert.match(await status(), /^Save canceled/);
    assert.equal(await errors(), before, 'no error logged');
  });

  test('a name typed, Enter saves it through the picker under that name', async () => {
    await h.evaluate(`(() => { const input = document.getElementById('circuit-name'); input.focus(); input.value = 'amp'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`);
    await h.until(`window.__picked.length === 2`);
    assert.equal(await h.evaluate('window.__picked[1]'), 'amp.json');
  });
});

describe('first save with a workspace folder', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ width: 1400, height: 900 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  test('Ctrl+S before naming asks at the name field; Enter there saves into the folder', async () => {
    await h.evaluate(`${h.module('document-session.js')}.then((m) => m.startNewDocument())`);
    await h.until(`document.activeElement?.id === 'circuit-name'`);
    await h.evaluate(`window.__run('add resistor R1 --at 0 0')`);
    await h.key('s', { ctrlKey: true });
    await h.until(`document.getElementById('circuit-name').classList.contains('needs-name')`);
    assert.equal(await h.evaluate(`document.activeElement?.id`), 'circuit-name');
    const log = await h.evaluate(`document.querySelector('.log-lines, #log')?.textContent || ''`);
    assert.doesNotMatch(log, /Names cannot start/, 'no error about forbidden characters');
    await h.evaluate(`(() => { const input = document.getElementById('circuit-name'); input.value = 'first'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`);
    await h.until(`${h.module('editor-state.js')}.then((m) => /first\\.json$/.test(m.editor.currentDocumentPath || ''))`);
    assert.equal(await h.evaluate(`document.getElementById('circuit-name').classList.contains('needs-name')`), false);
  });
});
