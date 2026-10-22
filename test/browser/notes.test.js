/** The notes window in a browser: writing Markdown, its rendered view,
 *  mentions that glow and select, renames that follow into the notes, one
 *  undo step per edit, and the notes saved with the design. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { start, browserSkip } from './harness.js';
import { amplifier } from './fixtures.js';

describe('design notes', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { amp: amplifier(), child: amplifier() } }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const editor = (expression) => h.evaluate(`${h.module('editor-state.js')}.then((m) => { const editor = m.editor; return ${expression}; })`);
  const typeNotes = (text) => h.evaluate(`(() => {
    const field = document.querySelector('.notes-source');
    field.focus();
    field.value = ${JSON.stringify(text)};
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const finish = () => h.evaluate(`document.querySelector('.notes-source').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);

  test('n opens empty notes ready to write; Esc shows them rendered, mentions and links live', async () => {
    await h.open('amp');
    await h.key('N', { shiftKey: true });
    await h.until(`!!document.querySelector('.notes-window:not([hidden])') && document.activeElement === document.querySelector('.notes-source')`);
    await typeNotes('# Bias\nGain from @M1 into @V_{SS}; see [[child]] and [[gone]]. $g_m r_o$');
    assert.equal(await editor('editor.circuit.notes'), '# Bias\nGain from @M1 into @V_{SS}; see [[child]] and [[gone]]. $g_m r_o$');
    assert.equal(await h.evaluate(`${h.module('document-session.js')}.then((m) => m.hasUnsavedChanges())`), true, 'unsaved');
    await finish();
    await h.until(`!!document.querySelector('.notes-view:not([hidden]) h3')`);
    const view = await h.evaluate(`(() => {
      const v = document.querySelector('.notes-view');
      return {
        heading: v.querySelector('h3').textContent,
        part: v.querySelector('.note-mention-component')?.dataset.mention,
        net: v.querySelector('.note-mention-net')?.dataset.mention,
        link: v.querySelector('.note-design:not(.broken)')?.dataset.design,
        broken: v.querySelector('.note-design.broken')?.dataset.design,
        math: !!v.querySelector('math'),
        source: document.querySelector('.notes-source').hidden,
      };
    })()`);
    assert.deepEqual(view, { heading: 'Bias', part: 'M1', net: 'V_{SS}', link: 'child', broken: 'gone', math: true, source: true });
  });

  test('a mention glows its part or net while hovered, and a click selects it', async () => {
    await h.evaluate(`document.querySelector('.note-mention-component').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`);
    assert.deepEqual(await editor('editor.hoverTarget'), { kind: 'component', refdes: 'M1' });
    await h.evaluate(`document.querySelector('.note-mention-component').dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))`);
    assert.equal(await editor('editor.hoverTarget'), null);
    await h.evaluate(`document.querySelector('.note-mention-net').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`);
    assert.equal(await editor('editor.hoverTarget?.kind'), 'net');
    await h.evaluate(`document.querySelector('.note-mention-net').dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))`);
    await h.click('.note-mention-component');
    assert.deepEqual(await editor('[...editor.multi]'), ['M1']);
    await h.click('.note-mention-net');
    assert.equal(await editor('editor.selectedNets.size'), 1);
  });

  test('renaming a part rewrites its mention, and undo takes both back', async () => {
    await h.evaluate(`window.__run('rename M1 Min')`);
    await h.until(`document.querySelector('.note-mention-component')?.dataset.mention === 'Min'`);
    assert.match(await editor('editor.circuit.notes'), /Gain from @Min into/);
    await h.key('u');
    await h.until(`document.querySelector('.note-mention-component')?.dataset.mention === 'M1'`);
    assert.match(await editor('editor.circuit.notes'), /Gain from @M1 into/);
  });

  test('an edit is one undo step, and the notes are saved with the design', async () => {
    await h.click('.notes-edit');
    await typeNotes('First');
    await typeNotes('First line\nSecond');
    await finish();
    await h.until(`document.querySelector('.notes-view p')?.textContent.startsWith('First line')`);
    await h.key('u');
    await h.until(`document.querySelector('.notes-view h3')?.textContent === 'Bias'`);
    await h.key('U', { shiftKey: true });
    await h.until(`document.querySelector('.notes-view p')?.textContent.startsWith('First line')`);
    await h.key('s', { ctrlKey: true });
    await h.until(`${h.module('document-session.js')}.then((m) => !m.hasUnsavedChanges())`);
    const saved = JSON.parse(await readFile(join(h.workspace, 'amp.json'), 'utf8'));
    assert.equal(saved.notes, 'First line\nSecond');
  });

  test('Copy puts the notes on the clipboard as plain Markdown', async () => {
    await h.click('.notes-edit');
    await typeNotes('Gain from @M1 into @V_{SS}, see [[child]]');
    await finish();
    await h.until(`document.querySelector('.notes-copy')?.disabled === false`);
    await h.evaluate(`(() => { window.__copied = null; navigator.clipboard.writeText = async (text) => { window.__copied = text; }; })()`);
    await h.click('.notes-copy');
    await h.until(`window.__copied !== null`);
    assert.equal(await h.evaluate(`window.__copied`), 'Gain from M1 into $V_{SS}$, see child');
    assert.equal(await editor('editor.circuit.notes'), 'Gain from @M1 into @V_{SS}, see [[child]]');
  });

  test('[[ completes design names and @ parts and nets, at the caret; Esc closes only the list', async () => {
    await h.click('.notes-edit');
    const key = (name) => h.evaluate(`document.querySelector('.notes-source').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(name)}, bubbles: true, cancelable: true }))`);
    const options = () => h.evaluate(`[...document.querySelectorAll('#notes-suggestions:not([hidden]) li')].map((li) => li.querySelector('.notes-suggestion-name').textContent + (li.getAttribute('aria-selected') === 'true' ? '*' : ''))`);
    const value = () => h.evaluate(`document.querySelector('.notes-source').value`);

    await typeNotes('See [[');
    assert.equal(await h.evaluate(`document.querySelector('.notes-copy').disabled`), false, 'Copy follows the typing');
    assert.deepEqual(await options(), ['child*'], 'the other designs, not this one');
    await key('Enter');
    assert.equal(await value(), 'See [[child]]');
    assert.deepEqual(await options(), []);

    await typeNotes('See [[child]] and @V');
    assert.deepEqual(await options(), ['V_{SS}*', 'VDD', 'VIN', 'VOUT'], 'the net V_{DD} is left out: @VDD finds the part');
    // The list sits at the caret, inside the window.
    const box = await h.evaluate(`(() => { const l = document.getElementById('notes-suggestions').getBoundingClientRect(); const f = document.querySelector('.notes-source').getBoundingClientRect(); return { inside: l.left >= f.left && l.top > f.top && l.top < f.bottom }; })()`);
    assert.deepEqual(box, { inside: true });
    await key('ArrowDown');
    assert.deepEqual(await options(), ['V_{SS}', 'VDD*', 'VIN', 'VOUT']);
    await key('Tab');
    assert.equal(await value(), 'See [[child]] and @VDD');
    assert.equal(await editor('editor.circuit.notes'), 'See [[child]] and @VDD');

    await typeNotes('See [[child]] and @VDD into @V_{S');
    assert.deepEqual(await options(), ['V_{SS}*']);
    await key('Escape');
    assert.deepEqual(await options(), []);
    assert.equal(await h.evaluate(`document.querySelector('.notes-source').hidden`), false, 'still editing');
    await finish();
  });

  test('Tab indents the lines under the caret into a sublist, Shift+Tab takes them back', async () => {
    await h.click('.notes-edit');
    await typeNotes('- bias\n- tail\n- mirror');
    const tab = (shiftKey, from, to) => h.evaluate(`(() => {
      const field = document.querySelector('.notes-source');
      field.focus();
      field.setSelectionRange(${from}, ${to});
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: ${shiftKey}, bubbles: true, cancelable: true }));
      return field.value;
    })()`);
    // The caret in "- tail", then a selection over "- tail" and "- mirror".
    assert.equal(await tab(false, 10, 10), '- bias\n  - tail\n- mirror');
    assert.equal(await h.evaluate(`document.querySelector('.notes-source').selectionStart`), 12, 'the caret moves with its text');
    assert.equal(await tab(false, 9, 24), '- bias\n    - tail\n  - mirror');
    assert.equal(await tab(true, 9, 26), '- bias\n  - tail\n- mirror');
    assert.equal(await editor('editor.circuit.notes'), '- bias\n  - tail\n- mirror');
    assert.equal(await h.evaluate(`document.activeElement === document.querySelector('.notes-source')`), true, 'Tab stays in the field');
    await finish();
    await h.until(`!!document.querySelector('.notes-view ul ul li')`);
    assert.equal(await h.evaluate(`document.querySelector('.notes-view ul ul li').textContent`), 'tail');
  });

  test('another design shows its own notes, and n closes the window', async () => {
    await h.open('child');
    await h.until(`!document.querySelector('.notes-view h3') && document.querySelector('.notes-source')?.hidden === false || !!document.querySelector('.notes-empty:not([hidden])')`);
    assert.equal(await editor('editor.circuit.notes'), '');
    await h.key('N', { shiftKey: true });
    assert.equal(await h.evaluate(`document.querySelector('.notes-window').hidden`), true);
  });
});
