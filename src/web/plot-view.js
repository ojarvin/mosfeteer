/**
 * The one interactive plot every analysis view uses (responses, steps,
 * swing, root locus, loop gain, Bode, the optimizer's run, the
 * time view). It draws a spec (core/plot-spec.js) as SVG at its own
 * size and lets it be looked into:
 *
 * - drag pans;
 * - right-drag zooms to a box -- a flat stroke only along x, a tall one
 *   only along y (core/plot-scale.js `zoomAxes`); a right-click steps back
 *   out, one zoom at a time;
 * - Ctrl+wheel (or a pinch) zooms about the pointer, Shift only along x,
 *   Alt only along y; with `wheel: 'always'` the plain wheel does too;
 * - double-click, or the Fit button that shows once zoomed, fits it all;
 * - hovering reads each curve at the pointer.
 *
 * A spec with `refine(xRange)` draws its curves again for the frequencies
 * in view as it is zoomed, so a close look has its own points. New data
 * keeps a zoomed view (the plot follows the data only until it is
 * zoomed); a spec with another `key` starts afresh.
 */

import { parseLabelRuns } from '../core/model.js';
import { axisTicks, fitRange, fromU, thinSeries, toU, valueAt, zoomAbout, zoomAxes } from '../core/plot-scale.js';

const NS = 'http://www.w3.org/2000/svg';
const MARGIN = { left: 46, right: 12, top: 10, bottom: 24 };
let clipCount = 0;

function svg(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) if (value !== undefined && value !== null) node.setAttribute(key, value);
  return node;
}

/** Text with _{} and ^{} markup, as tspans. */
function markupText(text, attrs) {
  const node = svg('text', attrs);
  for (const run of parseLabelRuns(String(text))) {
    const span = svg('tspan', run.sub || run.super ? { 'baseline-shift': run.sub ? '-25%' : '35%', 'font-size': '72%' } : {});
    span.textContent = run.text;
    node.append(span);
  }
  return node;
}

/** A number as the readout shows it. */
function readoutNumber(value) {
  if (!Number.isFinite(value)) return '–';
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 1e-3 || magnitude >= 1e6)) return value.toExponential(3).replace(/\.?0+e/, 'e');
  return String(Number(value.toPrecision(5)));
}

const plain = (tex) => String(tex || '').replace(/\\text\{([^{}]*)\}/g, '$1').replace(/\\/g, '').replace(/[{}$]/g, '');

/**
 * A plot. `height` is its height in pixels (`fill: true` takes its box's
 * height instead); `wheel` is 'modifier' (Ctrl/pinch zooms, the plain
 * wheel scrolls the page) or 'always'. `onView(view)` hears each change of
 * view (u coordinates), to link plots. Returns `{ el, set(spec), fit(),
 * setXView(range), dispose() }`.
 */
