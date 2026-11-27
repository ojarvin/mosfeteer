/** The notes window in a browser: writing Markdown, its rendered view,
 *  mentions that glow and select, renames that follow into the notes, one
 *  undo step per edit, and the notes saved with the design. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { start, sleep, browserSkip } from './harness.js';
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

  test('a picture pasted into the source is kept in the design, placed at the caret, drawn, and saved', async () => {
    await h.click('.notes-edit');
    await typeNotes('Before\n\nAfter');
    // A real PNG on the clipboard, pasted with the caret after "Before\n\n".
    await h.evaluate(`(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 40; canvas.height = 20;
      const g = canvas.getContext('2d'); g.fillStyle = '#c00'; g.fillRect(0, 0, 40, 20);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const data = new DataTransfer();
      data.items.add(new File([blob], 'shot.png', { type: 'image/png' }));
      const field = document.querySelector('.notes-source');
      field.setSelectionRange(8, 8);
      field.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    })()`);
    await h.until(`document.querySelector('.notes-source').value.includes('![](picture:1)')`);
    assert.equal(await h.evaluate(`document.querySelector('.notes-source').value`), 'Before\n\n![](picture:1)After');
    assert.match(await editor('editor.circuit.pictures[1]'), /^data:image\/(png|webp);base64,/);
    await finish();
    await h.until(`!!document.querySelector('.notes-view img.note-picture')`);
    // Nothing went onto the drawing.
    assert.equal(await editor('[...editor.circuit.labels.values()].some((l) => l.image)'), false);
    await h.key('s', { ctrlKey: true });
    await h.until(`${h.module('document-session.js')}.then((m) => !m.hasUnsavedChanges())`);
    const saved = JSON.parse(await readFile(join(h.workspace, 'amp.json'), 'utf8'));
    assert.match(saved.pictures['1'], /^data:image\//);
    // Undone with the notes: the reference and the picture go together.
    await h.key('u');
    await h.until(`!document.querySelector('.notes-view img.note-picture')`);
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
    const options = () => h.evaluate(`[...document.querySelectorAll('#notes-suggestions:not([hidden]) li[role=option]')].map((li) => li.querySelector('.notes-suggestion-name').textContent + (li.getAttribute('aria-selected') === 'true' ? '*' : ''))`);
    const value = () => h.evaluate(`document.querySelector('.notes-source').value`);

    await typeNotes('See [[');
    assert.equal(await h.evaluate(`document.querySelector('.notes-copy').disabled`), false, 'Copy follows the typing');
    assert.deepEqual((await options()).slice(0, 3), ['child*', 'circuit', 'drawing'], 'the other designs, not this one, then the figures');
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

  test('a click on a figure on the drawing, while [[# is being completed, puts its name in', async () => {
    await h.evaluate(`window.__run('partstable')`);
    await h.click('.notes-edit');
    await typeNotes('See [[#');
    await h.until(`!document.getElementById('notes-suggestions').hidden`);
    assert.equal(await h.evaluate(`document.querySelector('#notes-suggestions .notes-suggestion-hint')?.textContent`), 'Or click a figure on the drawing');
    const id = await editor(`[...editor.circuit.labels.values()].find((l) => l.table).figure.id`);
    await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.fitView())`);
    await h.settle();
    // A point of the table the notes window does not cover.
    const p = await h.evaluate(`${h.module('editor-state.js')}.then(async (m) => {
      const view = await ${h.module('canvas-view.js')};
      const b = [...m.editor.circuit.labels.values()].find((l) => l.table).bbox();
      const canvas = document.getElementById('canvas');
      for (let fy = 0.2; fy < 1; fy += 0.2) for (let fx = 0.2; fx < 1; fx += 0.2) {
        const c = view.worldToClient(b.x + b.w * fx, b.y + b.h * fy);
        if (canvas.contains(document.elementFromPoint(c.x, c.y))) return c;
      }
      return null;
    })`);
    assert.ok(p, 'the table is in sight');
    await h.tap(p.x, p.y);
    await h.until(`document.querySelector('.notes-source').value === 'See [[#${id}]]'`);
    assert.equal(await h.evaluate(`document.activeElement === document.querySelector('.notes-source')`), true, 'back to writing');
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

  test('a design link\'s right-click menu opens it or shows it in a reference window', async () => {
    await h.click('.notes-edit');
    await typeNotes('See [[child]] and [[gone]]');
    await finish();
    await h.until(`!!document.querySelector('.notes-view .note-design.broken')`);
    const menuFor = async (selector) => {
      await h.evaluate(`(() => { const a = document.querySelector(${JSON.stringify(selector)}); const r = a.getBoundingClientRect(); a.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 2, clientY: r.top + 2 })); })()`);
      return h.evaluate(`[...document.querySelectorAll('#component-context-menu:not([hidden]) button')].map((b) => b.textContent + (b.disabled ? ' (off)' : ''))`);
    };
    assert.deepEqual(await menuFor('.note-design.broken'), ['Open gone (off)', 'Show in a reference window (off)']);
    assert.deepEqual(await menuFor('.note-design:not(.broken)'), ['Open child', 'Show in a reference window']);
    await h.evaluate(`[...document.querySelectorAll('#component-context-menu button')].find((b) => b.textContent === 'Show in a reference window').click()`);
    await h.until(`[...document.querySelectorAll('.reference-window:not([hidden]) .reference-title')].some((t) => t.textContent.startsWith('child'))`);
    assert.equal(await editor('editor.currentCircuitName'), 'amp', 'the editor stays on its design');
    // Again: the window already showing it, not a second one.
    await menuFor('.note-design:not(.broken)');
    await h.evaluate(`[...document.querySelectorAll('#component-context-menu button')].find((b) => b.textContent === 'Show in a reference window').click()`);
    assert.equal(await h.evaluate(`document.querySelectorAll('.reference-window:not(.model-window)').length`), 1);
    await h.evaluate(`document.querySelector('.reference-window .floating-window-close')?.click()`);
  });

  test('a citation reads [N] and a click goes to its source in the list, in the window', async () => {
    await h.open('amp');
    await h.evaluate(`window.__run('notes set "Level shifting [^https://example.com/cls|CLS paper], again [^https://example.com/cls]."')`);
    if (await h.evaluate(`document.querySelector('.notes-window').hidden`)) await h.key('N', { shiftKey: true });
    await h.until(`!!document.querySelector('.notes-view:not([hidden]) .note-references')`);
    const view = await h.evaluate(`(() => {
      const v = document.querySelector('.notes-view');
      return { cites: [...v.querySelectorAll('.note-cite')].map((a) => a.textContent), entry: v.querySelector('#ref-1').textContent };
    })()`);
    assert.deepEqual(view, { cites: ['[1]', '[1]'], entry: 'CLS paper. https://example.com/cls' });
    await h.evaluate(`document.querySelector('.note-cite').click()`);
    assert.equal(await h.evaluate(`location.hash`), '', 'the page stays where it is');
    await h.evaluate(`window.__run('notes clear')`);
  });

  test('Outline starts empty notes from the drawing, one undo step, and leaves when there are notes', async () => {
    await h.open('amp');
    await h.evaluate(`window.__run('notes clear')`);
    if (await h.evaluate(`document.querySelector('.notes-window').hidden`)) await h.key('N', { shiftKey: true });
    await h.until(`!!document.querySelector('.notes-window:not([hidden])')`);
    await h.until(`document.querySelector('.notes-outline').hidden === false`);
    await h.click('.notes-outline');
    await h.until(`document.querySelector('.notes-source').value.startsWith('# amp')`);
    assert.match(await editor('editor.circuit.notes'), /^# amp\n\nAuthor: Your name\n\n\[TOC\]\n\n## Circuit\n\nWhat the circuit is and does\.\n\n!\[\[circuit\|The circuit\.\]\]/);
    assert.equal(await h.evaluate(`document.querySelector('.notes-outline').hidden`), true);
    await h.evaluate(`document.querySelector('.notes-source').blur()`);
    await h.key('z', { ctrlKey: true });
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.notes === '')`);
  });

  test('the report example keeps its math labels\' measured sizes: figures drawn outside the editor are framed as the editor frames them', async () => {
    const { reportExampleDesigns } = await import('../../src/web/examples/report-example.js');
    for (const { name, state } of reportExampleDesigns()) {
      await h.evaluate(`window.__load(${JSON.stringify(JSON.stringify(state))})`);
      const measured = await h.evaluate(`${h.module('main.js')}.then(async (m) => {
        const { editor } = await import('./editor-state.js');
        for (let i = 0; i < 4 && m.syncRenderedLabelMetrics(); i++) { editor.committedCanvasKey = ''; m.render(); }
        return Object.fromEntries(editor.circuit.toJSON().labels.filter((l) => l.mathBox).map((l) => [l.id, l.mathBox]));
      })`);
      const stored = Object.fromEntries(state.labels.filter((l) => l.mathBox).map((l) => [l.id, l.mathBox]));
      assert.deepEqual(stored, measured, `${name}: a stored math size is stale; measure the example again and save it`);
    }
  });

  test('Learn\'s report example opens unsaved, its integrator from the bundle, and saving keeps both designs', async () => {
    const exists = (name) => readFile(join(h.workspace, `${name}.json`), 'utf8').then(() => true, () => false);
    // Opened from Learn over the Atlas, it shows in the editor.
    await h.click('#app-mark');
    await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !!s && !s.busy; })`, 10000);
    await h.evaluate(`${h.module('help.js')}.then((m) => m.showHelp('tutorial'))`);
    await h.until(`!!document.getElementById('btn-report-example')?.getClientRects().length`);
    await h.click('#btn-report-example');
    // Unsaved changes are asked about first, as for any document.
    await h.until(`document.getElementById('switch-dialog').open || document.getElementById('circuit-name').value === 'report-example-modulator'`);
    if (await h.evaluate(`document.getElementById('switch-dialog').open`)) await h.click('#switch-dialog [value="discard"]');
    await h.until(`document.getElementById('circuit-name').value === 'report-example-modulator'`);
    await h.until(`${h.module('atlas.js')}.then((m) => !m.atlasSnapshot())`, 5000);
    assert.equal(await editor('editor.currentDocumentPath'), null, 'unsaved');
    assert.equal(await exists('report-example-modulator'), false);
    assert.equal(await exists('report-example-integrator'), false);
    // The integrator is known from the bundle: its section and link are whole.
    await h.until(`!!document.querySelector('.notes-view:not([hidden]) .note-section')`);
    assert.equal(await h.evaluate(`document.querySelector('.note-section .note-design').dataset.design`), 'report-example-integrator');
    assert.equal(await h.evaluate(`document.querySelector('.notes-view .note-design.broken')`), null);
    // H1's link peeks at it, unbroken.
    await h.evaluate(`${h.module('main.js')}.then((m) => { m.setSelection(['H1']); m.render(); })`);
    if (!await h.evaluate(`${h.module('hierarchy.js')}.then((m) => m.linkBubbleFrames().length)`)) await h.key('o');
    await h.until(`!!document.querySelector('.link-bubble:not(.broken) image[href^="data:image/svg"]')`);
    assert.deepEqual(await h.evaluate(`${h.module('hierarchy.js')}.then((m) => m.openDesignBrokenLinks())`), []);
    await h.evaluate(`${h.module('export-ui.js')}.then((m) => m.exportCircuit({ content: 'report' }))`);
    await h.until(`document.getElementById('export-report-summary').textContent.includes('a section from another design')`);
    await h.evaluate(`document.getElementById('export-dialog').close()`);
    // The report's text faces load from the editor's fonts folder.
    assert.equal(await h.evaluate(`${h.module('drawing-export.js')}.then(async (m) => ((await m.embeddedReportFontFaces()).match(/font-family:"Latin Modern Roman";src:url\\(data:font\\/woff2;base64,/g) || []).length)`), 4);
    // Saving keeps the modulator, and the integrator beside it.
    await h.key('s', { ctrlKey: true });
    await h.until(`${h.module('editor-state.js')}.then((m) => !!m.editor.currentDocumentPath)`);
    // A file on disk, polled from Node.
    for (let i = 0; i < 50 && !await exists('report-example-integrator'); i++) await sleep(100);
    assert.equal(await exists('report-example-modulator'), true);
    const integrator = JSON.parse(await readFile(join(h.workspace, 'report-example-integrator.json'), 'utf8'));
    assert.match(integrator.notes, /^# SC integrator with correlated level shifting/);
  });

  test('Table, while writing, puts an empty table of the columns and rows picked at the caret', async () => {
    await h.click('.notes-edit');
    await typeNotes('Intro');
    assert.equal(await h.evaluate(`document.querySelector('.notes-table').hidden`), false, 'shown while writing');
    await h.evaluate(`(() => { const f = document.querySelector('.notes-source'); f.focus(); f.setSelectionRange(5, 5); })()`);
    await h.click('.notes-table');
    await h.until(`!!document.querySelector('.notes-table-grid')`);
    await h.evaluate(`document.querySelector('.notes-table-cell[data-column="3"][data-row="2"]').dispatchEvent(new PointerEvent('pointerenter'))`);
    assert.equal(await h.evaluate(`document.querySelector('.context-menu-heading').textContent`), 'Table 3 × 2');
    assert.equal(await h.evaluate(`document.querySelectorAll('.notes-table-cell.chosen').length`), 6);
    await h.click('.notes-table-cell[data-column="3"][data-row="2"]');
    assert.equal(await h.evaluate(`document.querySelector('.notes-source').value`), 'Intro\n\n|   |   |   |\n| --- | --- | --- |\n|   |   |   |\n');
    assert.equal(await h.evaluate(`document.querySelector('.notes-source').selectionStart`), 9, 'the caret in the first heading cell');
    assert.match(await editor('editor.circuit.notes'), /\| --- \| --- \| --- \|/);
    await finish();
    await h.until(`!!document.querySelector('.notes-view table')`);
    assert.equal(await h.evaluate(`document.querySelector('.notes-table').hidden`), true, 'hidden when read');
  });

  test('text pasted from a spreadsheet asks Table or Text at the caret; Esc pastes the text', async () => {
    await h.click('.notes-edit');
    await typeNotes('Intro');
    const paste = (text) => h.evaluate(`(() => {
      const f = document.querySelector('.notes-source');
      f.focus();
      f.setSelectionRange(f.value.length, f.value.length);
      const data = new DataTransfer();
      data.setData('text/plain', ${JSON.stringify(text)});
      f.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    })()`);
    const value = () => h.evaluate(`document.querySelector('.notes-source').value`);
    const choose = (text) => h.evaluate(`[...document.querySelectorAll('.component-context-menu button')].find((b) => b.textContent.startsWith(${JSON.stringify(text)})).click()`);
    const sheet = 'Part\tW\tL\r\nM1\t2u\t180n\r\nM2 | M3\t4u\t180n\r\n';
    await paste(sheet);
    await h.until(`!document.querySelector('.component-context-menu').hidden`);
    assert.equal(await h.evaluate(`document.querySelector('.component-context-menu .context-menu-heading').textContent`), 'Paste');
    assert.equal(await h.evaluate(`document.activeElement.textContent`), 'Table (3 × 3)', 'Enter takes the table');
    await choose('Table');
    assert.equal(await value(), 'Intro\n\n| Part     | W   | L    |\n| -------- | --- | ---- |\n| M1       | 2u  | 180n |\n| M2 \\| M3 | 4u  | 180n |\n');
    await typeNotes('Intro ');
    await paste('a,b\n1,2');
    await h.until(`!document.querySelector('.component-context-menu').hidden`);
    await choose('Text');
    assert.equal(await value(), 'Intro a,b\n1,2');
    await typeNotes('Intro ');
    await paste('a,b\n1,2');
    await h.until(`!document.querySelector('.component-context-menu').hidden`);
    await h.evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
    await h.until(`document.querySelector('.component-context-menu').hidden`);
    assert.equal(await value(), 'Intro a,b\n1,2', 'closed without a choice: the text');
    assert.equal(await h.evaluate(`document.querySelector('.notes-source').hidden`), false, 'still writing');
    await finish();
  });

  test('a double-click on a picture on the drawing opens its options; its name places it in the notes', async () => {
    const id = await h.evaluate(`Promise.all([${h.module('editor-state.js')}, ${h.module('main.js')}]).then(([s, m]) => {
      const box = s.editor.circuit.addAnnotation('box', { x: 2000, y: 0, end: { x: 2160, y: 120 }, image: { src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', aspect: 4 / 3 } });
      m.render();
      return box.id;
    })`);
    const p = await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.worldToClient(2080, 60))`);
    await h.mouse('mousePressed', p.x, p.y, { clickCount: 1 });
    await h.mouse('mouseReleased', p.x, p.y, { clickCount: 1 });
    await h.mouse('mousePressed', p.x, p.y, { clickCount: 2 });
    await h.mouse('mouseReleased', p.x, p.y, { clickCount: 2 });
    await h.until(`!!document.querySelector('#picture-dialog[open]')`);
    // A name another target has is refused in the dialog.
    await h.evaluate(`(() => { const f = document.getElementById('picture-name'); f.value = 'circuit'; f.dispatchEvent(new Event('input')); })()`);
    await h.click('#picture-submit');
    assert.match(await h.evaluate(`document.querySelector('#picture-dialog .page-guide-error').textContent`), /taken/);
    await h.evaluate(`(() => { const f = document.getElementById('picture-name'); f.value = 'Scope'; f.dispatchEvent(new Event('input'));
      f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`);
    await h.until(`!document.getElementById('picture-dialog')`);
    assert.equal(await editor(`editor.circuit.labels.get(${JSON.stringify(id)}).image.name`), 'Scope');
    await h.click('.notes-edit');
    await typeNotes('See [[#scope]].\n\n![[Scope|The bench.]]');
    await finish();
    await h.until(`!!document.querySelector('.notes-view .note-figure-ref')`);
    assert.equal(await h.evaluate(`document.querySelector('.notes-view .note-figure-ref').textContent`), 'Fig. 1');
    // Undo takes the notes back, then the name.
    await h.key('u');
    await h.until(`${h.module('editor-state.js')}.then((m) => !m.editor.circuit.notes.includes('Scope'))`);
    await h.key('u');
    await h.until(`${h.module('editor-state.js')}.then((m) => !m.editor.circuit.labels.get(${JSON.stringify(id)})?.image.name)`);
  });

  test('another design shows its own notes, and n closes the window', async () => {
    await h.open('child');
    await h.until(`!document.querySelector('.notes-view h3') && document.querySelector('.notes-source')?.hidden === false || !!document.querySelector('.notes-empty:not([hidden])')`);
    assert.equal(await editor('editor.circuit.notes'), '');
    await h.key('N', { shiftKey: true });
    assert.equal(await h.evaluate(`document.querySelector('.notes-window').hidden`), true);
  });
});
