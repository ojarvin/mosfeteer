/**
 * The sweep: one coefficient stepped over a range, the diagram simulated
 * at each value (core/analysis/spectrum-run.js `simulatedMeasures`, in a
 * worker thread), and what each run measures plotted against it -- the
 * in-band SNDR and noise, the output tone, each net's peak. One view of the
 * Plots window (plots-window.js) beside the time plot. Its stimulus is set
 * here, as the time plot's: the source the sine drives, its amplitude and
 * f/fs, and the samples a segment of its spectrum.
 *
 * It runs on Sweep only (each point is a full simulation). Hold keeps a
 * copy of the sweep shown, drawn with the next ones of the same
 * coefficient and named by what differs since (the window's, not saved).
 * Annotate puts the measures shown on the drawing as a data plot, with
 * what each sweep drawn ran at (`plot.sweep`), so Update all plots runs
 * them again (sweepPlotUpdate). What it sweeps, how, and what it shows
 * are saved with the design (`Circuit#windows.sweep`).
 */

import { TRACE_COLORS, bandEdges, diagramSymbols, hasSignalFlow, signalFlowGraph } from '../core/analysis/signal-flow.js';
import { simulatedMeasures, sweepLabels, sweepValues } from '../core/analysis/spectrum-run.js';
import { swingTestFrequency } from '../core/analysis/optimize.js';
import { normalizePlot } from '../core/model.js';
import { placeDataPlot } from '../core/data-plot.js';
import { plotSpec } from '../core/plot-spec.js';
import { plainTex } from '../core/bode-figure.js';
import { plotsBusy } from './plots-window.js';
import { afterPaint } from './busy-indicator.js';
import { startWorker } from './worker-thread.js';
import { element as el, onFieldCommit } from './dom.js';
import { netPicker } from './net-picker.js';
import { editor } from './editor-state.js';
import { alignLabelColumn, commit, markSettingsChanged, onDocumentShown, render, setLabelSelection, setSelection } from './main.js';
import { logLine } from './status-bar-ui.js';
import { createPlotView } from './plot-view.js';

const SEGMENTS = [4096, 8192, 16384, 32768, 65536];
const AVERAGES = 4;

let api = null; // { flow(), links(), resolvedWith(values), visible() } from signal-flow-ui.js
let parts = null;
// { name, xs, from, to, log, points: [{ x, measures } | { x, overloaded } | { x, error }], signals, values, amplitude, stimulus }
let result = null;
let run = 0; // the sweep running; a newer one (or another design) stops it
// Held sweeps, drawn with the live one: { result, values (the sliders then), amplitude }.
let held = [];
let worker = null;

const state = () => editor.circuit.windows.sweep || { measures: [] };

function save(change) {
  editor.circuit.windows.sweep = { ...state(), ...change };
  markSettingsChanged();
}

/** A number typed: 0.5, 1/8, 1e-3. */
function typedNumber(text) {
  const t = String(text ?? '').trim();
  const match = t.match(/^(-?\d*\.?\d+(?:e[-+]?\d+)?)\s*\/\s*(\d*\.?\d+)$/i);
  return match ? Number(match[1]) / Number(match[2]) : t === '' ? NaN : Number(t);
}

/** The coefficients a sweep can step: the diagram's, but a linked one
 *  (it follows another). */
const sweepable = () => diagramSymbols(editor.circuit).filter((name) => !Object.hasOwn(api?.links() || {}, name));

/** The measures every run gives, before the nets' peaks. */
const MEASURES = [['sndr', 'SNDR in band', 'dB'], ['noise', 'Noise in band', 'dBFS'], ['tone', 'Output tone', 'dBFS']];

/** The view's element: what it sweeps, its stimulus, Sweep, the plot, the
 *  measures, and Annotate. */
