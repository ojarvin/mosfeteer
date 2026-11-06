/**
 * Data plot (More menu): a text file's columns plotted on the drawing
 * (core/data-plot.js). A file is chosen, then a dialog shows how it reads --
 * the separator, decimal sign, and rows before the data, all guessed
 * (core/csv-data.js) and each changeable -- with the first rows as a table
 * and the columns to plot. Under that is the plot editor that a data plot's
 * settings (its right-click menu, or a double-click) show too: the plot to
 * look into -- drag pans, right-drag zooms to a box, the wheel zooms
 * (web/plot-view.js) -- each axis's name and scale, and each trace's name
 * and color or its removal. The plot keeps the zoom shown. The file is read
 * once: the design keeps the traces, never the file. Given a data plot, the
 * dialog adds a file's traces to that plot (Add file…), the plot's own shown
 * with them, or replaces them (Replace file…).
 */

import { element as el } from './dom.js';
import { MAX_DATA_TRACES, readTable, tableTraces } from '../core/csv-data.js';
import { TRACE_COLORS } from '../core/analysis/signal-flow.js';
import { appendPlotTraces, fileUnits, inPlotUnits, movePlotTrace, placeDataPlot, removePlotTrace, replaceDataPlotTraces, setDataPlotAxis, setPlotCurveColors, setPlotCursors, setPlotTrace, setPlotTracesShown, setDataPlotView, takesFileTraces } from '../core/data-plot.js';
import { texToMathML } from '../core/render.js';
import { MAX_DATA_POINTS, MAX_PLOT_EXTRA, normalizePlot } from '../core/model.js';
import { COLOR_PALETTE } from '../core/style.js';
import { ownTraceCount, plotSpec } from '../core/plot-spec.js';
import { MAX_PLOT_CURSORS, cursorCurves, cursorNumber, cursorReadings, cursorValue } from '../core/plot-cursors.js';
import { plainTex } from '../core/bode-figure.js';
import { createPlotView } from './plot-view.js';
import { editor } from './editor-state.js';
import { logLine } from './status-bar-ui.js';
import { canvasEl } from './elements.js';
import { alignLabelColumn, commit, render, setLabelSelection, setSelection } from './main.js';

/** Past this a file is refused rather than read into the page. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const PREVIEW_ROWS = 8;
const SEPARATORS = [[',', 'Comma'], [';', 'Semicolon'], ['\t', 'Tab'], [' ', 'Spaces']];

/** Ask for a file, then open the dialog on it; `target` a data plot to
 *  read it into, `mode` 'add' to add its traces there rather than replace
 *  them. */
export function chooseDataFile(target = null, mode = 'replace') {
  const input = el('input', { type: 'file', accept: '.csv,.tsv,.txt,.dat,.prn,text/csv,text/plain', hidden: true });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      logLine(`${file.name} is ${Math.round(file.size / 1e6)} MB; a data plot reads up to ${MAX_FILE_BYTES / 1e6} MB`, 'error');
      return;
    }
    openDataPlotDialog(await file.text(), file.name, target, { mode });
  }, { once: true });
  document.body.append(input);
  input.click();
}

const SCALES = [['linear', 'Linear'], ['log', 'Log']];
/** The markers' kinds: their button text and key. */
const MARKERS = [['point', 'Point', 'm'], ['vertical', 'Vertical', 'v'], ['horizontal', 'Horizontal', 'h']];
const MARKER_NAMES = { point: 'Point', vertical: 'Vertical', horizontal: 'Horizontal' };
const capitalized = (name) => name[0].toUpperCase() + name.slice(1);

/** Swatches a row in the palette over a trace's color. */
const PALETTE_COLUMNS = 6;

/**
 * The palette's swatches (the style panel's) over `button`, the current
 * `color` right on top of it: a popover above the dialog that a click
 * outside or Escape closes. `pick(value)` hears the one chosen.
 */
