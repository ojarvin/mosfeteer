/**
 * The sweep: one coefficient stepped over a range, the diagram simulated
 * at each value (core/analysis/spectrum-run.js `simulatedMeasures`, in a
 * worker thread), and what each run measures plotted against it -- the
 * in-band SNDR and noise, the output tone, each net's peak. Its stimulus is
 * set as the time plot's: the source the sine drives, its amplitude and
 * f/fs, and the samples a segment of its spectrum.
 *
 * The sweep's controls (`sweepEditor`) are one editor in two places: the
 * Plots window's Sweep view (plots-window.js), on what the design saves
 * for it (`Circuit#windows.sweep`), and the Plot settings of a sweep on the
 * drawing (data-plot-ui.js), on what that plot ran (`plot.sweep`). Each
 * runs on Sweep only (each point is a full simulation), with a progress bar
 * and Stop.
 *
 * In the window, Hold keeps a copy of the sweep shown, drawn with the next
 * ones of the same coefficient and named by what differs since (the
 * window's, not saved). Annotate puts the measures shown on the drawing as
 * a data plot, with what each sweep drawn ran at (`plot.sweep`), so the
 * plot runs them again later (sweepPlotUpdate): the held ones at the
 * coefficients they ran at, the last at the coefficients then.
 */

import { TRACE_COLORS, bandEdges, diagramSymbols, hasSignalFlow, signalFlowGraph } from '../core/analysis/signal-flow.js';
import { simulatedMeasures, simulationSignals, sweepLabels, sweepValues } from '../core/analysis/spectrum-run.js';
import { swingTestFrequency } from '../core/analysis/optimize.js';
import { normalizePlot } from '../core/model.js';
import { placeDataPlot } from '../core/data-plot.js';
import { plotSpec } from '../core/plot-spec.js';
import { cursorValue } from '../core/plot-cursors.js';
import { plainTex } from '../core/bode-figure.js';
import { plotsBusy } from './plots-window.js';
import { afterPaint } from './busy-indicator.js';
import { startWorker } from './worker-thread.js';
import { controlPair, element as el, onFieldCommit } from './dom.js';
import { netPicker } from './net-picker.js';
import { editor } from './editor-state.js';
import { alignLabelColumn, commit, markSettingsChanged, onDocumentShown, render, setLabelSelection, setSelection } from './main.js';
import { logLine } from './status-bar-ui.js';
import { createPlotView } from './plot-view.js';

const SEGMENTS = [4096, 8192, 16384, 32768, 65536];
const AVERAGES = 4;

let api = null; // { flow(), links(), resolvedWith(values), visible() } from signal-flow-ui.js

/** A number typed: 0.5, 1e-3, or an expression the calculator takes
 *  (1/8, 2.7k/2.24M, 2^-6); NaN when blank or neither. */
function typedNumber(text) {
  const t = String(text ?? '').trim();
  return t === '' ? NaN : cursorValue(t) ?? NaN;
}

/** The coefficients a sweep can step: the diagram's, but a linked one
 *  (it follows another). */
const sweepable = () => diagramSymbols(editor.circuit).filter((name) => !Object.hasOwn(api?.links() || {}, name));

/** The sources a sine can drive: the diagram's, but quantizers and dither. */
const realSources = () => signalFlowGraph(editor.circuit).sources.filter((s) => !s.quantizer && !s.dither);

/** The measures every run gives, before the nets' peaks. */
const MEASURES = [['sndr', 'SNDR in band', 'dB'], ['noise', 'Noise in band', 'dBFS'], ['tone', 'Output tone', 'dBFS']];

/** The measures `settings` show: those picked, else the SNDR (with a band)
 *  or the output tone. */
function shownMeasures(settings) {
  const saved = settings.measures || [];
  if (settings.chosen || saved.length) return saved;
  return [bandEdges(editor.circuit.analysisValues.band).length ? 'sndr' : 'tone'];
}

/** Every measure a sweep's runs give: the three, then the peaks of the
 *  nets that swing (of `signals`). Each `[key, label, { name, unit }]`, the
 *  label its name with its unit (TeX). */
function measureList(signals) {
  // The nets that swing: the states, the quantizers' inputs, the output (as the Swing view shows first).
  const peaks = (signals || []).filter((s) => ['state', 'quantizer-input', 'output'].includes(s.role)).map((s) => [`peak:${s.key}`, `${s.name}\\text{ peak}`, 'dBFS']);
  return [...MEASURES.map(([key, text, unit]) => [key, `\\text{${text}}`, unit]), ...peaks].map(([key, name, unit]) => [key, `${name}\\text{ (${unit})}`, { name, unit }]);
}