export function sweepSection() {
  const plot = createPlotView({ fill: true, wheel: 'always', className: 'sweep-plot' });
  const name = el('select', { class: 'sweep-name', 'aria-label': 'Coefficient to sweep', onchange: (ev) => save({ name: ev.target.value }) });
  const field = (key, label, placeholder, title) => {
    const input = el('input', { type: 'text', class: 'time-field', 'aria-label': label, placeholder, title });
    onFieldCommit(input, (text) => save({ [key]: text.trim() }));
    return input;
  };
  const from = field('from', 'From', '', 'The first value');
  const to = field('to', 'To', '', 'The last value');
  const points = field('points', 'Points', '11', 'How many values, from 2 to 201');
  const scale = el('select', { class: 'sweep-scale', 'aria-label': 'Spacing', onchange: (ev) => save({ scale: ev.target.value === 'log' ? 'log' : undefined }) },
    [['linear', 'Linear'], ['log', 'Log']].map(([value, text]) => el('option', { value, text })));
  const input = el('select', { class: 'time-input', 'aria-label': 'Source the sine drives', onchange: (ev) => save({ input: ev.target.value }) });
  const amplitude = field('amplitude', 'Sine amplitude, dBFS', '-6', 'The sine\'s amplitude in dB of full scale');
  const frequency = field('frequency', 'Sine frequency, f/fs', '', 'Input f/fs (1/256, 0.004; 0 for DC); blank: in the band');
  const samples = el('select', { class: 'time-samples', 'aria-label': 'Samples per segment', title: 'Samples per FFT segment; each run is four segments', onchange: (ev) => save({ samples: Number(ev.target.value) }) },
    SEGMENTS.map((n) => el('option', { value: String(n), text: `${n}` })));
  const go = el('button', { type: 'button', class: 'primary-action sweep-run', text: 'Sweep', onclick: () => (running() ? stop() : sweep()) });
  const status = el('p', { class: 'field-hint sweep-status', 'aria-live': 'polite' });
  const measures = el('div', { class: 'time-nets sweep-measures' });
  const annotateButton = el('button', { type: 'button', class: 'sweep-annotate', text: 'Annotate', title: 'Put the sweep on the drawing', disabled: true, onclick: () => annotate() });
  const holdButton = el('button', { type: 'button', class: 'sweep-hold', text: 'Hold', title: 'Hold', disabled: true, onclick: () => holdSweep() });
  const clearButton = el('button', { type: 'button', class: 'sweep-clear', text: 'Clear held', disabled: true, onclick: () => { held = []; draw(); } });
  const node = el('div', { class: 'signal-flow-sweep', hidden: true }, [
    el('div', { class: 'signal-flow-swing-controls time-controls' }, [
      el('label', { text: 'Sweep' }), name,
      el('label', { text: 'from' }), from, el('label', { text: 'to' }), to,
      el('label', { text: 'in' }), points, el('label', { text: 'points,' }), scale,
    ]),
    el('div', { class: 'signal-flow-swing-controls time-controls' }, [
      el('label', { text: 'Sine into' }), input,
      el('label', { text: 'at' }), amplitude, el('label', { text: 'dBFS,' }),
      frequency, el('label', { text: 'f/fs,' }),
      samples, el('label', { text: 'samples' }),
      go,
    ]),
    plot.el,
    measures,
    el('div', { class: 'time-actions' }, [status, holdButton, clearButton, annotateButton]),
  ]);
  parts = { el: node, plot, name, from, to, points, scale, input, amplitude, frequency, samples, go, status, measures, annotate: annotateButton, hold: holdButton, clear: clearButton };
  return node;
}

const running = () => !!parts?.go.dataset.running;

/** The controls from the design's settings and the diagram. */
function fill() {
  if (!parts) return;
  const settings = state();
  const names = sweepable();
  parts.name.replaceChildren(...names.map((n) => el('option', { value: n, text: n })));
  const chosen = names.includes(settings.name) ? settings.name : names[0];
  if (chosen) parts.name.value = chosen;
  const now = chosen ? api.resolvedWith({})[chosen] ?? 1 : 1;
  parts.from.value = settings.from || '';
  parts.to.value = settings.to || '';
  // Blank: a decade either way of the value now (half and twice, when it is 0).
  parts.from.placeholder = String(Number((now ? now / 2 : 0).toPrecision(3)));
  parts.to.placeholder = String(Number((now ? now * 2 : 1).toPrecision(3)));
  parts.points.value = settings.points ? String(settings.points) : '';
  parts.scale.value = settings.scale === 'log' ? 'log' : 'linear';
  const { sources } = signalFlowGraph(editor.circuit);
  const real = sources.filter((s) => !s.quantizer && !s.dither);
  parts.input.replaceChildren(...real.map((s) => el('option', { value: s.id, text: s.name })));
  const source = real.find((s) => s.id === settings.input) || real.find((s) => s.id === api?.flow().swingInput) || real[0];
  if (source) parts.input.value = source.id;
  parts.amplitude.value = settings.amplitude || '';
  parts.frequency.value = settings.frequency || '';
  parts.frequency.placeholder = String(Number(swingTestFrequency({ frequency: '' }, editor.circuit.analysisValues.band).toPrecision(3)));
  parts.samples.value = String(SEGMENTS.includes(settings.samples) ? settings.samples : 8192);
}

