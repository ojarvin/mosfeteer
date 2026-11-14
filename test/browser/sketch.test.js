/** The Sketch tool in a browser: j arms it and shows the sketch, a drag
 *  draws a marker stroke, Shift-drag erases, Ctrl+Z steps the sketch back,
 *  Esc hides it, and it is saved with the design without making it unsaved. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { start, browserSkip } from './harness.js';
import { twoResistors, withBeats } from './fixtures.js';

describe('sketch', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { two: twoResistors(), other: twoResistors(), beats: withBeats() }, width: 1300, height: 850 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const strokes = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.sketch.strokes.length)`);
  const layerShown = () => h.evaluate(`!!document.querySelector('#canvas svg .sketch-layer')`);
  const unsaved = () => h.evaluate(`${h.module('document-session.js')}.then((m) => m.hasUnsavedChanges())`);
  const undoDepth = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.history.length)`);
  const at = (x, y) => h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.worldToClient(${x}, ${y}))`);
  /** A drag through world points, the left button held (Shift with `shift`). */
  const drag = async (points, { shift = false } = {}) => {
    const modifiers = shift ? 8 : 0;
    const [first, ...rest] = await Promise.all(points.map(([x, y]) => at(x, y)));
    await h.mouse('mouseMoved', first.x, first.y, { button: 'none', buttons: 0, modifiers });
    await h.mouse('mousePressed', first.x, first.y, { modifiers });
    for (const p of rest) await h.mouse('mouseMoved', p.x, p.y, { buttons: 1, modifiers });
    const last = rest.at(-1) || first;
    await h.mouse('mouseReleased', last.x, last.y, { modifiers });
    await h.settle();
  };

  test('j shows the sketch and draws; Esc hides it; j brings it back; none of it is a drawing edit', async () => {
    await h.open('two');
    const depth = await undoDepth();
    assert.equal(await layerShown(), false);
    await h.key('j');
    assert.equal(await h.evaluate(`document.getElementById('sketch-bar').hidden`), false);
    assert.equal(await h.evaluate(`document.getElementById('status-mode').textContent`), 'SKETCH');
    await drag([[200, 100], [300, 160], [400, 120], [500, 200]]);
    assert.equal(await strokes(), 1);
    assert.equal(await layerShown(), true);
    // Nothing of the drawing was picked or moved, and the design is not unsaved.
    assert.equal(await h.evaluate(`${h.module('main.js')}.then((m) => m.selectedComps().length)`), 0);
    assert.equal(await unsaved(), false);
    assert.equal(await undoDepth(), depth);
    await h.key('Escape');
    assert.equal(await layerShown(), false);
    assert.equal(await h.evaluate(`document.getElementById('sketch-bar').hidden`), true);
    assert.equal(await strokes(), 1, 'hidden, not gone');
    await h.key('j');
    assert.equal(await layerShown(), true);
    await h.key('j');
    assert.equal(await layerShown(), false, 'j again leaves the tool');
  });

  test('a color from the bar, Shift-drag to erase, Ctrl+Z to step back, Clear and sketch clear to empty it', async () => {
    await h.open('two');
    await h.evaluate(`window.__run('sketch clear')`);
    await h.key('j');
    await h.click('#sketch-bar [data-sketch-color="blue"]');
    await drag([[100, 600], [600, 600]]);
    await drag([[100, 800], [600, 800]]);
    assert.equal(await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.sketch.strokes[0].color)`), 'blue');
    // A Shift-drag across the first stroke takes it, not the second.
    await drag([[350, 520], [350, 680]], { shift: true });
    assert.equal(await strokes(), 1);
    assert.ok(Math.abs(await h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.sketch.strokes[0].points[0].y)`) - 800) < 2);
    await h.key('z', { ctrlKey: true });
    assert.equal(await strokes(), 2, 'the erased stroke is back');
    await h.click('#sketch-clear');
    assert.equal(await strokes(), 0);
    await h.key('z', { ctrlKey: true });
    assert.equal(await strokes(), 2, 'one step undoes Clear');
    await h.evaluate(`${h.module('main.js')}.then((m) => m.runLine('sketch clear'))`);
    assert.equal(await strokes(), 0);
    await h.key('z', { ctrlKey: true });
    assert.equal(await strokes(), 2, "sketch clear on the command line is the sketch's own step too");
    await h.key('Escape');
  });

  test("the sketch is written into the design file with the windows' state, and comes back with it", async () => {
    await h.open('two');
    await h.key('j');
    await drag([[200, 300], [500, 300]]);
    await h.key('Escape');
    assert.ok(await strokes() > 0);
    assert.equal(await unsaved(), false);
    await h.evaluate(`${h.module('document-session.js')}.then((m) => m.saveWindowState())`);
    const saved = JSON.parse(await readFile(join(h.workspace, 'two.json'), 'utf8'));
    assert.equal(saved.sketch?.strokes?.length, await strokes());
    await h.open('other');
    assert.equal(await strokes(), 0);
    await h.open('two');
    assert.equal(await strokes(), saved.sketch.strokes.length);
  });

  test('the export dialog offers the sketch when there is one, and puts it in only when asked', async () => {
    const exportWith = async (name, sketch) => {
      await h.evaluate(`${h.module('document-session.js')}.then(({ persistence }) => {
        window.__exports = [];
        if (!persistence.__realExport) persistence.__realExport = persistence.exportFiles;
        persistence.exportFiles = async (request) => { window.__exports.push(request); return persistence.__realExport(request); };
      })`);
      await h.key('e', { ctrlKey: true });
      await h.until(`document.getElementById('export-dialog').open`);
      const offered = await h.evaluate(`!document.querySelector('#export-form [name=sketch]').closest('label').hidden`);
      await h.evaluate(`(() => { const form = document.getElementById('export-form');
        document.getElementById('export-name').value = ${JSON.stringify(name)};
        for (const box of form.querySelectorAll('[name=format]')) box.checked = box.value === 'svg';
        form.querySelector('[name=sketch]').checked = ${sketch}; })()`);
      await h.click('#export-submit');
      await h.until(`window.__exports.length >= 1 && !document.getElementById('export-dialog').open`, 30000);
      return { offered, svg: await h.evaluate(`window.__exports[0].svg`) };
    };
    await h.open('other');
    const none = await exportWith('other-plain', false);
    assert.equal(none.offered, false, 'no sketch, no option');
    await h.open('two');
    assert.ok(await strokes() > 0);
    const plain = await exportWith('two-plain', false);
    assert.equal(plain.offered, true);
    assert.ok(!plain.svg.includes('sketch-layer'));
    const sketched = await exportWith('two-sketch', true);
    assert.ok(sketched.svg.includes('sketch-layer'));
  });

  test('presenting, j shows the sketch over the beat and a drag draws on it; Esc hides it, then ends the talk', async () => {
    await h.open('beats');
    await h.evaluate(`window.__run('sketch clear')`);
    await h.evaluate(`${h.module('beats-ui.js')}.then((m) => m.openPresenter(0))`);
    await h.until(`!!document.querySelector('.presenter-frame svg')`);
    const press = (key) => h.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))`);
    const index = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.presenter?.index ?? null)`);
    const layer = () => h.evaluate(`!!document.querySelector('.presenter-frame svg .sketch-layer')`);
    await press('j');
    assert.equal(await h.evaluate(`document.getElementById('presenter').classList.contains('sketching')`), true);
    // A drag across the middle of the screen draws; the click it ends with does not step.
    await h.mouse('mouseMoved', 500, 400, { button: 'none', buttons: 0 });
    await h.mouse('mousePressed', 500, 400);
    for (const x of [560, 620, 680, 740]) await h.mouse('mouseMoved', x, 420, { buttons: 1 });
    await h.mouse('mouseReleased', 740, 420);
    await h.settle();
    assert.equal(await strokes(), 1);
    assert.equal(await layer(), true);
    assert.equal(await index(), 0, 'drawing does not step');
    // The stroke lies where it was drawn: in the drawing's world, under the pointer.
    const lies = await h.evaluate(`${h.module('editor-state.js')}.then((m) => {
      const svg = [...document.querySelectorAll('.presenter-frame svg')].at(-1);
      const p = m.editor.circuit.sketch.strokes[0].points[0];
      const s = new DOMPoint(p.x, p.y).matrixTransform(svg.getScreenCTM());
      return Math.hypot(s.x - 500, s.y - 400);
    })`);
    assert.ok(lies < 2, String(lies));
    await press('z');
    assert.equal(await index(), 0, 'z is no step');
    await press('Escape');
    assert.equal(await layer(), false, 'Esc hides the sketch');
    assert.equal(await h.evaluate(`!document.getElementById('presenter').hidden`), true, 'and keeps presenting');
    await press('Escape');
    await h.until(`document.getElementById('presenter').hidden`);
    assert.equal(await strokes(), 1, 'the sketch is kept');
  });

  test('the rail holds Sketch below Highlight, the annotations right after Net label; its button arms and leaves the tool', async () => {
    await h.open('two');
    const rail = await h.evaluate(`[...document.querySelectorAll('.mode-toolbar > button')].map((b) => b.id)`);
    assert.deepEqual(rail.slice(-4), ['btn-mode-net-label', 'btn-rail-annotate', 'btn-mode-highlight', 'btn-mode-sketch']);
    await h.click('#btn-mode-sketch');
    assert.equal(await h.evaluate(`document.getElementById('btn-mode-sketch').getAttribute('aria-pressed')`), 'true');
    assert.equal(await h.evaluate(`document.getElementById('canvas').classList.contains('mode-sketch')`), true);
    assert.equal(await h.evaluate(`document.getElementById('sketch-bar').hidden`), false);
    await h.click('#btn-mode-sketch');
    assert.equal(await h.evaluate(`document.getElementById('btn-mode-sketch').getAttribute('aria-pressed')`), 'false');
    assert.equal(await h.evaluate(`document.getElementById('canvas').classList.contains('mode-sketch')`), false);
    assert.equal(await h.evaluate(`document.getElementById('sketch-bar').hidden`), true);
  });
});
