import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Circuit, LABEL_FONT_SIZE } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { editorOverlay, svgString } from '../src/core/render.js';
import { DRAWING_EXPORT_OPTIONS } from '../src/core/selection-drawing.js';
import {
  circuitPageGuideFrame, normalizePageGuide, pageGuideFrame, pageGuideTextSize, pageGuideWidth,
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

test('the frame centres the drawing, or says when the drawing is too wide', () => {
  const frame = pageGuideFrame(single, 0, 400);
  assert.equal(frame.fits, true);
  assert.ok(Math.abs(frame.x + frame.width / 2 - 200) < 1e-9);
  const wide = pageGuideFrame(single, 0, 2000);
  assert.equal(wide.fits, false);
  assert.deepEqual([wide.x, wide.width], [0, 2000]);
  assert.ok(Math.abs(wide.textPt - pageGuideTextSize(single, 2000)) < 1e-9);
  assert.ok(wide.textPt < 8);
  assert.ok(Math.abs(wide.target.width - pageGuideWidth(single)) < 1e-9);
  assert.ok(Math.abs(wide.target.x + wide.target.width / 2 - 1000) < 1e-9, 'centred on the drawing');
  assert.ok(Math.abs(wide.trimCells - (2000 - pageGuideWidth(single)) / 80) < 1e-9);
});

test('an export with a page guide is exactly the guide width, centred on the drawing', () => {
  const circuit = new Circuit();
  runCommand(circuit, 'add resistor R1 --at 0 0');
  const plain = svgString(circuit, DRAWING_EXPORT_OPTIONS);
  const guided = svgString(circuit, { ...DRAWING_EXPORT_OPTIONS, pageGuide: single });
  const box = (svg) => svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
  const [px, , pw, ph] = box(plain);
  const [gx, , gw, gh] = box(guided);
  assert.ok(Math.abs(gw - pageGuideWidth(single)) < 0.01);
  assert.equal(gh, ph, 'only the width changes');
  assert.ok(Math.abs((gx + gw / 2) - (px + pw / 2)) < 0.01, 'the drawing stays centred');
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
  // 38 units of text across 2000 units in a 252 pt column.
  assert.match(wide, /#dc2626/);
  assert.match(wide, /text would be 4\.8 pt/);
  // The column's own width still shows, as the part to trim to.
  const trim = (2000 - pageGuideWidth(single)) / 2 / 40;
  assert.match(wide, /class="page-guide-overflow"/);
  assert.match(wide, new RegExp(`−${Math.round(trim * 10) / 10} cells`));
  assert.doesNotMatch(fits, /page-guide-overflow/);
  assert.doesNotMatch(editorOverlay(new Circuit(), {}), /page-guide/);
});

test('settings hold the page guide and preferences; More holds document actions', () => {
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="btn-settings"[^>]*aria-haspopup="menu"/);
  const settings = html.slice(html.indexOf('id="settings-menu"'), html.indexOf('</header>'));
  assert.match(settings, /toolbar-menu-note[\s\S]*data-page-guide="ieee-1col"[\s\S]*data-page-guide="ieee-2col"/);
  for (const id of ['btn-scroll-scheme', 'btn-tips', 'btn-tutorial']) assert.match(settings, new RegExp(`id="${id}"`));
  // The settings button is not in the view cluster, so a folded toolbar keeps it.
  const view = html.slice(html.indexOf('class="toolbar-cluster view-cluster"'), html.indexOf('class="toolbar-cluster settings-cluster"'));
  assert.doesNotMatch(view, /btn-settings/);
  const more = html.slice(html.indexOf('id="document-menu"'), html.indexOf('</div>', html.indexOf('id="document-menu"')));
  for (const id of ['btn-scroll-scheme', 'btn-tips', 'btn-tutorial', 'data-page-guide']) assert.doesNotMatch(more, new RegExp(id));
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  assert.match(main, /renderDocument\(drawing, \{\s*\.\.\.DRAWING_EXPORT_OPTIONS,\s*grid,\s*pageGuide,/);
});