/**
 * Sweep `live` as a data plot, with `held` (sweeps of its coefficient, each
 * a result as `live` is): each of the measures `keys` a trace over the
 * values. `signals` names the nets' peaks. Null while nothing has a value.
 */
function sweepPlotOf(live, held, keys, signals = live.signals) {
  const runs = [...held.filter((h) => h.name === live.name), live];
  if (!runs.some((run) => run.points.some((p) => p.measures))) return null;
  const shown = new Set(keys);
  const measures = measureList(signals || runs.find((run) => run.signals)?.signals).filter(([key]) => shown.has(key));
  // Held sweeps first, each named by what differs from the live sweep
  // (the numbers it ran at); the live one names its own numbers for those.
  const same = runs.slice(0, -1);
  const named = same.flatMap((h) => heldChanges(h, live));
  const notes = [...same.map((h) => ({ of: h, notes: heldNotes(h, live), held: true })), { of: live, notes: liveNotes(live, named) }];
  // A unit all the measures share goes on the axis (sweepLabels), as
  // plain text: an axis takes no TeX but sub- and superscripts.
  const { y, labels } = sweepLabels(measures.map(([, , m]) => m), notes);
  const order = [...notes.keys()].slice(0, -1).map((n) => n + 1).concat(0);
  const traces = notes.flatMap((run, r) => measures.map(([key], k) => ({
    label: labels[r][k],
    color: TRACE_COLORS[(shown.size * order[r] + k) % TRACE_COLORS.length],
    points: run.of.points.filter((p) => Number.isFinite(p.measures?.[key])).map((p) => [p.x, p.measures[key]]),
  }))).filter((trace) => trace.points.length > 1);
  if (!traces.length) return null;
  // The coefficient as an axis names it: a_r as a sub-scripted r.
  return normalizePlot({ kind: 'data', x: { label: live.name.replace(/_([A-Za-z0-9]+)$/, '_{$1}'), scale: live.log ? 'log' : 'linear' }, y: { label: plainTex(y), scale: 'linear' }, traces });
}

const AMPLITUDE = '\0amplitude';

/** What differs between a held sweep and the live one: coefficient names
 *  (but the swept one), and AMPLITUDE for the input's. */
function heldChanges(h, live) {
  const now = live.values;
  const names = Object.entries(h.values).filter(([name, value]) => name !== h.name && Math.abs(value - (now[name] ?? 1)) > 1e-12 * Math.max(1, Math.abs(value))).map(([name]) => name);
  return h.amplitude !== live.amplitude ? [...names, AMPLITUDE] : names;
}

/** A held sweep's notes: the coefficients (but the swept one) and the
 *  amplitude it ran at that differ from the live sweep's. */
function heldNotes(h, live) {
  return heldChanges(h, live).map((name) => (name === AMPLITUDE ? `${h.amplitude}\\ \\text{dBFS}` : `${name} = ${Number(h.values[name].toPrecision(4))}`));
}

/** The live sweep's notes: its numbers for `names`. */
function liveNotes(live, names) {
  const now = live.values;
  return [...new Set(names)].map((name) => (name === AMPLITUDE ? `${live.amplitude}\\ \\text{dBFS}` : `${name} = ${Number((now[name] ?? 1).toPrecision(4))}`));
}

/** The source the sine drives: the one `settings` name, else the swing's,
 *  else the first. */
function inputOf(settings) {
  const real = realSources();
  return (real.find((s) => s.id === settings.input) || real.find((s) => s.id === api?.flow().swingInput) || real[0])?.id || '';
}

/** The input f/fs a blank field means: in the band. */
const bandFrequency = () => swingTestFrequency({ frequency: '' }, editor.circuit.analysisValues.band);

/**
 * What `settings` (the editor's fields, as typed) sweep: `{ name, run }`,
 * `run` as a plot keeps it (model.js sweepOf: `{ from, to, points, log,
 * input, amplitude, frequency, samples }`, f/fs on a bin of a segment), or
 * `{ error }`.
 */