function openPalette(button, color, pick) {
  const entries = Object.entries(COLOR_PALETTE);
  const palette = el('div', { class: 'swatches data-plot-swatches', popover: 'auto', role: 'radiogroup', 'aria-label': 'Color' }, entries.map(([name, value]) => el('button', {
    type: 'button', class: 'swatch', role: 'radio', 'data-value': name, 'aria-label': capitalized(name), title: capitalized(name),
    'aria-checked': String(value.toLowerCase() === String(color).toLowerCase()), style: `--swatch:${value}`,
    onclick: () => { palette.hidePopover(); pick(value); },
  })));
  palette.style.setProperty('--palette-columns', String(PALETTE_COLUMNS));
  // Escape closes the palette, not the dialog under it.
  const dialog = button.closest('dialog');
  const keepDialog = (ev) => { ev.preventDefault(); palette.hidePopover(); };
  palette.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') keepDialog(ev); });
  dialog.addEventListener('cancel', keepDialog);
  palette.addEventListener('toggle', (ev) => {
    if (ev.newState !== 'closed') return;
    dialog.removeEventListener('cancel', keepDialog);
    palette.remove();
    button.setAttribute('aria-expanded', 'false');
    button.focus({ preventScroll: true });
  });
  dialog.append(palette);
  palette.showPopover();
  button.setAttribute('aria-expanded', 'true');
  // The current swatch over the button, the whole palette kept on screen.
  const current = palette.querySelector('[aria-checked="true"]') || palette.querySelector('.swatch');
  const at = button.getBoundingClientRect();
  const own = current.getBoundingClientRect();
  const box = palette.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - box.width - 8, at.left + at.width / 2 - (own.left - box.left) - own.width / 2));
  const top = Math.max(8, Math.min(window.innerHeight - box.height - 8, at.top + at.height / 2 - (own.top - box.top) - own.height / 2));
  palette.style.left = `${left}px`;
  palette.style.top = `${top}px`;
  current.focus({ preventScroll: true });
}

/** A labeled select: `choices` [value, text]. */
function select(label, id, choices, value, onchange) {
  return el('label', { class: 'data-plot-field', for: id }, [
    el('span', { text: label }),
    el('select', { id, onchange: (ev) => onchange(ev.target.value) }, choices.map(([v, t]) => el('option', { value: v, text: t, selected: v === value }))),
  ]);
}

/**
 * The plot editor both dialogs show. `draft` is `{ x: { label, scale }, y:
 * { label, scale }, traces: [{ label, color, points, removed? }] }`, edited
 * in place. `onRemove(trace)` takes a trace off (by default it is marked
 * removed); `onAxis(axis)` hears an axis edited by hand; `onMove()` hears
 * the traces reordered (by default only the draft is). A later trace draws
 * over an earlier one. `base`, an analysis plot, makes the draft's traces
 * those added to it from files: its axes are its own then, and it may keep
 * none. Returns its `parts`,
 * `show()` to draw the draft again (after it changed from outside: also
 * `refresh()` for the fields), `plot()` the plot it shows with its zoom,
 * and `dispose()`.
 */
