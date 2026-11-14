/** The browser-only build opened from its file: the math face comes from
 *  the bundle, and an optimizer worker starts from the bundle's own source
 *  under the page's policy. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, browserSkip } from './harness.js';
import { Circuit } from '../../src/core/model.js';
import { runCommand } from '../../src/core/commands.js';

describe('browser-only, opened from a file', { skip: browserSkip() }, () => {
  let h;
  before(async () => {
    h = await start({ width: 1400, height: 900 });
    await h.send('Page.navigate', { url: new URL('../../browser-only/index.html', import.meta.url).href });
    await h.until(`location.protocol === 'file:' && typeof window.__circuit === 'function' && document.readyState === 'complete' && !document.getElementById('startup-cover')`, 15000);
  });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  test('the math face loads from the bundle', async () => {
    const face = await h.evaluate(`(async () => {
      await document.fonts.load('16px "Latin Modern Math"');
      return [...document.fonts].filter((f) => f.family.replace(/"/g, '') === 'Latin Modern Math').map((f) => f.status);
    })()`);
    assert.deepEqual(face, ['loaded']);
  });

  test('an optimizer worker starts from the bundle and scores', async () => {
    const circuit = new Circuit();
    for (const line of ['add input U --at 0 0', 'add gain K1 --at 400 0 --value k', 'add output V --at 800 0', 'connect U.p K1.in', 'connect K1.out V.p']) runCommand(circuit, line);
    const result = await h.evaluate(`(async () => {
      const url = URL.createObjectURL(new Blob(['(' + globalThis.__MOSFETEER_BUNDLE + ')("src/web/optimize-worker.js");'], { type: 'text/javascript' }));
      const worker = new Worker(url);
      const next = () => new Promise((resolve) => { worker.onmessage = ({ data }) => resolve(data); worker.onerror = (ev) => resolve({ error: ev.message || 'worker error' }); });
      let reply = next();
      worker.postMessage({ type: 'init', circuit: ${JSON.stringify(circuit.toJSON())}, problem: { output: 'V', sources: { U: 'input' }, band: { f0: 0, bw: 0.01 }, values: { k: 1 }, setup: { specs: [{ action: 'maximize', measure: 'average', input: 'U', band: 'signal' }] } } });
      const ready = await reply;
      reply = next();
      worker.postMessage({ type: 'evaluate', id: 3, batch: [{ k: 2 }] });
      const scores = await reply;
      worker.terminate();
      return { ready, id: scores.id, gain: scores.scores?.[0]?.specs?.[0] };
    })()`);
    assert.deepEqual(result.ready, { type: 'ready', ok: true, error: null });
    assert.equal(result.id, 3);
    assert.ok(Math.abs(result.gain - 20 * Math.log10(2)) < 1e-6);
  });

  test('a PDF, of the notes or the drawing, opens in the browser\'s print dialog sized to its pages', async () => {
    // Each print view as it opens. Its print is answered here, as a browser
    // closing the dialog would: a real dialog can block the page (print-pdf.js
    // prints a task after the frame's load, so this replaces it first).
    await h.evaluate(`(() => {
      window.__printed = [];
      new MutationObserver((records) => {
        for (const record of records) for (const node of record.addedNodes) {
          if (!node.classList?.contains('print-frame')) continue;
          node.addEventListener('load', () => {
            const win = node.contentWindow;
            win.print = () => { window.__printed.push(node.srcdoc); win.dispatchEvent(new Event('afterprint')); };
          });
        }
      }).observe(document.body, { childList: true });
    })()`);
    const circuit = new Circuit();
    runCommand(circuit, 'add resistor R1 --at 0 0');
    circuit.notes = '# Bias\n\nThe resistor sets the bias.';
    await h.evaluate(`window.__load(${JSON.stringify(circuit.toJSON())})`);
    const exportAs = async (content, name) => {
      await h.click('#btn-export');
      await h.until(`document.getElementById('export-dialog').open`);
      await h.click(`[data-export-content="${content}"]`);
      await h.evaluate(`(() => { const form = document.getElementById('export-form');
        document.getElementById('export-name').value = ${JSON.stringify(name)};
        for (const box of form.querySelectorAll('[name=format]')) box.checked = box.value === 'pdf'; })()`);
      assert.equal(await h.evaluate(`document.querySelector('#export-form [name=format][value=pdf]').disabled`), false, 'PDF is offered');
      const before = await h.evaluate(`window.__printed.length`);
      await h.click('#export-submit');
      await h.until(`window.__printed.length > ${before}`, 20000);
      return h.evaluate(`window.__printed.at(-1)`);
    };
    const notes = await exportAs('report', 'bias-notes');
    assert.match(notes, /<title>bias-notes<\/title>|<h1[^>]*>Bias/);
    assert.match(notes, /The resistor sets the bias/);
    assert.match(notes, /@page/);
    const drawing = await exportAs('drawing', 'bias');
    assert.match(drawing, /<title>bias<\/title>/);
    assert.match(drawing, /@page p0\{size:[\d.]+px [\d.]+px;margin:0\}/);
    assert.match(drawing, /<svg/);
  });
});