function sweepOf(settings) {
  const names = sweepable();
  const name = names.includes(settings.name) ? settings.name : names[0];
  if (!name) return { error: 'The diagram has no coefficient to sweep.' };
  const now = api.resolvedWith({})[name] ?? 1;
  const from = settings.from ? typedNumber(settings.from) : now ? now / 2 : 0;
  const to = settings.to ? typedNumber(settings.to) : now ? now * 2 : 1;
  const points = Math.max(2, Math.min(201, Math.round(Number(settings.points) || 11)));
  const log = settings.scale === 'log';
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return { error: 'From and to are two different numbers (or expressions: 1/64).' };
  if (!sweepValues(from, to, points, log).length) return { error: 'A log sweep runs between two numbers of one sign, neither zero.' };
  const amplitude = settings.amplitude ? typedNumber(settings.amplitude) : -6;
  if (!Number.isFinite(amplitude)) return { error: 'The amplitude is a number of dBFS.' };
  const samples = SEGMENTS.includes(settings.samples) ? settings.samples : 8192;
  const typed = typedNumber(settings.frequency);
  const f = Number.isFinite(typed) && settings.frequency ? typed : bandFrequency();
  const frequency = f === 0 ? 0 : Math.max(1, Math.round(f * samples)) / samples;
  return { name, run: { from, to, points, log, input: inputOf(settings), amplitude, frequency, samples } };
}

/** A kept run (`plot.sweep.runs[i]`) as the editor's fields. */
function settingsOfRun(name, measures, run) {
  const text = (n) => String(Number(n.toPrecision(6)));
  return { name, from: text(run.from), to: text(run.to), points: run.points, ...(run.log ? { scale: 'log' } : {}), input: run.input, amplitude: text(run.amplitude), frequency: text(run.frequency), samples: run.samples, measures: [...measures], chosen: true };
}

/** What one run of a sweep simulates at `values`, driven by `run`'s sine. */
function request(values, { input, amplitude, frequency, samples: segment }) {
  const diagram = Object.fromEntries(diagramSymbols(editor.circuit).map((name) => [name, values[name] ?? 1]));
  return {
    options: { values: diagram, sources: api.flow().sources, input, output: api.flow().output, frequency, samples: AVERAGES * segment, segment },
    amplitude,
    segment,
    edges: bandEdges(editor.circuit.analysisValues.band),
  };
}

/** The signals `settings`' sweep would measure the peaks of, worked out
 *  without a run (kept while the design and the sine's source stay). */
let signalsCache = { key: '', signals: [] };
function signalsOf(settings) {
  if (!api || !hasSignalFlow(editor.circuit)) return [];
  const spec = sweepOf(settings);
  if (spec.error) return [];
  const key = `${editor.modelRevision}\n${spec.run.input}\n${api.flow().output}`;
  if (signalsCache.key !== key) {
    const { options } = request(api.resolvedWith({}), spec.run);
    signalsCache = { key, signals: simulationSignals({ circuit: editor.circuit, options }) };
  }
  return signalsCache.signals;
}

/** How many points `runs` (kept runs) take in all. */
const pointCount = (runs) => runs.reduce((n, run) => n + sweepValues(run.from, run.to, run.points, run.log).length, 0);

/** How many points running a sweep plot (`plot.sweep`) again takes. */
export const sweepPlotPoints = (plot) => pointCount(plot.sweep.runs);

/**
 * Run sweeps of `name`, one after another: each of `runs` (`{ from, to,
 * points, log, input, amplitude, frequency, samples, values? }`) at the
 * coefficients now, `values` changed (a held one's). A point at a time, in
 * one worker thread where one starts. `onPoint({ runs, done, total })` hears
 * each point, `runs` the results so far. Returns `{ done: promise, stop() }`;
 * the promise resolves to `{ runs, error?, stopped? }`, each result `{ name,
 * xs, from, to, log, points: [{ x, measures } | { x, overloaded } | { x,
 * error }], signals, values, amplitude, stimulus }`.
 */
function runSweeps(name, runs, { onPoint = () => {} } = {}) {
  const circuit = editor.circuit.toJSON();
  const total = pointCount(runs);
  let thread = startWorker();
  let stopped = false;
  let waiting = null;
  let asked = 0;
  const stop = () => {
    stopped = true;
    thread?.terminate();
    thread = null;
    waiting?.(null);
  };
  const measure = (ask) => new Promise((resolve) => {
    waiting = resolve;
    if (!thread) { afterPaint(() => resolve(stopped ? null : simulatedMeasures(ask))); return; }
    const index = ++asked;
    thread.onmessage = ({ data }) => { if (data.type === 'measures' && data.index === index) resolve(data); };
    thread.onerror = (ev) => { ev.preventDefault?.(); thread?.terminate(); thread = null; resolve(simulatedMeasures(ask)); };
    thread.postMessage({ type: 'measures', id: 0, index, ...ask });
  });
  const done = (async () => {
    const results = [];
    let count = 0;
    try {
      for (const run of runs) {
        const xs = sweepValues(run.from, run.to, run.points, run.log);
        const { values: held, ...stimulus } = run;
        const result = { name, xs, from: run.from, to: run.to, log: run.log, points: [], signals: null, values: { ...api.resolvedWith(held || {}) }, amplitude: run.amplitude, stimulus, ...(held ? { held } : {}) };
        results.push(result);
        for (const x of xs) {
          if (stopped) return { runs: results, stopped: true };
          const data = await measure({ circuit, ...request(api.resolvedWith({ ...(held || {}), [name]: x }), stimulus) });
          if (stopped || !data) return { runs: results, stopped: true };
          result.signals ||= data.signals || null;
          result.points.push({ x, ...(data.measures ? { measures: data.measures } : data.overloaded ? { overloaded: true } : { error: data.error }) });
          onPoint({ runs: results, done: ++count, total });
          // A diagram that cannot run stops at its first point.
          if (data.error && !data.signals) return { runs: results, error: data.error };
        }
      }
      return { runs: results };
    } finally {
      thread?.terminate();
      thread = null;
    }
  })();
  return { done, stop };
}

