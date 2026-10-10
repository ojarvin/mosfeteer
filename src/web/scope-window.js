/**
 * The oscilloscope: a signal-flow diagram's nets in time, in a window of
 * their own. A sine of the amplitude (dBFS) and frequency (f/fs) set here
 * drives one source, the diagram runs at the coefficients' numbers
 * (core/analysis/simulate.js, the swing's simulation, dither included),
 * and the nets checked show as waveforms over the samples run -- a
 * sampled net held through each period, a continuous one between samples
 * as well. The plot is the analysis windows' one (plot-view.js), the
 * plain wheel zooming here: a flat right-drag zooms time alone, a tall one
 * the values alone.
 *
 * It runs again as the coefficients move and as its settings change. What
 * it shows and how it drives the diagram are saved with the design
 * (`Circuit#windows.scope`). `Shift+W` (W for waveforms) shows or hides it.
 */

import { prepareSimulation } from '../core/analysis/simulate.js';
import { TRACE_COLORS, diagramSymbols, hasSignalFlow, signalFlowGraph } from '../core/analysis/signal-flow.js';
import { swingTestFrequency } from '../core/analysis/optimize.js';
import { texToMathML } from '../core/render.js';
import { canvasEl } from './elements.js';
import { editor } from './editor-state.js';
import { floatingWindow } from './floating-window.js';
import { markSettingsChanged, onDocumentShown } from './main.js';
import { createPlotView } from './plot-view.js';

let api = null; // { flow(), resolved() } from the signal-flow window
let win = null;
let timer = 0;
const colors = new Map(); // net key -> its colour while shown

const state = () => editor.circuit.windows.scope || { nets: [] };

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== false && value !== null && value !== undefined) node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children);
  return node;
}

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

function build() {
  const close = el('button', { type: 'button', class: 'floating-window-close', 'aria-label': 'Close the oscilloscope', title: 'Close (Shift+W)', text: '×' });
  const plot = createPlotView({ fill: true, wheel: 'always', className: 'scope-plot' });
  const input = el('select', { class: 'scope-input', 'aria-label': 'Source the sine drives', onchange: (ev) => save({ input: ev.target.value }) });
  const amplitude = el('input', { type: 'text', class: 'scope-field', 'aria-label': 'Sine amplitude, dBFS', placeholder: '-6', title: 'The sine\'s amplitude in dB of full scale', onchange: (ev) => save({ amplitude: ev.target.value.trim() }) });
  const frequency = el('input', { type: 'text', class: 'scope-field', 'aria-label': 'Sine frequency, f/fs', title: 'f/fs (1/64, 0.01); blank: the middle of the signal band', onchange: (ev) => save({ frequency: ev.target.value.trim() }) });
  const samples = el('select', { class: 'scope-samples', 'aria-label': 'Samples to run', onchange: (ev) => save({ samples: Number(ev.target.value) }) },
    [256, 1024, 4096, 16384].map((n) => el('option', { value: String(n), text: `${n}` })));
  const status = el('p', { class: 'field-hint scope-status', 'aria-live': 'polite' });
  const nets = el('div', { class: 'scope-nets' });
  const node = el('section', { class: 'floating-window scope-window', 'aria-labelledby': 'scope-title', hidden: true }, [
    el('header', { class: 'floating-window-header' }, [el('h2', { id: 'scope-title', class: 'floating-window-title', text: 'Oscilloscope' }), close]),
    el('div', { class: 'scope-body' }, [
      el('div', { class: 'scope-controls' }, [
        el('label', { text: 'Sine into' }), input,
        el('label', { text: 'at' }), amplitude, el('label', { text: 'dBFS,' }),
        frequency, el('label', { text: 'f/fs,' }),
        samples, el('label', { text: 'samples' }),
      ]),
      plot.el,
      nets,
      status,
    ]),
  ]);
  node.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Escape' && ev.target.tagName !== 'INPUT') hide();
  });
  canvasEl.closest('.canvas-pane').append(node);
  const chrome = floatingWindow(node, { key: 'scope', onClose: hide, resizable: true });
  win = { el: node, plot, input, amplitude, frequency, samples, status, nets, chrome };
}

