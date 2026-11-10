/**
 * A design's text as the Atlas desk draws it on the GPU: laid out once by
 * the browser (SVG text and the math in foreignObject alike), then read
 * back as glyphs placed in the drawing's units, drawn from the glyph atlas
 * (atlas-glyphs.js). Rules the layout draws itself (fraction bars, radical
 * bars, table lines) come back as segments of ink.
 *
 * Glyphs are GLYPH_FLOATS floats each:
 *   [ox, oy, xx, xy,  yx, yy, grow, 0,  u0, v0, u1, v1,  r, g, b, a]
 * the cell's corner, its two sides, how far the glyph is grown (a text
 * stroke, half its width), its place in the atlas, and its premultiplied color.
 */

import { BUTT, INK_FLOATS, SEGMENT, parseColor } from './atlas-ink.js';

export const GLYPH_FLOATS = 16;

/** Accents a math layout stretches across. */
const WIDE = new Set([...'¯‾_^ˆ~˜→←↔⏞⏟︷︸']);
/** Large operators, drawn bigger in display style. */
const LARGE = new Set([...'∑∏∐∫∬∭∮⋃⋂⨁⨂']);

/** A letter as math italic draws it (`text-transform: math-auto` on a
 *  single-letter <mi>): the Mathematical Alphanumeric Symbols' italic. */
export function mathItalic(char) {
  const code = char.codePointAt(0);
  if (code === 0x68) return '\u210E';
  if (code >= 0x41 && code <= 0x5a) return String.fromCodePoint(0x1d434 + code - 0x41);
  if (code >= 0x61 && code <= 0x7a) return String.fromCodePoint(0x1d44e + code - 0x61);
  if (code >= 0x391 && code <= 0x3a9 && code !== 0x3a2) return String.fromCodePoint(0x1d6e2 + code - 0x391);
  if (code >= 0x3b1 && code <= 0x3c9) return String.fromCodePoint(0x1d6fc + code - 0x3b1);
  const other = { 0x131: 0x1d6a4, 0x237: 0x1d6a5, 0x2207: 0x1d6fb, 0x2202: 0x1d715, 0x3f5: 0x1d716, 0x3d1: 0x1d717, 0x3f0: 0x1d718, 0x3d5: 0x1d719, 0x3f1: 0x1d71a, 0x3d6: 0x1d71b }[code];
  return other ? String.fromCodePoint(other) : char;
}

let host = null;

function hostEl() {
  if (host?.isConnected) return host;
  host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;';
  document.body.appendChild(host);
  return host;
}

const fontOf = (style) => ({ style: style.fontStyle || 'normal', weight: style.fontWeight || '400', family: style.fontFamily || 'sans-serif' });

/**
 * Lay out `svg` (a design's text drawing, in the theme now) and read its
 * glyphs from `atlas`. `box` is its view box. Returns
 * `{ glyphs: Float32Array, glyphCount, rules: number[] (ink shapes) }`, or
 * null when the atlas filled up meanwhile (lay it out again).
 */
