import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATLAS_CAPTION, ATLAS_GAP } from '../src/web/atlas-layout.js';
import { MAX_SHEET_PX, atlasSheetSvg, sheetCaption } from '../src/web/atlas-sheet.js';
import { svgPixelSize } from '../src/core/render.js';

const drawing = (box, body = '<path d="M 0 0 L 40 0" stroke="#111"/>') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}">\n${body}\n</svg>`;

const boxA = { x: -143, y: -199, w: 606, h: 344 };
const boxB = { x: -60, y: -60, w: 520, h: 120 };
const items = [
  { x: 1000 + boxA.x, y: 400 + boxA.y, w: boxA.w, h: boxA.h, box: boxA, svg: drawing(boxA), caption: 'latch' },
  { x: -800 + boxB.x, y: boxB.y, w: boxB.w, h: boxB.h, box: boxB, svg: drawing(boxB, '<text>R &amp; C</text>'), caption: sheetCaption('rc', ['filter', 'lab']) },
];

test('each design is nested whole at its tile, drawn from its own viewBox', () => {
  const { svg, scale } = atlasSheetSvg(items);
  assert.equal(scale, 1);
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" /);
  assert.equal((svg.match(/<svg\b/g) || []).length, 3, 'the sheet plus one nested drawing each');
  assert.match(svg, /<svg x="857" y="201" width="606" height="344" viewBox="-143 -199 606 344" overflow="visible">\n<path d="M 0 0 L 40 0" stroke="#111"\/>\n<\/svg>/);
  assert.match(svg, /<svg x="-860" y="-60" width="520" height="120" viewBox="-60 -60 520 120" overflow="visible">\n<text>R &amp; C<\/text>\n<\/svg>/);
  assert.doesNotMatch(svg, /\sxmlns="[^"]*"[^>]*overflow="visible"/, 'nested drawings drop their own namespace attribute');
});

test('the sheet frames every design and caption with the gap around them, on white paper', () => {
  const { svg } = atlasSheetSvg(items);
  const x0 = -860 - ATLAS_GAP;
  const y0 = -60 - ATLAS_GAP;
  const x1 = 857 + 606 + ATLAS_GAP;
  const y1 = 201 + 344 + ATLAS_CAPTION + ATLAS_GAP;
  assert.match(svg, new RegExp(`^<svg [^>]*width="${x1 - x0}" height="${y1 - y0}" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}">`));
  assert.match(svg, new RegExp(`<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="#fff"/>`));
  assert.equal(svgPixelSize(svg).width, x1 - x0);
});

test('captions name each design with its tags, under it, escaped, and fitted to its width', () => {
  const { svg } = atlasSheetSvg([...items, { ...items[1], w: 200, y: 2000, caption: 'a very long design name that runs far past its small drawing' }]);
  assert.match(svg, /<text x="857" y="[\d.]+" dominant-baseline="hanging"[^>]*>latch<\/text>/);
  assert.match(svg, />rc {3}#filter #lab<\/text>/);
  const long = svg.match(/>(a very long[^<]*)<\/text>/)[1];
  assert.ok(long.endsWith('…') && long.length < 30, long);
  assert.equal(sheetCaption('amp'), 'amp');
  const bare = atlasSheetSvg([{ ...items[0], caption: '' }]).svg;
  assert.doesNotMatch(bare, /<text x=/, 'the symbol sheet has no caption');
});

test('the grid option draws the editor grid and frames the sheet on whole cells', () => {
  const { svg } = atlasSheetSvg(items, { grid: true });
  const [x, y, w, h] = svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/).slice(1).map(Number);
  for (const value of [x, y, w, h]) assert.ok(value % 40 === 0, `${value} is off the grid`);
  assert.match(svg, /<path class="grid-line" d="M -?\d+ -?\d+ V -?\d+[^"]*" fill="none" stroke="#e9e9e9" stroke-width="1"\/>/);
  assert.doesNotMatch(atlasSheetSvg(items).svg, /grid-line/);
});

test('a sheet past a PDF page shrinks its page, keeping its drawing units', () => {
  const huge = [{ ...items[0], x: 0, y: 0 }, { ...items[1], x: 3 * MAX_SHEET_PX, y: 0 }];
  const { svg, scale } = atlasSheetSvg(huge);
  assert.ok(scale < 1);
  const { width } = svgPixelSize(svg);
  assert.ok(Math.abs(width - MAX_SHEET_PX) < 0.01, String(width));
  const viewW = Number(svg.match(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+)/)[1]);
  assert.ok(Math.abs(viewW * scale - MAX_SHEET_PX) < 0.01);
  assert.throws(() => atlasSheetSvg([]), /no designs/);
});
