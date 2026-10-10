/**
 * The analysis panel's Bode tab: a relative sketch of the derived transfer
 * function (core/analysis/bode.js). Every g_m starts at one unit, every r_o
 * and resistor at g_m r_o units, capacitors at one unit (loads on the output
 * at ten); sliders scale any of them by ratios, and the plot, its poles and
 * zeros, and their names follow at once. Nothing here solves the circuit
 * again: only the derived coefficients are re-evaluated.
 */

import { PER_DECADE, indexE24, stepE24 } from './e-series.js';
import {
  DEFAULT_INTRINSIC_GAIN, DEFAULT_PARASITIC_RATIO, bodeSketch, evaluateExpression, expressionSymbols, numericCoefficients,
  sketchParameters, sketchValues,
} from '../core/analysis/bode.js';
import { renderExpression } from '../core/analysis/present.js';
import { negate } from '../core/analysis/rational.js';
import { cornerNames } from '../core/bode-figure.js';
import { bodeSpecs } from '../core/plot-spec.js';
import { createPlotView, linkPlots } from './plot-view.js';
import { normalizePlot } from '../core/model.js';
import { texToMathML } from '../core/render.js';
import { editor } from './editor-state.js';
import { commit, markSettingsChanged, render, selectedLabel, setLabelSelection, setSelection } from './main.js';
import { fitView } from './canvas-view.js';
import { logLine } from './status-bar-ui.js';
import { GRID, snap } from '../core/grid.js';

const QUANTITIES = [
  { key: 'transfer', label: 'Voltage gain', tex: 'A_{v}' },
  { key: 'output', label: 'Output impedance', tex: 'Z_{out}' },
  { key: 'input', label: 'Input impedance', tex: 'Z_{in}' },
  { key: 'loop', label: 'Loop gain', tex: 'T' },
];

const KIND_ORDER = ['transconductance', 'resistance', 'capacitance', 'inductance', 'other'];

/** The ratios a document was left at (Circuit#analysisValues.bode): the
 *  sketch opens with them. */
function loadRatios() {
  const saved = editor.circuit.analysisValues?.bode;
  state.intrinsicGain = saved?.intrinsicGain || DEFAULT_INTRINSIC_GAIN;
  state.parasiticRatio = saved?.parasiticRatio || DEFAULT_PARASITIC_RATIO;
  state.multipliers = { ...(saved?.multipliers || {}) };
}

let saveFrame = 0;
/** Keep the ratios with the document, once a frame while a slider moves. */
function saveRatios() {
  if (saveFrame) return;
  saveFrame = requestAnimationFrame(() => {
    saveFrame = 0;
    const defaults = state.intrinsicGain === DEFAULT_INTRINSIC_GAIN && state.parasiticRatio === DEFAULT_PARASITIC_RATIO && !Object.keys(state.multipliers).length;
    editor.circuit.analysisValues.bode = defaults ? null : { intrinsicGain: state.intrinsicGain, parasiticRatio: state.parasiticRatio, multipliers: { ...state.multipliers } };
    markSettingsChanged();
  });
}

/** Ratios chosen so far, by symbol: they outlast a re-analysis. */
const state = {
  quantity: 'transfer',
  withPhase: false,
  intrinsicGain: DEFAULT_INTRINSIC_GAIN,
  parasiticRatio: DEFAULT_PARASITIC_RATIO,
  multipliers: {},
  report: null,
};

const panelEl = () => document.getElementById('analysis-panel-bode');

// ----- steps ---------------------------------------------------------------------

/** A slider's plain readout: ×0.002, ×1, ×500. */
function ratioText(value) {
  return `×${Number(value.toPrecision(3))}`;
}

/** A number as a reader wants it: 3 significant figures, powers of ten when
 *  it is very large or small. */
function formatNumber(value) {
  if (!Number.isFinite(value)) return String(value);
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 1e-2 || magnitude >= 1e4)) {
    let exponent = Math.floor(Math.log10(magnitude));
    let mantissa = Number((value / 10 ** exponent).toPrecision(2));
    // 9.98 rounds to 10: that is the next power.
    if (Math.abs(mantissa) >= 10) {
      mantissa /= 10;
      exponent += 1;
    }
    return `${mantissa}·10^{${exponent}}`;
  }
  return String(Number(value.toPrecision(3)));
}

// ----- the model -------------------------------------------------------------------

function exactOf(report, key) {
  const exact = report?.reports?.[key]?.exact;
  return exact?.numeratorCoefficients && exact?.denominatorCoefficients ? exact : null;
}

/** Whether a report has anything with a frequency to plot. */
function bodeAvailable(report) {
  return QUANTITIES.some(({ key }) => {
    const exact = exactOf(report, key);
    return exact && (exact.numeratorDegree > 0 || exact.denominatorDegree > 0);
  });
}