/** A result's run as a plot keeps it (and a held one's coefficients). */
const keptRun = (result) => ({ from: result.from, to: result.to, points: result.xs.length, log: result.log, ...result.stimulus, ...(result.held ? { values: result.held } : {}) });

/** "Point 3 of 11 (27%)", or across sweeps "Sweep 2 of 3, point 3 of
 *  11 (60%)": the point after the `done` of `runs` (kept runs). */
export function progressText(runs, done) {
  const counts = runs.map((run) => sweepValues(run.from, run.to, run.points, run.log).length);
  const total = counts.reduce((a, b) => a + b, 0);
  let i = 0;
  let left = done;
  while (i < counts.length - 1 && left >= counts[i]) { left -= counts[i]; i++; }
  const point = Math.min(left + 1, counts[i]);
  return `${runs.length > 1 ? `Sweep ${i + 1} of ${runs.length}, point` : 'Point'} ${point} of ${counts[i]} (${Math.round((100 * done) / total)}%)…`;
}

/**
 * Sweep `name` as drawn while `runs` (results) of the `scheduled` kept
 * ones come: the last scheduled one the live sweep, named by its numbers
 * (`run`'s amplitude, the coefficients now) even before it starts. Its
 * own traces `{ traces, y, count }` for `measures`, or null while none has
 * two values.
 */
function drawnSweep(name, run, runs, scheduled, measures) {
  const live = runs.length === scheduled ? runs.at(-1) : { name, points: [], values: { ...api.resolvedWith({}) }, amplitude: run.amplitude, signals: null };
  const next = sweepPlotOf(live, runs.slice(0, scheduled - 1), measures, runs.find((r) => r.signals)?.signals);
  return next ? { traces: next.traces, y: next.y, count: next.traces.length } : null;
}

/** How a finished sweep reads in its status line. */
function doneText({ runs, error, stopped }, total) {
  if (stopped) return `Stopped after ${runs.reduce((n, r) => n + r.points.length, 0)} of ${total} points.`;
  const failed = error || runs.flatMap((r) => r.points).find((p) => p.error)?.error;
  if (failed) return failed;
  const live = runs.at(-1);
  const away = live.points.filter((p) => p.overloaded).length;
  return `${live.xs.length} points of ${live.name} from ${Number(live.from.toPrecision(4))} to ${Number(live.to.toPrecision(4))}${runs.length > 1 ? `, and ${runs.length - 1} held sweep${runs.length > 2 ? 's' : ''} again` : ''}${away ? `; the loop ran away at ${away} of them` : ''}.`;
}

/**
 * The sweep's controls: what it sweeps and its stimulus, `plot` (an element)
 * under them, the measures to show, and the progress bar with the status
 * and Sweep -- Stop while it runs -- beside `actions` (buttons).
 *
 * `settings()` gives the fields (as typed: `{ name, from, to, points,
 * scale, input, amplitude, frequency, samples, measures, chosen }`) and
 * `save(change)` keeps a change. `held()` gives the kept runs of sweeps run
 * before this one, to run again first (`{ values, ...run }`); `signals()`
 * the last run's signals, if any. `onProgress({ runs, done, total })` hears
 * each point, `onDone(outcome)` the end (runSweeps), `onMeasures()` the
 * measures picked changed.
 *
 * Returns `{ el, fill(), drawMeasures(), run(), stop(), reset(), running(),
 * say(text, error) }`.
 */
