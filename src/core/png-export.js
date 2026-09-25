import { LABEL_FONT_SIZE } from './model.js';

// PNG exports are sized by print resolution, not by screen pixels. The label
// text is taken to land at a nominal point size (the page guide's, else
// DEFAULT_EXPORT_TEXT_PT), which fixes the image's physical size; the chosen
// DPI then sets its pixels. The PNG records that DPI, so apps that honour it
// place the image at that size and its text at that point size.

export const PNG_DPI_CHOICES = Object.freeze([150, 300, 600]);
export const DEFAULT_PNG_DPI = 300;
/** Label text size (pt) a PNG is sized for when no page guide is active. */
export const DEFAULT_EXPORT_TEXT_PT = 10;

/** A stored DPI choice, normalized to one of PNG_DPI_CHOICES. */
export function normalizePngDpi(value) {
  const dpi = Number(value);
  return PNG_DPI_CHOICES.includes(dpi) ? dpi : DEFAULT_PNG_DPI;
}

/** Pixels per world unit for label text at `textPt` points printed at `dpi`. */
export function pngRasterScale(dpi, textPt = DEFAULT_EXPORT_TEXT_PT) {
  return (dpi / 72) * (textPt / LABEL_FONT_SIZE);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A copy of PNG `bytes` whose pHYs chunk records `dpi`, replacing any
 *  existing one; bytes that are not a PNG with an IHDR are returned as is. */
export function withPngDensity(bytes, dpi) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = (at) => String.fromCharCode(...bytes.subarray(at + 4, at + 8));
  if (bytes.length < 33 || type(8) !== 'IHDR') return bytes;
  // Drop any pHYs; a new one goes right after IHDR (it must precede IDAT).
  const parts = [bytes.subarray(0, 33)];
  for (let at = 33; at + 12 <= bytes.length;) {
    const end = at + 12 + view.getUint32(at);
    if (type(at) !== 'pHYs') parts.push(bytes.subarray(at, end));
    at = end;
  }
  const perMetre = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const out = new DataView(chunk.buffer);
  out.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // 'pHYs'
  out.setUint32(8, perMetre);
  out.setUint32(12, perMetre);
  chunk[16] = 1; // unit: metre
  out.setUint32(17, crc32(chunk.subarray(4, 17)));
  parts.splice(1, 0, chunk);
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
