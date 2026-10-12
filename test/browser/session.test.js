/** The editor around a document in a browser: exporting it, reloading,
 *  opening a document asked for, and what follows the document shown. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { start, sleep, browserSkip } from './harness.js';
import { amplifier, withBeats } from './fixtures.js';
import { normalizePageGuide, pageGuideWidth } from '../../src/core/page-guide.js';

/** The pixels per inch a PNG data URL declares (its pHYs chunk). */
function pngDpi(dataUrl) {
  const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
  const at = bytes.indexOf('pHYs');
  if (at < 0) return null;
  return Math.round(bytes.readUInt32BE(at + 4) * 0.0254);
}
/** The files in `dir` starting with `prefix`, once `count` of them are written. */
async function writtenFiles(dir, prefix, count) {
  for (let i = 0; i < 100; i++) {
    const files = readdirSync(dir).filter((f) => f.startsWith(prefix)).sort();
    if (files.length >= count) return files;
    await sleep(100);
  }
  return readdirSync(dir).filter((f) => f.startsWith(prefix)).sort();
}
const pngWidth = (dataUrl) => Buffer.from(dataUrl.split(',')[1], 'base64').readUInt32BE(16);

describe('documents and sessions', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { amp: amplifier(), other: amplifier(), beats: withBeats() }, width: 1400, height: 900 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  /** Export through the dialog with `set` applied to its form; the requests it sent. */
  const exportWith = async (name, set) => {
    // Each request the export sends, kept as it goes to the server.
    await h.evaluate(`${h.module('document-session.js')}.then(({ persistence }) => {
      window.__exports = [];
      if (!persistence.__realExport) persistence.__realExport = persistence.exportFiles;
      persistence.exportFiles = (request) => { window.__exports.push(request); return persistence.__realExport(request); };
    })`);
    await h.key('e', { ctrlKey: true });
    await h.until(`document.getElementById('export-dialog').open`);
    await h.evaluate(`(() => { const form = document.getElementById('export-form'); document.getElementById('export-name').value = ${JSON.stringify(name)}; (${set})(form); })()`);
    await h.click('#export-submit');
    await h.until(`window.__exports.length > 0 && !document.getElementById('export-dialog').open`, 20000);
    await sleep(300);
    return h.evaluate(`window.__exports`);
  };

  test('a PNG export is made at the resolution chosen, and the PDF\'s fallback raster at least as fine', async () => {
    await h.open('amp');
    for (const dpi of ['300', '600']) {
      const [request] = await exportWith(`amp-${dpi}`, `(form) => { for (const box of form.querySelectorAll('[name=format]')) box.checked = box.value !== 'svg'; form.querySelector('[name=pngDpi]').value = '${dpi}'; }`);
      assert.deepEqual(request.formats.sort(), ['pdf', 'png']);
      assert.equal(pngDpi(request.png), Number(dpi));
      assert.ok(pngWidth(request.pdfPng) >= pngWidth(request.png) || dpi === '600', 'a fine fallback for the PDF');
    }
    assert.equal(await h.evaluate(`document.querySelector('#export-form [name=pngDpi]').value`), '600', 'the choice is kept');
    // Written where the dialog said: the export folder in the test's own home.
    assert.deepEqual(await writtenFiles(join(h.home, 'Pictures'), 'amp', 4), ['amp-300.pdf', 'amp-300.png', 'amp-600.pdf', 'amp-600.png']);
  });

  test('exporting every beat writes one PDF with a page per beat beside numbered SVG and PNG files', async () => {
    await h.open('beats');
    const requests = await exportWith('steps', `(form) => {
      for (const box of form.querySelectorAll('[name=format]')) box.checked = true;
      const beat = document.getElementById('export-beat');
      beat.value = 'all';
      beat.dispatchEvent(new Event('change', { bubbles: true }));
    }`);
    const pdf = requests.filter((r) => r.formats.includes('pdf'));
    assert.equal(pdf.length, 1, 'one PDF');
    assert.equal(pdf[0].pdfPages.length, 2, 'a page per beat');
    const files = requests.filter((r) => r.formats.some((f) => f !== 'pdf'));
    assert.equal(files.length, 2, 'SVG and PNG files per beat');
    assert.notEqual(files[0].name, files[1].name, 'numbered');
    assert.deepEqual(await writtenFiles(join(h.home, 'Pictures'), 'steps', 5), ['steps-1.png', 'steps-1.svg', 'steps-2.png', 'steps-2.svg', 'steps.pdf']);
  });

  test('a file asked for in the address opens at startup', async () => {
    const path = `${h.workspace}/other.json`;
    await h.evaluate(`location.href = location.pathname + '?open=' + encodeURIComponent(${JSON.stringify(path)})`);
    await sleep(500);
    await h.until(`typeof window.__circuit === 'function' && !document.getElementById('startup-cover')`, 15000);
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.currentDocumentPath === ${JSON.stringify(path)})`, 10000);
    assert.equal(await h.evaluate(`location.search`), '', 'the address is cleaned');
  });

  test('F5 reloads the application', async () => {
    await h.evaluate(`window.__beforeReload = true`);
    await h.key('F5');
    await h.until(`window.__beforeReload === undefined && typeof window.__circuit === 'function'`, 15000);
  });

  test('a file that changed on disk only in what its windows show does not reload the open design', async () => {
    await h.until(`typeof window.__circuit === 'function' && !document.getElementById('startup-cover')`, 15000);
    await h.open('amp');
    const log = () => h.evaluate(`[...document.querySelectorAll('#log > *')].map((n) => n.textContent).join(' | ')`);
    const path = join(h.workspace, 'amp.json');
    // The same drawing, its windows' state changed: as this window's own
    // window-state save writes it.
    const data = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...data, windows: { scope: { nets: ['VOUT'], chosen: true } } }));
    await sleep(2500);
    assert.doesNotMatch(await log(), /Reloaded amp/);
    assert.equal(await h.evaluate(`${h.module('editor-state.js')}.then((m) => !!m.editor.circuit.windows?.scope)`), false, 'what is open stays');
    // A drawing changed on disk still reloads.
    writeFileSync(path, JSON.stringify({ ...data, components: [...data.components, { ...data.components[0], refdes: 'M99', transform: { ...data.components[0].transform, x: data.components[0].transform.x + 2000 } }] }));
    await h.until(`[...document.querySelectorAll('#log > *')].some((n) => /Reloaded amp/.test(n.textContent))`, 15000);
  });

  test('a new document is not replaced when another window makes a different one active', async () => {
    await h.until(`typeof window.__circuit === 'function' && !document.getElementById('startup-cover')`, 15000);
    await h.evaluate(`(() => { const a = document.getElementById('atlas'); if (a && !a.hidden) document.getElementById('atlas-close')?.click(); })()`);
    await h.click('#btn-new-document');
    await h.untilDiscarding(`${h.module('editor-state.js')}.then((m) => !m.editor.currentDocumentPath)`);
    // The CLI makes amp the active document; the new, unsaved one stays.
    const response = await fetch(`http://127.0.0.1:${h.port}/api/circuits/amp/cmd`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd: 'add resistor R8 --at 1200 0' }) });
    assert.ok(response.ok, await response.text());
    await sleep(2500);
    assert.equal(await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.currentDocumentPath)`), null);
  });

  test('what the windows show follows the document: a drag keeps it, another document resets it', async () => {
    await h.open('amp');
    await h.key('E');
    await h.until(`!!document.querySelector('.calculator-window:not([hidden])')`);
    await h.evaluate(`(() => { const line = document.querySelector('.calculator-line'); line.value = '6*7'; line.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    const results = () => h.evaluate(`document.querySelectorAll('.calculator-list .calculator-entry').length`);
    assert.equal(await results(), 1);
    // A part dragged: the drag works on a copy of the drawing, the windows stay.
    const from = await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.worldToClient(0, -320))`);
    await h.mouse('mouseMoved', from.x, from.y, { button: 'none', buttons: 0 });
    await h.mouse('mousePressed', from.x, from.y);
    for (let k = 1; k <= 5; k++) await h.mouse('mouseMoved', from.x + k * 12, from.y, { buttons: 1 });
    assert.equal(await results(), 1, 'kept during the drag');
    await h.mouse('mouseReleased', from.x + 60, from.y);
    await sleep(100);
    assert.equal(await results(), 1, 'and after it');
    await h.open('other');
    assert.equal(await results(), 0, 'another document has its own');
  });

  test('opening another design ends the tutorial; its own design reloaded does not', async () => {
    await h.open('amp');
    await h.evaluate(`${h.module('onboarding.js')}.then((m) => m.offerTutorial())`);
    const going = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => !!m.editor.tutorial)`);
    await h.untilDiscarding(`${h.module('editor-state.js')}.then((m) => !!m.editor.tutorial)`);
    // Saved, its file changed by another program and reloaded: still going.
    await h.evaluate(`${h.module('document-session.js')}.then((m) => m.saveCircuit())`);
    await h.until(`${h.module('editor-state.js')}.then((m) => !!m.editor.currentDocumentPath)`);
    const name = await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.currentCircuitName)`);
    const response = await fetch(`http://127.0.0.1:${h.port}/api/circuits/${name}/cmd`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd: 'add resistor R7 --at 800 800' }) });
    assert.ok(response.ok, await response.text());
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.has('R7'))`, 10000);
    assert.equal(await going(), true, 'a reload of its own keeps it');
    await h.open('other');
    assert.equal(await going(), false, 'another design ends it');
  });

  test("the status bar dates a clean design by its file's time and an unsaved one by its latest edit", async () => {
    utimesSync(join(h.workspace, 'other.json'), new Date(2025, 0, 5, 9, 30), new Date(2025, 0, 5, 9, 30));
    await h.open('amp');
    await h.open('other');
    const chip = () => h.evaluate(`(() => { const c = document.getElementById('status-modified'); return c.hidden ? null : c.textContent; })()`);
    assert.match(await chip(), /^saved .*2025/);
    await h.evaluate(`window.__run('add resistor R9 --at 1600 1600')`);
    await h.until(`/^edited just now$/.test(document.getElementById('status-modified').textContent)`);
  });

  test('an export is the width of the page guide chosen in Settings', async () => {
    await h.open('amp');
    // As first written: other tests widen it past the guide.
    await h.evaluate(`window.__load(${JSON.stringify(amplifier())})`);
    const width = (svg) => Number(svg.match(/viewBox="([^"]+)"/)[1].split(' ')[2]);
    const svgOnly = `(form) => { for (const box of form.querySelectorAll('[name=format]')) box.checked = box.value === 'svg'; }`;
    const [plain] = await exportWith('plain', svgOnly);
    await h.evaluate(`document.querySelector('[data-page-guide="ieee-1col"]').click()`);
    try {
      const [guided] = await exportWith('guided', svgOnly);
      assert.ok(Math.abs(width(guided.svg) - pageGuideWidth(normalizePageGuide('ieee-1col'))) < 0.01, `${width(plain.svg)} -> ${width(guided.svg)}`);
      assert.notEqual(width(guided.svg), width(plain.svg));
    } finally {
      await h.evaluate(`document.querySelector('[data-page-guide=""]').click()`);
    }
  });

  test('"Only the selection" starts unchecked each time the export opens', async () => {
    await h.open('amp');
    await h.evaluate(`${h.module('main.js')}.then((m) => { m.selectAll(); m.render(); })`);
    const box = () => h.evaluate(`(() => { const b = document.querySelector('#export-form [name=selection]'); return { checked: b.checked, disabled: b.disabled }; })()`);
    await h.key('e', { ctrlKey: true });
    await h.until(`document.getElementById('export-dialog').open`);
    assert.deepEqual(await box(), { checked: false, disabled: false });
    await h.evaluate(`document.querySelector('#export-form [name=selection]').click()`);
    await h.evaluate(`document.getElementById('export-dialog').close()`);
    await h.key('e', { ctrlKey: true });
    await h.until(`document.getElementById('export-dialog').open`);
    assert.deepEqual(await box(), { checked: false, disabled: false });
    await h.evaluate(`document.getElementById('export-dialog').close()`);
  });
});