function outputComponents(report) {
  const netId = report?.outputPort?.netId;
  const net = netId && editor.circuit.nets.get(netId);
  return new Set(net ? net.terminals.map((terminal) => terminal.comp) : []);
}

function currentModel() {
  const report = state.report;
  const exact = exactOf(report, state.quantity);
  if (!exact) return null;
  const symbols = new Set([...exact.numeratorCoefficients, ...exact.denominatorCoefficients]
    .flatMap(({ coefficient }) => [...expressionSymbols(coefficient)]));
  const parameters = sketchParameters(symbols, report.symbolProvenance || {}, { outputComponents: outputComponents(report) });
  const values = sketchValues(parameters, state);
  const sketch = bodeSketch(numericCoefficients(exact.numeratorCoefficients, values), numericCoefficients(exact.denominatorCoefficients, values));
  const corners = cornerNames(sketch.poles, sketch.zeros);
  // A corner whose factor is first order has its exact expression.
  const symbolic = [...(report.reports[state.quantity].poles || []).map((root) => ({ ...root, kind: 'pole' })),
    ...(report.reports[state.quantity].zeros || []).map((root) => ({ ...root, kind: 'zero' }))];
  for (const corner of corners) {
    for (const root of symbolic) {
      if (root.kind !== corner.kind || !root.root || root.order !== 1) continue;
      let value;
      try { value = evaluateExpression(root.root, values); } catch { continue; }
      if (Math.abs(Math.abs(value) - corner.w) <= 1e-6 * corner.w) {
        corner.tex = renderExpression(value < 0 ? negate(root.root) : root.root);
        break;
      }
    }
  }
  const found = QUANTITIES.find((q) => q.key === state.quantity);
  // An ideal opamp's loop is its feedback factor (T = A beta, A infinite).
  const quantity = found.key === 'loop' && report.reports.loop?.infinite ? { ...found, label: 'Feedback factor', tex: '\\beta' } : found;
  return { parameters, values, sketch, corners, quantity };
}

// ----- drawing -----------------------------------------------------------------------

function mathElement(tex, tag = 'span') {
  const element = document.createElement(tag);
  element.className = 'bode-math';
  element.innerHTML = texToMathML(tex);
  return element;
}

function emphasize(components) {
  const next = components.filter(Boolean);
  if (next.join(' ') === editor.equationEmphasis.join(' ')) return;
  editor.equationEmphasis = next;
  render();
}

function slider({ label, tex, index, min, max, text, onInput, components = [], title = '' }) {
  const row = document.createElement('label');
  row.className = 'bode-slider';
  if (title) row.title = title;
  const name = tex ? mathElement(tex) : document.createElement('span');
  if (!tex) name.textContent = label;
  name.classList.add('bode-slider-name');
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = '1';
  input.value = String(index);
  input.setAttribute('aria-label', label);
  const value = document.createElement('span');
  value.className = 'bode-slider-value';
  value.textContent = text(index);
  input.addEventListener('input', () => {
    value.textContent = text(Number(input.value));
    onInput(Number(input.value));
  });
  if (components.length) {
    row.addEventListener('pointerenter', () => emphasize(components));
    row.addEventListener('pointerleave', () => emphasize([]));
    input.addEventListener('focus', () => emphasize(components));
    input.addEventListener('blur', () => emphasize([]));
  }
  row.append(name, input, value);
  return row;
}


// The magnitude and the phase, two plots sharing their frequency axis
// (plot-view.js), kept across redraws so a zoomed view stays while a slider moves.
let plots = null;
function bodePlots() {
  if (!plots) {
    plots = { magnitude: createPlotView({ height: 200, aspect: 0.55 }), phase: createPlotView({ height: 130, aspect: 0.36 }) };
    linkPlots(plots.magnitude, plots.phase);
  }
  return plots;
}

