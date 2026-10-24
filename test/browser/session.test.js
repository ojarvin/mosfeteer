/** The editor around a document in a browser: exporting it, reloading,
 *  opening a document asked for, and what follows the document shown. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
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
  for (let i = 0; i < 300; i++) {
    const files = readdirSync(dir).filter((f) => f.startsWith(prefix)).sort();
    if (files.length >= count) return files;
    await h.settle();
  }
  return readdirSync(dir).filter((f) => f.startsWith(prefix)).sort();
}
const pngWidth = (dataUrl) => Buffer.from(dataUrl.split(',')[1], 'base64').readUInt32BE(16);

describe('documents and sessions', { skip: browserSkip() }, () => {
  let h;
  /** The editor's live sync, run to its end: one already under way, then a
   *  fresh one. Whatever it does with a change on disk, it has done. */
  const synced = () => h.evaluate(`${h.module('document-session.js')}.then(async (m) => { await m.syncActiveCircuit(); await m.syncActiveCircuit(); return true; })`);
  before(async () => { h = await start({ docs: { amp: amplifier(), other: amplifier(), beats: withBeats() }, width: 1400, height: 900 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  /** Export through the dialog with `set` applied to its form; the requests it sent. */
  // `count`: how many requests the export sends (exporting every beat sends
  // its files and its PDF apart); all of them are waited for, never a pause.
  const exportWith = async (name, set, count = 1) => {
    // Each request the export sends, kept as it goes to the server.
    await h.evaluate(`${h.module('document-session.js')}.then(({ persistence }) => {
      window.__exports = [];
      window.__exported = 0;
      if (!persistence.__realExport) persistence.__realExport = persistence.exportFiles;
      // Counted once the server has written the files: printing a PDF can
      // take a cold Chromium start (seconds on a busy CI runner).
      persistence.exportFiles = async (request) => {
        window.__exports.push(request);
        try { return await persistence.__realExport(request); } finally { window.__exported += 1; }
      };
    })`);
    await h.key('e', { ctrlKey: true });
    await h.until(`document.getElementById('export-dialog').open`);
    await h.evaluate(`(() => { const form = document.getElementById('export-form'); document.getElementById('export-name').value = ${JSON.stringify(name)}; (${set})(form); })()`);
    await h.click('#export-submit');
    await h.until(`window.__exported >= ${count} && !document.getElementById('export-dialog').open`, 90000);
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
    }`, 3);
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
    // Marked, so the wait below is for the page the address opens.
    await h.evaluate(`window.__beforeReload = true`);
    await h.evaluate(`location.href = location.pathname + '?open=' + encodeURIComponent(${JSON.stringify(path)})`);
    await h.until(`!window.__beforeReload && typeof window.__circuit === 'function' && !document.getElementById('startup-cover')`, 15000);
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
    // Reloads counted from here: an earlier test's own change to amp may
    // still be arriving.
    const reloads = () => h.evaluate(`[...document.querySelectorAll('#log > *')].filter((n) => /Reloaded amp/.test(n.textContent)).length`);
    // Settled: the count unchanged over a full sync, however long a busy
    // machine takes to deliver what is still arriving.
    let settled = await reloads();
    for (;;) {
      await synced();
      const now = await reloads();
      if (now === settled) break;
      settled = now;
    }
    const path = join(h.workspace, 'amp.json');
    // The same drawing, its windows' state changed: as this window's own
    // window-state save writes it -- from what the window holds (a machine
    // with other fonts lays text out apart from the file's own sizes).
    const held = JSON.parse(await h.evaluate(`${h.module('main.js')}.then((m) => m.snapshot())`));
    writeFileSync(path, JSON.stringify({ ...held, windows: { scope: { nets: ['VOUT'], chosen: true } } }));
    const data = JSON.parse(readFileSync(path, 'utf8'));
    await synced();
    assert.equal(await reloads(), settled, 'no reload');
    assert.equal(await h.evaluate(`${h.module('editor-state.js')}.then((m) => !!m.editor.circuit.windows?.scope)`), false, 'what is open stays');
    // A drawing changed on disk still reloads.
    writeFileSync(path, JSON.stringify({ ...data, components: [...data.components, { ...data.components[0], refdes: 'M99', transform: { ...data.components[0].transform, x: data.components[0].transform.x + 2000 } }] }));
    await h.until(`[...document.querySelectorAll('#log > *')].filter((n) => /Reloaded amp/.test(n.textContent)).length > ${settled}`, 15000);
  });

  test('a new document is not replaced when another window makes a different one active', async () => {
    await h.until(`typeof window.__circuit === 'function' && !document.getElementById('startup-cover')`, 15000);
    await h.evaluate(`(() => { const a = document.getElementById('atlas'); if (a && !a.hidden) document.getElementById('atlas-close')?.click(); })()`);
    await h.click('#btn-new-document');
    await h.untilDiscarding(`${h.module('editor-state.js')}.then((m) => !m.editor.currentDocumentPath)`);
    // The CLI makes amp the active document; the new, unsaved one stays.
    const response = await fetch(`http://127.0.0.1:${h.port}/api/circuits/amp/cmd`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd: 'add resistor R8 --at 1200 0' }) });
    assert.ok(response.ok, await response.text());
    await synced();
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
    await h.settle();
    assert.equal(await results(), 1, 'and after it');
    await h.open('other');
    assert.equal(await results(), 0, 'another document has its own');
  });

  test('a new design saved at once stays open, though the CLI made another active earlier', async () => {
    // amp open, the CLI changes it: amp is the server's active document,
    // and the editor reloads it.
    await h.open('amp');
    const response = await fetch(`http://127.0.0.1:${h.port}/api/circuits/amp/cmd`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd: 'add resistor R6 --at 2000 0' }) });
    assert.ok(response.ok, await response.text());
    await h.untilDiscarding(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.has('R6'))`);
    // A new design, named and saved before the next sync poll.
    await h.evaluate(`${h.module('document-session.js')}.then(async (m) => {
      m.startNewDocument();
      document.getElementById('circuit-name').value = 'fresh';
      await m.saveCircuit();
    })`);
    await synced();
    assert.match(await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.currentDocumentPath)`), /fresh\.json$/, 'not replaced by amp');
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
    // A file no window has shown: leaving a design may write what its
    // windows show into its file (saveWindowState), and a write left over
    // from an earlier test landing after the dating would date it now.
    const dated = join(h.workspace, 'dated.json');
    writeFileSync(dated, JSON.stringify(amplifier()));
    utimesSync(dated, new Date(2025, 0, 5, 9, 30), new Date(2025, 0, 5, 9, 30));
    await h.open('dated');
    // The chip dates it once the file's time has come back from the server.
    try {
      await h.until(`(() => { const c = document.getElementById('status-modified'); return !c.hidden && /^saved .*2025/.test(c.textContent); })()`);
    } catch (error) {
      const chip = await h.evaluate(`document.getElementById('status-modified').textContent`);
      throw new Error(`${error.message}\n  chip: ${chip}; the file's time: ${statSync(dated).mtime.toISOString()}`);
    }
    await h.evaluate(`window.__run('add resistor R9 --at 1600 1600')`);
    await h.until(`/^edited just now$/.test(document.getElementById('status-modified').textContent)`);
  });

  test('an export is the width of the page guide chosen in Settings or in the Export dialog', async () => {
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
    // The Export dialog shows the same choice, and choosing it there is
    // choosing it in Settings.
    assert.equal(await h.evaluate(`(async () => { document.getElementById('btn-export').click(); await new Promise(requestAnimationFrame); const v = document.getElementById('export-page-guide').value; document.getElementById('export-dialog').close(); return v; })()`), '', 'the dialog shows the guide in use');
    const pickA4 = `(form) => { for (const box of form.querySelectorAll('[name=format]')) box.checked = box.value === 'svg'; const s = form.querySelector('#export-page-guide'); s.value = 'a4'; s.dispatchEvent(new Event('change', { bubbles: true })); }`;
    try {
      const [a4] = await exportWith('a4', pickA4);
      assert.ok(Math.abs(width(a4.svg) - pageGuideWidth(normalizePageGuide('a4'))) < 0.01, `${width(a4.svg)}`);
      assert.equal(await h.evaluate(`document.querySelector('#settings-menu [data-page-guide="a4"]').getAttribute('aria-checked')`), 'true');
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

  test('a new name typed for a saved design turns Save on, and Save makes a copy under it', async () => {
    await h.open('amp');
    const save = () => h.evaluate(`(() => { const b = document.getElementById('btn-save'); return { disabled: b.disabled, title: b.title }; })()`);
    assert.equal((await save()).disabled, true, 'nothing to save');
    await h.evaluate(`(() => { const field = document.getElementById('circuit-name'); field.value = 'amp-copy'; field.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    assert.deepEqual(await save(), { disabled: false, title: 'Save as a copy named “amp-copy” (Ctrl/Cmd+S)' });
    await h.click('#btn-save');
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.currentCircuitName === 'amp-copy')`);
    assert.ok(existsSync(join(h.workspace, 'amp-copy.json')) && existsSync(join(h.workspace, 'amp.json')), 'a copy beside the original');
    await h.until(`document.getElementById('btn-save').disabled`);
  });
});