function plotEditor(draft, { onRemove = null, onAxis = () => {}, onMove = null, base = null } = {}) {
  draft.cursors ||= [];
  if (draft.cursorValues === undefined) draft.cursorValues = true;
  const view = createPlotView({ height: 260, wheel: 'always', className: 'data-plot-view', onCursors: (next) => { draft.cursors = next; show(); refreshCursors(); } });
  const shown = () => draft.traces.filter((t) => !t.removed);
  const traces = () => shown().map(({ label, color, points }) => ({ label, color, points }));
  // A point marker names its trace by id (plot-spec.js): the plot's own
  // traces first, then these. Moved or removed, the markers follow.
  const firstId = () => (base ? ownTraceCount(base) : 0);
  const traceKey = (t) => (t.index !== undefined ? `o${t.index}` : `c${t.column}`);
  const traceIds = () => new Map(shown().map((t, i) => [traceKey(t), firstId() + i]));
  const keepCursors = (change) => {
    const before = traceIds();
    change();
    const after = traceIds();
    const keyOf = new Map([...before].map(([key, id]) => [id, key]));
    draft.cursors = draft.cursors.flatMap((c) => {
      if (c.kind !== 'point' || c.trace < firstId()) return [c];
      const id = after.get(keyOf.get(c.trace));
      return id === undefined ? [] : [{ ...c, trace: id }];
    });
    show();
    refreshCursors();
  };
  // A response plot's own curves as the draft shows or hides them.
  const withShown = (plot) => (draft.curves ? { ...plot, traces: plot.traces.map(({ hidden: _hidden, ...trace }, i) => ({ ...trace, color: draft.curves[i]?.color || trace.color, ...(draft.curves[i]?.on === false ? { hidden: true } : {}) })) } : plot);
  const marked = () => ({ cursors: draft.cursors, ...(draft.cursorValues ? {} : { cursorValues: false }) });
  const bare = () => (base ? normalizePlot({ ...withShown(base), extra: traces(), ...marked() }) : normalizePlot({ kind: 'data', x: draft.x, y: draft.y, traces: traces(), ...marked() }));
  const show = ({ keepZoom = true } = {}) => {
    const zoom = keepZoom ? view.zoom() : null;
    const plot = bare();
    view.set(plot ? plotSpec(plot) : null);
    if (zoom && plot) view.zoomTo(zoom);
  };
  const axes = el('div', { class: 'data-plot-columns' });
  // A response plot's own curves and spectra, each shown or hidden.
  const curveList = draft.curves ? el('div', { class: 'data-plot-traces data-plot-curves', role: 'group', 'aria-label': 'Curves' }, draft.curves.map((curve) => {
    const check = el('input', { type: 'checkbox', 'aria-label': 'Show this curve', onchange: (ev) => { curve.on = ev.target.checked; show(); } });
    check.checked = curve.on;
    const name = el('span', { class: 'data-plot-curve-name' });
    name.innerHTML = texToMathML(curve.label);
    name.style.color = curve.color;
    // The box shows or hides; the swatch picks the color, as a file trace's does.
    const swatch = el('button', { type: 'button', class: 'swatch', style: `--swatch:${curve.color}`, title: 'Color', 'aria-label': 'Curve color', 'aria-haspopup': 'true', 'aria-expanded': 'false',
      onclick: () => openPalette(swatch, curve.color, (value) => { curve.color = value; name.style.color = value; swatch.style.setProperty('--swatch', value); show(); }) });
    return el('div', { class: 'data-plot-trace data-plot-curve' }, [check, swatch, name]);
  })) : null;
  const traceList = el('div', { class: 'data-plot-traces', role: 'group', 'aria-label': 'Traces' });
  const axisFields = (axis) => el('fieldset', { class: 'data-plot-axis' }, [
    el('legend', { text: axis === 'x' ? 'X axis' : 'Y axis' }),
    el('label', { class: 'data-plot-field' }, [el('span', { text: 'Name' }),
      el('input', { type: 'text', value: draft[axis].label, 'data-axis-label': axis, spellcheck: 'false', oninput: (ev) => { draft[axis].label = ev.target.value; onAxis(axis); show(); } })]),
    el('label', { class: 'data-plot-field' }, [el('span', { text: 'Scale' }),
      el('select', { 'data-axis-scale': axis, onchange: (ev) => { draft[axis].scale = ev.target.value; onAxis(axis); show({ keepZoom: false }); } },
        SCALES.map(([v, t]) => el('option', { value: v, text: t, selected: draft[axis].scale === v })))]),
  ]);
  const refresh = () => {
    axes.replaceChildren(...(base ? [] : [axisFields('x'), axisFields('y')]));
    const left = shown().length + (base ? 1 : 0);
    const visible = shown();
    // Swap with the next visible trace up or down the list.
    const move = (trace, step) => {
      const other = visible[visible.indexOf(trace) + step];
      const a = draft.traces.indexOf(trace);
      const b = draft.traces.indexOf(other);
      keepCursors(() => {
        [draft.traces[a], draft.traces[b]] = [draft.traces[b], draft.traces[a]];
        if (onMove) onMove();
        else { refresh(); show(); }
      });
    };
    if (base && !visible.length) {
      traceList.replaceChildren(el('p', { class: 'field-hint', text: 'No traces from files. Add file… adds them.' }));
      return;
    }
    traceList.replaceChildren(...visible.map((trace, i) => {
      return el('div', { class: 'data-plot-trace' }, [
        el('button', { type: 'button', class: 'data-plot-trace-move', text: '↑', title: 'Move up', 'aria-label': `Move ${trace.label} up`, disabled: i === 0, onclick: () => move(trace, -1) }),
        el('button', { type: 'button', class: 'data-plot-trace-move', text: '↓', title: 'Move down', 'aria-label': `Move ${trace.label} down`, disabled: i === visible.length - 1, onclick: () => move(trace, 1) }),
        el('button', { type: 'button', class: 'swatch', style: `--swatch:${trace.color}`, title: 'Color', 'aria-label': `${trace.label}: color`, 'aria-haspopup': 'true', 'aria-expanded': 'false',
          onclick: (ev) => openPalette(ev.currentTarget, trace.color, (value) => { trace.color = value; refresh(); show(); }) }),
        el('input', { type: 'text', value: trace.label, 'aria-label': 'Trace name', spellcheck: 'false', oninput: (ev) => { trace.label = ev.target.value; show(); } }),
        el('button', { type: 'button', class: 'data-plot-trace-remove', text: '×', title: 'Remove', 'aria-label': `Remove ${trace.label}`, disabled: left < 2,
          onclick: () => keepCursors(() => { if (onRemove) onRemove(trace); else { trace.removed = true; refresh(); show(); } }) }),
      ]);
    }));
  };
  // The markers: added by their buttons or keys, dragged on the plot, a
  // line's place typed.
  const cursorList = el('div', { class: 'data-plot-traces data-plot-markers', role: 'group', 'aria-label': 'Markers' });
  const valuesBox = el('input', { type: 'checkbox', class: 'data-plot-marker-values', onchange: (ev) => { draft.cursorValues = ev.target.checked; show(); } });
  valuesBox.checked = draft.cursorValues;
  const addButtons = MARKERS.map(([kind, text, key]) => el('button', { type: 'button', class: 'data-plot-marker-add', 'data-kind': kind, text, title: `${text} marker (${key.toUpperCase()})`, onclick: () => add(kind) }));
  const markerBar = el('div', { class: 'data-plot-marker-bar' }, [
    el('span', { class: 'data-plot-marker-heading', text: 'Markers' }), ...addButtons,
    el('label', { class: 'data-plot-check' }, [valuesBox, ' Values']),
  ]);
  const add = (kind) => {
    if (draft.cursors.length >= MAX_PLOT_CURSORS) return;
    if (!view.addCursor(kind)) logLine('no trace to put a point marker on', 'error');
  };
  const setCursor = (i, next) => { draft.cursors = draft.cursors.map((c, k) => (k === i ? next : c)); show(); };
  function refreshCursors() {
    for (const button of addButtons) button.disabled = draft.cursors.length >= MAX_PLOT_CURSORS;
    const spec = view.spec();
    const curves = spec ? cursorCurves(spec) : [];
    const readings = new Map((spec ? cursorReadings(spec) : []).map((r) => [r.index, r]));
    cursorList.replaceChildren(...draft.cursors.map((cursor, i) => {
      const axis = cursor.kind === 'horizontal' ? 'y' : 'x';
      const field = el('input', { type: 'text', class: 'data-plot-marker-value', value: cursorNumber(cursor[axis]), 'aria-label': `${MARKER_NAMES[cursor.kind]} marker ${axis}`, spellcheck: 'false',
        onchange: (ev) => { const v = cursorValue(ev.target.value); if (v === null) { ev.target.setAttribute('aria-invalid', 'true'); return; } ev.target.removeAttribute('aria-invalid'); setCursor(i, { ...draft.cursors[i], [axis]: v }); refreshCursors(); } });
      const trace = cursor.kind === 'point' ? el('select', { class: 'data-plot-marker-trace', 'aria-label': 'Point marker trace', onchange: (ev) => { setCursor(i, { ...draft.cursors[i], trace: Number(ev.target.value) }); refreshCursors(); } },
        curves.map((c) => el('option', { value: String(c.trace), text: plainTex(c.label) || `Trace ${c.trace + 1}`, selected: c.trace === cursor.trace }))) : null;
      const read = readings.get(i);
      const reads = cursor.kind === 'point' ? (read ? read.hits[0].text : 'off its trace') : read ? read.hits.map((h) => h.text).join(', ') : '';
      return el('div', { class: 'data-plot-trace data-plot-marker' }, [
        el('span', { class: 'data-plot-marker-kind', text: MARKER_NAMES[cursor.kind] }),
        ...(trace ? [trace] : []),
        el('span', { class: 'data-plot-marker-axis', text: `${axis} =` }), field,
        el('span', { class: 'data-plot-marker-reads', text: reads }),
        el('button', { type: 'button', class: 'data-plot-trace-remove', text: '×', title: 'Remove', 'aria-label': `Remove ${MARKER_NAMES[cursor.kind].toLowerCase()} marker`,
          onclick: () => { draft.cursors = draft.cursors.filter((_, k) => k !== i); show(); refreshCursors(); } }),
      ]);
    }));
  }
  /** M, V, and H add a marker, unless a field is being typed in. */
  const key = (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.target.closest?.('input[type=text], input[type=number], textarea, select')) return;
    const marker = MARKERS.find(([, , k]) => k === ev.key.toLowerCase());
    if (!marker) return;
    ev.preventDefault();
    add(marker[0]);
  };
  refresh();
  return {
    parts: [view.el, el('p', { class: 'field-hint', text: 'Drag pans, right-drag zooms to a box, the wheel zooms, double-click fits. The plot on the drawing keeps this zoom. A trace lower in the list draws on top.' }), axes, ...(curveList ? [curveList] : []), traceList, markerBar, cursorList],
    show: (options) => { show(options); refreshCursors(); },
    refresh,
    key,
    /** The markers as edited: `{ cursors, values }`. */
    cursors: () => ({ cursors: draft.cursors, values: draft.cursorValues }),
    zoomTo: (range) => view.zoomTo(range),
    zoom: () => view.zoom(),
    /** The plot as shown, zoomed as shown (a zoom a log axis cannot show left out). */
    plot(extra = {}) {
      const zoom = view.zoom();
      return normalizePlot({ ...bare(), ...extra, ...(zoom ? { view: zoom } : {}) });
    },
    dispose: () => view.dispose(),
  };
}

