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
 * corner, label, number. `zero` also marks the phase's multiples of 180°.
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
 * A curve cut to a value range: `samples` are `{ at, value }`, `x` and `y`
 * place them. Where it leaves the range it ends at the edge (and starts again
 * where it returns), rather than running flat along the edge as if the
 * curve stopped falling.
 */
function clippedPaths(samples, x, y, low, high, role) {
  const paths = [];
  let current = null;
  const inside = (value) => value >= low && value <= high;
  const edgePoint = (a, b) => {
    const edge = (a.value > high) !== (b.value > high) ? high : low;
    const t = (edge - a.value) / (b.value - a.value);
    return { x: x(a) + t * (x(b) - x(a)), y: y(edge) };
  };
  samples.forEach((sample, index) => {
    const previous = samples[index - 1];
    if (inside(sample.value)) {
      if (!current) {
        current = [];
        if (previous && Number.isFinite(previous.value)) current.push(edgePoint(previous, sample));
        paths.push({ type: 'path', points: current, role });
      }
      current.push({ x: x(sample), y: y(sample.value) });
    } else if (current) {
      if (Number.isFinite(sample.value)) current.push(edgePoint(previous, sample));
      current = null;
    }
  });
  return paths.filter((path) => path.points.length > 1);
}

/**
 * Lay out `sketch` (bode.js's bodeSketch) in a `width` x `height` box.
 * `corners` are `{ w, text }` to mark (ω_{p1}, ω_{z1}); `quantity` names the
 * magnitude axis (`A_{v}`). `numbers: false` gives the textbook sketch: no
 * figures on the axes, only the marked frequencies.
 */