/** The controls from the design's settings, and the diagram's sources and nets. */
function fill(sim) {
  const settings = state();
  const { sources } = signalFlowGraph(editor.circuit);
  const real = sources.filter((s) => !s.quantizer && !s.dither);
  win.input.replaceChildren(...real.map((s) => el('option', { value: s.id, text: s.name })));
  const chosen = real.find((s) => s.id === settings.input) || real.find((s) => s.id === api?.flow().swingInput) || real[0];
  if (chosen) win.input.value = chosen.id;
  win.amplitude.value = settings.amplitude || '';
  win.frequency.value = settings.frequency || '';
  win.frequency.placeholder = String(Number(swingTestFrequency({ frequency: '' }, editor.circuit.analysisValues.band).toPrecision(3)));
  win.samples.value = String(settings.samples || 1024);
  if (!sim) { win.nets.replaceChildren(); return; }
  const shown = new Set(shownKeys(sim));
  win.nets.replaceChildren(...sim.signals.map((signal) => {
    const check = el('input', { type: 'checkbox', 'aria-label': `Show ${signal.name}` });
    check.checked = shown.has(signal.key);
    check.addEventListener('change', () => {
      const keys = new Set(shownKeys(sim));
      if (check.checked) keys.add(signal.key);
      else keys.delete(signal.key);
      save({ nets: sim.signals.map((s) => s.key).filter((key) => keys.has(key)), chosen: true });
    });
    const name = el('span', { class: 'scope-net-name' });
    name.innerHTML = texToMathML(signal.name);
    const color = colors.get(signal.key);
    if (check.checked && color) name.style.color = color;
    return el('label', { class: 'scope-net', title: signal.domain === 's' ? 'continuous' : 'sampled' }, [check, ...(check.checked && color ? [el('span', { class: 'signal-flow-swatch', style: `background:${color}` })] : []), name]);
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
  if (scopeShown()) timer = setTimeout(run, 60);
}

/** Run the diagram and draw what it gives. */
function run() {
  if (!scopeShown() || !api) return;
  const settings = state();
  const say = (text, error = false) => { win.status.textContent = text; win.status.classList.toggle('analysis-error', error); };
  if (!hasSignalFlow(editor.circuit)) {
    fill(null);
    win.plot.set(null);
    say('The oscilloscope shows a signal-flow diagram\'s nets: draw one (H(s), H(z), sums, gains, quantizers).');
    return;
  }
  const numbers = api.resolved();
  const values = Object.fromEntries(diagramSymbols(editor.circuit).map((name) => [name, numbers[name] ?? 1]));
  const { sources } = signalFlowGraph(editor.circuit);
  const real = sources.filter((s) => !s.quantizer && !s.dither);
  const input = (real.find((s) => s.id === settings.input) || real.find((s) => s.id === api.flow().swingInput) || real[0])?.id || '';
  const frequency = settings.frequency ? typedFraction(settings.frequency) : swingTestFrequency({ frequency: '' }, editor.circuit.analysisValues.band);
  const samples = settings.samples || 1024;
  const sim = prepareSimulation(editor.circuit, {
    values, sources: api.flow().sources, input, output: api.flow().output, frequency, samples, warmup: Math.min(samples, 1024), dither: api.flow().dither,
  });
  if (!sim.ok) {
    fill(null);
    win.plot.set(null);
    say(sim.error, true);
    return;
  }
  const keys = shownKeys(sim);
  const used = new Set();
  for (const key of keys) {
    let color = colors.get(key);
    if (!color || used.has(color)) color = TRACE_COLORS.find((c) => !used.has(c)) || TRACE_COLORS[0];
    colors.set(key, color);
    used.add(color);
  }
  fill(sim);
  const indices = keys.map((key) => sim.signals.findIndex((s) => s.key === key)).filter((i) => i >= 0);
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
  win.plot.set({
    key: 'scope',
    title: 'Waveforms',
    x: { scale: 'linear', label: 'n (t/T_{s})', range: [0, Math.max(1, samples - 1)] },
    y: { scale: 'linear', label: 'value', include: [0] },
    series,
    vlines: [],
    hlines: [{ y: 0, role: 'zero' }, ...(sim.fullScale ? [{ y: sim.fullScale, role: 'band' }, { y: -sim.fullScale, role: 'band' }] : [])],
  });
  const cycles = sim.frequency * samples;
  say(`${result.overloaded ? 'The loop ran away: shown up to there. ' : ''}A ${amplitude} dBFS sine at f/fs = ${Number(sim.frequency.toPrecision(4))} (${Math.round(cycles)} cycles in ${samples} samples, after ${Math.min(samples, 1024)} to settle); full scale ±${sim.fullScale}.`, result.overloaded);
}

function syncButton() {
  document.getElementById('btn-window-scope')?.setAttribute('aria-checked', String(scopeShown()));
}

export function scopeShown() {
  return !!win && !win.el.hidden;
}

function show() {
  if (!win) build();
  win.el.hidden = false;
  win.chrome.place();
  syncButton();
  run();
}

function hide() {
  if (!win || win.el.hidden) return;
  win.el.hidden = true;
  syncButton();
  canvasEl.focus({ preventScroll: true });
}

/** Shift+W: show or hide the oscilloscope. */
export function toggleScope() {
  if (scopeShown()) hide();
  else show();
}

/** The coefficients or the diagram moved: run again. */
export function scopeChanged() {
  schedule();
}

/** `deps`: the signal-flow window's `{ flow(), resolved() }`. */
export function installScope(deps) {
  api = deps;
  document.getElementById('btn-window-scope')?.addEventListener('click', toggleScope);
  onDocumentShown(() => {
    colors.clear();
    win?.plot.set(null);
    schedule();
  });
}
