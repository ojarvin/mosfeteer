import test from 'node:test';
import assert from 'node:assert/strict';
import { LABEL_FONT_SIZE } from '../src/core/model.js';
import { decodePngToRgb } from '../src/server/pdf-raster.js';
import {
  DEFAULT_EXPORT_TEXT_PT, DEFAULT_PNG_DPI, normalizePngDpi, pngRasterScale, withPngDensity,
} from '../src/core/png-export.js';

const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');

function chunks(bytes) {
  const list = [];
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at);
    list.push({ type: bytes.toString('latin1', at + 4, at + 8), data: bytes.subarray(at + 8, at + 8 + length), crc: bytes.readUInt32BE(at + 8 + length) });
    at += 12 + length;
  }
  return list;
}

test('PNG scale puts label text at the nominal point size for the DPI', () => {
  assert.equal(DEFAULT_PNG_DPI, 300);
  assert.equal(DEFAULT_EXPORT_TEXT_PT, 10);
  // A label LABEL_FONT_SIZE units tall is textPt/72 in, so dpi*textPt/72 px.
  assert.ok(Math.abs(pngRasterScale(150) * LABEL_FONT_SIZE - (150 * 10) / 72) < 1e-9);
  assert.ok(Math.abs(pngRasterScale(300, 8) * LABEL_FONT_SIZE - (300 * 8) / 72) < 1e-9);
  assert.equal(normalizePngDpi('150'), 150);
  assert.equal(normalizePngDpi(96), 300);
  assert.equal(normalizePngDpi(undefined), 300);
});

test('the PNG records its DPI in one pHYs chunk right after IHDR', () => {
  const once = Buffer.from(withPngDensity(new Uint8Array(TINY_PNG), 150));
  const list = chunks(once);
  assert.deepEqual(list.map((chunk) => chunk.type), ['IHDR', 'pHYs', 'IDAT', 'IEND']);
  const phys = list[1];
  assert.equal(phys.data.readUInt32BE(0), 5906);
  assert.equal(phys.data.readUInt32BE(4), 5906);
  assert.equal(phys.data[8], 1);
  assert.equal(phys.crc, 0x679fd252);
  // Re-stamping replaces the chunk instead of adding another.
  const twice = Buffer.from(withPngDensity(new Uint8Array(once), 300));
  assert.deepEqual(chunks(twice).map((chunk) => chunk.type), ['IHDR', 'pHYs', 'IDAT', 'IEND']);
  assert.equal(chunks(twice)[1].data.readUInt32BE(0), 11811);
  assert.deepEqual(decodePngToRgb(twice), decodePngToRgb(TINY_PNG));
  const notPng = new Uint8Array([1, 2, 3]);
  assert.equal(withPngDensity(notPng, 150), notPng);
});