export function createPlotView({ height = 230, fill = false, aspect = null, maxHeight = 520, wheel = 'modifier', onView = null, className = '' } = {}) {
  const el = document.createElement('div');
  el.className = `plot-view${className ? ` ${className}` : ''}`;
  if (!fill) el.style.height = `${height}px`;
  // Its size now: its box's height when it fills one; with `aspect`, a
  // height that follows its width (a wider window, a taller plot).
  const measure = () => {
    const w = el.clientWidth || 400;
    if (fill) return { w, h: el.clientHeight || height };
    if (aspect) {
      const h = Math.round(Math.min(maxHeight, Math.max(height, w * aspect)));
      if (el.style.height !== `${h}px`) el.style.height = `${h}px`;
      return { w, h };
    }
    return { w, h: height };
  };
  const root = svg('svg', { class: 'plot-view-svg', role: 'img' });
  const fitButton = document.createElement('button');
  fitButton.type = 'button';
  fitButton.className = 'plot-view-fit';
  fitButton.textContent = 'Fit';
  fitButton.title = 'Show it all again (double-click the plot)';
  fitButton.hidden = true;
  const readout = document.createElement('div');
  readout.className = 'plot-view-readout';
  readout.hidden = true;
  el.append(root, fitButton, readout);
  el.title = 'Drag to pan; right-drag zooms to a box (a flat stroke only along x, a tall one only along y); right-click steps back; double-click fits; Ctrl+wheel zooms';
  const clipId = `plot-clip-${++clipCount}`;

  let spec = null;
  let base = null; // the series as set, before any refinement
  let view = null; // { x: [u0, u1], y: [u0, u1] }
  let following = true; // the view follows the data until zoomed
  let history = [];
  let hover = null; // { px, py }
  let box = null; // a right-drag: { from, to, axes }
  let frame = 0;
  let refineTimer = 0;
  let size = { w: 0, h: 0 };
  let viewListener = onView;

  const scaleX = () => spec?.x.scale || 'linear';
  const pane = () => ({ x: MARGIN.left, y: MARGIN.top, w: Math.max(10, size.w - MARGIN.left - MARGIN.right), h: Math.max(10, size.h - MARGIN.top - MARGIN.bottom) });
  const uPoints = (series) => series.points.map(([x, y]) => [toU(scaleX(), x), y]).filter(([u]) => Number.isFinite(u));

  /** The view that shows all the data. */
  function autoView() {
    const p = pane();
    const xs = spec.x.range ? spec.x.range.map((v) => toU(scaleX(), v))
      : fitRange(spec.series.filter((s) => s.role !== 'band').flatMap((s) => uPoints(s).map(([u]) => u)), { pad: spec.equal ? 0.08 : 0, include: (spec.x.include || []).map((v) => toU(scaleX(), v)) });
    const inX = ([u]) => u >= Math.min(...xs) - 1e-9 && u <= Math.max(...xs) + 1e-9;
    let ys = spec.series.filter((s) => s.role !== 'background' && s.role !== 'band')
      .flatMap((s) => uPoints(s).filter(inX).map(([, y]) => y))
      .filter((y) => Number.isFinite(y) && (spec.y.floor === undefined || spec.y.floor === null || y > spec.y.floor));
    if (spec.y.symmetric) ys = ys.flatMap((y) => [y, -y]);
    let yr = fitRange(ys, { step: spec.y.step, pad: 0.08, include: spec.y.include || [] });
    if (Number.isFinite(spec.y.ceiling)) yr = [Math.min(yr[0], spec.y.ceiling - (spec.y.step || 1)), Math.min(yr[1], spec.y.ceiling)];
    let next = { x: [Math.min(...xs), Math.max(...xs)], y: yr };
    if (spec.equal) next = equalized(next, p);
    return next;
  }

  /** Equal units per pixel on both axes, growing the tighter one. */
  function equalized(v, p) {
    const per = Math.max((v.x[1] - v.x[0]) / p.w, (v.y[1] - v.y[0]) / p.h);
    const cx = (v.x[0] + v.x[1]) / 2;
    const cy = (v.y[0] + v.y[1]) / 2;
    return { x: [cx - (per * p.w) / 2, cx + (per * p.w) / 2], y: [cy - (per * p.h) / 2, cy + (per * p.h) / 2] };
  }

  const X = (u) => { const p = pane(); return p.x + ((u - view.x[0]) / (view.x[1] - view.x[0])) * p.w; };
  const Y = (u) => { const p = pane(); return p.y + ((view.y[1] - u) / (view.y[1] - view.y[0])) * p.h; };
  const atX = (px) => { const p = pane(); return view.x[0] + ((px - p.x) / p.w) * (view.x[1] - view.x[0]); };
  const atY = (py) => { const p = pane(); return view.y[1] - ((py - p.y) / p.h) * (view.y[1] - view.y[0]); };
  // Far off-screen values are pinned near the pane, so a curve that runs
  // off it still leaves at the right slope without enormous coordinates.
  const clampPx = (v, lo, hi) => Math.max(lo - 4 * (hi - lo), Math.min(hi + 4 * (hi - lo), v));

  function seriesPath(series, p) {
    let points = uPoints(series);
    if (!series.parametric && !series.dots) points = thinSeries(points, view.x[0], view.x[1], Math.round(p.w));
    let d = '';
    let pen = false;
    let last = null;
    for (const [u, y] of points) {
      if (y === null || !Number.isFinite(y)) { pen = false; last = null; continue; }
      const px = clampPx(X(u), p.x, p.x + p.w).toFixed(1);
      const py = clampPx(Y(y), p.y, p.y + p.h).toFixed(1);
      if (series.stairs && pen && last) d += ` L ${px} ${last}`;
      d += `${pen ? ' L' : ' M'} ${px} ${py}`;
      pen = true;
      last = py;
    }
    return d.trim();
  }

  function render() {
    frame = 0;
    root.replaceChildren();
    if (!spec || !view) return;
    size = measure();
    root.setAttribute('viewBox', `0 0 ${size.w} ${size.h}`);
    root.setAttribute('width', size.w);
    root.setAttribute('height', size.h);
    root.setAttribute('aria-label', spec.title || 'Plot');
    const p = pane();
    const clip = svg('clipPath', { id: clipId });
    clip.append(svg('rect', { x: p.x, y: p.y, width: p.w, height: p.h }));
    const defs = svg('defs');
    defs.append(clip);
    root.append(defs);

    const grid = svg('g', { class: 'plot-grid' });
    const xTicks = axisTicks(scaleX(), view.x[0], view.x[1], { target: Math.max(2, Math.round(p.w / 80)) });
    const yTicks = axisTicks('linear', view.y[0], view.y[1], { target: Math.max(2, Math.round(p.h / 38)), step: spec.y.step });
    for (const tick of xTicks) {
      const at = X(tick.u);
      grid.append(svg('line', { x1: at, y1: p.y, x2: at, y2: p.y + p.h, class: tick.major ? 'role-grid' : 'role-grid minor' }));
      if (tick.major || xTicks.length <= 12) grid.append(markupText(tick.text, { x: at, y: p.y + p.h + 15, 'text-anchor': 'middle', class: 'role-number' }));
    }
    for (const tick of yTicks) {
      const at = Y(tick.u);
      grid.append(svg('line', { x1: p.x, y1: at, x2: p.x + p.w, y2: at, class: 'role-grid' }));
      grid.append(markupText(tick.text, { x: p.x - 5, y: at + 3.5, 'text-anchor': 'end', class: 'role-number' }));
    }
    root.append(grid);

    const body = svg('g', { 'clip-path': `url(#${clipId})` });
    for (const line of spec.hlines || []) {
      if (line.y < view.y[0] || line.y > view.y[1]) continue;
      body.append(svg('line', { x1: p.x, y1: Y(line.y), x2: p.x + p.w, y2: Y(line.y), class: `role-${line.role || 'zero'}` }));
    }
    const marks = [];
    for (const line of spec.vlines || []) {
      const u = toU(scaleX(), line.x);
      if (!Number.isFinite(u) || u < view.x[0] || u > view.x[1]) continue;
      body.append(svg('line', { x1: X(u), y1: p.y, x2: X(u), y2: p.y + p.h, class: `role-${line.role || 'marker'}` }));
      if (line.label) marks.push({ at: X(u), text: line.label, role: line.role || 'marker' });
    }
    for (const series of spec.series) {
      if (series.dots) {
        uPoints(series).forEach(([u, y], i) => {
          if (u < view.x[0] || u > view.x[1] || y < view.y[0] || y > view.y[1]) return;
          const dot = svg('circle', { cx: X(u), cy: Y(y), r: 2, class: 'role-dot' });
          dot.style.fill = series.color || '';
          dot.style.fillOpacity = String(0.2 + 0.8 * (series.dots[i] ?? 1));
          body.append(dot);
        });
        continue;
      }
      const d = seriesPath(series, p);
      if (!d) continue;
      const path = svg('path', { d, class: `role-${series.role || 'curve'}` });
      if (series.color) path.style.stroke = series.color;
      body.append(path);
    }
    for (const cross of spec.crosses || []) {
      const cx = X(cross.x);
      const cy = Y(cross.y);
      body.append(svg('path', { d: `M ${cx - 4} ${cy - 4} L ${cx + 4} ${cy + 4} M ${cx - 4} ${cy + 4} L ${cx + 4} ${cy - 4}`, class: 'role-marker cross' }));
    }
    root.append(body);
    root.append(svg('rect', { x: p.x, y: p.y, width: p.w, height: p.h, class: 'plot-frame' }));
    // Marked lines' names at the top, inside, clear of the edge.
    for (const mark of marks) {
      const right = mark.at > p.x + p.w / 2;
      root.append(markupText(mark.text, { x: mark.at + (right ? -4 : 4), y: p.y + 24, 'text-anchor': right ? 'end' : 'start', class: `role-${mark.role} role-mark-label` }));
    }
    root.append(markupText(spec.y.label, { x: p.x + 5, y: p.y + 11, class: 'role-label' }));
    (spec.notes || []).forEach((note, i) => root.append(markupText(note.text, { x: p.x + 5, y: p.y + 24 + 13 * i, class: `role-${note.role || 'label'}` })));
    root.append(markupText(spec.x.label, { x: p.x + p.w - 4, y: p.y + p.h - 5, 'text-anchor': 'end', class: 'role-label' }));

    if (box) {
      const x0 = box.axes === 'y' ? p.x : Math.min(box.from.x, box.to.x);
      const x1 = box.axes === 'y' ? p.x + p.w : Math.max(box.from.x, box.to.x);
      const y0 = box.axes === 'x' ? p.y : Math.min(box.from.y, box.to.y);
      const y1 = box.axes === 'x' ? p.y + p.h : Math.max(box.from.y, box.to.y);
      if (box.axes) root.append(svg('rect', { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0), class: 'plot-zoom-box' }));
    } else if (hover && hover.px >= p.x && hover.px <= p.x + p.w && hover.py >= p.y && hover.py <= p.y + p.h) {
      root.append(svg('line', { x1: hover.px, y1: p.y, x2: hover.px, y2: p.y + p.h, class: 'plot-cursor' }));
      showReadout();
    }
    if (!hover || box) readout.hidden = true;
    fitButton.hidden = following;
  }

  function showReadout() {
    const u = atX(hover.px);
    const rows = [`${plain(spec.x.label) || 'x'} = ${readoutNumber(fromU(scaleX(), u))}`];
    const colors = [null];
    if (spec.equal) rows.push(`${plain(spec.y.label) || 'y'} = ${readoutNumber(atY(hover.py))}`);
    else {
      for (const series of spec.series) {
        if (series.dots || series.parametric || series.role === 'band') continue;
        const y = valueAt(uPoints(series), u, { stairs: !!series.stairs });
        if (y === null || !Number.isFinite(y)) continue;
        rows.push(`${plain(series.label) || plain(spec.y.label)}: ${readoutNumber(y)}`);
        colors.push(series.color || null);
        if (rows.length > 7) break;
      }
      if (rows.length === 1) { rows.push(`${plain(spec.y.label) || 'y'} = ${readoutNumber(atY(hover.py))}`); colors.push(null); }
    }
    readout.replaceChildren(...rows.map((text, i) => {
      const line = document.createElement('div');
      line.textContent = text;
      if (colors[i]) line.style.color = colors[i];
      return line;
    }));
    readout.hidden = false;
    const p = pane();
    readout.classList.toggle('left', hover.px > p.x + p.w / 2);
  }

  const schedule = () => { if (!frame) frame = requestAnimationFrame(render); };

  function refine() {
    clearTimeout(refineTimer);
    if (!spec?.refine) return;
    const series = following ? null : spec.refine(view.x.map((u) => fromU(scaleX(), u)));
    spec = { ...spec, series: series || base };
    schedule();
  }

  function setView(next, { record = true, quiet = false } = {}) {
    if (record && view) {
      history.push(view);
      if (history.length > 50) history.shift();
    }
    view = next;
    following = false;
    schedule();
    clearTimeout(refineTimer);
    refineTimer = setTimeout(refine, 120);
    if (!quiet) viewListener?.(view);
  }

  function fit({ quiet = false } = {}) {
    if (!spec) return;
    following = true;
    history = [];
    spec = { ...spec, series: base };
    size = measure();
    view = autoView();
    schedule();
    if (!quiet) viewListener?.(null);
  }

  // ----- pointer -----
  const local = (ev) => {
    const rect = root.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  };
  el.addEventListener('contextmenu', (ev) => ev.preventDefault());
  el.addEventListener('pointerdown', (ev) => {
    if (!spec || !view || ev.target === fitButton) return;
    if (ev.button !== 0 && ev.button !== 2) return;
    ev.preventDefault();
    el.setPointerCapture(ev.pointerId);
    const start = local(ev);
    const startView = view;
    let moved = false;
    if (ev.button === 2) box = { from: start, to: start, axes: null };
    else el.classList.add('panning');
    const move = (e) => {
      const at = local(e);
      if (Math.hypot(at.x - start.x, at.y - start.y) > 3) moved = true;
      if (box) {
        box.to = at;
        box.axes = spec.equal ? (zoomAxes(at.x - start.x, at.y - start.y) && 'both') : zoomAxes(at.x - start.x, at.y - start.y);
        schedule();
        return;
      }
      const p = pane();
      const dx = ((at.x - start.x) / p.w) * (startView.x[1] - startView.x[0]);
      const dy = ((at.y - start.y) / p.h) * (startView.y[1] - startView.y[0]);
      view = { x: [startView.x[0] - dx, startView.x[1] - dx], y: [startView.y[0] + dy, startView.y[1] + dy] };
      following = false;
      schedule();
      viewListener?.(view);
    };
    const end = (e) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      el.classList.remove('panning');
      if (box) {
        const { from, to, axes } = box;
        box = null;
        if (e.type === 'pointerup' && !moved) {
          // A right-click: back out of the last zoom.
          if (history.length) { view = history.pop(); following = false; schedule(); refine(); viewListener?.(view); } else fit();
          return;
        }
        if (!axes) { schedule(); return; }
        const xs = [atX(from.x), atX(to.x)].sort((a, b) => a - b);
        const ys = [atY(from.y), atY(to.y)].sort((a, b) => a - b);
        let next = { x: axes === 'y' ? view.x : xs, y: axes === 'x' ? view.y : ys };
        if (spec.equal) next = equalized(next, pane());
        setView(next);
        return;
      }
      if (moved) {
        history.push(startView);
        setView(view, { record: false });
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  });
  el.addEventListener('pointermove', (ev) => {
    if (box || el.classList.contains('panning')) return;
    const at = local(ev);
    hover = { px: at.x, py: at.y };
    schedule();
  });
  el.addEventListener('pointerleave', () => { hover = null; schedule(); });
  el.addEventListener('dblclick', (ev) => { if (ev.target !== fitButton) fit(); });
  fitButton.addEventListener('click', () => fit());
  el.addEventListener('wheel', (ev) => {
    if (!spec || !view || (wheel !== 'always' && !ev.ctrlKey && !ev.metaKey)) return;
    ev.preventDefault();
    const at = local(ev);
    const delta = ev.deltaY || ev.deltaX;
    const factor = Math.exp(Math.max(-1, Math.min(1, delta * (ev.deltaMode === 1 ? 0.05 : 0.002))));
    const axes = spec.equal ? 'both' : ev.shiftKey ? 'x' : ev.altKey ? 'y' : 'both';
    setView(zoomAbout(view, { x: atX(at.x), y: atY(at.y) }, factor, axes), { record: false });
  }, { passive: false });

  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    const next = measure();
    if (next.w === size.w && next.h === size.h) return;
    if (following && spec) { size = next; view = autoView(); }
    schedule();
  }) : null;
  observer?.observe(el);

  return {
    el,
    /** Show `spec`; a zoomed view stays unless the spec's key changed. */
    set(next) {
      if (!next) { spec = null; base = null; root.replaceChildren(); return; }
      const fresh = !spec || spec.key !== next.key;
      spec = next;
      base = next.series;
      size = measure();
      if (fresh || following || !view) { following = true; history = []; view = autoView(); } else if (spec.refine) {
        const series = spec.refine(view.x.map((u) => fromU(scaleX(), u)));
        if (series) spec = { ...spec, series };
      }
      render();
    },
    fit,
    /** Follow another plot's x view (linked plots); null fits. */
    setXView(range) {
      if (!spec) return;
      if (!range) { fit({ quiet: true }); return; }
      view = { x: [...range.x], y: view.y };
      following = false;
      schedule();
      clearTimeout(refineTimer);
      refineTimer = setTimeout(refine, 120);
    },
    zoomed: () => !following,
    /** The x range in view, in the data's units; null before anything is shown. */
    xRange: () => (spec && view ? view.x.map((u) => fromU(scaleX(), u)) : null),
    /** Hear each change of view made on this plot (not one set from outside). */
    listen(fn) { viewListener = fn; },
    dispose() { observer?.disconnect(); clearTimeout(refineTimer); if (frame) cancelAnimationFrame(frame); },
  };
}

/** Plots that share their x view: zooming or panning one moves the others. */
export function linkPlots(...plots) {
  for (const plot of plots) plot.listen((view) => { for (const other of plots) if (other !== plot) other.setXView(view); });
}