/** The measures to show: those picked, else the SNDR (with a band) or the
 *  output tone. */
function shownMeasures() {
  const saved = state().measures;
  if (state().chosen || saved.length) return saved;
  return [bandEdges(editor.circuit.analysisValues.band).length ? 'sndr' : 'tone'];
}

/** Every measure a sweep's runs give: the three, then the peaks of the
 *  nets that swing. Each `[key, label, { name, unit }]`, the label its
 *  name with its unit (TeX). */
function measureList(of = result) {
  // The nets that swing: the states, the quantizers' inputs, the output (as the Swing view shows first).
  const peaks = (of?.signals || []).filter((s) => ['state', 'quantizer-input', 'output'].includes(s.role)).map((s) => [`peak:${s.key}`, `${s.name}\\text{ peak}`, 'dBFS']);
  return [...MEASURES.map(([key, text, unit]) => [key, `\\text{${text}}`, unit]), ...peaks].map(([key, name, unit]) => [key, `${name}\\text{ (${unit})}`, { name, unit }]);
}

/** The sweep shown as a data plot. */
const sweepPlot = () => sweepPlotOf(result, held, shownMeasures());

/** Sweep `live` as a data plot, with those `held` of its coefficient: each
 *  of the measures `keys` a trace over the values. */
function sweepPlotOf(live, held, keys) {
  if (!live?.points.some((p) => p.measures)) return null;
  const shown = new Set(keys);
  const measures = measureList(live).filter(([key]) => shown.has(key));
  // Held sweeps of the same coefficient first, each named by what differs
  // from the sweep shown (the numbers it ran at).
  const same = held.filter((h) => h.result.name === live.name);
  // The live sweep names its own numbers for those its held ones name.
  const named = same.flatMap((h) => heldChanges(h, live));
  const runs = [...same.map((h) => ({ of: h.result, notes: heldNotes(h, live), held: true })), { of: live, notes: liveNotes(live, named) }];
  // A unit all the measures share goes on the axis (sweepLabels), as
  // plain text: an axis takes no TeX but sub- and superscripts.
  const { y, labels } = sweepLabels(measures.map(([, , m]) => m), runs);
  const order = [...runs.keys()].slice(0, -1).map((n) => n + 1).concat(0);
  const traces = runs.flatMap((run, r) => measures.map(([key], k) => ({
    label: labels[r][k],
    color: TRACE_COLORS[(shown.size * order[r] + k) % TRACE_COLORS.length],
    points: run.of.points.filter((p) => Number.isFinite(p.measures?.[key])).map((p) => [p.x, p.measures[key]]),
  }))).filter((trace) => trace.points.length > 1);
  if (!traces.length) return null;
  // The coefficient as an axis names it: a_r as a sub-scripted r.
  return normalizePlot({ kind: 'data', x: { label: live.name.replace(/_([A-Za-z0-9]+)$/, '_{$1}'), scale: live.log ? 'log' : 'linear' }, y: { label: plainTex(y), scale: 'linear' }, traces });
}

/** A held sweep's notes: the coefficients (but the swept one) and the
 *  amplitude it ran at that differ from the live sweep's. */
function heldNotes(h, live) {
  return heldChanges(h, live).map((name) => (name === AMPLITUDE ? `${h.amplitude}\\ \\text{dBFS}` : `${name} = ${Number(h.values[name].toPrecision(4))}`));
}