/** The edits the plot editor made to `box`'s own traces (`draft.traces`
 *  with an `index`) and axes, inside a commit. */
function applyDraft(circuit, box, draft) {
  // An analysis plot's axes are its own.
  if (box.plot.kind === 'data') for (const axis of ['x', 'y']) setDataPlotAxis(box, axis, { label: draft[axis].label, scale: draft[axis].scale });
  const own = draft.traces.filter((trace) => trace.index !== undefined);
  for (const trace of own) if (!trace.removed) setPlotTrace(circuit, box, trace.index, { label: trace.label, color: trace.color });
  // Last first, so the indices still hold.
  for (const trace of [...own].sort((a, b) => b.index - a.index)) if (trace.removed) removePlotTrace(circuit, box, trace.index);
}

/** Put `box`'s traces in the draft's order. `current` is the draft traces
 *  in the plot's order now: its own (by index), then those just added. */
function applyOrder(circuit, box, draft, current) {
  const now = [...current];
  draft.traces.filter((t) => !t.removed).forEach((trace, place) => {
    const at = now.indexOf(trace);
    if (at === place) return;
    movePlotTrace(circuit, box, at, place);
    now.splice(place, 0, now.splice(at, 1)[0]);
  });
}

/** The draft's own traces left, in the plot's order. */
const ownLeft = (draft) => draft.traces.filter((t) => t.index !== undefined && !t.removed).sort((a, b) => a.index - b.index);