function sweepEditor({ settings, save, plot = null, actions = [], held = () => [], signals = () => null, onStart = () => {}, onProgress = () => {}, onDone = () => {}, onMeasures = () => {}, busyKey = null }) {
  const name = el('select', { class: 'sweep-name', 'aria-label': 'Coefficient to sweep', onchange: (ev) => { save({ name: ev.target.value }); fill(); } });
  const field = (key, label, placeholder, title) => {
    const input = el('input', { type: 'text', class: 'time-field', 'aria-label': label, placeholder, title });
    onFieldCommit(input, (text) => save({ [key]: text.trim() }));
    return input;
  };
  const from = field('from', 'From', '', 'The first value: a number or an expression (1/64, 2.7k/2.24M)');
  const to = field('to', 'To', '', 'The last value: a number or an expression (1/64, 2.7k/2.24M)');
  const points = field('points', 'Points', '11', 'How many values, from 2 to 201');
  const scale = el('select', { class: 'sweep-scale', 'aria-label': 'Spacing', onchange: (ev) => save({ scale: ev.target.value === 'log' ? 'log' : undefined }) },
    [['linear', 'Linear'], ['log', 'Log']].map(([value, text]) => el('option', { value, text })));
  const input = el('select', { class: 'time-input', 'aria-label': 'Source the sine drives', onchange: (ev) => save({ input: ev.target.value }) });
  const amplitude = field('amplitude', 'Sine amplitude, dBFS', '-6', 'The sine\'s amplitude in dB of full scale');
  const frequency = field('frequency', 'Sine frequency, f/fs', '', 'Input f/fs (1/256, 0.004; 0 for DC); blank: in the band');
  const samples = el('select', { class: 'time-samples', 'aria-label': 'Samples per segment', title: 'Samples per FFT segment; each run is four segments', onchange: (ev) => save({ samples: Number(ev.target.value) }) },
    SEGMENTS.map((n) => el('option', { value: String(n), text: `${n}` })));
  const go = el('button', { type: 'button', class: 'primary-action sweep-run', text: 'Sweep', onclick: () => (running() ? stop() : run()) });
  const bar = el('progress', { class: 'sweep-progress', max: '1', value: '0', hidden: true });
  const status = el('p', { class: 'field-hint sweep-status', 'aria-live': 'polite' });
  const measures = el('div', { class: 'time-nets sweep-measures' });
  const node = el('div', { class: 'sweep-editor' }, [
    el('div', { class: 'signal-flow-swing-controls time-controls' }, [
      controlPair('Sweep', name),
      controlPair('Scale', scale),
      controlPair('From', from),
      controlPair('To', to),
      controlPair('Points', points),
      controlPair('Sine into', input),
      controlPair('Amplitude', amplitude, 'dBFS'),
      controlPair('Frequency', frequency, 'f/fs'),
      controlPair('Samples', samples),
      controlPair('', go),
    ]),
    ...(plot ? [plot] : []),
    measures,
    bar,
    el('div', { class: 'time-actions' }, [status, ...actions]),
  ]);
  let job = null;
  const running = () => !!job;

  function say(text, error = false) {
    status.textContent = text;
    status.classList.toggle('analysis-error', error);
  }

  /** The controls from the settings and the diagram. */
  function fill() {
    const now = settings();
    const names = sweepable();
    name.replaceChildren(...names.map((n) => el('option', { value: n, text: n })));
    const chosen = names.includes(now.name) ? now.name : names[0];
    if (chosen) name.value = chosen;
    const value = chosen ? api.resolvedWith({})[chosen] ?? 1 : 1;
    from.value = now.from || '';
    to.value = now.to || '';
    // Blank: half and twice the value now (0 and 1, when it is 0).
    from.placeholder = String(Number((value ? value / 2 : 0).toPrecision(3)));
    to.placeholder = String(Number((value ? value * 2 : 1).toPrecision(3)));
    points.value = now.points ? String(now.points) : '';
    scale.value = now.scale === 'log' ? 'log' : 'linear';
    const real = realSources();
    input.replaceChildren(...real.map((s) => el('option', { value: s.id, text: s.name })));
    const source = inputOf(now);
    if (source) input.value = source;
    amplitude.value = now.amplitude || '';
    frequency.value = now.frequency || '';
    frequency.placeholder = String(Number(bandFrequency().toPrecision(3)));
    samples.value = String(SEGMENTS.includes(now.samples) ? now.samples : 8192);
    drawMeasures();
  }

  /** The measures, each to tick, in the colors the plot gives them. */
  function drawMeasures() {
    const now = settings();
    const shown = new Set(shownMeasures(now));
    const list = measureList(signals() || signalsOf(now));
    const colors = new Map(list.filter(([key]) => shown.has(key)).map(([key], i) => [key, TRACE_COLORS[i % TRACE_COLORS.length]]));
    measures.replaceChildren(netPicker(list.map(([key, label]) => ({ key, label, checked: shown.has(key), color: colors.get(key) })), (key, on) => {
      const keys = new Set(shownMeasures(settings()));
      if (on) keys.add(key);
      else keys.delete(key);
      save({ measures: list.map(([k]) => k).filter((k) => keys.has(k)), chosen: true });
      drawMeasures();
      onMeasures();
    }));
  }

  function finish() {
    job = null;
    if (busyKey) plotsBusy.set(busyKey, false);
    delete go.dataset.running;
    go.textContent = 'Sweep';
    bar.hidden = true;
  }

  function stop() {
    job?.stop();
  }

  /** Sweep: the held runs again, then the one the fields set. */
  function run() {
    if (running() || !api || !hasSignalFlow(editor.circuit)) return;
    fill();
    const spec = sweepOf(settings());
    if (spec.error) { say(spec.error, true); return; }
    const runs = [...held(), spec.run];
    const total = pointCount(runs);
    const circuit = editor.circuit;
    const told = { name: spec.name, run: spec.run, scheduled: runs.length };
    if (busyKey) plotsBusy.set(busyKey, true);
    go.dataset.running = '1';
    go.textContent = 'Stop';
    bar.hidden = false;
    bar.value = 0;
    say(progressText(runs, 0));
    const started = runSweeps(spec.name, runs, {
      onPoint: (progress) => {
        bar.value = progress.done / progress.total;
        if (progress.done < progress.total) say(progressText(runs, progress.done));
        onProgress({ ...progress, ...told });
      },
    });
    job = started;
    onStart(told);
    started.done.then((outcome) => {
      if (job !== started) return;
      finish();
      if (circuit !== editor.circuit) return;
      say(doneText(outcome, total), !outcome.stopped && !!(outcome.error || outcome.runs.flatMap((r) => r.points).some((p) => p.error)));
      onDone({ ...outcome, ...told });
    });
  }

  /** Stop a sweep unheard (another design is shown). */
  function reset() {
    if (job) {
      const old = job;
      job = null;
      old.stop();
      finish();
    }
    say('');
  }

  return { el: node, fill, drawMeasures, run, stop, reset, running, say };
}

