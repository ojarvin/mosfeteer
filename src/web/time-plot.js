/**
 * The time-domain plot: a signal-flow diagram's nets in time, one view of
 * the Plots window (plots-window.js) beside the responses, the locus, the
 * swing, and the loop gain. A sine of the amplitude (dBFS) and frequency
 * (f/fs) set here drives one source, the diagram runs at the coefficients'
 * numbers (core/analysis/simulate.js, the swing's simulation, dither
 * included), and the nets checked show as waveforms over the samples run --
 * a sampled net held through each period, a continuous one between samples
 * as well. The plot is the windows' one (plot-view.js), the plain wheel
 * zooming here: a flat right-drag zooms time alone, a tall one the values
 * alone.
 *
 * Annotate puts the waveforms on the drawing over the time in view (a
 * `wave` plot, drawn as step plots are; Update plots runs it again).
 *
 * It runs again as the coefficients move and as its settings change, while
 * it is on screen. What it shows and how it drives the diagram are saved
 * with the design (`Circuit#windows.scope`).
 */

import { prepareSimulation } from '../core/analysis/simulate.js';
import { TRACE_COLORS, diagramSymbols, hasSignalFlow, signalFlowGraph } from '../core/analysis/signal-flow.js';
import { swingTestFrequency } from '../core/analysis/optimize.js';
import { thinSeries } from '../core/plot-scale.js';
import { element as el } from './dom.js';
import { netPicker } from './net-picker.js';
import { editor } from './editor-state.js';
import { markSettingsChanged, onDocumentShown } from './main.js';
import { createPlotView } from './plot-view.js';

let api = null; // { flow(), resolved(), placePlot(), symbols(), visible() } from signal-flow-ui.js
let parts = null; // the section's elements
let timer = 0;
let last = null; // the last run shown: { sim, result, samples, amplitude, series }
const colors = new Map(); // net key -> its colour while shown

const state = () => editor.circuit.windows.scope || { nets: [] };

/** A frequency typed as f/fs: 0.004, 1/256. */
function typedFraction(text) {
  const match = String(text).trim().match(/^(\d*\.?\d+)\s*\/\s*(\d*\.?\d+)$/);
  return match ? Number(match[1]) / Number(match[2]) : Number(String(text).trim());
}

function save(change) {
  editor.circuit.windows.scope = { ...state(), ...change };
  markSettingsChanged();
  schedule();
}

/** The view's element: its stimulus, the plot, the nets, and Annotate. */
export function timeSection() {
  const plot = createPlotView({ fill: true, wheel: 'always', className: 'time-plot' });
  const input = el('select', { class: 'time-input', 'aria-label': 'Source the sine drives', onchange: (ev) => save({ input: ev.target.value }) });
  const amplitude = el('input', { type: 'text', class: 'time-field', 'aria-label': 'Sine amplitude, dBFS', placeholder: '-6', title: 'The sine\'s amplitude in dB of full scale', onchange: (ev) => save({ amplitude: ev.target.value.trim() }) });
  const frequency = el('input', { type: 'text', class: 'time-field', 'aria-label': 'Sine frequency, f/fs', title: 'f/fs (1/64, 0.01); blank: the middle of the signal band', onchange: (ev) => save({ frequency: ev.target.value.trim() }) });
  const samples = el('select', { class: 'time-samples', 'aria-label': 'Samples to run', onchange: (ev) => save({ samples: Number(ev.target.value) }) },
    [256, 1024, 4096, 16384].map((n) => el('option', { value: String(n), text: `${n}` })));
  const status = el('p', { class: 'field-hint time-status', 'aria-live': 'polite' });
  const nets = el('div', { class: 'time-nets' });
  const annotateButton = el('button', { type: 'button', class: 'time-annotate', text: 'Annotate', title: 'Put the waveforms on the drawing, over the time in view, their nets named beside them (Update plots redraws it)', disabled: true, onclick: () => annotate() });
  const node = el('div', { class: 'signal-flow-time', hidden: true }, [
    el('div', { class: 'signal-flow-swing-controls time-controls' }, [
      el('label', { text: 'Sine into' }), input,
      el('label', { text: 'at' }), amplitude, el('label', { text: 'dBFS,' }),
      frequency, el('label', { text: 'f/fs,' }),
      samples, el('label', { text: 'samples' }),
    ]),
    plot.el,
    nets,
    el('div', { class: 'time-actions' }, [status, annotateButton]),
  ]);
  parts = { el: node, plot, input, amplitude, frequency, samples, status, nets, annotate: annotateButton };
  return node;
}