/** The zoom shown on `box`'s axes, those it can show. */
function applyZoom(box, zoom) {
  if (box.plot.kind !== 'data') {
    const { view: _view, ...rest } = box.plot;
    box.plot = normalizePlot(zoom ? { ...rest, view: zoom } : rest);
    return;
  }
  for (const axis of ['x', 'y']) setDataPlotView(box, axis, zoom?.[axis] && !(box.plot[axis].scale === 'log' && zoom[axis][0] <= 0) ? zoom[axis] : null);
}

/** The markers the plot editor set, on `box`. */
function applyCursors(box, plotEdit) {
  const { cursors, values } = plotEdit.cursors();
  setPlotCursors(box, cursors, { values });
}

/** An analysis plot as the plot editor draws under its added traces. */
const analysisBase = ({ extra: _extra, view: _view, ...rest }) => rest;

/** The traces a plot's editor edits: a data plot's, or an analysis plot's added ones. */
const editedTraces = (plot) => (plot.kind === 'data' ? plot.traces : plot.extra || [])
  .map((trace, index) => ({ index, label: trace.label, color: trace.color, points: trace.points, removed: false }));

/** The dialog on `text` (the file `name`): Place puts its plot on the
 *  drawing, or into `target` -- its traces replaced, or with `mode` 'add'
 *  the file's added to them (the plot's own shown with them, to edit too). */