// ----- the Plots window's Sweep view ------------------------------------------------------

let view = null; // { editor, plot, annotate, hold, clear }
// The last sweep run here (runSweeps's result), and those held to draw with it.
let result = null;
let held = [];

const state = () => editor.circuit.windows.sweep || { measures: [] };

function save(change) {
  editor.circuit.windows.sweep = { ...state(), ...change };
  markSettingsChanged();
}

/** The view's element: what it sweeps, its stimulus, Sweep, the plot, the
 *  measures, and Hold, Clear held, and Annotate. */
export function sweepSection() {
  const plot = createPlotView({ fill: true, wheel: 'always', className: 'sweep-plot' });
  const annotateButton = el('button', { type: 'button', class: 'sweep-annotate', text: 'Annotate', title: 'Put the sweep on the drawing', disabled: true, onclick: () => annotate() });
  const holdButton = el('button', { type: 'button', class: 'sweep-hold', text: 'Hold', title: 'Hold', disabled: true, onclick: () => holdSweep() });
  const clearButton = el('button', { type: 'button', class: 'sweep-clear', text: 'Clear held', disabled: true, onclick: () => { held = []; draw(); } });
  const controls = sweepEditor({
    settings: state,
    save,
    plot: plot.el,
    actions: [holdButton, clearButton, annotateButton],
    signals: () => result?.signals || null,
    busyKey: 'sweep',
    onStart: ({ name, run }) => {
      result = { name, xs: sweepValues(run.from, run.to, run.points, run.log), from: run.from, to: run.to, log: run.log, points: [], signals: null, values: { ...api.resolvedWith({}) }, amplitude: run.amplitude, stimulus: run };
      draw();
    },
    onProgress: ({ runs }) => { result = runs.at(-1); draw(); },
    onDone: ({ runs }) => { if (runs.length) result = runs.at(-1); draw(); },
    onMeasures: () => draw(),
  });
  const node = el('div', { class: 'signal-flow-sweep', hidden: true }, [controls.el]);
  view = { el: node, editor: controls, plot, annotate: annotateButton, hold: holdButton, clear: clearButton };
  return node;
}

/** The sweep shown as a data plot. */
const sweepPlot = () => (result ? sweepPlotOf(result, held, shownMeasures(state())) : null);

/** Hold the sweep shown: a copy that stays as the sliders and the next sweep move. */
function holdSweep() {
  if (!result?.points.some((p) => p.measures) || view.editor.running()) return;
  held.push(result);
  draw();
}

