import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, LABEL_FONT_SIZE } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { editorOverlay, svgString } from '../src/core/render.js';
import { DRAWING_EXPORT_OPTIONS, selectionDrawing } from '../src/core/selection-drawing.js';
import {
  circuitPageGuideFrame, customPageGuide, normalizePageGuide, pageGuideCaption, pageGuideFrame, pageGuideTextSize, pageGuideTitle, pageGuideWidth,
} from '../src/core/page-guide.js';

const single = normalizePageGuide('ieee-1col');
const double = normalizePageGuide('ieee-2col');

test('the guide width puts label text at the body size across a full column', () => {
  // 3.5 in = 252 pt; a label LABEL_FONT_SIZE units tall must scale to 8 pt.
  assert.equal(single.textPt, 8);
  assert.ok(Math.abs((LABEL_FONT_SIZE * 252) / pageGuideWidth(single) - 8) < 1e-9);
  assert.ok(Math.abs((LABEL_FONT_SIZE * 516) / pageGuideWidth(double) - 8) < 1e-9);
  assert.ok(pageGuideWidth(double) > 2 * pageGuideWidth(single), 'two columns and the gutter');
  assert.equal(normalizePageGuide('letter'), null);
  assert.equal(normalizePageGuide(''), null);
});

test('the frame centers the drawing, or says when the drawing is too wide', () => {
  const frame = pageGuideFrame(single, 0, 400);
  assert.equal(frame.fits, true);
  assert.ok(Math.abs(frame.x + frame.width / 2 - 200) < 1e-9);
  const wide = pageGuideFrame(single, 0, 2000);
  assert.equal(wide.fits, false);
  assert.deepEqual([wide.x, wide.width], [0, 2000]);
  assert.ok(Math.abs(wide.textPt - pageGuideTextSize(single, 2000)) < 1e-9);
  assert.ok(wide.textPt < 8);
  assert.ok(Math.abs(wide.target.width - pageGuideWidth(single)) < 1e-9);
  assert.ok(Math.abs(wide.target.x + wide.target.width / 2 - 1000) < 1e-9, 'centered on the drawing');
  assert.ok(Math.abs(wide.trimCells - (2000 - pageGuideWidth(single)) / 80) < 1e-9);
});

test('an export with a page guide is exactly the guide width, centered on the drawing', () => {
  const circuit = new Circuit();
  runCommand(circuit, 'add resistor R1 --at 0 0');
  const plain = svgString(circuit, DRAWING_EXPORT_OPTIONS);
  const guided = svgString(circuit, { ...DRAWING_EXPORT_OPTIONS, pageGuide: single });
  const box = (svg) => svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
  const [px, , pw, ph] = box(plain);
  const [gx, , gw, gh] = box(guided);
  assert.ok(Math.abs(gw - pageGuideWidth(single)) < 0.01);
  assert.equal(gh, ph, 'only the width changes');
  assert.ok(Math.abs((gx + gw / 2) - (px + pw / 2)) < 0.01, 'the drawing stays centered');
  assert.match(guided, new RegExp(`width="${Number.isInteger(gw) ? gw : gw.toFixed(2)}"`));
  // The editor guide marks the same frame the export uses.
  const frame = circuitPageGuideFrame(circuit, single, DRAWING_EXPORT_OPTIONS.padding);
  assert.ok(Math.abs(frame.x - gx) < 0.01);
});

