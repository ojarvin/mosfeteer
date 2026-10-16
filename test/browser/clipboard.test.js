/** Copying and pasting in a browser: the system clipboard carries the
 *  copy, a copied net label pastes into the net label tool, and a copied
 *  net keeps its diagonal legs, and a pasted PNG is kept losslessly in the
 *  smaller of PNG and WebP. */

import { describe, before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, browserSkip } from './harness.js';
import { editing } from './fixtures.js';
import { Circuit } from '../../src/core/model.js';
import { runCommand } from '../../src/core/commands.js';

/** Two cross-coupled pairs: nets N1 and N2 run diagonally. */
function crossed() {
  const circuit = new Circuit();
  for (const line of ['add resistor R1 --at 0 0 --rot 90', 'add resistor R2 --at 400 0 --rot 90', 'add resistor R3 --at 0 400 --rot 90', 'add resistor R4 --at 400 400 --rot 90', 'cross R1.b R4.a R2.b R3.a']) runCommand(circuit, line);
  return circuit.toJSON();
}

describe('copy and paste', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { edit: editing() }, width: 1400, height: 900 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });
  beforeEach(async () => {
    await h.open('edit');
    await h.key('Escape');
    await h.evaluate(`window.__load(${JSON.stringify(editing())})`);
  });

  const ed = (expression) => h.evaluate(`${h.module('editor-state.js')}.then((m) => { const e = m.editor; const c = e.circuit; return ${expression}; })`);
  const select = (refs, labels = []) => h.evaluate(`${h.module('main.js')}.then((m) => { if (${refs.length}) m.setSelection(${JSON.stringify(refs)}); else m.setLabelSelection(${JSON.stringify(labels)}); m.render(); })`);
  /** A key pressed on the drawing, as the browser delivers it; whether the editor kept its default. */
  const press = (key, init = {}) => h.evaluate(`(() => { const ev = new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true, ...${JSON.stringify(init)} }); document.body.dispatchEvent(ev); return ev.defaultPrevented; })()`);
  /** Ctrl+C: the text it put on the system clipboard. */
  const copy = async () => {
    await h.evaluate(`(() => {
      window.__copied = null;
      // The editor writes the copy event's data, which reads back empty: catch it as written.
      window.addEventListener('copy', (ev) => { const set = ev.clipboardData.setData.bind(ev.clipboardData); ev.clipboardData.setData = (type, text) => { window.__copied = text; set(type, text); }; }, { once: true, capture: true });
      if (!navigator.clipboard.__real) navigator.clipboard.__real = navigator.clipboard.writeText;
      navigator.clipboard.writeText = (text) => { window.__copied = text; return Promise.resolve(); };
    })()`);
    await press('c', { ctrlKey: true });
    await h.until(`!!window.__copied`);
    return h.evaluate(`window.__copied`);
  };
  /** Ctrl+V with `text` in the browser's paste event; whether the key kept its default. */
  const paste = async (text) => {
    const prevented = await press('v', { ctrlKey: true });
    await h.evaluate(`(() => { const data = new DataTransfer(); data.setData('text/plain', ${JSON.stringify(text)}); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); })()`);
    return prevented;
  };

  test('Ctrl+C puts the copy on the system clipboard; Ctrl+V pastes what the paste event carries', async () => {
    await select(['R1']);
    const text = await copy();
    assert.ok(text.length > 0);
    // Another editor's copy: this one's own buffer is not what is pasted.
    await h.evaluate(`${h.module('editor-state.js')}.then((m) => { m.editor.clipboard = null; })`);
    const before = await ed('c.components.size');
    assert.equal(await paste(text), false, 'Ctrl+V keeps its default, or no paste event follows');
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.size === ${before + 1})`);
  });

  test('a copied net label pastes into the net label tool, which asks before renaming another named net', async () => {
    for (const line of ['add resistor R4 --at 600 400', 'add resistor R5 --at 1000 400', 'connect R4.b R5.a --name MID']) await h.evaluate(`window.__run(${JSON.stringify(line)})`);
    const label = await ed(`[...c.labels.values()].find((l) => l.text === 'OUT').id`);
    await select([], [label]);
    const text = await copy();
    const before = await ed('c.labels.size');
    await paste(text);
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.labelMode === 'net')`);
    assert.equal(await ed('c.labels.size'), before, 'no loose text dropped');
    // Clicked on MID's wire: asked first.
    const p = await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.worldToClient(800, 400))`);
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
    await h.mouse('mousePressed', p.x, p.y);
    await h.mouse('mouseReleased', p.x, p.y);
    await h.until(`!!document.querySelector('dialog[open]')`);
    assert.match(await h.evaluate(`document.querySelector('dialog[open]').textContent`), /Rename it to OUT\?/);
    await h.evaluate(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent.trim() === 'Cancel').click()`);
    await h.until(`!document.querySelector('dialog[open]')`);
    assert.equal(await ed(`c.netOfTerminal({ comp: 'R4', term: 'b' }).name`), 'MID');
    // l afterwards places the names typed, not the pasted one.
    await h.key('Escape');
    await h.key('l');
    await h.until(`!!document.querySelector('.label-prompt input')`);
    await h.evaluate(`(() => { const input = document.querySelector('.label-prompt input'); input.value = 'NEW'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    await h.until(`!document.querySelector('.label-prompt')`);
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
    await h.mouse('mousePressed', p.x, p.y);
    await h.mouse('mouseReleased', p.x, p.y);
    await h.until(`!!document.querySelector('dialog[open]')`);
    assert.match(await h.evaluate(`document.querySelector('dialog[open]').textContent`), /Rename it to NEW\?/);
    await h.evaluate(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent.trim() === 'Cancel').click()`);
    await h.key('Escape');
  });

  test('a copied net keeps its diagonal legs', async () => {
    await h.evaluate(`window.__load(${JSON.stringify(crossed())})`);
    await h.evaluate(`${h.module('main.js')}.then((m) => { m.selectAll(); m.render(); })`);
    const text = await copy();
    await h.evaluate(`${h.module('editor-state.js')}.then((m) => { m.editor.cursor = { x: 1200, y: 0 }; })`);
    await paste(text);
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.size === 8)`);
    assert.deepEqual(await ed('[...c.nets.values()].map((n) => n.allowDiagonal)'), [true, true, true, true]);
  });

  test('a resized block pastes at its size, with the terminals its wires end on', async () => {
    const circuit = new Circuit();
    runCommand(circuit, 'add block B1 --at 0 0');
    circuit.resizeBlock('B1', { x: -80, y: -80, w: 320, h: 240 });
    // T13 is a slot only the larger block has.
    for (const line of ['add resistor R1 --at 200 360 --rot 90', 'connect B1.T13 R1.a']) runCommand(circuit, line);
    await h.evaluate(`window.__load(${JSON.stringify(circuit.toJSON())})`);
    await h.evaluate(`${h.module('main.js')}.then((m) => { m.selectAll(); m.render(); })`);
    const text = await copy();
    // Pasted into another design.
    await h.evaluate(`window.__load(${JSON.stringify(new Circuit().toJSON())})`);
    await paste(text);
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.size === 2)`);
    const block = await ed(`(() => { const b = [...c.components.values()].find((x) => x.type === 'block'); return { size: b.blockSize, terminals: b.blockTerminals.length, wired: [...c.nets.values()].some((n) => n.terminals.some((t) => t.comp === b.refdes && t.term === 'T13')) }; })()`);
    assert.deepEqual(block, { size: { w: 320, h: 240 }, terminals: 24, wired: true });
  });

  test('a paste that fails part way leaves the drawing as it was', async () => {
    const before = await ed('JSON.stringify(c.toJSON())');
    const undoable = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.history.length)`);
    const steps = await undoable();
    const pasted = await h.evaluate(`Promise.all([${h.module('editor-state.js')}, ${h.module('copy-paste.js')}]).then(([s, p]) => {
      // A part goes in, then a broken net fails the rest.
      s.editor.clipboard = { comps: [{ origRef: 'X1', type: 'resistor', x: 0, y: 2000, rotation: 0 }], labels: [], nets: [{ id: 'N9', terminals: [] }], fragments: [], anchor: { x: 0, y: 0 }, style: null };
      return p.pasteClipboard();
    })`);
    assert.equal(pasted, false, 'it failed');
    assert.equal(await ed('JSON.stringify(c.toJSON())'), before);
    assert.equal(await undoable(), steps, 'and no undo step');
  });
  /** Paste a PNG drawn by `draw(g, w, h)` on a w×h canvas, with the pointer
   *  over the drawing; the picture as the document keeps it, and whether it
   *  draws the very pixels of the PNG. */
  const pastePicture = async (w, h2, draw) => {
    await h.mouse('mouseMoved', 600, 400, { button: 'none', buttons: 0 });
    const before = await ed('[...c.labels.values()].filter((l) => l.image).length');
    await h.evaluate(`(async () => {
      const canvas = new OffscreenCanvas(${w}, ${h2});
      (${draw})(canvas.getContext('2d'), ${w}, ${h2});
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      window.__png = await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
      const data = new DataTransfer();
      data.items.add(new File([blob], 'picture.png', { type: 'image/png' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    })()`);
    await h.until(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].filter((l) => l.image).length === ${before + 1})`, 5000);
    return h.evaluate(`${h.module('editor-state.js')}.then(async (m) => {
      const src = [...m.editor.circuit.labels.values()].filter((l) => l.image).at(-1).image.src;
      const pixels = async (url) => {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = new OffscreenCanvas(image.naturalWidth, image.naturalHeight);
        const g = canvas.getContext('2d'); g.drawImage(image, 0, 0);
        return [...g.getImageData(0, 0, canvas.width, canvas.height).data].join();
      };
      return { type: src.slice(5, src.indexOf(';')), length: src.length, png: window.__png.length, same: (await pixels(src)) === (await pixels(window.__png)) };
    })`);
  };

  test('a pasted screenshot is kept as lossless WebP when that is smaller', async () => {
    const kept = await pastePicture(480, 320, (g, w, h) => {
      g.fillStyle = '#fafafa'; g.fillRect(0, 0, w, h);
      g.font = '13px sans-serif';
      for (let row = 0; row < 18; row++) {
        g.fillStyle = ['#111', '#1565c0', '#c62828'][row % 3];
        g.fillText(`Vout = ${(row * 1.37).toFixed(2)} V  gm·ro = ${(row * 7.1 + 3).toFixed(1)}  f₋₃dB ${row + 2} MHz`, 8, 16 + row * 17);
      }
      g.strokeStyle = '#2e7d32'; g.lineWidth = 1.5; g.beginPath();
      for (let x = 0; x < w; x++) g.lineTo(x, h / 2 + 60 * Math.sin(x / 23));
      g.stroke();
    });
    assert.equal(kept.type, 'image/webp', JSON.stringify(kept));
    assert.ok(kept.length < kept.png, JSON.stringify(kept));
    assert.equal(kept.same, true, 'lossless: the same pixels as the PNG');
  });

  test('a pasted PNG stays PNG when WebP would not be smaller', async () => {
    const kept = await pastePicture(1, 1, (g) => { g.fillStyle = '#000'; g.fillRect(0, 0, 1, 1); });
    assert.deepEqual(kept, { ...kept, type: 'image/png', length: kept.png, same: true });
  });
});