/** Redraw the figure and the corner list; the sliders stay (so a drag goes on). */
function drawSketch() {
  const panel = panelEl();
  const figureHost = panel?.querySelector('.bode-figure-host');
  const list = panel?.querySelector('.bode-corners');
  if (!figureHost || !list) return;
  const model = currentModel();
  figureHost.replaceChildren();
  list.replaceChildren();
  if (!model) {
    figureHost.textContent = 'This quantity has no derived expression to plot.';
    return;
  }
  const { sketch, corners, quantity } = model;
  const specs = bodeSpecs(sketch, { corners, quantity: quantity.tex, ...(quantity.key === 'loop' ? { unityText: 'ω_{c}' } : {}) });
  const views = bodePlots();
  for (const [name, view] of Object.entries(views)) {
    figureHost.appendChild(view.el);
    view.set({ ...specs[name], key: `${specs[name].key}:${quantity.key}:${quantity.tex}` });
  }
  for (const corner of corners) {
    const item = document.createElement('li');
    const where = `${formatNumber(corner.w)}\\,g/C`;
    const name = corner.text.replace('ω', '\\omega');
    const tex = corner.tex ? `${name} = ${corner.tex} \\approx ${where}` : `${name} \\approx ${where}`;
    item.appendChild(mathElement(tex));
    if (corner.rightHalf) item.append(' (right half-plane)');
    if (Math.abs(corner.root.im) > 0) item.append(` (complex pair, Q = ${formatNumber(corner.w / (2 * Math.abs(corner.root.re)))})`);
    list.appendChild(item);
  }
  if (sketch.cancelled) {
    const item = document.createElement('li');
    item.className = 'bode-cancelled';
    item.textContent = `${sketch.cancelled} pole–zero pair${sketch.cancelled === 1 ? '' : 's'} of the exact solution cancel exactly and are left out`;
    list.appendChild(item);
  }
  // A loop gain's crossover, and its phase margin there.
  if (quantity.key === 'loop' && quantity.tex === 'T') {
    const item = document.createElement('li');
    if (sketch.unityGain) {
      let phase = sketch.unityGain.phase % 360;
      if (phase > 0) phase -= 360;
      const margin = 180 + phase;
      item.appendChild(mathElement(`\\omega_{c} \\approx ${formatNumber(sketch.unityGain.w)}\\,g/C,\\ \\text{phase margin } ${Math.round(margin)}\\text{°}`));
      if (margin < 0) item.classList.add('analysis-error');
    } else {
      item.textContent = 'No crossover: |T| does not pass 1 at these ratios.';
    }
    list.appendChild(item);
  }
  // Too large for every symbol, the loop was solved at these ratios' numbers.
  if (quantity.key === 'loop' && state.report.reports?.loop?.numeric) {
    const item = document.createElement('li');
    item.className = 'bode-cancelled';
    item.textContent = 'Too large to solve with every symbol: T was solved at the sketch ratios as they were at the last Analyze; analyze again after moving a slider.';
    list.appendChild(item);
  }
  if (sketch.unityGain && quantity.key === 'transfer') {
    const item = document.createElement('li');
    item.appendChild(mathElement(`\\omega_{u} \\approx ${formatNumber(sketch.unityGain.w)}\\,g/C,\\ \\text{phase there } ${Math.round(sketch.unityGain.phase)}\\text{°}`));
    list.appendChild(item);
  }
}

const selectedPlot = () => (selectedLabel()?.plot ? selectedLabel() : null);

/** Name the place button for what a press does now: update the selected
 *  sketch, or place a new one. The selection changes without a new report. */
export function syncBodePlace(place = panelEl()?.querySelector('.bode-place')) {
  if (!place) return;
  const text = selectedPlot() ? 'Update sketch' : 'Place on drawing';
  if (place.textContent !== text) place.textContent = text;
}

/** Rebuild the tab for a new report (or a new quantity). */
/** The settings came back from undo or redo: draw the sketch at its ratios again. */
export function bodeSettingsRestored() {
  if (state.report) renderBode(state.report);
}

