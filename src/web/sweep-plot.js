/**
 * The sweep: one coefficient stepped over a range, the diagram simulated
 * at each value (core/analysis/spectrum-run.js `simulatedMeasures`, in a
 * worker thread), and what each run measures plotted against it -- the
 * in-band SNDR and noise, the output tone, each net's peak. One view of the
 * Plots window (plots-window.js) beside the time plot. Its stimulus is set
 * here, as the time plot's: the source the sine drives, its amplitude and
 * f/fs, and the samples a segment of its spectrum.
 *
 * It runs on Sweep only (each point is a full simulation). Annotate puts
 * the measures shown on the drawing as a data plot. What it sweeps, how,
 * and what it shows are saved with the design (`Circuit#windows.sweep`).
 */

import { TRACE_COLORS, bandEdges, diagramSymbols, hasSignalFlow, signalFlowGraph } from '../core/analysis/signal-flow.js';
import { simulatedMeasures, sweepValues } from '../core/analysis/spectrum-run.js';
import { swingTestFrequency } from '../core/analysis/optimize.js';
import { normalizePlot } from '../core/model.js';
import { placeDataPlot } from '../core/data-plot.js';
import { plotSpec } from '../core/plot-spec.js';
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
let result = null; // { name, xs, points: [{ x, measures } | { x, overloaded } | { x, error }], signals, log }
let run = 0; // the sweep running; a newer one (or another design) stops it
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
const MEASURES = [['sndr', 'SNDR in band (dB)'], ['noise', 'Noise in band (dBFS)'], ['tone', 'Output tone (dBFS)']];

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
    el('div', { class: 'time-actions' }, [status, annotateButton]),
  ]);
  parts = { el: node, plot, name, from, to, points, scale, input, amplitude, frequency, samples, go, status, measures, annotate: annotateButton };
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
 *  nets that swing. */
function measureList() {
  // The nets that swing: the states, the quantizers' inputs, the output (as the Swing view shows first).
  const peaks = (result?.signals || []).filter((s) => ['state', 'quantizer-input', 'output'].includes(s.role)).map((s) => [`peak:${s.key}`, `${s.name}\\text{ peak (dBFS)}`]);
  return [...MEASURES.map(([key, text]) => [key, `\\text{${text}}`]), ...peaks];
}

/** The sweep as a data plot: each measure shown a trace over the values. */
function sweepPlot() {
  if (!result?.points.some((p) => p.measures)) return null;
  const shown = new Set(shownMeasures());
  const traces = measureList().filter(([key]) => shown.has(key)).map(([key, label], i) => ({
    label: label.replace(/\\text\{([^}]*)\}/g, '$1').replace(/\\ /g, ' '),
    color: TRACE_COLORS[i % TRACE_COLORS.length],
    points: result.points.filter((p) => Number.isFinite(p.measures?.[key])).map((p) => [p.x, p.measures[key]]),
  })).filter((trace) => trace.points.length > 1);
  if (!traces.length) return null;
  return normalizePlot({ kind: 'data', x: { label: result.name, scale: result.log ? 'log' : 'linear' }, y: { label: 'dB', scale: 'linear' }, traces });
}

function draw() {
  if (!parts) return;
  const plot = sweepPlot();
  parts.plot.set(plot ? plotSpec(plot) : null);
  parts.annotate.disabled = !plot;
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

/** What one run of the sweep simulates at `values`. */
function request(values) {
  const settings = state();
  const segment = SEGMENTS.includes(settings.samples) ? settings.samples : 8192;
  const typed = typedNumber(settings.frequency);
  const f = Number.isFinite(typed) && settings.frequency ? typed : swingTestFrequency({ frequency: '' }, editor.circuit.analysisValues.band);
  const frequency = f === 0 ? 0 : Math.max(1, Math.round(f * segment)) / segment;
  const amplitude = settings.amplitude ? Number(settings.amplitude) : -6;
  const diagram = Object.fromEntries(diagramSymbols(editor.circuit).map((name) => [name, values[name] ?? 1]));
  return {
    options: { values: diagram, sources: api.flow().sources, input: parts.input.value, output: api.flow().output, frequency, samples: AVERAGES * segment, segment },
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
  result = { name, xs, points: [], signals: null, log };
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
    const ask = { circuit, ...request(api.resolvedWith({ [name]: xs[index] })) };
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

/** The sweep shown onto the drawing, as a data plot. */
function annotate() {
  const plot = sweepPlot();
  if (!plot) return;
  let placed = null;
  commit(() => { placed = placeDataPlot(editor.circuit, plot); });
  if (!placed) return;
  const legend = placed.legend;
  if (legend.length) alignLabelColumn(legend.map((label) => label.id), { left: Math.min(...legend.map((l) => l.bbox().x)), top: Math.min(...legend.map((l) => l.bbox().y)), gap: 0 });
  setSelection([]);
  setLabelSelection([placed.box.id]);
  logLine('placed the sweep on the drawing; drag to move it, its corners to resize');
  render();
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
    if (parts) { finish(); parts.plot.set(null); say(''); }
  });
}