export function layoutText(svg, box, atlas) {
  const root = hostEl();
  root.innerHTML = svg;
  const drawing = root.querySelector('svg');
  if (!drawing) {
    root.replaceChildren();
    return { glyphs: new Float32Array(0), glyphCount: 0, rules: [] };
  }
  // One unit of the drawing to a pixel, so what is read back is in its units.
  drawing.setAttribute('width', String(box.w));
  drawing.setAttribute('height', String(box.h));
  drawing.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`);
  drawing.setAttribute('preserveAspectRatio', 'none');
  // A fraction's bar is on the math axis, above its baseline: each fraction
  // gets a probe of no size on its baseline (in a row with it, which lays
  // out as it alone does).
  const MATHML = 'http://www.w3.org/1998/Math/MathML';
  const baselines = new Map();
  for (const fraction of drawing.querySelectorAll('mfrac')) {
    const row = document.createElementNS(MATHML, 'mrow');
    const probe = document.createElementNS(MATHML, 'mspace');
    fraction.replaceWith(row);
    row.append(probe, fraction);
    baselines.set(fraction, probe);
  }
  const origin = drawing.getBoundingClientRect();
  const toX = (x) => box.x + x - origin.left;
  const toY = (y) => box.y + y - origin.top;

  const out = [];
  const rules = [];
  let count = 0;
  let full = false;
  const opacities = new Map();
  const opacityOf = (el) => {
    if (!el || el === drawing.parentNode) return 1;
    let value = opacities.get(el);
    if (value === undefined) {
      const own = parseFloat(getComputedStyle(el).opacity);
      value = (Number.isFinite(own) ? own : 1) * opacityOf(el.parentElement);
      opacities.set(el, value);
    }
    return value;
  };
  const premultiplied = (color, alpha) => {
    const c = parseColor(color);
    if (!c) return null;
    const a = c[3] * alpha;
    return a > 0 ? [c[0] * a, c[1] * a, c[2] * a, a] : null;
  };

  /** One glyph, its pen on the baseline at (x, y), `size` the em, turned by `angle`. */
  const place = (font, char, x, y, size, angle, color, { sx = 1, sy = 1, grow = 0 } = {}) => {
    const glyph = atlas.glyph(font, char);
    if (!glyph) {
      full = true;
      return null;
    }
    if (glyph.empty || !color) return glyph;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const w = glyph.w * size * sx;
    const h = glyph.h * size * sy;
    const gx = glyph.x * size * sx;
    const gy = glyph.y * size * sy;
    out.push(
      x + cos * gx - sin * gy, y + sin * gx + cos * gy, cos * w, sin * w,
      -sin * h, cos * h, grow, 0,
      glyph.u0, glyph.v0, glyph.u1, glyph.v1,
      ...color,
    );
    count += 1;
    return glyph;
  };

  const rule = (x0, y0, x1, y1, width, color) => {
    if (!color || !(width > 0)) return;
    rules.push(x0, y0, x1, y1, width / 2, BUTT, BUTT, SEGMENT, ...color);
  };

  // SVG text: each character where the layout put it, turned with it.
  for (const text of drawing.querySelectorAll('text')) {
    const matrix = text.getScreenCTM();
    if (!matrix) continue;
    const total = text.getNumberOfChars();
    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
    // The characters the layout addresses are the text's, unless spaces
    // collapsed: then each is found by its box instead.
    const units = nodes.reduce((sum, node) => sum + node.data.length, 0);
    const indexed = units === total;
    const scale = Math.hypot(matrix.a, matrix.b);
    const turn = Math.atan2(matrix.b, matrix.a);
    let index = 0;
    for (const node of nodes) {
      const style = getComputedStyle(node.parentElement);
      const font = fontOf(style);
      const size = parseFloat(style.fontSize) * scale;
      const fillOpacity = parseFloat(style.fillOpacity);
      const color = premultiplied(style.fill, (Number.isFinite(fillOpacity) ? fillOpacity : 1) * opacityOf(node.parentElement));
      const data = node.data;
      for (let j = 0; j < data.length && !full;) {
        const code = data.codePointAt(j);
        const char = String.fromCodePoint(code);
        const length = char.length;
        if (!/\s/.test(char)) {
          if (indexed) {
            try {
              const start = text.getStartPositionOfChar(index + j);
              const angle = turn + (text.getRotationOfChar(index + j) * Math.PI) / 180;
              const p = new DOMPoint(start.x, start.y).matrixTransform(matrix);
              place(font, char, toX(p.x), toY(p.y), size, angle, color);
            } catch { /* not drawn */ }
          } else {
            const range = document.createRange();
            range.setStart(node, j);
            range.setEnd(node, j + length);
            const r = range.getBoundingClientRect();
            const glyph = r.width ? atlas.glyph(font, char) : null;
            if (glyph && !glyph.empty) place(font, char, toX(r.left), toY(r.top) + glyph.ascent * size, size, turn, color);
          }
        }
        j += length;
      }
      index += data.length;
    }
  }

  // HTML (the math in foreignObject): each character from its box.
  for (const object of drawing.querySelectorAll('foreignObject')) {
    const walker = document.createTreeWalker(object, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node && !full; node = walker.nextNode()) {
      const parent = node.parentElement;
      const style = getComputedStyle(parent);
      const font = fontOf(style);
      const size = parseFloat(style.fontSize);
      const color = premultiplied(style.color, opacityOf(parent));
      const grow = (parseFloat(style.webkitTextStrokeWidth) || 0) / 2;
      const data = node.data;
      // A single letter in math is drawn in italic.
      const italic = style.textTransform === 'math-auto' && [...data.trim()].length === 1;
      for (let j = 0; j < data.length && !full;) {
        const typed = String.fromCodePoint(data.codePointAt(j));
        const char = italic ? mathItalic(typed) : typed;
        const length = typed.length;
        if (!/\s/.test(char)) {
          range.setStart(node, j);
          range.setEnd(node, j + length);
          const r = range.getBoundingClientRect();
          const glyph = r.width && r.height ? atlas.glyph(font, char) : null;
          if (!glyph) {
            if (r.width && r.height) full = true;
          } else if (!glyph.empty) {
            // An operator the layout stretched (a bracket, a norm, a large
            // operator) fills its box, taller than its text: drawn to its ink.
            const operator = parent.localName === 'mo' && [...data.trim()].length === 1 ? parent.getBoundingClientRect() : null;
            const ink = (glyph.inkAscent + glyph.inkDescent) * size;
            if (operator && ink > 0 && operator.height > (glyph.ascent + glyph.descent) * size * 1.15) {
              const sy = operator.height / ink;
              // A taller variant is wider too, as far as its box says.
              const sx = LARGE.has(char) ? sy : Math.max(1, Math.min(sy, operator.width / Math.max(glyph.advance * size, 1e-6)));
              place(font, char, toX(operator.left), toY(operator.top) + glyph.inkAscent * size * sy, size, 0, color, { sx, sy, grow });
            } else {
              const sx = WIDE.has(char) && r.width > glyph.advance * size * 1.2 ? r.width / (glyph.advance * size) : 1;
              place(font, char, toX(r.left), toY(r.top) + glyph.ascent * size, size, 0, color, { sx, grow });
            }
          }
        }
        j += length;
      }
    }
    // Lines the layout draws itself.
    for (const el of object.querySelectorAll('*')) {
      const style = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const alpha = opacityOf(el);
      const x0 = toX(r.left);
      const y0 = toY(r.top);
      const x1 = toX(r.right);
      const y1 = toY(r.bottom);
      const background = premultiplied(style.backgroundColor, alpha);
      if (background && r.width && r.height) {
        if (r.width >= r.height) rule(x0, (y0 + y1) / 2, x1, (y0 + y1) / 2, y1 - y0, background);
        else rule((x0 + x1) / 2, y0, (x0 + x1) / 2, y1, x1 - x0, background);
      }
      for (const [side, a, b, c, d, along] of [
        ['Top', x0, y0, x1, y0, 'h'], ['Bottom', x0, y1, x1, y1, 'h'], ['Left', x0, y0, x0, y1, 'v'], ['Right', x1, y0, x1, y1, 'v'],
      ]) {
        const width = parseFloat(style[`border${side}Width`]);
        if (!(width > 0) || style[`border${side}Style`] === 'none') continue;
        const inward = side === 'Top' || side === 'Left' ? width / 2 : -width / 2;
        const color = premultiplied(style[`border${side}Color`], alpha);
        if (along === 'h') rule(a, b + inward, c, d + inward, width, color);
        else rule(a + inward, b, c + inward, d, width, color);
      }
      const tag = el.localName;
      const size = parseFloat(style.fontSize) || 16;
      const ink = premultiplied(style.color, alpha);
      const stroke = parseFloat(style.webkitTextStrokeWidth) || 0;
      if (tag === 'mfrac' && el.children.length >= 2 && el.getAttribute('linethickness') !== '0') {
        // The bar on the math axis (Latin Modern Math's: a quarter em above
        // the baseline), as thick as its rule (0.04 em).
        const probe = baselines.get(el);
        const top = el.children[0].getBoundingClientRect();
        const bottom = el.children[1].getBoundingClientRect();
        const y = probe ? toY(probe.getBoundingClientRect().top) - 0.25 * size : toY((top.bottom + bottom.top) / 2);
        const thick = parseFloat(el.getAttribute('linethickness')) || 0.04 * size;
        rule(x0, y, x1, y, thick, ink);
      } else if ((tag === 'msqrt' || tag === 'mroot') && el.children.length) {
        // The layout paints the radical sign itself: drawn stretched to the
        // root's height, left of the radicand, the bar on from its top.
        const base = el.children[0].getBoundingClientRect();
        const thick = 0.04 * size;
        const font = fontOf(style);
        const sign = atlas.glyph(font, '√');
        if (!sign) {
          full = true;
          break;
        }
        let from = toX(base.left);
        if (!sign.empty) {
          const tall = (sign.inkAscent + sign.inkDescent) * size;
          const sy = tall > 0 ? (y1 - y0) / tall : 1;
          const width = (sign.inkLeft + sign.inkRight) * size;
          const pen = from - width + sign.inkLeft * size;
          place(font, '√', pen, y0 + sign.inkAscent * size * sy, size, 0, ink, { sy, grow: stroke / 2 });
          from = pen + sign.inkRight * size - thick;
        }
        rule(from, y0 + thick / 2, x1, y0 + thick / 2, thick, ink);
      }
    }
  }
  root.replaceChildren();
  if (full) return null;
  return { glyphs: new Float32Array(out), glyphCount: count, rules };
}

/** The ink and the rules as one list of shapes. */
export function withRules(data, rules) {
  if (!rules.length) return data;
  const joined = new Float32Array(data.length + rules.length);
  joined.set(data);
  joined.set(rules, data.length);
  return joined;
}

export { INK_FLOATS };