export function bodeFigure(sketch, {
  width = 480, height = 300, phase = true, numbers = true, corners = [], quantity = 'A_{v}', unityGain = true, maxSpanDb = 180, unityText = 'ω_{u}',
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
  // A loop gain's unity crossing is its crossover, ω_c.
  const unity = unityGain && sketch.unityGain ? { w: sketch.unityGain.w, text: unityText, unity: true } : null;
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
  let [phLow, phHigh] = niceRange(sketch.points.map((p) => p.phase), 90, 5);
  // A reference level (a multiple of 180°) on the frequency axis would hide
  // under it: give it room.
  if (phLow % 180 === 0) phLow -= 90;
  const yPh = (deg) => ph.y + ((phHigh - clamp(deg, phLow, phHigh)) / (phHigh - phLow)) * ph.h;

  // Axes: the frequency axis runs along the bottom of each pane.
  for (const pane of phase ? [mag, ph] : [mag]) {
    items.push({ type: 'line', x1: pane.x, y1: pane.y, x2: pane.x, y2: pane.y + pane.h, role: 'axis' });
    items.push({ type: 'line', x1: pane.x, y1: pane.y + pane.h, x2: pane.x + pane.w, y2: pane.y + pane.h, role: 'axis' });
  }
  if (dbLow < 0 && dbHigh > 0) items.push({ type: 'line', x1: mag.x, y1: yDb(0), x2: mag.x + mag.w, y2: yDb(0), role: 'zero' });
  // The phase's reference levels (0°, ±180°, ...), dotted like 0 dB.
  if (phase) {
    for (let deg = Math.ceil(phLow / 180) * 180; deg <= phHigh; deg += 180) {
      items.push({ type: 'line', x1: ph.x, y1: yPh(deg), x2: ph.x + ph.w, y2: yPh(deg), role: 'zero' });
    }
  }

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
  const atW = (sample) => x(sample.w);
  items.push(...clippedPaths(sketch.asymptote.map((p) => ({ w: p.w, value: p.db })), atW, yDb, dbLow, dbHigh, 'asymptote'));
  items.push(...clippedPaths(sketch.points.map((p) => ({ w: p.w, value: p.db })), atW, yDb, dbLow, dbHigh, 'curve'));
  if (phase) items.push(...clippedPaths(sketch.points.map((p) => ({ w: p.w, value: p.phase })), atW, yPh, phLow, phHigh, 'curve'));

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

/**
 * Lay out a plot of several magnitude responses (a `kind: 'response'` plot,
 * signal-flow analysis): dB against log frequency, a curve per trace in the
 * trace's colour (`item.color`), numbered axes, and the frequency unit --
 * f/f_{s} for sampled systems, relative ω otherwise. Curve items carry
 * `trace`, their index. The traces' names go beside the figure, not in it.
 */
export function responseFigure(plot, { width = 480, height = 260, fontSize = 11 } = {}) {
  const items = [];
  const em = fontSize;
  const { low, high } = plot.range;
  const left = 3.6 * em;
  const right = 0.9 * em;
  const top = 0.9 * em;
  const bottom = 2 * em;
  const pane = { x: left, y: top, w: Math.max(10, width - left - right), h: Math.max(10, height - top - bottom) };
  const x = (f) => pane.x + ((Math.log10(f) - low) / (high - low)) * pane.w;
  // The axis fits every curve, in whole 20 dB steps; its ticks spread out on
  // a wide range (a high-order noise shaper reaches far down).
  // A phase plot: degrees in steps of 45 (90, 180 on a wide range).
  const phase = plot.quantity === 'phase';
  // A background trace (a simulated spectrum) does not set the axis.
  const values = plot.traces.filter((trace) => !trace.background).flatMap((trace) => trace.points.map((p) => p.db)).filter((db) => db > -1000 && Number.isFinite(db));
  let [dbLow, dbHigh] = niceRange(values, phase ? 45 : 20, 0);
  // In dBFS, room above full scale for the axis title.
  if (plot.units === 'dBFS') dbHigh = Math.max(dbHigh, 20);
  const span = dbHigh - dbLow;
  const step = phase ? (span > 720 ? 180 : span > 360 ? 90 : 45) : span > 400 ? 100 : span > 200 ? 50 : span > 100 ? 40 : 20;
  const y = (db) => pane.y + ((dbHigh - clamp(db, dbLow, dbHigh)) / (dbHigh - dbLow)) * pane.h;
  items.push({ type: 'line', x1: pane.x, y1: pane.y, x2: pane.x, y2: pane.y + pane.h, role: 'axis' });
  items.push({ type: 'line', x1: pane.x, y1: pane.y + pane.h, x2: pane.x + pane.w, y2: pane.y + pane.h, role: 'axis' });
  if (dbLow < 0 && dbHigh > 0) items.push({ type: 'line', x1: pane.x, y1: y(0), x2: pane.x + pane.w, y2: y(0), role: 'zero' });
  for (let decade = Math.ceil(low); decade <= high; decade++) {
    const at = x(10 ** decade);
    items.push({ type: 'line', x1: at, y1: pane.y, x2: at, y2: pane.y + pane.h, role: 'grid' });
    items.push({ type: 'line', x1: at, y1: pane.y + pane.h, x2: at, y2: pane.y + pane.h - 0.36 * em, role: 'tick' });
    items.push({ type: 'text', x: at, y: pane.y + pane.h + 1.3 * em, text: decade === 0 ? '1' : decade === 1 ? '10' : `10^{${decade}}`, anchor: 'middle', role: 'number' });
  }
  for (let db = Math.ceil(dbLow / step) * step; db <= dbHigh; db += step) {
    items.push({ type: 'line', x1: pane.x, y1: y(db), x2: pane.x + pane.w, y2: y(db), role: 'grid' });
    items.push({ type: 'text', x: pane.x - 0.45 * em, y: y(db) + 0.36 * em, text: `${db}`, anchor: 'end', role: 'number' });
  }
  plot.traces.forEach((trace, index) => {
    // Only what lies in the frequency range (a spectrum's lowest bins may not).
    const samples = trace.points.filter((p) => Math.log10(p.f) >= low - 1e-9 && Math.log10(p.f) <= high + 1e-9).map((p) => ({ f: p.f, value: p.db }));
    for (const path of clippedPaths(samples, (s) => x(s.f), y, dbLow, dbHigh, trace.background ? 'spectrum' : 'curve')) items.push({ ...path, color: trace.color, trace: index });
  });
  // Marked frequencies (a loop's crossover), labelled at the top.
  for (const marker of plot.markers || []) {
    if (!(marker.f > 0) || Math.log10(marker.f) <= low || Math.log10(marker.f) >= high) continue;
    items.push({ type: 'line', x1: x(marker.f), y1: pane.y, x2: x(marker.f), y2: pane.y + pane.h, role: 'marker' });
    if (marker.label) {
      const right = x(marker.f) > pane.x + pane.w / 2;
      items.push({ type: 'text', x: x(marker.f) + (right ? -0.35 : 0.35) * em, y: pane.y + 2.1 * em, text: marker.label, anchor: right ? 'end' : 'start', role: 'marker' });
    }
  }
  // The signal band's edges.
  for (const f of plot.band || []) {
    if (Math.log10(f) <= low || Math.log10(f) >= high) continue;
    items.push({ type: 'line', x1: x(f), y1: pane.y, x2: x(f), y2: pane.y + pane.h, role: 'band' });
  }
  items.push({ type: 'text', x: pane.x + 0.4 * em, y: pane.y + 0.9 * em, text: (() => {
    const name = plot.role === 'loop' ? 'T' : 'H';
    return phase ? `∠${name} (°)` : plot.units === 'dBFS' ? 'dBFS' : `|${name}| (dB)`;
  })(), anchor: 'start', role: 'label' });
  items.push({ type: 'text', x: pane.x + pane.w, y: pane.y + pane.h - 0.45 * em, text: plot.axis === 'normalized' ? 'f/f_{s}' : 'ω', anchor: 'end', role: 'label' });
  return { width, height, items, pane, ranges: { db: [dbLow, dbHigh] } };
}

/**
 * A step-response plot: each trace's output against time, linear axes, a
 * sampled trace as stairs. `plot`: `{ unit: 'n' | 't', range: { low, high },
 * traces: [{ color, stairs, points: [{ t, y }] }] }`.
 */
export function stepFigure(plot, { width = 480, height = 260, fontSize = 11 } = {}) {
  const items = [];
  const em = fontSize;
  const left = 3.6 * em;
  const right = 0.9 * em;
  const top = 0.9 * em;
  const bottom = 2 * em;
  const pane = { x: left, y: top, w: Math.max(10, width - left - right), h: Math.max(10, height - top - bottom) };
  const { low, high } = plot.range;
  const x = (t) => pane.x + ((t - low) / (high - low || 1)) * pane.w;
  const values = plot.traces.flatMap((trace) => trace.points.map((p) => p.y)).filter(Number.isFinite);
  const yTop = Math.max(0, ...values);
  const yBottom = Math.min(0, ...values);
  const span = yTop - yBottom || 1;
  const ystep = niceStep(span / 4);
  // A little room above and below, clear of the axis title.
  const yLow = Math.floor((yBottom - (yBottom < 0 ? 0.08 * span : 0)) / ystep) * ystep;
  const yHigh = Math.ceil((yTop + 0.08 * span) / ystep) * ystep || ystep;
  const y = (v) => pane.y + ((yHigh - Math.max(yLow, Math.min(yHigh, v))) / (yHigh - yLow)) * pane.h;
  items.push({ type: 'line', x1: pane.x, y1: pane.y, x2: pane.x, y2: pane.y + pane.h, role: 'axis' });
  items.push({ type: 'line', x1: pane.x, y1: pane.y + pane.h, x2: pane.x + pane.w, y2: pane.y + pane.h, role: 'axis' });
  if (yLow < 0 && yHigh > 0) items.push({ type: 'line', x1: pane.x, y1: y(0), x2: pane.x + pane.w, y2: y(0), role: 'zero' });
  const xstep = niceStep((high - low) / 5);
  for (let t = Math.ceil(low / xstep) * xstep; t <= high + 1e-9; t += xstep) {
    items.push({ type: 'line', x1: x(t), y1: pane.y, x2: x(t), y2: pane.y + pane.h, role: 'grid' });
    items.push({ type: 'text', x: x(t), y: pane.y + pane.h + 1.3 * em, text: `${Number(t.toPrecision(3))}`, anchor: 'middle', role: 'number' });
  }
  for (let v = yLow; v <= yHigh + 1e-9; v += ystep) {
    items.push({ type: 'line', x1: pane.x, y1: y(v), x2: pane.x + pane.w, y2: y(v), role: 'grid' });
    items.push({ type: 'text', x: pane.x - 0.45 * em, y: y(v) + 0.36 * em, text: `${Number(v.toPrecision(3))}`, anchor: 'end', role: 'number' });
  }
  plot.traces.forEach((trace, index) => {
    const points = [];
    trace.points.forEach((p, i) => {
      if (!Number.isFinite(p.y)) return;
      // A sampled response holds each value until the next sample.
      if (trace.stairs && i > 0) points.push({ x: x(p.t), y: y(trace.points[i - 1].y) });
      points.push({ x: x(p.t), y: y(p.y) });
    });
    if (points.length > 1) items.push({ type: 'path', points, role: 'curve', color: trace.color, trace: index });
  });
  items.push({ type: 'text', x: pane.x + 0.4 * em, y: pane.y + 0.9 * em, text: plot.kind === 'wave' ? 'value' : 'step response', anchor: 'start', role: 'label' });
  items.push({ type: 'text', x: pane.x + pane.w, y: pane.y + pane.h - 0.45 * em, text: plot.unit === 'n' ? 'n (t/T_{s})' : 't', anchor: 'end', role: 'label' });
  return { width, height, items, pane, ranges: { y: [yLow, yHigh] } };
}

/** 1, 2, or 5 times a power of ten, near `rough`. */
function niceStep(rough) {
  if (!(rough > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(rough));
  const unit = rough / power;
  return (unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * power;
}

/**
 * A swing plot (signal-flow simulation): each net's peak against the input
 * amplitude, both in dB of full scale, a 0 dB line at full scale. `plot`:
 * `{ range: { low, high } (input dBFS), traces: [{ color, points: [{ a, db }] }] }`.
 */
export function swingFigure(plot, { width = 480, height = 260, fontSize = 11 } = {}) {
  const items = [];
  const em = fontSize;
  const { low, high } = plot.range;
  const left = 3.6 * em;
  const right = 0.9 * em;
  const top = 0.9 * em;
  const bottom = 2 * em;
  const pane = { x: left, y: top, w: Math.max(10, width - left - right), h: Math.max(10, height - top - bottom) };
  const x = (a) => pane.x + ((a - low) / (high - low)) * pane.w;
  // The peaks fit in whole 10 dB steps; a loop blowing up runs off the top.
  const values = plot.traces.flatMap((trace) => trace.points.map((p) => p.db)).filter((db) => Number.isFinite(db) && db > -200);
  let [dbLow, dbHigh] = niceRange(values.length ? values : [-40, 0], 10, 0);
  dbHigh = Math.min(Math.max(dbHigh, 10), 40);
  dbLow = Math.min(dbLow, -10);
  const step = dbHigh - dbLow > 80 ? 20 : 10;
  const y = (db) => pane.y + ((dbHigh - clamp(db, dbLow, dbHigh)) / (dbHigh - dbLow)) * pane.h;
  items.push({ type: 'line', x1: pane.x, y1: pane.y, x2: pane.x, y2: pane.y + pane.h, role: 'axis' });
  items.push({ type: 'line', x1: pane.x, y1: pane.y + pane.h, x2: pane.x + pane.w, y2: pane.y + pane.h, role: 'axis' });
  items.push({ type: 'line', x1: pane.x, y1: y(0), x2: pane.x + pane.w, y2: y(0), role: 'zero' });
  if (low < 0 && high > 0) items.push({ type: 'line', x1: x(0), y1: pane.y, x2: x(0), y2: pane.y + pane.h, role: 'zero' });
  const xStep = high - low > 60 ? 20 : 10;
  for (let a = Math.ceil(low / xStep) * xStep; a <= high; a += xStep) {
    items.push({ type: 'line', x1: x(a), y1: pane.y, x2: x(a), y2: pane.y + pane.h, role: 'grid' });
    items.push({ type: 'line', x1: x(a), y1: pane.y + pane.h, x2: x(a), y2: pane.y + pane.h - 0.36 * em, role: 'tick' });
    items.push({ type: 'text', x: x(a), y: pane.y + pane.h + 1.3 * em, text: `${a}`, anchor: 'middle', role: 'number' });
  }
  for (let db = Math.ceil(dbLow / step) * step; db <= dbHigh; db += step) {
    items.push({ type: 'line', x1: pane.x, y1: y(db), x2: pane.x + pane.w, y2: y(db), role: 'grid' });
    items.push({ type: 'text', x: pane.x - 0.45 * em, y: y(db) + 0.36 * em, text: `${db}`, anchor: 'end', role: 'number' });
  }
  // The amplitude not to operate at: a net reaching full scale, or the
  // swings running away, whichever comes first.
  const limit = swingLimit(plot.traces);
  if (limit && limit.a > low && limit.a < high) {
    items.push({ type: 'line', x1: x(limit.a), y1: pane.y, x2: x(limit.a), y2: pane.y + pane.h, role: 'marker' });
    // At the top, clear of the axis titles: left of the line in the right half, else right of it.
    const right = x(limit.a) > pane.x + pane.w / 2;
    const text = limit.kind === 'full-scale'
      ? `${limit.label ? `${plainTex(limit.label)} ` : ''}full scale ${Number(limit.a.toFixed(1))} dBFS`
      : `runaway ${Number(limit.a.toFixed(2))} dBFS`;
    items.push({ type: 'text', x: x(limit.a) + (right ? -0.35 : 0.35) * em, y: pane.y + 2.1 * em, text, anchor: right ? 'end' : 'start', role: 'marker' });
  }
  plot.traces.forEach((trace, index) => {
    const samples = trace.points.map((p) => ({ f: p.a, value: Number.isFinite(p.db) ? p.db : dbHigh + 100 }));
    for (const path of clippedPaths(samples, (s) => x(s.f), y, dbLow, dbHigh, 'curve')) items.push({ ...path, color: trace.color, trace: index });
  });
  items.push({ type: 'text', x: pane.x + 0.4 * em, y: pane.y + 0.9 * em, text: 'peak (dBFS)', anchor: 'start', role: 'label' });
  items.push({ type: 'text', x: pane.x + pane.w, y: pane.y + pane.h - 0.45 * em, text: 'input (dBFS)', anchor: 'end', role: 'label' });
  return { width, height, items, pane, ranges: { db: [dbLow, dbHigh] } };
}

/** A trace's TeX name as plot text, which knows only `_{}` and `^{}`:
 *  `\text{tone at } V_{\text{OUT}}` reads `tone at V_{OUT}`. */
export function plainTex(tex) {
  let text = String(tex).replace(/\$/g, '');
  // Innermost first, so a \text inside a subscript leaves its braces to it.
  for (let last = null; last !== text;) {
    last = text;
    text = text.replace(/\\(?:text|mathrm|mathit|operatorname)\{([^{}]*)\}/g, '$1');
  }
  return text.replace(/\\[,;! ]/g, ' ').replace(/\\cdot/g, '·').replace(/ {2,}/g, ' ').trim();
}

/**
 * The lowest input amplitude (dBFS) at which the simulated system overloaded
 * -- its run ran away, so every trace has no value there (null, or not
 * finite). Null when every run stayed bounded.
 */
export function swingOverload(traces) {
  let best = null;
  for (const trace of traces) {
    for (const point of trace.points) {
      if (Number.isFinite(point.db)) continue;
      if (best === null || point.a < best) best = point.a;
      break;
    }
  }
  return best;
}

/**
 * Where a system's swings run away, the amplitude not to operate at: the
 * first (dBFS) at which a net's peak outgrows the input by more than
 * `excess` dB over the preceding `window` dB of sweep -- above the best
 * line of slope 1 (growing as the input does) through any earlier point
 * in that window -- or at which the run overloads. A net that tracks the
 * input never trips it, a noise-limited one only with a real jump; a
 * quantized net (`stepped`, a quantizer's output moving between levels)
 * is left out. Null when neither happens.
 */
export function swingRunaway(traces, { excess = 3, window = 3 } = {}) {
  let best = swingOverload(traces);
  for (const trace of traces) {
    if (trace.stepped) continue;
    const points = trace.points.filter((p) => Number.isFinite(p.db)).sort((p, q) => p.a - q.a);
    for (let i = 1; i < points.length; i++) {
      const here = points[i];
      if (best !== null && here.a >= best) break;
      const earlier = points.slice(0, i).filter((p) => p.a >= here.a - window - 1e-9);
      if (!earlier.length) continue;
      const line = Math.max(...earlier.map((p) => p.db - p.a)) + here.a;
      if (here.db - line > excess) { best = here.a; break; }
    }
  }
  return best;
}

/**
 * The first amplitude (dBFS) at which a net's peak climbs through full
 * scale, 0 dBFS, from below -- interpolated between sweep points -- as
 * `{ a, label }`. A net already at full scale never crosses, and a quantized
 * one (`stepped`) is left out. Null when none does.
 */
export function swingFullScale(traces) {
  let best = null;
  for (const trace of traces) {
    // A tone (the output at the input frequency) tracks the input by design.
    if (trace.stepped || trace.tone) continue;
    const points = trace.points.filter((p) => Number.isFinite(p.db)).sort((p, q) => p.a - q.a);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      if (!(a.db < -0.05) || !(b.db >= 0)) continue;
      const at = a.a + ((0 - a.db) / (b.db - a.db)) * (b.a - a.a);
      if (!best || at < best.a) best = { a: at, label: trace.label || '' };
      break;
    }
  }
  return best;
}

/** Where to stop: the earlier of a net reaching full scale and the swings
 *  running away, as `{ a, kind: 'full-scale' | 'runaway', label }`. */
export function swingLimit(traces) {
  const full = swingFullScale(traces);
  const runaway = swingRunaway(traces);
  if (full && (runaway === null || full.a <= runaway)) return { a: full.a, kind: 'full-scale', label: full.label };
  return runaway === null ? null : { a: runaway, kind: 'runaway', label: '' };
}

/**
 * A root-locus plot: the complex plane, equal scales, the unit circle (z)
 * or the j omega axis (s) as the stability boundary, the swept poles as
 * dots from light (the sweep's start) to full colour (its end), the
 * current value's poles as crosses. `plot`: locus.js's `locusPlot`.
 */
export function locusFigure(plot, { width = 480, height = 260, fontSize = 11 } = {}) {
  const items = [];
  const em = fontSize;
  const left = 3.6 * em;
  const right = 0.9 * em;
  const top = 0.9 * em;
  const bottom = 2 * em;
  const pane = { x: left, y: top, w: Math.max(10, width - left - right), h: Math.max(10, height - top - bottom) };
  const z = plot.variable === 'z';
  // In z the view stays near the unit circle: a pole far outside is
  // unstable either way, and following it would shrink the circle away.
  const near = (p) => !z || Math.hypot(p.re, p.im) <= 2.5;
  const all = [...plot.points, ...plot.current].filter(near);
  let reLow = Math.min(...all.map((p) => p.re), z ? -1.1 : 0);
  let reHigh = Math.max(...all.map((p) => p.re), z ? 1.1 : 0);
  let imHigh = Math.max(...all.map((p) => Math.abs(p.im)), z ? 1.1 : 0);
  if (!Number.isFinite(reLow) || !Number.isFinite(reHigh)) { reLow = -1; reHigh = 1; }
  // Equal scales: the axis that needs more room per pixel sets both.
  const spanRe = Math.max(reHigh - reLow, 1e-9) * 1.1;
  const spanIm = Math.max(2 * imHigh, 1e-9) * 1.1;
  const scale = Math.max(spanRe / pane.w, spanIm / pane.h);
  const cx = (reLow + reHigh) / 2;
  const x = (re) => pane.x + pane.w / 2 + (re - cx) / scale;
  const y = (im) => pane.y + pane.h / 2 - im / scale;
  items.push({ type: 'line', x1: pane.x, y1: pane.y, x2: pane.x, y2: pane.y + pane.h, role: 'axis' });
  items.push({ type: 'line', x1: pane.x, y1: pane.y + pane.h, x2: pane.x + pane.w, y2: pane.y + pane.h, role: 'axis' });
  // The real and imaginary axes through the origin, when in view.
  if (y(0) > pane.y && y(0) < pane.y + pane.h) items.push({ type: 'line', x1: pane.x, y1: y(0), x2: pane.x + pane.w, y2: y(0), role: 'grid' });
  if (x(0) > pane.x && x(0) < pane.x + pane.w) items.push({ type: 'line', x1: x(0), y1: pane.y, x2: x(0), y2: pane.y + pane.h, role: z ? 'grid' : 'band' });
  if (z) {
    const circle = Array.from({ length: 97 }, (_, i) => ({ x: x(Math.cos((i * Math.PI) / 48)), y: y(Math.sin((i * Math.PI) / 48)) }));
    items.push({ type: 'path', points: circle, role: 'band' });
  }
  for (const p of plot.points) {
    if (x(p.re) < pane.x || x(p.re) > pane.x + pane.w || y(p.im) < pane.y || y(p.im) > pane.y + pane.h) continue;
    items.push({ type: 'dot', x: x(p.re), y: y(p.im), r: 0.17 * em, color: plot.color, opacity: 0.2 + 0.8 * p.t, role: 'curve' });
  }
  const arm = 0.4 * em;
  for (const p of plot.current) {
    items.push({ type: 'line', x1: x(p.re) - arm, y1: y(p.im) - arm, x2: x(p.re) + arm, y2: y(p.im) + arm, role: 'marker' });
    items.push({ type: 'line', x1: x(p.re) - arm, y1: y(p.im) + arm, x2: x(p.re) + arm, y2: y(p.im) - arm, role: 'marker' });
  }
  const number = (v) => String(Number(v.toPrecision(3)));
  items.push({ type: 'text', x: pane.x + 0.4 * em, y: pane.y + 0.9 * em, text: `${plot.parameter} ${number(plot.from)} … ${number(plot.to)}`, anchor: 'start', role: 'label' });
  // Where it is stable: between its crossings.
  const crossings = plot.crossings || [];
  if (crossings.length) {
    const stableFrom = crossings.find((c) => c.becomes === 'stable');
    const unstableAt = crossings.find((c) => c.becomes === 'unstable' && (!stableFrom || c.k !== stableFrom.k));
    const text = stableFrom && unstableAt
      ? `stable for ${plot.parameter} ${number(Math.min(stableFrom.k, unstableAt.k))} … ${number(Math.max(stableFrom.k, unstableAt.k))}`
      : stableFrom ? `stable from ${plot.parameter} = ${number(stableFrom.k)}` : `unstable from ${plot.parameter} = ${number(unstableAt.k)}`;
    items.push({ type: 'text', x: pane.x + 0.4 * em, y: pane.y + 2.1 * em, text, anchor: 'start', role: 'marker' });
  }
  items.push({ type: 'text', x: pane.x + pane.w, y: pane.y + pane.h - 0.45 * em, text: z ? 'Re z' : 'Re s', anchor: 'end', role: 'label' });
  return { width, height, items, pane };
}