const AMPLITUDE = '\0amplitude';

/** What differs between a held sweep and the live one: coefficient names
 *  (but the swept one), and AMPLITUDE for the input's. */
function heldChanges(h, live) {
  const now = live.values;
  const names = Object.entries(h.values).filter(([name, value]) => name !== h.result.name && Math.abs(value - (now[name] ?? 1)) > 1e-12 * Math.max(1, Math.abs(value))).map(([name]) => name);
  return h.amplitude !== live.amplitude ? [...names, AMPLITUDE] : names;
}

/** The live sweep's notes: its numbers for `names`. */
function liveNotes(live, names) {
  const now = live.values;
  return [...new Set(names)].map((name) => (name === AMPLITUDE ? `${live.amplitude}\\ \\text{dBFS}` : `${name} = ${Number((now[name] ?? 1).toPrecision(4))}`));
}

/** Hold the sweep shown: a copy that stays as the sliders and the next sweep move. */
function holdSweep() {
  if (!result?.points.some((p) => p.measures) || running()) return;
  held.push({ result, values: result.values, amplitude: result.amplitude });
  draw();
}

function draw() {
  if (!parts) return;
  const plot = sweepPlot();
  parts.plot.set(plot ? plotSpec(plot) : null);
  parts.annotate.disabled = !plot;
  parts.hold.disabled = !plot || running();
  parts.clear.disabled = !held.length;
  const shown = new Set(shownMeasures());
  const colors = new Map(measureList().filter(([key]) => shown.has(key)).map(([key], i) => [key, TRACE_COLORS[i % TRACE_COLORS.length]]));
  parts.measures.replaceChildren(result ? netPicker(measureList().map(([key, label]) => ({ key, label, checked: shown.has(key), color: colors.get(key) })), (key, on) => {
    const keys = new Set(shownMeasures());
    if (on) keys.add(key);
    else keys.delete(key);
    save({ measures: measureList().map(([k]) => k).filter((k) => keys.has(k)), chosen: true });
    draw();
  }) : '');
}

function say(text, error = false) {
  parts.status.textContent = text;
  parts.status.classList.toggle('analysis-error', error);
}

/** The sine the settings drive the sweep with: `{ input, amplitude,
 *  frequency, samples }` (f/fs on a bin of a segment of `samples`). */
function stimulusNow() {
  const settings = state();
  const samples = SEGMENTS.includes(settings.samples) ? settings.samples : 8192;
  const typed = typedNumber(settings.frequency);
  const f = Number.isFinite(typed) && settings.frequency ? typed : swingTestFrequency({ frequency: '' }, editor.circuit.analysisValues.band);
  const frequency = f === 0 ? 0 : Math.max(1, Math.round(f * samples)) / samples;
  return { input: parts.input.value, amplitude: settings.amplitude ? Number(settings.amplitude) : -6, frequency, samples };
}

/** What one run of a sweep simulates at `values`, driven by `stimulus`. */
function request(values, stimulus) {
  const { input, amplitude, frequency, samples: segment } = stimulus;
  const diagram = Object.fromEntries(diagramSymbols(editor.circuit).map((name) => [name, values[name] ?? 1]));
  return {
    options: { values: diagram, sources: api.flow().sources, input, output: api.flow().output, frequency, samples: AVERAGES * segment, segment },
    amplitude,
    segment,
    edges: bandEdges(editor.circuit.analysisValues.band),
  };
}

function stop() {
  run++;
  worker?.terminate();
  worker = null;
  finish();
  say(result ? `Stopped after ${result.points.length} of ${result.xs.length} points.` : 'Stopped.');
}

function finish() {
  plotsBusy.set('sweep', false);
  delete parts.go.dataset.running;
  parts.go.textContent = 'Sweep';
  parts.hold.disabled = !sweepPlot();
}

/** Run the sweep: a run a value, in a worker thread where one starts,
 *  the plot drawn as the points come. */
