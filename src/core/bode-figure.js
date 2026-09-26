/**
 * The layout of a Bode sketch as plain drawing items in a box: lines, paths,
 * and short texts (with `_{}`/`^{}` markup). One layout, two renderers -- the
 * analysis panel draws it in the theme's colors, and a plot annotation on the
 * canvas draws it in the drawing's own ink -- so the figure on the paper is
 * the one in the panel.
 *
 * Items: `{ type: 'line', x1, y1, x2, y2, role }`, `{ type: 'path', points,
 * role }`, `{ type: 'text', x, y, text, anchor, role }`, `{ type: 'dot', x, y,
 * role }`. Roles: axis, zero (the 0 dB line), tick, grid, curve, asymptote,
 * corner, label, number.
 */

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function niceRange(values, step, pad) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return [-step, step];
  const low = Math.floor((Math.min(...finite) - pad) / step) * step;
  const high = Math.ceil((Math.max(...finite) + pad) / step) * step;
  // `+ 0` turns a -0 bound into 0.
  return low === high ? [low - step + 0, high + step + 0] : [low + 0, high + 0];
}

/**
 * Lay out `sketch` (bode.js's bodeSketch) in a `width` x `height` box.
 * `corners` are `{ w, text }` to mark (ω_{p1}, ω_{z1}); `quantity` names the
 * magnitude axis (`A_{v}`). `numbers: false` gives the textbook sketch: no
 * figures on the axes, only the marked frequencies.
 */
