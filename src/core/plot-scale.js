/**
 * The arithmetic of an interactive plot (web/plot-view.js), kept apart from
 * the DOM so it can be tested: axes in "u" coordinates (log10 of the value
 * on a log axis, the value itself on a linear one), the ticks for a view,
 * an automatic view that fits the data, which way a dragged box zooms, and
 * thinning a long series down to what the pixels can show.
 */

/** A value on an axis of `scale` ('log' | 'linear') in u coordinates. */
export const toU = (scale, value) => (scale === 'log' ? Math.log10(value) : value);
/** Back from u coordinates. */
export const fromU = (scale, u) => (scale === 'log' ? 10 ** u : u);

/** 1, 2, or 5 times a power of ten, near `rough`. */
export function niceStep(rough) {
  if (!(rough > 0) || !Number.isFinite(rough)) return 1;
  const power = 10 ** Math.floor(Math.log10(rough));
  const unit = rough / power;
  return (unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * power;
}

/** A number as a tick shows it: short, no float dust. */
export function tickText(value, step = 0) {
  if (value === 0 || Math.abs(value) < Math.abs(step) * 1e-9) return '0';
  const magnitude = Math.abs(value);
  if (magnitude >= 1e5 || magnitude < 1e-3) {
    const exponent = Math.floor(Math.log10(magnitude) + 1e-12);
    const mantissa = Number((value / 10 ** exponent).toPrecision(3));
    return mantissa === 1 ? `10^{${exponent}}` : mantissa === -1 ? `-10^{${exponent}}` : `${mantissa}·10^{${exponent}}`;
  }
  // As many decimals as the step needs.
  const decimals = step > 0 ? Math.max(0, Math.min(10, -Math.floor(Math.log10(step) + 1e-9))) : 3;
  return String(Number(value.toFixed(decimals)));
}

/**
 * Ticks for the range [u0, u1] of an axis: `[{ u, text, major }]`. A log
 * axis over several decades ticks whole decades (every second one, or
 * fifth, when there are many); over about a decade or two it adds 2 and 5;
 * zoomed in further it ticks plain numbers. A linear axis ticks 1-2-5 steps.
 * `step` forces a linear step (20 dB, 45 degrees); `target` is roughly how
 * many to aim for.
 */
export function axisTicks(scale, u0, u1, { target = 6, step = null } = {}) {
  const low = Math.min(u0, u1);
  const high = Math.max(u0, u1);
  if (!(high > low) || !Number.isFinite(low) || !Number.isFinite(high)) return [];
  const ticks = [];
  if (scale === 'log') {
    const span = high - low;
    if (span >= 2.5) {
      const every = Math.max(1, niceStep(span / target));
      for (let d = Math.ceil(low / every) * every; d <= high + 1e-9; d += every) {
        ticks.push({ u: d, text: d === 0 ? '1' : d === 1 ? '10' : `10^{${d}}`, major: true });
      }
      return ticks;
    }
    if (span >= 0.8) {
      for (let d = Math.floor(low); d <= high; d++) {
        for (const m of [1, 2, 5]) {
          const u = d + Math.log10(m);
          if (u < low - 1e-9 || u > high + 1e-9) continue;
          const value = m * 10 ** d;
          ticks.push({ u, text: tickText(value, value / 10), major: m === 1 });
        }
      }
      return ticks;
    }
    // Zoomed in: plain numbers in steps, placed on the log axis.
    const a = 10 ** low;
    const b = 10 ** high;
    const linearStep = niceStep((b - a) / target);
    for (let v = Math.ceil(a / linearStep) * linearStep; v <= b * (1 + 1e-12); v += linearStep) {
      if (v > 0) ticks.push({ u: Math.log10(v), text: tickText(v, linearStep), major: true });
    }
    return ticks;
  }
  const s = step && (high - low) / step <= 3 * target ? step : niceStep((high - low) / target);
  for (let v = Math.ceil(low / s - 1e-9) * s; v <= high + s * 1e-9; v += s) {
    const value = Math.abs(v) < s * 1e-9 ? 0 : v;
    ticks.push({ u: value, text: tickText(value, s), major: true });
  }
  return ticks;
}

/**
 * The u range that fits `values` (already in u coordinates): rounded out to
 * `step` when given (whole 20 dB), else padded by `pad` of the span. A
 * single value, or none, gets a range around it.
 */
export function fitRange(values, { step = null, pad = 0.05, include = [] } = {}) {
  const finite = [...values, ...include].filter(Number.isFinite);
  if (!finite.length) return [-1, 1];
  let low = Math.min(...finite);
  let high = Math.max(...finite);
  if (high - low < 1e-12) {
    const around = step || Math.max(Math.abs(low) * 0.1, 1);
    return [low - around, high + around];
  }
  if (step) return [Math.floor(low / step - 1e-9) * step, Math.ceil(high / step + 1e-9) * step];
  const margin = (high - low) * pad;
  return [low - margin, high + margin];
}

/**
 * Which way a dragged box zooms: 'x' when it is a flat stroke (only the
 * horizontal axis), 'y' when it is a tall one, 'both' for a box, null when
 * it is too small to mean anything. In pixels.
 */
export function zoomAxes(dx, dy, { flat = 14, ratio = 3, least = 5 } = {}) {
  const w = Math.abs(dx);
  const h = Math.abs(dy);
  if (w < least && h < least) return null;
  if (h < flat && w >= ratio * h) return 'x';
  if (w < flat && h >= ratio * w) return 'y';
  if (w < least || h < least) return null;
  return 'both';
}

/** A view zoomed by `factor` (below 1 zooms in) about the u point `at`, on
 *  the axes named in `axes` ('x', 'y', or 'both'). */
export function zoomAbout(view, at, factor, axes = 'both') {
  const scaled = (range, centre) => [centre + (range[0] - centre) * factor, centre + (range[1] - centre) * factor];
  return {
    x: axes === 'y' ? view.x : scaled(view.x, at.x),
    y: axes === 'x' ? view.y : scaled(view.y, at.y),
  };
}

/** Index of the last point whose x (u) is at most `u`, by bisection;
 *  -1 before the first. `points` are [x, y] sorted by x. */
export function bisect(points, u) {
  let lo = 0;
  let hi = points.length - 1;
  if (!points.length || u < points[0][0]) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid][0] <= u) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** A series' y at x = u, straight between its points (held, for stairs);
 *  null outside it. */