export function sweep() {
  if (!parts || !hasSignalFlow(editor.circuit)) return;
  fill();
  const settings = state();
  const name = parts.name.value;
  if (!name) { say('The diagram has no coefficient to sweep.', true); return; }
  const now = api.resolvedWith({})[name] ?? 1;
  const from = settings.from ? typedNumber(settings.from) : now ? now / 2 : 0;
  const to = settings.to ? typedNumber(settings.to) : now ? now * 2 : 1;
  const count = settings.points || 11;
  const log = settings.scale === 'log';
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) { say('From and to are two different numbers.', true); return; }
  const xs = sweepValues(from, to, count, log);
  if (!xs.length) { say('A log sweep runs between two numbers of one sign, neither zero.', true); return; }
  if (!Number.isFinite(Number(settings.amplitude || -6))) { say('The amplitude is a number of dBFS.', true); return; }
  const id = ++run;
  const circuit = editor.circuit.toJSON();
  // The numbers it runs at, for its name beside held sweeps.
  const stimulus = stimulusNow();
  result = { name, xs, from, to, log, points: [], signals: null, values: { ...api.resolvedWith({}) }, amplitude: stimulus.amplitude, stimulus };
  plotsBusy.set('sweep', true);
  parts.go.dataset.running = '1';
  parts.go.textContent = 'Stop';
  say(`Point 1 of ${xs.length}…`);
  draw();
  worker?.terminate();
  worker = startWorker();
  const next = (index) => {
    if (id !== run) return;
    if (index >= xs.length) {
      finish();
      const away = result.points.filter((p) => p.overloaded).length;
      const failed = result.points.find((p) => p.error);
      say(failed ? failed.error : `${xs.length} points of ${name} from ${Number(from.toPrecision(4))} to ${Number(to.toPrecision(4))}${away ? `; the loop ran away at ${away} of them` : ''}.`, !!failed);
      return;
    }
    const ask = { circuit, ...request(api.resolvedWith({ [name]: xs[index] }), stimulus) };
    const take = (data) => {
      if (id !== run) return;
      result.signals ||= data.signals || null;
      result.points.push({ x: xs[index], ...(data.measures ? { measures: data.measures } : data.overloaded ? { overloaded: true } : { error: data.error }) });
      say(`Point ${index + 2 > xs.length ? xs.length : index + 2} of ${xs.length}…`);
      draw();
      // A diagram that cannot run stops at its first point.
      if (data.error && !data.signals) { finish(); say(data.error, true); return; }
      next(index + 1);
    };
    if (worker) {
      worker.onmessage = ({ data }) => { if (data.type === 'measures' && data.id === id && data.index === index) take(data); };
      worker.onerror = (ev) => { ev.preventDefault?.(); worker?.terminate(); worker = null; take(simulatedMeasures(ask)); };
      worker.postMessage({ type: 'measures', id, index, ...ask });
    } else afterPaint(() => { if (id === run) take(simulatedMeasures(ask)); });
  };
  next(0);
}

/** What Update all plots runs again of a sweep: its range and its sine,
 *  and for a held one the coefficients it ran at (model.js sweepOf). */
function sweepRun(of, values) {
  return { from: of.from, to: of.to, points: of.xs.length, log: of.log, ...of.stimulus, ...(values ? { values } : {}) };
}

/** The sweep shown onto the drawing, as a data plot. */
function annotate() {
  let plot = sweepPlot();
  if (!plot) return;
  const same = held.filter((h) => h.result.name === result.name);
  plot = normalizePlot({ ...plot, sweep: { name: result.name, measures: shownMeasures(), count: plot.traces.length, runs: [...same.map((h) => sweepRun(h.result, h.values)), sweepRun(result)] } });
  let placed = null;
  commit(() => { placed = placeDataPlot(editor.circuit, plot, { math: true }); });
  if (!placed) return;
  const legend = placed.legend;
  if (legend.length) alignLabelColumn(legend.map((label) => label.id), { left: Math.min(...legend.map((l) => l.bbox().x)), top: Math.min(...legend.map((l) => l.bbox().y)), gap: 0 });
  setSelection([]);
  setLabelSelection([placed.box.id]);
  logLine('placed the sweep on the drawing; drag to move it, its corners to resize');
  render();
}

/** Each run of `asks` (simulatedMeasures requests) in turn, in a worker
 *  thread where one starts; the results in order, or null once `stale()`. */