export function renderBode(report) {
  state.report = report || null;
  const panel = panelEl();
  const tab = document.getElementById('analysis-tab-bode');
  const available = bodeAvailable(report);
  if (tab) tab.disabled = !available;
  if (!panel) return available;
  panel.replaceChildren();
  if (!available) return available;
  loadRatios();
  if (!exactOf(report, state.quantity)) state.quantity = QUANTITIES.find(({ key }) => exactOf(report, key))?.key || 'transfer';

  const head = document.createElement('div');
  head.className = 'bode-head';
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Quantity to plot');
  for (const quantity of QUANTITIES) {
    if (!exactOf(report, quantity.key)) continue;
    const option = document.createElement('option');
    option.value = quantity.key;
    option.textContent = quantity.label;
    option.selected = quantity.key === state.quantity;
    select.appendChild(option);
  }
  select.addEventListener('change', () => {
    state.quantity = select.value;
    renderBode(state.report);
  });
  const note = document.createElement('span');
  note.className = 'bode-note';
  note.textContent = 'A relative sketch: each gm starts at one unit g, each capacitor at one unit C (loads on the output at 10), each ro and resistor at gm·ro units. Frequency is in g/C.';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Reset ratios';
  reset.addEventListener('click', () => {
    Object.assign(state, { intrinsicGain: DEFAULT_INTRINSIC_GAIN, parasiticRatio: DEFAULT_PARASITIC_RATIO, multipliers: {} });
    editor.circuit.analysisValues.bode = null;
    markSettingsChanged();
    renderBode(state.report);
  });
  const place = document.createElement('button');
  place.type = 'button';
  place.className = 'bode-place';
  place.title = 'A textbook sketch of this plot on the drawing: no numbers, the corners named. With a sketch selected, this updates it.';
  syncBodePlace(place);
  place.addEventListener('click', () => placeSketch(selectedPlot()));
  const phaseToggle = document.createElement('label');
  phaseToggle.className = 'bode-phase-toggle';
  const phaseBox = document.createElement('input');
  phaseBox.type = 'checkbox';
  phaseBox.checked = state.withPhase;
  phaseBox.addEventListener('change', () => { state.withPhase = phaseBox.checked; });
  phaseToggle.append(phaseBox, ' with phase');
  head.append(select, reset);
  const placeRow = document.createElement('div');
  placeRow.className = 'bode-head';
  placeRow.append(place, phaseToggle);
  const figureHost = document.createElement('div');
  figureHost.className = 'bode-figure-host';
  const corners = document.createElement('ul');
  corners.className = 'bode-corners';
  const sliders = document.createElement('div');
  sliders.className = 'bode-sliders';
  panel.append(head, note, figureHost, placeRow, corners, sliders);

  const model = currentModel();
  // The one ratio every MOS design has.
  sliders.appendChild(slider({
    label: 'Intrinsic gain g_m r_o', tex: 'g_{m} r_{o}', index: indexE24(state.intrinsicGain), min: 0, max: 4 * PER_DECADE,
    text: (i) => String(stepE24(i)), title: 'Every r_o (and resistor) starts at this many units of 1/g',
    onInput: (i) => { state.intrinsicGain = stepE24(i); saveRatios(); drawSketch(); },
  }));
  if (model?.parameters.some((parameter) => parameter.parasitic)) {
    sliders.appendChild(slider({
      label: 'Parasitic capacitance', tex: 'C_{par}/C', index: indexE24(state.parasiticRatio), min: -2 * PER_DECADE, max: PER_DECADE,
      text: (i) => String(stepE24(i)), title: 'Every MOS C_gs and C_gd, in units of C',
      onInput: (i) => { state.parasiticRatio = stepE24(i); saveRatios(); drawSketch(); },
    }));
  }
  const own = [...(model?.parameters || [])].filter((parameter) => !parameter.parasitic)
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const parameter of own) {
    sliders.appendChild(slider({
      label: parameter.name,
      tex: parameter.tex,
      index: indexE24(state.multipliers[parameter.name] ?? 1),
      min: -3 * PER_DECADE,
      max: 3 * PER_DECADE,
      text: (i) => ratioText(stepE24(i)),
      components: [parameter.component],
      title: parameter.load ? 'A load on the output: starts at 10 units' : '',
      onInput: (i) => {
        const value = stepE24(i);
        if (value === 1) delete state.multipliers[parameter.name];
        else state.multipliers[parameter.name] = value;
        saveRatios();
        drawSketch();
      },
    }));
  }
  drawSketch();
  return available;
}

/** The sketch as it stands, as a plot annotation's data (model.js normalizePlot). */
function currentPlotData() {
  const model = currentModel();
  if (!model) return null;
  const { sketch, corners, quantity } = model;
  // Twenty samples a decade are plenty on paper.
  const points = sketch.points.filter((_, index) => index % 2 === 0 || index === sketch.points.length - 1);
  return {
    range: sketch.range,
    points,
    asymptote: sketch.asymptote,
    corners: corners.map((corner) => ({ w: corner.w, text: corner.text })),
    unityGain: quantity.key === 'transfer' || quantity.key === 'loop' ? sketch.unityGain : null,
    quantity: quantity.tex,
    phase: state.withPhase,
  };
}

/** Put the sketch on the drawing, right of what is there -- or, with a plot
 *  annotation selected, redraw that one in place. One undo entry. */
function placeSketch(existing) {
  const plot = currentPlotData();
  if (!plot) return;
  let placed = existing;
  commit(() => {
    if (existing) {
      existing.plot = normalizePlot(plot);
      editor.circuit.invalidateRoutingCache();
      return;
    }
    const bounds = editor.circuit.inkBounds();
    const empty = !editor.circuit.components.size && !editor.circuit.labels.size;
    const x = empty ? 0 : snap(bounds.x + bounds.w + 2 * GRID);
    const y = empty ? 0 : snap(bounds.y);
    const w = 16 * GRID;
    const h = (plot.phase ? 14 : 10) * GRID;
    placed = editor.circuit.addAnnotation('box', { x, y, end: { x: x + w, y: y + h }, plot, style: { lineStyle: 'solid' } });
  });
  if (!placed) return;
  setSelection([]);
  setLabelSelection([placed.id]);
  if (!existing) fitView({ animate: true });
  logLine(existing ? 'updated the Bode sketch' : 'placed a Bode sketch on the drawing; drag to move it, its corners to resize');
  renderBode(state.report);
  render();
}
