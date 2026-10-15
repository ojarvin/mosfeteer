/** The history window in a browser: save points from each Save, viewing
 *  and restoring one (one undo step), pinning checkpoints, removing
 *  entries, and starting a new design from one -- all kept in the file. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { start, browserSkip } from './harness.js';
import { amplifier } from './fixtures.js';
import { historyEntries, historyText } from '../../src/core/save-history.js';

describe('save history', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { amp: amplifier(), other: amplifier() } }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const session = (expression) => h.evaluate(`${h.module('document-session.js')}.then((m) => ${expression})`);
  const m1x = () => h.evaluate(`window.__circuit().comps.find((c) => c.refdes === 'M1').x`);
  const onDisk = async () => {
    const state = JSON.parse(await readFile(join(h.workspace, 'amp.json'), 'utf8'));
    return historyEntries(state.history, historyText(state));
  };
  const save = async () => {
    await h.key('s', { ctrlKey: true });
    await h.until(`${h.module('document-session.js')}.then((m) => !m.hasUnsavedChanges())`);
  };
  const rows = () => h.evaluate(`[...document.querySelectorAll('.history-entry')].map((row) => ({
    label: row.querySelector('.history-label').textContent, pinned: row.classList.contains('pinned'), file: !!row.querySelector('.history-current'),
  }))`);
  const rowButton = (index, text) => h.evaluate(`[...document.querySelectorAll('.history-entry')[${index}].querySelectorAll('button')].find((b) => b.textContent === ${JSON.stringify(text)}).click()`);
  const menuItem = (text) => h.evaluate(`[...document.querySelectorAll('.component-context-menu button, #component-context-menu button')].find((b) => b.textContent.startsWith(${JSON.stringify(text)})).click()`);

  test('each Save is a save point; the window lists them, newest (the file) first', async () => {
    await h.open('amp');
    await h.evaluate(`window.__run('move M1 40 0')`);
    await save();
    await h.evaluate(`window.__run('move M1 80 0')`);
    await save();
    assert.equal((await onDisk()).length, 2);
    await h.click('#btn-history');
    await h.until(`document.querySelectorAll('.history-entry').length === 2`);
    assert.deepEqual(await rows(), [{ label: 'Saved', pinned: false, file: true }, { label: 'Saved', pinned: false, file: false }]);
  });

  test('View shows a save point beside the drawing; Restore brings it back as one undo step', async () => {
    await rowButton(1, 'View');
    await h.until(`[...document.querySelectorAll('.reference-window:not([hidden]) .reference-title')].some((t) => t.textContent.includes('amp @'))`);
    await h.until(`!!document.querySelector('.reference-window:not([hidden]) .reference-picture:not([hidden])')`);
    await rowButton(1, 'Restore');
    await h.until(`window.__circuit().comps.find((c) => c.refdes === 'M1').x === 40`);
    assert.equal(await session('m.hasUnsavedChanges()'), true);
    await h.key('u');
    await h.until(`window.__circuit().comps.find((c) => c.refdes === 'M1').x === 80`);
    assert.equal(await session('m.hasUnsavedChanges()'), false);
  });

  test('a save point pinned from its menu is a named checkpoint, written at once', async () => {
    await rowButton(1, '⋯');
    await menuItem('Pin as checkpoint');
    await h.until(`!!document.querySelector('.history-form .history-name')`);
    await h.evaluate(`(() => {
      document.querySelector('.history-form .history-name').value = 'first move';
      document.querySelector('.history-form .history-comment').value = 'M1 one cell right';
      document.querySelector('.history-form').requestSubmit();
    })()`);
    await h.until(`[...document.querySelectorAll('.history-entry.pinned .history-label')].some((l) => l.textContent === 'first move')`);
    const pinned = (await onDisk()).find((entry) => entry.pinned);
    assert.equal(pinned.name, 'first move');
    assert.equal(pinned.comment, 'M1 one cell right');
    assert.equal(await session('m.hasUnsavedChanges()'), false, 'pinning is no edit');
  });

  test('Checkpoint saves unsaved edits first, then pins them', async () => {
    await h.evaluate(`window.__run('move M1 120 0')`);
    await h.click('.history-checkpoint');
    await h.until(`!!document.querySelector('.history-top .history-name')`);
    await h.evaluate(`(() => { document.querySelector('.history-top .history-name').value = 'works'; document.querySelector('.history-top .history-form').requestSubmit(); })()`);
    await h.until(`[...document.querySelectorAll('.history-entry.pinned .history-label')].some((l) => l.textContent === 'works')`);
    assert.equal(await session('m.hasUnsavedChanges()'), false);
    const list = await onDisk();
    assert.equal(list[0].name, 'works');
    assert.ok(list[0].text.includes('"x": 120'));
    assert.equal(await m1x(), 120);
  });

  test('× removes a save point at once and asks before a checkpoint; Remove save points keeps checkpoints', async () => {
    const before = (await onDisk()).length;
    await h.evaluate(`document.querySelector('.history-entry:not(.pinned) .history-remove').click()`);
    await h.until(`document.querySelectorAll('.history-entry').length === ${before - 1}`);
    assert.equal((await onDisk()).length, before - 1);
    await h.evaluate(`document.querySelector('.history-entry.pinned .history-remove').click()`);
    await h.until(`!!document.querySelector('dialog.confirm-dialog[open]')`);
    await h.evaluate(`[...document.querySelectorAll('dialog.confirm-dialog[open] button')].find((b) => b.value === 'choice:0').click()`);
    await h.until(`document.querySelectorAll('.history-entry').length === ${before - 2}`);
    await h.evaluate(`window.__run('move M1 160 0')`);
    await save();
    await h.until(`!document.querySelector('.history-clear').hidden`);
    await h.click('.history-clear');
    await h.until(`document.querySelectorAll('.history-entry:not(.pinned)').length === 0 && document.querySelectorAll('.history-entry.pinned').length === 1`);
    assert.deepEqual((await onDisk()).map((entry) => entry.pinned === true), [true]);
  });

  test('a checkpoint starts a new design, unsaved, with no history of its own', async () => {
    await rowButton(0, '⋯');
    await menuItem('New design from this');
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.currentDocumentPath === null)`);
    // The checkpoint left is the first move's.
    assert.equal(await h.evaluate(`document.getElementById('circuit-name').value`), 'amp-first-move');
    assert.equal(await m1x(), 40);
    assert.equal(await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.history)`), null);
    await h.until(`!!document.querySelector('.history-message:not([hidden])')`);
  });
});