async function measureAll(asks, stale) {
  let thread = startWorker();
  const results = [];
  try {
    for (const [index, ask] of asks.entries()) {
      if (stale()) return null;
      const data = thread ? await new Promise((resolve) => {
        thread.onmessage = ({ data: reply }) => { if (reply.type === 'measures' && reply.index === index) resolve(reply); };
        thread.onerror = (ev) => { ev.preventDefault?.(); thread?.terminate(); thread = null; resolve(simulatedMeasures(ask)); };
        thread.postMessage({ type: 'measures', id: 0, index, ...ask });
      }) : await new Promise((resolve) => afterPaint(() => resolve(simulatedMeasures(ask))));
      results.push(data);
      // A diagram that cannot run stops at its first point.
      if (data.error && !data.signals) return results;
    }
    return results;
  } finally {
    thread?.terminate();
  }
}

/**
 * A sweep plot (`plot.sweep`) run again: each of its sweeps in turn, the
 * held ones at the coefficients they ran at, the live one at those now,
 * over the same range with the same sine. Resolves to `{ traces, y? }`:
 * the plot's new traces (the sweep's, colored as they were, then those
 * added since) and, for a plot whose y axis is the old "dB", its new one; or
 * null when the diagram no longer runs or no longer has what it plotted;
 * null too once `stale()`.
 */
export async function sweepPlotUpdate(plot, stale = () => false) {
  const spec = plot?.sweep;
  if (!spec || !api || !hasSignalFlow(editor.circuit)) return null;
  if (!diagramSymbols(editor.circuit).includes(spec.name)) return null;
  const circuit = editor.circuit.toJSON();
  const sources = new Set(signalFlowGraph(editor.circuit).sources.filter((s) => !s.quantizer && !s.dither).map((s) => s.id));
  const runs = [];
  for (const run of spec.runs) {
    if (!sources.has(run.input)) return null;
    const xs = sweepValues(run.from, run.to, run.points, run.log);
    if (!xs.length) return null;
    const values = run.values ? { ...api.resolvedWith(run.values) } : { ...api.resolvedWith({}) };
    const asks = xs.map((x) => ({ circuit, ...request(api.resolvedWith({ ...(run.values || {}), [spec.name]: x }), run) }));
    const data = await measureAll(asks, stale);
    if (!data) return null;
    const points = data.map((d, i) => ({ x: xs[i], ...(d.measures ? { measures: d.measures } : d.overloaded ? { overloaded: true } : { error: d.error }) }));
    runs.push({ name: spec.name, xs, from: run.from, to: run.to, log: run.log, points, signals: data.find((d) => d.signals)?.signals || null, values, amplitude: run.amplitude, stimulus: run });
  }
  const live = runs.at(-1);
  // Every measure it showed is still there to show.
  const keys = new Set(measureList(live).map(([key]) => key));
  if (spec.measures.some((key) => !keys.has(key))) return null;
  const next = sweepPlotOf(live, runs.slice(0, -1).map((r) => ({ result: r, values: r.values, amplitude: r.amplitude })), spec.measures);
  if (!next || next.traces.length !== spec.count) return null;
  const own = plot.traces.slice(0, spec.count);
  const traces = [...next.traces.map((trace, i) => ({ ...trace, color: own[i]?.color || trace.color })), ...plot.traces.slice(spec.count)];
  // A plot from before the unit went on the axis had "dB" there: it takes
  // the axis its names now leave the unit to.
  return { traces, ...(plot.y?.label === 'dB' && next.y.label !== 'dB' ? { y: { ...plot.y, label: next.y.label } } : {}) };
}

/** The view was shown: its controls, and the last sweep. */
export function showSweep() {
  fill();
  draw();
  if (!result && parts && !running()) say('Pick a coefficient and its range, then Sweep: each point is a full simulation.');
}

/** `deps`: signal-flow-ui.js's `{ flow(), links(), resolvedWith(values), visible() }`. */
export function installSweepPlot(deps) {
  api = deps;
  onDocumentShown(() => {
    run++;
    worker?.terminate();
    worker = null;
    result = null;
    held = [];
    if (parts) { finish(); parts.plot.set(null); say(''); }
  });
}