export function openDataPlotDialog(text, name, target = null, { mode = 'replace' } = {}) {
  const adding = mode === 'add' && takesFileTraces(target);
  // An analysis plot takes the file's traces in its own units.
  const analysis = adding && target.plot.kind !== 'data';
  const unitChoices = analysis ? fileUnits(target.plot) : { x: [], y: [] };
  const units = { x: unitChoices.x[0]?.key || null, y: unitChoices.y[0]?.key || null };
  // The plot's own traces, when adding to it.
  const own = adding ? editedTraces(target.plot) : [];
  const room = () => (analysis ? MAX_PLOT_EXTRA : MAX_DATA_TRACES) - own.filter((t) => !t.removed).length;
  let options = {};
  let table = readTable(text);
  let x = table.x;
  let y = table.y.slice(0, room());
  // What was edited by hand stays when the columns change.
  const edited = { x: false, y: false };
  const draft = { x: { label: '', scale: table.scale.x }, y: { label: '', scale: table.scale.y }, traces: [] };
  const form = el('div', { class: 'data-plot-form' });
  const preview = el('div', { class: 'data-plot-table', role: 'region', 'aria-label': 'The first rows', tabindex: '0' });
  const columns = el('div', { class: 'data-plot-columns' });
  const status = el('p', { class: 'field-hint', 'aria-live': 'polite' });
  const place = el('button', { type: 'button', class: 'primary-action', text: adding ? 'Add to plot' : target ? 'Read into plot' : 'Place' });
  const plotEdit = plotEditor(draft, {
    base: analysis ? analysisBase(target.plot) : null,
    onAxis: (axis) => { edited[axis] = true; },
    onRemove: (trace) => {
      if (trace.index !== undefined) trace.removed = true;
      else y = y.filter((c) => c !== trace.column);
      update();
    },
    onMove: () => update(),
  });

  /** The traces of the columns picked, each keeping a name or color given it. */
  function update() {
    const before = new Map(draft.traces.filter((t) => t.index === undefined).map((t) => [t.column, t]));
    const added = y.map((column) => {
      let [trace] = tableTraces(table, x, [column]);
      if (trace && analysis) [trace] = inPlotUnits(target.plot, [trace], units);
      if (!trace || trace.points.length < 2) return null;
      const old = before.get(column);
      return { column, points: trace.points, label: old ? old.label : trace.label, color: old ? old.color : null };
    }).filter(Boolean);
    // Clear of the colors the plot uses: an analysis plot's own curves' too.
    const theirs = analysis ? [...(target.plot.traces || []).map((t) => t.color), target.plot.color] : [];
    const taken = new Set([...theirs, ...[...own, ...added].filter((t) => !t.removed).map((t) => t.color)].filter(Boolean));
    for (const trace of added) {
      if (trace.color) continue;
      trace.color = TRACE_COLORS.find((c) => !taken.has(c)) || TRACE_COLORS[0];
      taken.add(trace.color);
    }
    // In the order the list was left in; a new column's trace goes last.
    const key = (t) => (t.index !== undefined ? `o${t.index}` : `c${t.column}`);
    const rank = new Map(draft.traces.map((t, i) => [key(t), i]));
    draft.traces = [...own, ...added].map((t, i) => [t, rank.has(key(t)) ? rank.get(key(t)) : Infinity, i])
      .sort((a, b) => a[1] - b[1] || a[2] - b[2]).map(([t]) => t);
    if (!edited.x) draft.x.label = x === null ? 'Row' : table.names[x];
    if (!edited.y) draft.y.label = added.length === 1 ? added[0].label : '';
    drawColumns();
    plotEdit.refresh();
    plotEdit.show();
    const plot = plotEdit.plot();
    place.disabled = !plot;
    if (!plot) {
      status.textContent = table.numeric.length ? 'Choose a column with two rows of numbers or more.' : 'No column of numbers: check the separator and the rows before the data.';
      return;
    }
    // The file's own traces: a plot added to has its others already.
    const fresh = added.map((trace) => Math.min(trace.points.length, MAX_DATA_POINTS));
    const points = fresh.reduce((sum, n) => sum + n, 0);
    status.textContent = `${fresh.length} trace${fresh.length === 1 ? '' : 's'} from ${name}, ${points} points kept from ${table.rows.length - table.skip} rows.`;
  }

  const reread = (change) => {
    options = { ...options, ...change };
    const before = table;
    table = readTable(text, options);
    // A new reading of the columns starts their choice over.
    if (before.names.length !== table.names.length || before.skip !== table.skip) {
      x = table.x;
      y = table.y.slice(0, room());
      draft.traces = own;
      if (!edited.x) draft.x.scale = table.scale.x;
      if (!edited.y) draft.y.scale = table.scale.y;
    }
    drawReading();
    update();
  };

  function drawReading() {
    form.replaceChildren(
      select('Separator', 'data-plot-separator', SEPARATORS, table.separator, (v) => reread({ separator: v })),
      select('Decimal sign', 'data-plot-decimal', [['.', 'Point'], [',', 'Comma']], table.decimal, (v) => reread({ decimal: v })),
      el('label', { class: 'data-plot-field', for: 'data-plot-skip' }, [
        el('span', { text: 'Rows before the data' }),
        el('input', { id: 'data-plot-skip', type: 'number', min: '0', max: String(table.rows.length), value: String(table.skip), onchange: (ev) => reread({ skip: Math.max(0, Math.floor(Number(ev.target.value) || 0)) }) }),
      ]),
      el('label', { class: 'data-plot-check' }, [
        el('input', { type: 'checkbox', checked: table.header, disabled: !table.skip, onchange: (ev) => reread({ header: ev.target.checked }) }),
        ' The last of them names the columns',
      ]),
    );
    const first = Math.max(0, table.skip - 3);
    const rows = table.rows.slice(first, table.skip + PREVIEW_ROWS);
    const width = Math.max(table.names.length, ...rows.map((row) => row.length));
    preview.replaceChildren(el('table', {}, [
      el('thead', {}, [el('tr', {}, Array.from({ length: width }, (_, c) => el('th', { text: table.names[c] || `Column ${c + 1}` })))]),
      el('tbody', {}, rows.map((row, i) => el('tr', { class: first + i < table.skip ? 'data-plot-skipped' : '' },
        Array.from({ length: width }, (_, c) => el('td', { text: row[c] ?? '' }))))),
    ]));
  }

  function drawColumns() {
    const numeric = new Set(table.numeric);
    const xChoices = [['row', 'Row number'], ...table.numeric.map((c) => [String(c), table.names[c]])];
    columns.replaceChildren(
      select('X column', 'data-plot-x', xChoices, x === null ? 'row' : String(x), (v) => { x = v === 'row' ? null : Number(v); y = y.filter((c) => c !== x); update(); }),
      el('fieldset', { class: 'data-plot-y' }, [
        el('legend', { text: 'Y columns' }),
        ...table.names.map((n, c) => el('label', {}, [
          el('input', { type: 'checkbox', 'data-column': String(c), checked: y.includes(c), disabled: !numeric.has(c) || c === x || (!y.includes(c) && y.length >= room()),
            onchange: (ev) => { y = ev.target.checked ? [...y, c].sort((a, b) => a - b) : y.filter((k) => k !== c); update(); } }),
          ` ${n}`,
        ])),
      ]),
      // A response plot's units: the file's are read into them.
      ...(unitChoices.x.length ? [select('X is in', 'data-plot-xunit', unitChoices.x.map((u) => [u.key, u.text]), units.x, (v) => { units.x = v; update(); })] : []),
      ...(unitChoices.y.length ? [select('Y is in', 'data-plot-yunit', unitChoices.y.map((u) => [u.key, u.text]), units.y, (v) => { units.y = v; update(); })] : []),
    );
  }

  place.addEventListener('click', () => {
    const plot = plotEdit.plot({ file: name });
    if (!plot) return;
    const zoom = plotEdit.zoom();
    const old = target ? editor.circuit.plotLegend(target).map((label) => label.bbox()) : [];
    dialog.close();
    let placed = null;
    commit(() => {
      if (adding) {
        // The plot's own traces as edited here, then the file's under them.
        applyDraft(editor.circuit, target, draft);
        const fresh = draft.traces.filter((t) => t.index === undefined);
        if (fresh.length) appendPlotTraces(editor.circuit, target, fresh.map(({ label, color, points }) => ({ label, color, points })), { file: name });
        applyOrder(editor.circuit, target, draft, [...ownLeft(draft), ...fresh]);
        applyZoom(target, zoom);
        applyCursors(target, plotEdit);
        placed = { box: target, legend: editor.circuit.plotLegend(target) };
      } else if (target) {
        // Its axes, as edited here, and the zoom shown.
        const legend = replaceDataPlotTraces(editor.circuit, target, plot);
        for (const axis of ['x', 'y']) setDataPlotAxis(target, axis, plot[axis]);
        for (const axis of ['x', 'y']) setDataPlotView(target, axis, plot.view?.[axis] || null);
        applyCursors(target, plotEdit);
        placed = { box: target, legend };
      } else placed = placeDataPlot(editor.circuit, plot);
    });
    // The legend's sizes are estimates until the browser measures them;
    // a plot's own column keeps its place.
    const legend = placed.legend;
    const column = old.length ? old : legend.map((l) => l.bbox());
    if (legend.length) alignLabelColumn(legend.map((label) => label.id), { left: Math.min(...column.map((r) => r.x)), top: Math.min(...column.map((r) => r.y)), gap: 0 });
    setSelection([]);
    setLabelSelection([placed.box.id]);
    const count = draft.traces.filter((t) => t.index === undefined).length;
    logLine(adding ? `added ${count} trace${count === 1 ? '' : 's'} from ${name} to the plot` : target ? `read ${name} into the plot` : `plotted ${plot.traces.length} trace${plot.traces.length === 1 ? '' : 's'} from ${name}; drag to move it, its corners to resize`);
    render();
  });

  // Read into a plot, it starts from that plot's axes and zoom.
  if (target?.plot?.kind === 'data') {
    draft.x = { ...target.plot.x };
    draft.y = { ...target.plot.y };
    edited.x = true;
    edited.y = true;
  }
  const dialog = el('dialog', { class: 'confirm-dialog data-plot-dialog', 'aria-label': 'Data plot' });
  if (target?.plot) Object.assign(draft, { cursors: [...(target.plot.cursors || [])], cursorValues: target.plot.cursorValues !== false });
  dialog.append(
    el('h2', { text: adding ? `Add ${name} to the plot` : target ? `Read ${name} into the plot` : `Data plot from ${name}` }),
    el('h3', { class: 'data-plot-heading', text: 'File' }),
    form, preview, columns,
    el('h3', { class: 'data-plot-heading', text: 'Plot' }),
    ...plotEdit.parts, status,
    el('div', { class: 'dialog-actions' }, [el('button', { type: 'button', value: 'cancel', text: 'Cancel', onclick: () => dialog.close() }), place]),
  );
  dialog.addEventListener('keydown', (event) => { event.stopPropagation(); plotEdit.key(event); });
  dialog.addEventListener('close', () => {
    plotEdit.dispose();
    dialog.remove();
    canvasEl.focus({ preventScroll: true });
  }, { once: true });
  drawReading();
  document.body.append(dialog);
  dialog.showModal();
  update();
  if (target?.plot?.view) plotEdit.zoomTo(target.plot.view);
  place.focus();
}