/** The controls from the design's settings, and the diagram's sources and nets. */
function fill(sim) {
  const settings = state();
  const { sources } = signalFlowGraph(editor.circuit);
  const real = sources.filter((s) => !s.quantizer && !s.dither);
  parts.input.replaceChildren(...real.map((s) => el('option', { value: s.id, text: s.name })));
  const chosen = real.find((s) => s.id === settings.input) || real.find((s) => s.id === api?.flow().swingInput) || real[0];
  if (chosen) parts.input.value = chosen.id;
  parts.amplitude.value = settings.amplitude || '';
  parts.frequency.value = settings.frequency || '';
  parts.frequency.placeholder = String(Number(swingTestFrequency({ frequency: '' }, editor.circuit.analysisValues.band).toPrecision(3)));
  parts.samples.value = String(settings.samples || 1024);
  if (!sim) { parts.nets.replaceChildren(); return; }
  const shown = new Set(shownKeys(sim));
  const items = sim.signals.map((signal) => ({
    key: signal.key, label: signal.name, color: colors.get(signal.key), checked: shown.has(signal.key),
    title: signal.domain === 's' ? 'continuous' : 'sampled',
  }));
  parts.nets.replaceChildren(netPicker(items, (key, on) => {
    const keys = new Set(shownKeys(sim));
    if (on) keys.add(key);
    else keys.delete(key);
    save({ nets: sim.signals.map((s) => s.key).filter((k) => keys.has(k)), chosen: true });
  }));
}

/** The nets to show: those picked (none, if all were unchecked), else the
 *  output and the quantizers' inputs. */
function shownKeys(sim) {
  const saved = state().nets.filter((key) => sim.signals.some((s) => s.key === key));
  if (state().chosen || saved.length) return saved;
  return sim.signals.filter((s) => s.role === 'output' || s.role === 'quantizer-input' || s.key === api?.flow().output).map((s) => s.key);
}

function schedule() {
  clearTimeout(timer);
  if (api?.visible()) timer = setTimeout(runTime, 60);
}

/**
 * The diagram run as the time-domain plot is set: `{ sim, result, samples,
 * amplitude, series }` for the nets `keys` (the ones it shows by default),
 * or `{ error }`. Needs no window: Update plots runs it for an annotated
 * waveform.
 */
function simulateTime(keys = null) {
  const settings = state();
  if (!hasSignalFlow(editor.circuit)) return { error: 'The time-domain plot shows a signal-flow diagram\'s nets: draw one (H(s), H(z), sums, gains, quantizers).', quiet: true };
  const numbers = api.resolved();
  const values = Object.fromEntries(diagramSymbols(editor.circuit).map((name) => [name, numbers[name] ?? 1]));
  const { sources } = signalFlowGraph(editor.circuit);
  const real = sources.filter((s) => !s.quantizer && !s.dither);
  const input = (real.find((s) => s.id === settings.input) || real.find((s) => s.id === api.flow().swingInput) || real[0])?.id || '';
  const frequency = settings.frequency ? typedFraction(settings.frequency) : swingTestFrequency({ frequency: '' }, editor.circuit.analysisValues.band);
  const samples = settings.samples || 1024;
  const sim = prepareSimulation(editor.circuit, {
    values, sources: api.flow().sources, input, output: api.flow().output, frequency, samples, warmup: Math.min(samples, 1024),
  });
  if (!sim.ok) return { error: sim.error };
  const shown = keys || shownKeys(sim);
  const used = new Set();
  for (const key of shown) {
    let color = colors.get(key);
    if (!color || used.has(color)) color = TRACE_COLORS.find((c) => !used.has(c)) || TRACE_COLORS[0];
    colors.set(key, color);
    used.add(color);
  }
  const indices = shown.map((key) => sim.signals.findIndex((s) => s.key === key)).filter((i) => i >= 0);
  const amplitude = Number.isFinite(Number(settings.amplitude)) && settings.amplitude !== '' ? Number(settings.amplitude) : -6;
  const result = sim.run(amplitude, { waves: indices });
  const series = (result.waves || []).map((wave) => {
    const signal = sim.signals[wave.index];
    return {
      label: signal.name,
      color: colors.get(signal.key),
      role: 'curve',
      stairs: !wave.continuous,
      points: wave.t.map((t, i) => [t, Number.isFinite(wave.v[i]) ? wave.v[i] : null]),
    };
  });
  return { sim, result, samples, amplitude, series };
}