export function bodeFigure(sketch, {
  width = 480, height = 300, phase = true, numbers = true, corners = [], quantity = 'A_{v}', unityGain = true, maxSpanDb = 160,
} = {}) {
  const items = [];
  const left = numbers ? 46 : 22;
  const right = 10;
  const top = 12;
  const bottom = numbers ? 22 : 16;
  const gap = phase ? 14 : 0;
  const plotW = Math.max(10, width - left - right);
  const available = height - top - bottom - gap;
  const magH = phase ? available * 0.62 : available;
  const phaseH = phase ? available - magH : 0;
  const mag = { x: left, y: top, w: plotW, h: magH };
  const ph = { x: left, y: top + magH + gap, w: plotW, h: phaseH };
  const { low, high } = sketch.range;
  const x = (w) => mag.x + ((Math.log10(w) - low) / (high - low)) * plotW;

  let [dbLow, dbHigh] = niceRange([...sketch.points.map((p) => p.db), ...sketch.asymptote.map((p) => p.db)], 20, 3);
  if (dbHigh - dbLow > maxSpanDb) dbLow = dbHigh - maxSpanDb;
  const yDb = (db) => mag.y + ((dbHigh - clamp(db, dbLow, dbHigh)) / (dbHigh - dbLow)) * mag.h;
  const [phLow, phHigh] = niceRange(sketch.points.map((p) => p.phase), 90, 5);
  const yPh = (deg) => ph.y + ((phHigh - clamp(deg, phLow, phHigh)) / (phHigh - phLow)) * ph.h;

  // Axes: the frequency axis runs along the bottom of each pane.
  for (const pane of phase ? [mag, ph] : [mag]) {
    items.push({ type: 'line', x1: pane.x, y1: pane.y, x2: pane.x, y2: pane.y + pane.h, role: 'axis' });
    items.push({ type: 'line', x1: pane.x, y1: pane.y + pane.h, x2: pane.x + pane.w, y2: pane.y + pane.h, role: 'axis' });
  }
  if (dbLow < 0 && dbHigh > 0) items.push({ type: 'line', x1: mag.x, y1: yDb(0), x2: mag.x + mag.w, y2: yDb(0), role: 'zero' });

  // Decades along the bottom; dB and degrees up the side.
  for (let decade = Math.ceil(low); decade <= high; decade++) {
    const at = x(10 ** decade);
    for (const pane of phase ? [mag, ph] : [mag]) {
      items.push({ type: 'line', x1: at, y1: pane.y + pane.h, x2: at, y2: pane.y + pane.h - 4, role: 'tick' });
      if (numbers) items.push({ type: 'line', x1: at, y1: pane.y, x2: at, y2: pane.y + pane.h, role: 'grid' });
    }
    if (numbers) {
      const pane = phase ? ph : mag;
      items.push({ type: 'text', x: at, y: pane.y + pane.h + 14, text: decade === 0 ? '1' : decade === 1 ? '10' : `10^{${decade}}`, anchor: 'middle', role: 'number' });
    }
  }
  if (numbers) {
    for (let db = dbLow; db <= dbHigh; db += 20) {
      items.push({ type: 'line', x1: mag.x, y1: yDb(db), x2: mag.x + 4, y2: yDb(db), role: 'tick' });
      items.push({ type: 'text', x: mag.x - 5, y: yDb(db) + 4, text: `${db}`, anchor: 'end', role: 'number' });
    }
    if (phase) {
      for (let deg = phLow; deg <= phHigh; deg += 90) {
        items.push({ type: 'line', x1: ph.x, y1: yPh(deg), x2: ph.x + 4, y2: yPh(deg), role: 'tick' });
        items.push({ type: 'text', x: ph.x - 5, y: yPh(deg) + 4, text: `${deg}°`, anchor: 'end', role: 'number' });
      }
    }
  }

  // The straight-line sketch under the exact curve.
  items.push({ type: 'path', points: sketch.asymptote.map((p) => ({ x: x(p.w), y: yDb(p.db) })), role: 'asymptote' });
  items.push({ type: 'path', points: sketch.points.map((p) => ({ x: x(p.w), y: yDb(p.db) })), role: 'curve' });
  if (phase) items.push({ type: 'path', points: sketch.points.map((p) => ({ x: x(p.w), y: yPh(p.phase) })), role: 'curve' });

  // Marked frequencies: a dotted drop line and the name at the axis.
  for (const corner of corners) {
    if (!(corner.w > 0)) continue;
    const at = x(corner.w);
    if (at < mag.x || at > mag.x + mag.w) continue;
    const bottomY = (phase ? ph : mag).y + (phase ? ph : mag).h;
    items.push({ type: 'line', x1: at, y1: mag.y, x2: at, y2: bottomY, role: 'corner' });
    // Near the right edge the name goes on the corner's left.
    const nearEdge = at > mag.x + mag.w - 36;
    items.push({ type: 'text', x: nearEdge ? at - 3 : at + 3, y: mag.y + mag.h - 5, text: corner.text, anchor: nearEdge ? 'end' : 'start', role: 'label' });
  }
  if (unityGain && sketch.unityGain && dbLow < 0 && dbHigh > 0) {
    const at = x(sketch.unityGain.w);
    items.push({ type: 'dot', x: at, y: yDb(0), role: 'corner' });
    const nearEdge = at > mag.x + mag.w - 30;
    items.push({ type: 'text', x: nearEdge ? at - 4 : at + 4, y: yDb(0) - 5, text: 'ω_{u}', anchor: nearEdge ? 'end' : 'start', role: 'label' });
  }

  // What the axes are.
  items.push({ type: 'text', x: mag.x + 4, y: mag.y + 10, text: `|${quantity}|${numbers ? ' (dB)' : ''}`, anchor: 'start', role: 'label' });
  if (phase) items.push({ type: 'text', x: ph.x + 4, y: ph.y + 10, text: `∠${quantity}`, anchor: 'start', role: 'label' });
  const axisPane = phase ? ph : mag;
  items.push({ type: 'text', x: axisPane.x + axisPane.w, y: axisPane.y + axisPane.h - 5, text: numbers ? 'ω (g/C)' : 'ω', anchor: 'end', role: 'label' });
  return { width, height, items, panes: { magnitude: mag, phase: phase ? ph : null }, ranges: { db: [dbLow, dbHigh], phase: [phLow, phHigh] } };
}

/** Number the marked frequencies in order: ω_{p1}, ω_{p2}, ω_{z1}, ... */
export function cornerNames(poles, zeros) {
  const named = (roots, letter) => roots
    .map((root) => ({ root, w: Math.hypot(root.re, root.im) }))
    .filter(({ w }) => w > 0)
    .sort((a, b) => a.w - b.w)
    .map(({ root, w }, index) => ({ root, w, kind: letter === 'p' ? 'pole' : 'zero', text: `ω_{${letter}${index + 1}}`, rightHalf: root.re > 0 }));
  return [...named(poles, 'p'), ...named(zeros, 'z')];
}