function draw() {
  if (!view) return;
  const plot = sweepPlot();
  view.plot.set(plot ? plotSpec(plot) : null);
  view.annotate.disabled = !plot;
  view.hold.disabled = !plot || view.editor.running();
  view.clear.disabled = !held.length;
  view.editor.drawMeasures();
}

/** Run the sweep the view is set to (as its Sweep button does). */
export function sweep() {
  view?.editor.run();
}

/** The sweep shown onto the drawing, as a data plot. */
function annotate() {
  let plot = sweepPlot();
  if (!plot) return;
  const same = held.filter((h) => h.name === result.name);
  plot = normalizePlot({ ...plot, sweep: { name: result.name, measures: shownMeasures(state()), count: plot.traces.length, runs: [...same.map((h) => ({ ...keptRun(h), values: h.values })), keptRun(result)] } });
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

/** The view was shown: its controls, and the last sweep. */
export function showSweep() {
  if (!view) return;
  view.editor.fill();
  draw();
  if (!result && !view.editor.running()) view.editor.say('Pick a coefficient and its range, then Sweep: each point is a full simulation.');
}

// ----- a sweep on the drawing ---------------------------------------------------------------

/** Why a sweep plot (`plot.sweep`) cannot run again now, or null. */
export function sweepPlotProblem(plot) {
  const spec = plot?.sweep;
  if (!spec) return 'it is no sweep';
  if (!api || !hasSignalFlow(editor.circuit)) return 'the drawing has no signal-flow diagram';
  if (!diagramSymbols(editor.circuit).includes(spec.name)) return `the diagram has no ${spec.name}`;
  const sources = new Set(realSources().map((s) => s.id));
  if (spec.runs.some((run) => !sources.has(run.input))) return 'the source its sine drove is gone';
  if (spec.runs.some((run) => !sweepValues(run.from, run.to, run.points, run.log).length)) return 'its range is no longer a sweep';
  return null;
}

/**
 * Sweep `results` (runSweeps's, of a sweep plot's runs: the held ones,
 * then the live one) as the plot's new traces: `{ traces, y?, count }` --
 * the sweep's, colored as `plot`'s were where they are as many, then the
 * plot's traces added since -- or `{ error }`. `measures` the measures to
 * show (the plot's by default).
 */
function sweepTraces(plot, results, measures = plot.sweep.measures) {
  const spec = plot.sweep;
  const live = results.at(-1);
  // Every measure it shows is there to show.
  const keys = new Set(measureList(results.find((r) => r.signals)?.signals).map(([key]) => key));
  if (measures.some((key) => !keys.has(key))) return { error: 'a net it showed the peak of is gone' };
  const next = sweepPlotOf(live, results.slice(0, -1), measures);
  if (!next) return { error: 'its sweep gives no values now' };
  const same = measures.length === spec.measures.length && next.traces.length === spec.count;
  const own = plot.traces.slice(0, spec.count);
  const traces = [...next.traces.map((trace, i) => ({ ...trace, color: (same && own[i]?.color) || trace.color })), ...plot.traces.slice(spec.count)];
  // A plot from before the unit went on the axis had "dB" there: it takes
  // the axis its names now leave the unit to.
  const y = plot.y?.label === 'dB' && next.y.label !== 'dB' ? { ...plot.y, label: next.y.label } : next.y.label !== plot.y?.label ? { ...plot.y, label: next.y.label } : null;
  return { traces, count: next.traces.length, ...(y ? { y } : {}) };
}

/**
 * A sweep plot (`plot.sweep`) run again: each of its sweeps in turn, the
 * held ones at the coefficients they ran at, the live one at those now,
 * over the same range with the same sine. `onPoint(progress)` hears each
 * point (runSweeps's, with `plot`: the plot so far). Returns `{ done, stop()
 * }`; `done` resolves to `{ traces, y?, count }` (sweepTraces), `{ error }`,
 * or `{ stopped }`.
 */
export function sweepPlotUpdate(plot, { onPoint = () => {} } = {}) {
  const problem = sweepPlotProblem(plot);
  if (problem) return { done: Promise.resolve({ error: problem }), stop: () => {} };
  const spec = plot.sweep;
  const job = runSweeps(spec.name, spec.runs, {
    onPoint: (progress) => onPoint({ ...progress, plot: partialPlot(plot, progress.runs) }),
  });
  return {
    stop: job.stop,
    done: job.done.then((outcome) => {
      if (outcome.stopped) return { stopped: true };
      if (outcome.error) return { error: outcome.error };
      const traces = sweepTraces(plot, outcome.runs);
      return traces.error || traces.count === spec.count ? traces : { error: 'its sweep no longer gives every trace it drew' };
    }),
  };
}

/** A sweep plot as its runs so far draw it. */
function partialPlot(plot, runs) {
  const spec = plot.sweep;
  const next = drawnSweep(spec.name, spec.runs.at(-1), runs, spec.runs.length, spec.measures);
  const { view: _view, ...rest } = plot;
  return next ? normalizePlot({ ...rest, traces: [...next.traces, ...plot.traces.slice(spec.count)], ...(next.y ? { y: { ...plot.y, label: next.y.label } } : {}) }) : null;
}

/** The fields but the measures: what a sweep runs. */
const runFields = ({ measures: _measures, chosen: _chosen, ...rest }) => JSON.stringify(rest);

/**
 * The sweep of a plot on the drawing, in its Plot settings: the sweep's
 * editor on what the plot ran, its held sweeps run again first as they
 * were (another coefficient drops them). `onPlot(next, { partial })` hears
 * the sweep's own traces as a sweep runs and once it is done (`{ traces,
 * y, count }`, null while there are none), and `onPlot(null, { stopped })`
 * a sweep stopped, the plot's own to show again. Returns `{ el, changed(),
 * spec(), run(), stop(), running() }`: `changed()` whether the fields
 * differ from what the traces shown ran, `spec()` the plot's `sweep` for
 * them.
 */
export function sweepPlotEditor(plot, { onPlot = () => {}, onDone = () => {} } = {}) {
  const kept = plot.sweep;
  let fields = settingsOfRun(kept.name, kept.measures, kept.runs.at(-1));
  // What the traces shown ran: the plot's own until a sweep here.
  let ran = { spec: kept, fields: JSON.stringify(fields) };
  let lastRuns = null;
  const heldRuns = () => (fields.name === kept.name ? kept.runs.slice(0, -1) : []);
  const controls = sweepEditor({
    settings: () => fields,
    save: (change) => { fields = { ...fields, ...change }; hint(); },
    held: heldRuns,
    signals: () => lastRuns?.find((r) => r.signals)?.signals || null,
    onProgress: ({ runs, name, run, scheduled }) => onPlot(drawnSweep(name, run, runs, scheduled, shownMeasures(fields)), { partial: true }),
    onDone: (outcome) => {
      const complete = !outcome.stopped && !outcome.error && outcome.runs.length === outcome.scheduled;
      const next = complete ? drawnSweep(outcome.name, outcome.run, outcome.runs, outcome.scheduled, shownMeasures(fields)) : null;
      if (next) {
        lastRuns = outcome.runs;
        ran = { spec: { name: outcome.name, measures: shownMeasures(fields), count: next.count, runs: outcome.runs.map(keptRun) }, fields: JSON.stringify(fields) };
        onPlot(next, {});
      } else onPlot(null, { stopped: true });
      hint();
      onDone(outcome);
    },
    onMeasures: () => {
      // Measures the last sweep here measured show at once; others need a sweep.
      if (lastRuns && runFields(fields) === runFields(JSON.parse(ran.fields))) {
        const measures = shownMeasures(fields);
        const next = drawnSweep(ran.spec.name, ran.spec.runs.at(-1), lastRuns, lastRuns.length, measures);
        if (next) {
          ran = { spec: { ...ran.spec, measures, count: next.count }, fields: JSON.stringify(fields) };
          onPlot(next, {});
        }
      }
      hint();
    },
  });
  const note = el('p', { class: 'field-hint sweep-held-note' });
  function hint() {
    const count = heldRuns().length;
    note.textContent = count ? `Sweep runs its ${count} held sweep${count > 1 ? 's' : ''} again first, each at the coefficients it ran at.` : '';
    note.hidden = !count;
    if (!controls?.running()) controls?.say(JSON.stringify(fields) === ran.fields ? 'Sweep runs it again at the coefficients now.' : 'Changed: Apply sweeps first.');
  }
  const node = el('fieldset', { class: 'data-plot-axis sweep-figure' }, [el('legend', { text: 'Sweep' }), controls.el, note]);
  controls.fill();
  hint();
  return {
    el: node,
    changed: () => JSON.stringify(fields) !== ran.fields,
    spec: () => ran.spec,
    run: () => controls.run(),
    stop: () => controls.stop(),
    running: () => controls.running(),
  };
}

/** `deps`: signal-flow-ui.js's `{ flow(), links(), resolvedWith(values), visible() }`. */
export function installSweepPlot(deps) {
  api = deps;
  onDocumentShown(() => {
    result = null;
    held = [];
    if (view) { view.editor.reset(); view.plot.set(null); }
  });
}