/** The settings of the plot `box`: a data plot's, or an analysis plot's
 *  (the traces added to it from files, and its zoom). */
export function openPlotSettings(box) {
  if (!takesFileTraces(box)) return;
  const data = box.plot.kind === 'data';
  const draft = { x: { ...box.plot.x }, y: { ...box.plot.y }, traces: editedTraces(box.plot), curves: box.plot.kind === 'response' ? box.plot.traces.map((trace) => ({ label: trace.label, color: trace.color, on: !trace.hidden })) : null,
    cursors: [...(box.plot.cursors || [])], cursorValues: box.plot.cursorValues !== false };
  const dialog = el('dialog', { class: 'confirm-dialog data-plot-dialog', 'aria-label': 'Plot settings' });
  const plotEdit = plotEditor(draft, { base: data ? null : analysisBase(box.plot) });
  const apply = () => {
    const zoom = plotEdit.zoom();
    const old = editor.circuit.plotLegend(box).map((label) => label.bbox());
    dialog.close();
    commit(() => {
      if (draft.curves) {
        setPlotCurveColors(editor.circuit, box, draft.curves.map((curve) => curve.color));
        setPlotTracesShown(editor.circuit, box, draft.curves.map((curve) => curve.on));
      }
      applyDraft(editor.circuit, box, draft);
      applyOrder(editor.circuit, box, draft, ownLeft(draft));
      applyZoom(box, zoom);
      applyCursors(box, plotEdit);
    });
    // Renamed entries are measured again: the column keeps its left edge and top.
    const legend = editor.circuit.plotLegend(box);
    if (legend.length && old.length) alignLabelColumn(legend.map((label) => label.id), { left: Math.min(...old.map((r) => r.x)), top: Math.min(...old.map((r) => r.y)), gap: 0 });
    logLine('updated the plot');
    render();
  };
  // The close event comes a task later: a file's dialog opened from this
  // one must not find it still there, or lose its focus to the canvas.
  const closed = () => {
    if (!dialog.isConnected) return;
    plotEdit.dispose();
    dialog.remove();
    canvasEl.focus({ preventScroll: true });
  };
  const closeNow = () => { dialog.close(); closed(); };
  const full = draft.traces.length >= (data ? MAX_DATA_TRACES : MAX_PLOT_EXTRA);
  dialog.append(
    el('h2', { text: data ? (box.plot.file ? `Data plot from ${box.plot.file}` : 'Data plot') : 'Plot settings' }),
    ...plotEdit.parts,
    el('div', { class: 'dialog-actions' }, [
      el('button', { type: 'button', class: 'data-plot-add', text: 'Add file…', title: 'Add traces from a file', disabled: full, onclick: () => { closeNow(); chooseDataFile(box, 'add'); } }),
      ...(data ? [el('button', { type: 'button', class: 'data-plot-reread', text: 'Replace file…', title: 'Replace the traces with a file\'s, keeping the plot\'s place, axes, and zoom', onclick: () => { closeNow(); chooseDataFile(box); } })] : []),
      el('span', { class: 'dialog-actions-gap' }),
      el('button', { type: 'button', text: 'Cancel', onclick: () => dialog.close() }),
      el('button', { type: 'button', class: 'primary-action', text: 'Apply', onclick: apply }),
    ]),
  );
  dialog.addEventListener('keydown', (event) => { event.stopPropagation(); plotEdit.key(event); });
  dialog.addEventListener('close', closed, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  plotEdit.show({ keepZoom: false });
  if (box.plot.view) plotEdit.zoomTo(box.plot.view);
}

export function installDataPlotUi() {
  document.getElementById('btn-data-plot')?.addEventListener('click', () => chooseDataFile());
}
