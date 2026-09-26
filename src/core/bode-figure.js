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
  fontSize = 11,
} = {}) {
  const items = [];
  // Every margin and offset is in text heights, so the figure reads the
  // same in the panel (11 px text) and on the drawing (label-sized text).
  const em = fontSize;
  const { low, high } = sketch.range;
  // The sketch (no numbers) keeps every word off the plot: the quantity above
  // each axis, ω after the frequency axis, and the marked frequencies under
  // it -- in a second row where two would crowd each other.
  const marks = [];
  for (const corner of corners) if (corner.w > 0) marks.push({ w: corner.w, text: corner.text });
  const unity = unityGain && sketch.unityGain ? { w: sketch.unityGain.w, text: 'ω_{u}', unity: true } : null;
  if (unity) marks.push(unity);
  const left = numbers ? 4.2 * em : 0.8 * em;
  const right = numbers ? 0.9 * em : 1.4 * em;
  const top = numbers ? 1.1 * em : 1.6 * em;
  const gap = phase ? (numbers ? 1.3 * em : 1.9 * em) : 0;
  const plotW = Math.max(10, width - left - right);
  const x = (w) => left + ((Math.log10(w) - low) / (high - low)) * plotW;
  const rows = [];
  for (const mark of [...marks].sort((a, b) => a.w - b.w)) {
    const at = x(mark.w);
    if (at < left - 1 || at > left + plotW + 1) { mark.hidden = true; continue; }
    let row = rows.findIndex((last) => at - last >= 2.8 * em);
    if (row < 0) row = rows.length < 2 ? rows.length : rows.indexOf(Math.min(...rows));
    rows[row] = at;
    mark.row = row;
    mark.at = at;
  }
  const markRows = numbers ? 0 : Math.max(1, rows.length);
  const bottom = numbers ? 2 * em : 0.5 * em + markRows * 1.15 * em;
  const available = height - top - bottom - gap;
  const magH = phase ? available * 0.62 : available;
  const phaseH = phase ? available - magH : 0;
  const mag = { x: left, y: top, w: plotW, h: magH };
  const ph = { x: left, y: top + magH + gap, w: plotW, h: phaseH };

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
      items.push({ type: 'line', x1: at, y1: pane.y + pane.h, x2: at, y2: pane.y + pane.h - 0.36 * em, role: 'tick' });
      if (numbers) items.push({ type: 'line', x1: at, y1: pane.y, x2: at, y2: pane.y + pane.h, role: 'grid' });
    }
    if (numbers) {
      const pane = phase ? ph : mag;
      items.push({ type: 'text', x: at, y: pane.y + pane.h + 1.3 * em, text: decade === 0 ? '1' : decade === 1 ? '10' : `10^{${decade}}`, anchor: 'middle', role: 'number' });
    }
  }
  if (numbers) {
    for (let db = dbLow; db <= dbHigh; db += 20) {
      items.push({ type: 'line', x1: mag.x, y1: yDb(db), x2: mag.x + 0.36 * em, y2: yDb(db), role: 'tick' });
      items.push({ type: 'text', x: mag.x - 0.45 * em, y: yDb(db) + 0.36 * em, text: `${db}`, anchor: 'end', role: 'number' });
    }
    if (phase) {
      for (let deg = phLow; deg <= phHigh; deg += 90) {
        items.push({ type: 'line', x1: ph.x, y1: yPh(deg), x2: ph.x + 0.36 * em, y2: yPh(deg), role: 'tick' });
        items.push({ type: 'text', x: ph.x - 0.45 * em, y: yPh(deg) + 0.36 * em, text: `${deg}°`, anchor: 'end', role: 'number' });
      }
    }
  }

  // The straight-line sketch under the exact curve.
  items.push({ type: 'path', points: sketch.asymptote.map((p) => ({ x: x(p.w), y: yDb(p.db) })), role: 'asymptote' });
  items.push({ type: 'path', points: sketch.points.map((p) => ({ x: x(p.w), y: yDb(p.db) })), role: 'curve' });
  if (phase) items.push({ type: 'path', points: sketch.points.map((p) => ({ x: x(p.w), y: yPh(p.phase) })), role: 'curve' });

  // Marked frequencies: a dotted drop line and the name at the axis.
  const axisPane = phase ? ph : mag;
  const axisY = axisPane.y + axisPane.h;
  const unityShown = unity && dbLow < 0 && dbHigh > 0;
  for (const mark of marks) {
    if (mark.hidden || (mark.unity && !unityShown)) continue;
    const at = x(mark.w);
    const from = mark.unity ? yDb(0) : mag.y;
    if (mark.unity) items.push({ type: 'dot', x: at, y: yDb(0), r: 0.23 * em, role: 'corner' });
    items.push({ type: 'line', x1: at, y1: from, x2: at, y2: axisY, role: 'corner' });
    if (numbers) {
      // The panel's decades are under the axis: names go inside, beside the line.
      const nearEdge = at > mag.x + mag.w - 3.3 * em;
      const y = mark.unity ? yDb(0) - 0.45 * em : mag.y + mag.h - 0.45 * em;
      items.push({ type: 'text', x: nearEdge ? at - 0.35 * em : at + 0.35 * em, y, text: mark.text, anchor: nearEdge ? 'end' : 'start', role: 'label' });
    } else {
      items.push({ type: 'line', x1: at, y1: axisY, x2: at, y2: axisY + 0.3 * em, role: 'tick' });
      items.push({ type: 'text', x: at, y: axisY + (1.15 + mark.row * 1.15) * em, text: mark.text, anchor: 'middle', role: 'label' });
    }
  }

  // What the axes are.
  if (numbers) {
    items.push({ type: 'text', x: mag.x + 0.4 * em, y: mag.y + 0.9 * em, text: `|${quantity}| (dB)`, anchor: 'start', role: 'label' });
    if (phase) items.push({ type: 'text', x: ph.x + 0.4 * em, y: ph.y + 0.9 * em, text: `∠${quantity}`, anchor: 'start', role: 'label' });
    items.push({ type: 'text', x: axisPane.x + axisPane.w, y: axisY - 0.45 * em, text: 'ω (g/C)', anchor: 'end', role: 'label' });
  } else {
    items.push({ type: 'text', x: Math.max(0, mag.x - 0.4 * em), y: mag.y - 0.45 * em, text: `|${quantity}|`, anchor: 'start', role: 'label' });
    if (phase) items.push({ type: 'text', x: Math.max(0, ph.x - 0.4 * em), y: ph.y - 0.45 * em, text: `∠${quantity}`, anchor: 'start', role: 'label' });
    items.push({ type: 'text', x: axisPane.x + axisPane.w + 0.3 * em, y: axisY + 0.35 * em, text: 'ω', anchor: 'start', role: 'label' });
  }
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
