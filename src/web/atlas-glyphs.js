/**
 * The Atlas desk's glyphs as signed distance fields: each glyph (a font and
 * a character) drawn once, with the page's own fonts, into one shared
 * one-channel image the desk's shaders read text from at any size.
 *
 * A texel holds 1 - (distance / RADIUS + CUTOFF), the distance in reference
 * pixels (REF_PX to the em), positive outside the glyph: its edge is at
 * 1 - CUTOFF. When the image is full it starts again empty (`generation`
 * counts the starts), and what was drawn from it is laid out again.
 */

export const REF_PX = 56;
export const RADIUS = 10;
export const CUTOFF = 0.25;
const BUFFER = 6;
const INF = 1e20;

/** One distance transform along a line (Felzenszwalb and Huttenlocher). */
function edt1d(grid, offset, stride, length, f, v, z) {
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  f[0] = grid[offset];
  for (let q = 1, k = 0, s = 0; q < length; q++) {
    f[q] = grid[offset + q * stride];
    const q2 = q * q;
    do {
      const r = v[k];
      s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2;
    } while (s <= z[k] && --k > -1);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  for (let q = 0, k = 0; q < length; q++) {
    while (z[k + 1] < q) k++;
    const r = v[k];
    const qr = q - r;
    grid[offset + q * stride] = f[r] + qr * qr;
  }
}

function edt(grid, width, height, f, v, z) {
  for (let x = 0; x < width; x++) edt1d(grid, x, width, height, f, v, z);
  for (let y = 0; y < height; y++) edt1d(grid, y * width, 1, width, f, v, z);
}

/** The atlas: `glyph(font, char)` and the image's pixels to upload. */
export function createGlyphAtlas(size = 2048) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const pixels = new Uint8Array(size * size);
  const glyphs = new Map();
  let shelf = { x: 0, y: 0, h: 0 };
  let dirty = null;
  let generation = 1;
  let outer = new Float64Array(0);
  let inner = new Float64Array(0);
  let f = new Float64Array(0);
  let v = new Uint16Array(0);
  let z = new Float64Array(0);

  const reset = () => {
    pixels.fill(0);
    glyphs.clear();
    shelf = { x: 0, y: 0, h: 0 };
    dirty = { y0: 0, y1: size };
    generation += 1;
  };

  /** Room for a w by h cell, or null when the image is full. */
  const place = (w, h) => {
    if (shelf.x + w > size) shelf = { x: 0, y: shelf.y + shelf.h + 1, h: 0 };
    if (shelf.y + h > size) return null;
    const at = { x: shelf.x, y: shelf.y };
    shelf.x += w + 1;
    shelf.h = Math.max(shelf.h, h);
    return at;
  };

  const draw = (font, char) => {
    ctx.font = `${font.style} ${font.weight} ${REF_PX}px ${font.family}`;
    const m = ctx.measureText(char);
    const left = Math.ceil(Math.max(0, m.actualBoundingBoxLeft));
    const right = Math.ceil(Math.max(0, m.actualBoundingBoxRight));
    const ascent = Math.ceil(Math.max(0, m.actualBoundingBoxAscent));
    const descent = Math.ceil(Math.max(0, m.actualBoundingBoxDescent));
    const w = left + right + 2 * BUFFER;
    const h = ascent + descent + 2 * BUFFER;
    const metrics = {
      advance: m.width / REF_PX,
      ascent: (m.fontBoundingBoxAscent ?? REF_PX * 0.8) / REF_PX,
      descent: (m.fontBoundingBoxDescent ?? REF_PX * 0.2) / REF_PX,
      // The ink, from the pen on the baseline.
      inkLeft: left / REF_PX, inkRight: right / REF_PX, inkAscent: ascent / REF_PX, inkDescent: descent / REF_PX,
      // The cell from the pen on the baseline, in ems.
      x: -(left + BUFFER) / REF_PX, y: -(ascent + BUFFER) / REF_PX, w: w / REF_PX, h: h / REF_PX,
    };
    if (left + right === 0 || ascent + descent === 0) return { ...metrics, empty: true };
    const at = place(w, h);
    if (!at) return null;
    if (canvas.width < w || canvas.height < h) {
      canvas.width = Math.max(canvas.width, w);
      canvas.height = Math.max(canvas.height, h);
    }
    ctx.clearRect(0, 0, w, h);
    ctx.font = `${font.style} ${font.weight} ${REF_PX}px ${font.family}`;
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(char, BUFFER + left, BUFFER + ascent);
    const alpha = ctx.getImageData(0, 0, w, h).data;
    const area = w * h;
    if (outer.length < area) {
      outer = new Float64Array(area);
      inner = new Float64Array(area);
    }
    const longest = Math.max(w, h);
    if (f.length < longest) {
      f = new Float64Array(longest);
      v = new Uint16Array(longest);
      z = new Float64Array(longest + 1);
    }
    for (let i = 0; i < area; i++) {
      const a = alpha[i * 4 + 3] / 255;
      if (a === 1) {
        outer[i] = 0;
        inner[i] = INF;
      } else if (a === 0) {
        outer[i] = INF;
        inner[i] = 0;
      } else {
        // Part covered: the edge lies within the pixel.
        const d = 0.5 - a;
        outer[i] = d > 0 ? d * d : 0;
        inner[i] = d < 0 ? d * d : 0;
      }
    }
    edt(outer, w, h, f, v, z);
    edt(inner, w, h, f, v, z);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const distance = Math.sqrt(outer[i]) - Math.sqrt(inner[i]);
        pixels[(at.y + y) * size + at.x + x] = Math.max(0, Math.min(255, Math.round(255 - 255 * (distance / RADIUS + CUTOFF))));
      }
    }
    dirty = dirty ? { y0: Math.min(dirty.y0, at.y), y1: Math.max(dirty.y1, at.y + h) } : { y0: at.y, y1: at.y + h };
    return { ...metrics, u0: at.x / size, v0: at.y / size, u1: (at.x + w) / size, v1: (at.y + h) / size };
  };

  return {
    size,
    pixels,
    get generation() { return generation; },
    /** A glyph's cell and metrics (in ems), drawn now if new; null when the
     *  image filled up and started again (lay the text out again). */
    glyph(font, char) {
      const key = `${font.style}|${font.weight}|${font.family}|${char}`;
      let glyph = glyphs.get(key);
      if (glyph) return glyph;
      glyph = draw(font, char);
      if (!glyph) {
        reset();
        return null;
      }
      glyphs.set(key, glyph);
      return glyph;
    },
    /** The rows drawn since the last call: { y0, y1 }, or null. */
    takeDirty() {
      const rows = dirty;
      dirty = null;
      return rows;
    },
  };
}

let shared = null;

/** The one atlas the desk draws its text from. */
export function glyphAtlas() {
  shared ||= createGlyphAtlas();
  return shared;
}
