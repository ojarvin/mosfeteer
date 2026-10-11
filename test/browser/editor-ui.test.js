/**
 * The editor's chrome in a browser: menus, settings, the look shared by
 * the windows' cards and fields, and what makes a design unsaved.
 */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, sleep, browserSkip } from './harness.js';
import { amplifier, editing, modulator } from './fixtures.js';

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
    await h.mouse('mousePressed', p.x, p.y, { button: 'right' });
    await h.mouse('mouseReleased', p.x, p.y, { button: 'right' });
    await h.until(`!document.querySelector('.component-context-menu').hidden`);
    // The menu's last group holds Delete alone.
    const last = await h.evaluate(`[...document.querySelector('.component-context-menu').lastElementChild.querySelectorAll('button')].map((b) => b.textContent.trim())`);
    assert.equal(last.length, 1);
    assert.match(last[0], /^Delete/);
    const items = await h.evaluate(`[...document.querySelectorAll('.component-context-menu button')].map((b) => b.textContent.trim())`);
    assert.ok(!items.some((item) => /^Close/.test(item)));
    await h.key('Escape');
  });

  test('the theme is a setting: its menu item switches the drawing dark and back', async () => {
    assert.ok(await h.evaluate(`!!document.querySelector('#settings-menu #btn-theme[role="menuitemcheckbox"]')`));
    const dark = () => h.evaluate(`document.documentElement.classList.contains('dark')`);
    const was = await dark();
    await h.click('#btn-theme');
    assert.equal(await dark(), !was);
    await h.click('#btn-theme');
    assert.equal(await dark(), was);
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
    await sleep(100);
    assert.equal(await unsaved(), false, 'a calculator result is window state');
    await h.evaluate(`window.__run('add resistor R9 --at 800 800')`);
    await sleep(100);
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
    await h.mouse('mousePressed', p.x, p.y, { button: 'right' });
    await h.mouse('mouseReleased', p.x, p.y, { button: 'right' });
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

  test('hovering another menu row closes the submenus it is not part of', async () => {
    await h.open('amplifier');
    await rightClick(-20, 0); // M1
    const row = (text) => `[...document.querySelectorAll('.component-context-menu button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)}))`;
    await h.evaluate(`${row('Small-signal attributes')}.click()`);
    const open = () => h.evaluate(`document.querySelectorAll('.component-context-menu .context-submenu.open').length`);
    assert.ok(await open() > 0);
    // Hovering inside the submenu keeps it.
    await h.evaluate(`${row('Device model')}.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`);
    await sleep(250);
    assert.ok(await open() > 0, 'inside it, it stays');
    await h.evaluate(`[...document.querySelector('.component-context-menu').querySelectorAll(':scope > button, :scope > .context-menu-group > button')].find((b) => !b.textContent.includes('Small-signal')).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`);
    await sleep(250);
    assert.equal(await open(), 0, 'a row outside it closes it');
    await h.key('Escape');
  });

  test("the symbol sheet's category labels keep their placed boxes when the page measures labels", async () => {
    await h.evaluate(`${h.module('../core/symbol-sheet.js')}.then((m) => window.__load(m.symbolSheet().toJSON()))`);
    await h.evaluate(`${h.module('main.js')}.then((m) => m.render())`);
    await sleep(500);
    const labels = await h.evaluate(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].filter((l) => l.kind === 'label').map((l) => ({ category: l.id.startsWith('category_'), measured: !!l._renderedTextBounds })))`);
    const categories = labels.filter((l) => l.category);
    assert.ok(categories.length > 3);
    assert.ok(categories.every((l) => !l.measured), 'no category label measured');
    assert.ok(labels.some((l) => !l.category && l.measured), 'while the other labels are');
    await h.open('amplifier');
  });
});

