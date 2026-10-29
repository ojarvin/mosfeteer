/**
 * The editor's chrome in a browser: menus, settings, the look shared by
 * the windows' cards and fields, and what makes a design unsaved.
 */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, sleep, browserSkip } from './harness.js';
import { amplifier, editing, modulator } from './fixtures.js';
import { Circuit } from '../../src/core/model.js';
import { COLOR_PALETTE } from '../../src/core/style.js';

describe('editor chrome', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { amplifier: amplifier(), modulator: modulator(), edit: editing() }, width: 1500, height: 950 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const style = (selector, property) => h.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? getComputedStyle(el).getPropertyValue(${JSON.stringify(property)}) : null; })()`);
  const at = (x, y) => h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.worldToClient(${x}, ${y}))`);
  const unsaved = () => h.evaluate(`${h.module('document-session.js')}.then((m) => m.hasUnsavedChanges())`);

  test('a right click on a part opens its menu, Delete last in its own group, with no Close item', async () => {
    await h.open('amplifier');
    const p = await at(0, -320);
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
    await h.tap(p.x, p.y, { button: 'right' });
    await h.until(`!document.querySelector('.component-context-menu').hidden`);
    // The menu's last group holds Delete alone.
    const last = await h.evaluate(`[...document.querySelector('.component-context-menu').lastElementChild.querySelectorAll('button')].map((b) => b.textContent.trim())`);
    assert.equal(last.length, 1);
    assert.match(last[0], /^Delete/);
    const items = await h.evaluate(`[...document.querySelectorAll('.component-context-menu button')].map((b) => b.textContent.trim())`);
    assert.ok(!items.some((item) => /^Close/.test(item)));
    await h.key('Escape');
  });

  test('the insert tool is called Insert wherever it shows: its button, its mode, the analysis is Analysis', async () => {
    await h.open('amplifier');
    assert.equal(await h.evaluate(`document.getElementById('btn-mode-place').title`), 'Insert (i)');
    assert.equal(await h.evaluate(`document.getElementById('btn-analysis').title`), 'Analysis (Shift+S)');
    // What puts a figure on the drawing is Annotate (Annotate… where it offers
    // a choice); the rail's text, arrows, and boxes are Annotations.
    assert.equal(await h.evaluate(`document.getElementById('analysis-annotate').textContent.trim()`), 'Annotate…');
    assert.equal(await h.evaluate(`document.getElementById('btn-rail-annotate').textContent.trim()`), 'Annotations');
    assert.equal(await h.evaluate(`document.getElementById('btn-arrange-figures').textContent.trim()`), 'Arrange figures');
    await h.key('i');
    await h.until(`document.getElementById('status-mode').textContent === 'INSERT'`);
    await h.key('Escape');
    await h.key('Escape');
  });

  test('a new design\'s empty card lists the latest designs, and a click opens one', async () => {
    await h.open('amplifier');
    await h.click('#btn-new-document');
    await h.until(`!document.getElementById('empty-state').hidden && !document.querySelector('.empty-state-recent').hidden`);
    const names = await h.evaluate(`[...document.querySelectorAll('.empty-state-recent [data-recent-path] .empty-state-text')].map((n) => n.textContent)`);
    assert.deepEqual([...names].sort(), ['amplifier', 'edit', 'modulator']);
    await h.evaluate(`[...document.querySelectorAll('.empty-state-recent [data-recent-path]')].find((b) => b.textContent.includes('modulator')).click()`);
    await h.untilDiscarding(`${h.module('editor-state.js')}.then((m) => m.editor.currentDocumentPath?.endsWith('modulator.json'))`);
  });

  test('the theme is a setting: its menu item switches the drawing dark and back', async () => {
    assert.ok(await h.evaluate(`!!document.querySelector('#settings-menu #btn-theme[role="menuitemcheckbox"]')`));
    const dark = () => h.evaluate(`document.documentElement.classList.contains('dark')`);
    const was = await dark();
    await h.click('#btn-theme');
    assert.equal(await dark(), !was);
    await h.click('#btn-theme');
    assert.equal(await dark(), was);
    // Chosen here, the theme no longer follows the system; asked to, it
    // follows the system's again, and keeps following it as it changes.
    const follows = () => h.evaluate(`document.getElementById('btn-theme-system').getAttribute('aria-checked')`);
    assert.equal(await follows(), 'false');
    await h.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: 'dark' }] });
    await h.click('#btn-theme-system');
    assert.equal(await follows(), 'true');
    await h.until(`document.documentElement.classList.contains('dark')`);
    await h.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: 'light' }] });
    await h.until(`!document.documentElement.classList.contains('dark')`);
    await h.click('#btn-theme');
    assert.equal(await follows(), 'false', 'a choice made here ends following');
    await h.click('#btn-theme');
  });

  test('every card opens with the same header, headings inside a card are quieter, hints sit close', async () => {
    await h.open('modulator');
    await h.key('S');
    await h.until(`!document.getElementById('analysis-dialog').hidden`);
    await h.evaluate(`document.querySelector('.signal-flow-optimize').open = true`);
    for (const header of ['#analysis-signal-flow fieldset > legend', '.signal-flow-plots > .card-heading', '.signal-flow-optimize > summary']) {
      assert.equal(await style(header, 'text-transform'), 'uppercase', header);
    }
    assert.equal(await style('.signal-flow-optimize-heading', 'text-transform'), 'none');
    // A scrollbar appearing never reflows the window; a segmented control never wraps.
    assert.equal(await style('#analysis-dialog .analysis-scroll', 'scrollbar-gutter'), 'stable');
    assert.equal(await style('.analysis-mode', 'flex-wrap'), 'nowrap');
    // A hint stands below what it explains, pulled up inside a container that spaces its rows.
    assert.equal(await style('#analysis-signal-flow fieldset > .field-hint', 'margin-top'), '-4px');
    assert.equal(await style('#analysis-signal-flow .signal-flow-stale', 'margin-top') !== '-4px', true);
  });

  test('fields show what is typed: no ligatures join their characters', async () => {
    assert.equal(await style('#analysis-dialog input[type=text]', 'font-variant-ligatures'), 'none');
  });

  test('every floating window can be resized from each corner', async () => {
    await h.key('E');
    await h.until(`!!document.querySelector('.calculator-window:not([hidden])')`);
    const corners = await h.evaluate(`[...document.querySelectorAll('.floating-window')].filter((w) => !w.hidden).map((w) => w.querySelectorAll(':scope > .floating-window-grip').length)`);
    assert.ok(corners.length >= 2);
    assert.ok(corners.every((n) => n === 4), `${corners}`);
  });

  test('window state never makes a design unsaved; an edit does, and leaving it asks to save, discard, or keep editing', async () => {
    await h.open('amplifier');
    assert.equal(await unsaved(), false);
    await h.evaluate(`(() => { const line = document.querySelector('.calculator-line'); line.value = '1+1'; line.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    await h.settle();
    assert.equal(await unsaved(), false, 'a calculator result is window state');
    await h.evaluate(`window.__run('add resistor R9 --at 800 800')`);
    await h.settle();
    assert.equal(await unsaved(), true);
    await h.evaluate(`void ${h.module('document-session.js')}.then((m) => m.openDocumentPath(${JSON.stringify(`${h.workspace}/modulator.json`)}))`);
    await h.until(`document.getElementById('switch-dialog').open`);
    const choices = await h.evaluate(`[...document.querySelectorAll('#switch-dialog button[value]')].map((b) => b.value + ':' + b.textContent.trim())`);
    assert.deepEqual(choices.sort(), ['cancel:Keep editing', 'discard:Discard and load', 'save:Save and load']);
    await h.click('#switch-dialog button[value="cancel"]');
    assert.equal(await unsaved(), true, 'kept editing');
    await h.key('u');
  });

  const closeWindows = () => h.evaluate(`[...document.querySelectorAll('.floating-window:not([hidden]) .floating-window-close')].forEach((b) => b.click())`);
  const rightClick = async (x, y) => {
    await closeWindows();
    const p = await at(x, y);
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
    await h.tap(p.x, p.y, { button: 'right' });
    await h.until(`!document.querySelector('.component-context-menu').hidden`);
  };

  test('a line\'s arrowheads are two toggles, its start and its end, sharing one setting', async () => {
    await h.open('edit');
    const line = await h.evaluate(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].find((l) => l.kind === 'line').id)`);
    await h.evaluate(`${h.module('main.js')}.then((m) => { m.setLabelSelection([${JSON.stringify(line)}]); m.render(); })`);
    const arrowhead = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.labels.get(${JSON.stringify(line)}).style.arrowhead || 'none')`);
    await h.click('#style-arrow-start');
    assert.equal(await arrowhead(), 'start');
    await h.click('#style-arrow-end');
    assert.equal(await arrowhead(), 'both');
    await h.click('#style-arrow-start');
    assert.equal(await arrowhead(), 'end');
    assert.equal(await h.evaluate(`document.getElementById('style-arrow-end').getAttribute('aria-pressed')`), 'true');
    for (const pattern of ['solid', 'dashed', 'dash-dot', 'dotted']) assert.ok(await h.evaluate(`!!document.querySelector('#style-panel [data-line-style="${pattern}"]')`), pattern);
  });

  test('the context menu carries the style controls, keeps no duplicate ids, and stays open while styling', async () => {
    await h.open('edit');
    await h.evaluate(`${h.module('main.js')}.then((m) => { m.setSelection(['R2']); m.render(); })`);
    await rightClick(600, 0);
    const strip = await h.evaluate(`(() => { const menu = document.querySelector('.component-context-menu'); return { controls: menu.querySelectorAll('[data-line-style], [data-arrow-end], [data-style-color], button[data-color]').length, ids: [...menu.querySelectorAll('[id]')].map((el) => el.id).filter((id) => document.querySelectorAll('#' + CSS.escape(id)).length > 1) }; })()`);
    assert.ok(strip.controls > 0, 'style controls in the menu');
    assert.deepEqual(strip.ids, [], 'no id twice in the page');
    await h.evaluate(`document.querySelector('.component-context-menu [data-line-style="dashed"]')?.click()`);
    assert.equal(await h.evaluate(`document.querySelector('.component-context-menu').hidden`), false, 'still open');
    await h.key('Escape');
  });

  test('Copy as image says the resolution it copied at', async () => {
    await h.open('amplifier');
    await h.evaluate(`(() => { window.__copied = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: async (items) => { for (const item of items) window.__copied.push(await item.getType('image/png')); } } }); })()`);
    await h.evaluate(`${h.module('export-ui.js')}.then((m) => m.copyAsImage())`);
    await h.until(`${h.module('editor-state.js')}.then((m) => /^Copied image/.test(m.editor.clipboardNotice || ''))`);
    assert.equal(await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.clipboardNotice)`), 'Copied image at 300 dpi');
    assert.equal(await h.evaluate(`window.__copied.length`), 1);
  });

  test('hovering another menu row closes the submenus it is not part of', async () => {
    await h.open('amplifier');
    await rightClick(-20, 0); // M1
    const row = (text) => `[...document.querySelectorAll('.component-context-menu button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)}))`;
    await h.evaluate(`${row('Small-signal attributes')}.click()`);
    const open = () => h.evaluate(`document.querySelectorAll('.component-context-menu .context-submenu.open').length`);
    assert.ok(await open() > 0);
    // Hovering inside the submenu keeps it.
    await h.evaluate(`${row('Device model')}.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`);
    // Past the menu's 150 ms hover delay. Too short a wait on a busy machine
    // could only let a fault through, never fail the test.
    await sleep(250);
    assert.ok(await open() > 0, 'inside it, it stays');
    await h.evaluate(`[...document.querySelector('.component-context-menu').querySelectorAll(':scope > button, :scope > .context-menu-group > button')].find((b) => !b.textContent.includes('Small-signal')).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`);
    await h.until(`document.querySelectorAll('.component-context-menu .context-submenu.open').length === 0`);
    await h.key('Escape');
  });

  test('the menu highlight follows the pointer: a left trigger goes dark at once, a plain row once the pointer leaves', async () => {
    await h.open('amplifier');
    await rightClick(-20, 0); // M1
    const lit = () => h.evaluate(`[...document.querySelectorAll('.component-context-menu button')].filter((b) => b.getClientRects().length && (b.matches(':hover, :focus-visible') || b.classList.contains('context-item-open'))).map((b) => (b.firstChild?.textContent || "").trim())`);
    const move = async (text) => {
      const c = await h.evaluate(`(() => { const r = [...document.querySelectorAll('.component-context-menu button')].find((b) => (b.firstChild?.textContent || "").trim() === ${JSON.stringify(text)} && b.getClientRects().length).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await h.mouse('mouseMoved', c.x, c.y, { button: 'none', buttons: 0 });
    };
    await move('Small-signal attributes');
    await h.until(`document.querySelectorAll('.component-context-menu .context-submenu.open').length === 1`);
    await move('Rotate');
    // Before the hover delay closes the submenu, only the hovered row is lit.
    assert.deepEqual(await lit(), ['Rotate']);
    await move('Small-signal attributes');
    await move('Device model');
    assert.deepEqual(await lit(), ['Small-signal attributes', 'Device model']);
    // Off the menu, an open submenu's triggers stay lit.
    await h.mouse('mouseMoved', 5, 5, { button: 'none', buttons: 0 });
    assert.deepEqual(await lit(), ['Small-signal attributes', 'Device model']);
    await move('Rotate');
    await h.until(`document.querySelectorAll('.component-context-menu .context-submenu.open').length === 0`);
    await h.mouse('mouseMoved', 5, 5, { button: 'none', buttons: 0 });
    assert.deepEqual(await lit(), []);
    await h.key('Escape');
  });

  test("the symbol sheet's category labels keep their placed boxes when the page measures labels", async () => {
    await h.evaluate(`${h.module('../core/symbol-sheet.js')}.then((m) => window.__load(m.symbolSheet().toJSON()))`);
    await h.evaluate(`${h.module('main.js')}.then((m) => m.render())`);
    // Measured in one pass: once the other labels are, a category label would be too.
    await h.until(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].some((l) => l.kind === 'label' && !l.id.startsWith('category_') && !!l._renderedTextBounds))`);
    const labels = await h.evaluate(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].filter((l) => l.kind === 'label').map((l) => ({ category: l.id.startsWith('category_'), measured: !!l._renderedTextBounds })))`);
    const categories = labels.filter((l) => l.category);
    assert.ok(categories.length > 3);
    assert.ok(categories.every((l) => !l.measured), 'no category label measured');
    assert.ok(labels.some((l) => !l.category && l.measured), 'while the other labels are');
    await h.open('amplifier');
  });

  test('every editor command the command line offers has an action', async () => {
    const missing = await h.evaluate(`Promise.all([${h.module('command-line.js')}, ${h.module('command-line-ui.js')}]).then(([line, ui]) => line.EDITOR_COMMANDS.map((c) => c.name).filter((name) => typeof ui.ACTIONS[name] !== 'function'))`);
    assert.deepEqual(missing, []);
  });

  test('the chrome speaks one language: menu keys as kbd with no repeated titles, short placeholders, type names, and one close title', async () => {
    await h.open('amplifier');
    // A menu item's text is its tooltip: no title repeats or explains it.
    const titled = await h.evaluate(`[...document.querySelectorAll('#document-menu button, #settings-menu button')].filter((b) => b.textContent.trim() && b.title && !['Scroll pans, pinch zooms', 'The file stays on disk'].includes(b.title)).map((b) => b.textContent.trim())`);
    assert.deepEqual(titled, []);
    const open = await h.evaluate(`document.getElementById('btn-open-file').querySelector('kbd')?.textContent`);
    assert.equal(open, 'Ctrl/Cmd+O');
    // A search field's placeholder fits it; its key is in the title.
    for (const id of ['panel-filter', 'atlas-search']) {
      const field = await h.evaluate(`(() => { const f = document.getElementById(${JSON.stringify(id)}); return { placeholder: f.placeholder, title: f.title }; })()`);
      assert.doesNotMatch(field.placeholder, /Ctrl|\(/, id);
      assert.match(field.title, /^Find \(/, id);
    }
    // The side panel names a part's type as the insert menu does.
    const types = await h.evaluate(`[...document.querySelectorAll('#components-list [data-type]')].map((row) => [row.dataset.type, row.textContent])`);
    const mos = types.find(([type]) => type === 'nmos');
    assert.ok(mos && /NMOS/.test(mos[1]) && !/nmos/.test(mos[1]), JSON.stringify(types));
    // Every window's close × is titled Close, with its key when it has one.
    for (const key of ['S', 'E', 'N', 'Z', 'K', 'B']) await h.key(key, { shiftKey: true });
    await h.settle();
    const closes = await h.evaluate(`[...document.querySelectorAll('.floating-window:not([hidden]) .floating-window-close')].map((b) => b.title)`);
    assert.ok(closes.length >= 5, JSON.stringify(closes));
    for (const title of closes) assert.match(title, /^Close( \(Shift\+[A-Z]\))?$/);
    await h.evaluate(`[...document.querySelectorAll('.floating-window:not([hidden]) .floating-window-close')].forEach((b) => b.click())`);
  });

  test('the footer is one status line with a log drawer over the drawing; live hints and check results stay out of the log', async () => {
    await h.open('edit');
    const bar = await h.evaluate(`(() => { const s = getComputedStyle(document.querySelector('footer.statusbar')); return { h: s.height, resize: s.resize }; })()`);
    assert.deepEqual(bar, { h: '26px', resize: 'none' });
    for (const id of ['status-mode', 'status-selection', 'status-cursor', 'status-zoom', 'status-check', 'status-message', 'btn-help']) assert.ok(await h.evaluate(`!!document.querySelector('footer.statusbar #${id}')`), id);
    assert.equal(await h.evaluate(`!!document.querySelector('#log-drawer #log') && !!document.querySelector('#log-drawer #cmd-input')`), true);
    assert.equal(await style('#log-drawer', 'position'), 'absolute', 'it floats, taking no room');
    assert.equal(await h.evaluate(`document.getElementById('log-drawer').hidden`), true);
    // The wiring hint shows in the status line only.
    await h.key('w');
    await h.until(`/click a terminal or point to start/.test(document.getElementById('status-message').textContent)`);
    assert.doesNotMatch(await h.evaluate(`document.getElementById('log').textContent`), /click a terminal or point to start/);
    await h.key('Escape');
    // A check with problems fills the panel and the chip; the log drawer stays shut.
    await h.evaluate(`${h.module('design-check-ui.js')}.then((m) => m.runCheck())`);
    assert.match(await h.evaluate(`document.getElementById('status-check').textContent`), /⚠/);
    await h.settle();
    assert.equal(await h.evaluate(`document.getElementById('log-drawer').hidden`), true, 'no peek');
    // Each category is one group, its rows without the category's name.
    const groups = await h.evaluate(`[...document.querySelectorAll('#check-summary details.check-group')].map((g) => ({ name: g.querySelector('summary span').textContent, rows: [...g.querySelectorAll('.check-issue')].map((b) => b.textContent) }))`);
    assert.ok(groups.length > 0);
    for (const group of groups) for (const row of group.rows) assert.ok(!row.includes(group.name), `${group.name}: ${row}`);
  });

  test('a view of its own keeps its scale and top-left corner when the window resizes', async () => {
    await h.open('edit');
    // Zoomed by hand: no longer the fitted view, which refits instead.
    await h.evaluate(`(() => { const c = document.getElementById('canvas'); const r = c.getBoundingClientRect(); c.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, ctrlKey: true, clientX: r.x + r.width / 3, clientY: r.y + r.height / 3, bubbles: true, cancelable: true })); })()`);
    await h.settle();
    const view = () => h.evaluate(`${h.module('canvas-view.js')}.then((m) => { const a = m.worldToClient(0, 0); const b = m.worldToClient(400, 0); return { x: Math.round(a.x), y: Math.round(a.y), scale: Math.round((b.x - a.x) * 100) / 100 }; })`);
    const before = await view();
    await h.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
    await h.settle();
    const after = await view();
    await h.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
    await h.settle();
    assert.deepEqual(after, before);
  });

  test('the name shows a dot while unsaved; the annotation tools fold into one rail flyout; styling sits in the Selection panel', async () => {
    await h.open('amplifier');
    const dot = () => h.evaluate(`document.getElementById('dirty-dot').hidden`);
    assert.equal(await dot(), true);
    await h.evaluate(`window.__run('add resistor R9 --at 1600 1600')`);
    await h.until(`!document.getElementById('dirty-dot').hidden`);
    await h.key('u');
    for (const id of ['annotation', 'arrow', 'box', 'line']) {
      assert.equal(await h.evaluate(`!!document.querySelector('.mode-toolbar #btn-mode-${id}')`), false, `${id} not on the rail`);
      assert.equal(await h.evaluate(`!!document.querySelector('#rail-flyout #btn-mode-${id}')`), true, `${id} in the flyout`);
    }
    assert.ok(await h.evaluate(`!!document.querySelector('.mode-toolbar #btn-rail-annotate')`));
    for (const id of ['btn-bring-front', 'btn-send-back']) assert.equal(await h.evaluate(`!!document.getElementById('${id}')`), false, id);
    assert.equal(await h.evaluate(`document.getElementById('style-panel').closest('[data-panel]').dataset.panel`), 'terminals');
  });

  test('Ctrl+Z undoes and Ctrl+Shift+Z redoes', async () => {
    await h.open('amplifier');
    const has = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.has('R9'))`);
    await h.evaluate(`window.__run('add resistor R9 --at 1600 1600')`);
    await h.key('z', { ctrlKey: true });
    assert.equal(await has(), false);
    await h.key('Z', { ctrlKey: true, shiftKey: true });
    assert.equal(await has(), true);
  });

  test('Settings holds the page guides, scrolling, and tips; More and Learn keep the rest', async () => {
    await h.click('#btn-settings');
    await h.until(`!document.getElementById('settings-menu').hidden`);
    const settings = await h.evaluate(`[...document.querySelectorAll('#settings-menu button')].map((b) => b.id || (b.dataset.accent !== undefined ? 'accent:' + b.dataset.accent : 'guide:' + (b.dataset.pageGuide ?? '')))`);
    const guides = settings.filter((id) => id.startsWith('guide:'));
    assert.deepEqual(guides, ['guide:', 'guide:ieee-1col', 'guide:ieee-2col', 'guide:a4', 'guide:custom']);
    assert.ok(settings.includes('btn-custom-page-guide'));
    // The accent colors: the default first, then the palette.
    const accents = settings.filter((id) => id.startsWith('accent:'));
    assert.equal(accents[0], 'accent:');
    assert.ok(accents.includes('accent:blue') && accents.length > 10, accents.join());
    for (const id of ['btn-scroll-scheme', 'btn-tips', 'btn-grid', 'btn-guides', 'btn-crosshair', 'btn-net-beams']) assert.ok(settings.includes(id), id);
    assert.equal(await h.evaluate(`document.getElementById('btn-tips').getAttribute('role')`), 'menuitemcheckbox');
    assert.deepEqual(await h.evaluate(`(() => { const card = document.getElementById('tip-card'); return [card.getAttribute('role'), card.hidden]; })()`), ['status', true]);
    for (const id of ['btn-tutorial', 'btn-symbols']) assert.ok(!settings.includes(id), id);
    await h.key('Escape');
    // The view toggles have no toolbar buttons of their own.
    assert.equal(await h.evaluate(`!!document.querySelector('.toolbar > .toolbar-cluster > :is(#btn-grid, #btn-guides, #btn-crosshair)')`), false);
    assert.equal(await h.evaluate(`!!document.querySelector('#document-menu :is(#btn-scroll-scheme, #btn-tips, #btn-tutorial, [data-page-guide])')`), false);
    assert.equal(await h.evaluate(`!!document.querySelector('#help-dialog #btn-tutorial')`), true, 'the tutorial is in Learn');
  });

  test('the tutorial is offered, never pushed: the empty drawing points to Learn, and starting it asks about unsaved changes', async () => {
    await h.open('amplifier');
    await h.click('#btn-new-document');
    await h.untilDiscarding(`${h.module('editor-state.js')}.then((m) => !m.editor.currentDocumentPath && m.editor.circuit.components.size === 0)`);
    await h.until(`!document.getElementById('empty-state').hidden`);
    const tutorial = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => !!m.editor.tutorial)`);
    assert.equal(await tutorial(), false, 'not started by itself');
    await h.click('#empty-state [data-empty-action="learn"]');
    await h.until(`document.getElementById('help-dialog').open`);
    await h.evaluate(`document.getElementById('help-dialog').close()`);
    assert.equal(await tutorial(), false);
    // With an edit unsaved, starting it asks first.
    await h.evaluate(`window.__run('add resistor R1 --at 0 0')`);
    await h.evaluate(`document.getElementById('btn-tutorial').click()`);
    await h.until(`document.getElementById('switch-dialog').open`);
    assert.equal(await tutorial(), false);
    await h.click('#switch-dialog [value="discard"]');
    await h.until(`${h.module('editor-state.js')}.then((m) => !!m.editor.tutorial)`);
    await h.evaluate(`${h.module('onboarding.js')}.then((m) => m.dropTutorial())`);
  });

  test('a guide shows on the drawing while a part is placed, not in the status line; the crosshair starts off', async () => {
    await h.open('edit');
    assert.equal(await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.crosshairVisible)`), false);
    // R2 at 600 and R3 at 1000: a third resistor placed a pitch before them.
    await h.key('i');
    for (const ch of 'resistor') await h.key(ch);
    await h.key('Enter');
    await h.until(`${h.module('editor-state.js')}.then((m) => !!m.editor.pendingPlace)`);
    const p = await at(200, 0);
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.cursor.x === 200 && m.editor.cursor.y === 0)`);
    await h.until(`!!document.querySelector('#canvas .placement-guides')`);
    const status = await h.evaluate(`document.querySelector('footer.statusbar').textContent`);
    assert.doesNotMatch(status, /\d+ cells/, 'the drawing carries the measure, not the status line');
    // A pitch measured from R2 and R3 to the part being placed.
    const guides = await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.activePlacementGuides.map((g) => ({ kind: g.kind, xs: g.points.map((p) => p.x), moving: g.points.filter((p) => p.moving).length })))`);
    assert.ok(guides.some((g) => g.kind === 'spacing' && g.xs.join() === '200,600,1000' && g.moving === 1), JSON.stringify(guides));
    await h.key('Escape');
    await h.key('Escape');
  });

  test('Align follows Style in the Selection panel and lines up a box\'s own label with a loose one', async () => {
    assert.equal(await h.evaluate(`(() => { const style = document.getElementById('style-panel'); const align = document.getElementById('align-panel'); return style.closest('[data-panel]') === align.closest('[data-panel]') && !!(style.compareDocumentPosition(align) & Node.DOCUMENT_POSITION_FOLLOWING); })()`), true);
    assert.equal(await h.evaluate(`document.querySelectorAll('#align-panel').length`), 1);
    const circuit = new Circuit();
    const box = circuit.addAnnotation('box', { x: 0, y: 0, end: { x: 400, y: 240 } });
    const child = circuit.addLabel({ text: 'inside', align: 'left', parent: box.id, x: 160, y: 120 });
    const loose = circuit.addLabel({ text: 'loose', align: 'left', x: 40, y: 480 });
    await h.evaluate(`window.__load(${JSON.stringify(circuit.toJSON())})`);
    await h.evaluate(`${h.module('main.js')}.then((m) => { m.setLabelSelection(${JSON.stringify([child.id, loose.id])}); m.render(); })`);
    await h.click('[data-layout-align="left"]');
    const left = (id) => h.evaluate(`${h.module('editor-state.js')}.then((m) => Math.round(m.editor.circuit.labels.get(${JSON.stringify(id)}).inkRect().x))`);
    assert.equal(await left(child.id), await left(loose.id));
  });

  test('the style swatches offer every palette color, stored as its token', async () => {
    const swatches = await h.evaluate(`[...document.querySelectorAll('#style-color .swatch')].map((b) => ({ value: b.dataset.value, label: b.getAttribute('aria-label'), color: b.style.getPropertyValue('--swatch') }))`);
    for (const [token, value] of Object.entries(COLOR_PALETTE)) {
      const swatch = swatches.find((s) => s.value === token);
      assert.ok(swatch, `swatch for ${token}`);
      assert.equal(swatch.color, value, token);
      assert.equal(swatch.label, token === 'gray' ? 'Gray' : token[0].toUpperCase() + token.slice(1));
    }
  });

  test('a label toggled bold and back keeps its place: no creep on toggles', async () => {
    await h.open('edit');
    // A left-aligned formula: its measured box differs from the estimate.
    const circuit = new Circuit();
    const formula = circuit.addLabel({ text: '$\\frac{g_m}{C_L}$', x: 200, y: 200, math: true });
    formula.setAlign('left');
    await h.evaluate(`window.__load(${JSON.stringify(circuit.toJSON())})`);
    const id = formula.id;
    await h.evaluate(`${h.module('main.js')}.then((m) => { m.setLabelSelection([${JSON.stringify(id)}]); m.render(); })`);
    const box = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => { const r = m.editor.circuit.labels.get(${JSON.stringify(id)}).inkRect(); return [r.x, r.y, r.w, r.h].map((v) => Math.round(v * 10) / 10); })`);
    await h.settle();
    const before = await box();
    for (let i = 0; i < 6; i++) { await h.key('b', { ctrlKey: true }); await h.settle(); }
    assert.deepEqual(await box(), before);
  });
});