/** Run the diagram and draw what it gives (the view on screen). */
export function runTime() {
  if (!parts || !api?.visible()) return;
  const say = (text, error = false) => { parts.status.textContent = text; parts.status.classList.toggle('analysis-error', error); };
  const run = simulateTime();
  if (run.error) {
    fill(null);
    parts.plot.set(null);
    last = null;
    say(run.error, !run.quiet);
    return;
  }
  const { sim, result, samples, amplitude, series } = run;
  fill(sim);
  last = run;
  parts.plot.set({
    key: 'time',
    title: 'Waveforms',
    x: { scale: 'linear', label: 'n (t/T_{s})', range: [0, Math.max(1, samples - 1)] },
    y: { scale: 'linear', label: 'value', include: [0] },
    series,
    vlines: [],
    hlines: [{ y: 0, role: 'zero' }, ...(sim.fullScale ? [{ y: sim.fullScale, role: 'band' }, { y: -sim.fullScale, role: 'band' }] : [])],
  });
  parts.annotate.disabled = !series.length;
  const cycles = sim.frequency * samples;
  say(`${result.overloaded ? 'The loop ran away: shown up to there. ' : ''}A ${amplitude} dBFS sine at f/fs = ${Number(sim.frequency.toPrecision(4))} (${Math.round(cycles)} cycles in ${samples} samples, after ${Math.min(samples, 1024)} to settle); full scale ±${sim.fullScale}.`, result.overloaded);
}

/** Waveforms as a plot annotation keeps them: over `range` (in samples),
 *  each thinned to what a drawing shows. */
function wavePlot(series, range) {
  const [low, high] = range;
  const traces = series.map((s) => {
    const inside = s.points.filter(([t, v]) => t >= low && t <= high && v !== null);
    const thin = thinSeries(inside, low, high, 900);
    return { label: s.label, color: s.color, ...(s.stairs ? { stairs: true } : {}), points: thin.map(([t, y]) => ({ t, y })) };
  }).filter((trace) => trace.points.length > 1);
  return traces.length ? { kind: 'wave', unit: 'n', range: { low, high }, traces } : null;
}

/** The waveforms shown, over the time in view, onto the drawing. */
function annotate() {
  if (!last?.series.length || !api.placePlot) return;
  const range = parts.plot.xRange() || [0, last.samples - 1];
  const plot = wavePlot(last.series, range);
  if (!plot) return;
  api.placePlot(plot, plot.traces.map((t) => ({ label: t.label, color: t.color })), api.symbols());
}

/** An annotated waveform at the numbers now (Update plots): its nets by
 *  name, its time span kept; null when a net is gone or it does not run. */
export function timePlotUpdate(plot) {
  if (!api) return null;
  const probe = simulateTime([]);
  if (probe.error) return null;
  const keys = plot.traces.map((trace) => probe.sim.signals.find((s) => s.name === trace.label)?.key);
  if (keys.some((key) => !key)) return null;
  plot.traces.forEach((trace, i) => colors.set(keys[i], trace.color));
  const run = simulateTime(keys);
  if (run.error) return null;
  const next = wavePlot(run.series, [plot.range.low, plot.range.high]);
  return next ? { plot: next, shown: next.traces.map((t) => ({ label: t.label, color: t.color })), used: api.symbols() } : null;
}

/** The coefficients, the diagram, or its settings moved: run again. */
export function timeChanged() {
  schedule();
}

/** `deps`: signal-flow-ui.js's `{ flow(), resolved(), placePlot(plot,
 *  shown, used), symbols(), visible() }`. */
export function installTimePlot(deps) {
  api = deps;
  onDocumentShown(() => {
    colors.clear();
    parts?.plot.set(null);
    last = null;
    schedule();
  });
}