test('the editor draws the guide quietly, and in red when the drawing is wider', () => {
  const view = { x: -800, y: -600, w: 1600, h: 1200 };
  const fits = editorOverlay(new Circuit(), { pageGuide: { frame: pageGuideFrame(single, -100, 100), view, caption: 'IEEE single column' } });
  assert.match(fits, /class="page-guide"/);
  assert.match(fits, /#6b7a90/);
  const wide = editorOverlay(new Circuit(), { pageGuide: { frame: pageGuideFrame(single, -1000, 1000), view, caption: 'IEEE single column' } });
  // 46 units of text across 2000 units in a 252 pt column.
  assert.match(wide, /#dc2626/);
  assert.match(wide, /text would be 5\.8 pt/);
  // The column's own width still shows, as the part to trim to.
  const trim = (2000 - pageGuideWidth(single)) / 2 / 40;
  assert.match(wide, /class="page-guide-overflow"/);
  assert.match(wide, new RegExp(`−${Math.round(trim * 10) / 10} cells`));
  assert.doesNotMatch(fits, /page-guide-overflow/);
  assert.doesNotMatch(editorOverlay(new Circuit(), {}), /page-guide/);
});

test('the A4 guide sets base label text at 8 pt across a 16 cm text width', () => {
  const a4 = normalizePageGuide('a4');
  assert.equal(a4.textPt, 8);
  // The target is the label's base text (LABEL_FONT_SIZE), not its subscripts.
  assert.ok(Math.abs((LABEL_FONT_SIZE * 453.54) / pageGuideWidth(a4) - 8) < 1e-9);
  assert.match(pageGuideCaption(a4), /A4 page \(16 cm\) · 8 pt text with \\includegraphics\[width=\\textwidth\]/);
  assert.match(pageGuideCaption(single), /width=\\columnwidth/);
  assert.match(pageGuideCaption(double), /width=\\textwidth/);
});

test('a copied selection image is padded to the guide, centered on the selection', () => {
  const circuit = new Circuit();
  runCommand(circuit, 'add resistor R1 --at 0 0');
  runCommand(circuit, 'add resistor R2 --at 2000 0');
  const svg = selectionDrawing(circuit, { refs: ['R2'] }, { pageGuide: single });
  const [x, , w] = svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
  assert.ok(Math.abs(w - pageGuideWidth(single)) < 0.01);
  assert.ok(Math.abs(x + w / 2 - 2000) < 0.01, 'centered on R2, not on the drawing');
  assert.doesNotMatch(svg, /data-ref="R1"/);
});

test('a custom guide takes its width in in, cm, mm, or pt and its own text size', () => {
  const custom = normalizePageGuide({ preset: 'custom', width: 12, unit: 'cm', textPt: 9 });
  assert.equal(custom.preset, 'custom');
  assert.ok(Math.abs(custom.widthPt - (12 * 72) / 2.54) < 1e-9);
  // Label text lands at 9 pt across 12 cm.
  assert.ok(Math.abs((LABEL_FONT_SIZE * custom.widthPt) / pageGuideWidth(custom) - 9) < 1e-9);
  assert.equal(pageGuideTitle(custom), 'Custom (12 cm, 9 pt)');
  assert.match(pageGuideCaption(custom), /Custom \(12 cm\) · 9 pt text with \\includegraphics\[width=12cm\]/);
  // A normalized guide normalizes to itself, as a stored one is read back.
  assert.deepEqual(normalizePageGuide(custom), custom);
  assert.deepEqual(normalizePageGuide({ preset: 'custom', width: '3.5', unit: 'in', textPt: '8' }).widthPt, 252);
  // A drawing wider than it is fitted to its width, its text smaller.
  const wide = pageGuideFrame(custom, 0, 2 * pageGuideWidth(custom));
  assert.equal(wide.fits, false);
  assert.ok(Math.abs(wide.textPt - 4.5) < 1e-9);
});

test('a custom guide outside its bounds is refused, saying why', () => {
  assert.equal(normalizePageGuide({ preset: 'custom', width: 12, unit: 'furlong', textPt: 9 }), null);
  assert.equal(customPageGuide({ width: -1, unit: 'cm', textPt: 9 }), null);
  assert.throws(() => customPageGuide({ width: 0.1, unit: 'cm', textPt: 9 }, { strict: true }), /width must be from 1\.27 to 101\.6 cm/);
  assert.throws(() => customPageGuide({ width: 12, unit: 'cm', textPt: 2 }, { strict: true }), /text size must be from 4 to 36 pt/);
  assert.throws(() => customPageGuide({ width: 'wide', unit: 'cm', textPt: 9 }, { strict: true }), /positive number/);
});

test('every guide is listed with its width and text size, the menus as pageGuideTitle names them', async () => {
  assert.equal(pageGuideTitle(normalizePageGuide('a4')), 'A4 page (16 cm, 8 pt)');
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../src/web/index.html', import.meta.url), 'utf8');
  for (const preset of ['ieee-1col', 'ieee-2col', 'a4']) {
    const title = pageGuideTitle(normalizePageGuide(preset));
    assert.ok(html.includes(`data-page-guide="${preset}">${title}</button>`), `the settings menu names ${title}`);
    assert.ok(html.includes(`<option value="${preset}">${title}</option>`), `the export dialog names ${title}`);
  }
});