export function valueAt(points, u, { stairs = false } = {}) {
  const i = bisect(points, u);
  if (i < 0) return null;
  const a = points[i];
  const b = points[i + 1];
  if (!b) return u === a[0] ? a[1] : null;
  if (stairs || b[0] === a[0]) return a[1];
  return a[1] + ((u - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
}

/**
 * A long series cut to what `columns` pixel columns over [u0, u1] can
 * show: per column its first, lowest, highest, and last point, in order,
 * so peaks survive; a short one comes back as it is (with a point either
 * side of the view, so lines run to the edges). `points` are [x, y] in u,
 * sorted by x.
 */
export function thinSeries(points, u0, u1, columns) {
  const start = Math.max(0, bisect(points, u0));
  let end = bisect(points, u1) + 1;
  end = Math.min(points.length - 1, end);
  const visible = end - start + 1;
  if (visible <= Math.max(4 * columns, 64)) return points.slice(start, end + 1);
  const out = [points[start]];
  const width = (u1 - u0) / columns;
  let column = null;
  let bucket = [];
  const flush = () => {
    if (!bucket.length) return;
    let lowest = bucket[0];
    let highest = bucket[0];
    for (const p of bucket) {
      if (p[1] < lowest[1]) lowest = p;
      if (p[1] > highest[1]) highest = p;
    }
    const kept = [bucket[0], lowest, highest, bucket[bucket.length - 1]].filter((p, i, all) => all.indexOf(p) === i).sort((p, q) => p[0] - q[0]);
    out.push(...kept);
    bucket = [];
  };
  for (let i = start + 1; i < end; i++) {
    const p = points[i];
    if (!Number.isFinite(p[1])) { flush(); out.push(p); continue; }
    const c = Math.floor((p[0] - u0) / width);
    if (c !== column) { flush(); column = c; }
    bucket.push(p);
  }
  flush();
  out.push(points[end]);
  return out;
}
