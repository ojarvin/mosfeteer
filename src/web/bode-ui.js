/**
 * The analysis panel's Bode tab: a relative sketch of the derived transfer
 * function (core/analysis/bode.js). Every g_m starts at one unit, every r_o
 * and resistor at g_m r_o units, capacitors at one unit (loads on the output
 * at ten); sliders scale any of them by ratios, and the plot, its poles and
 * zeros, and their names follow at once. Nothing here solves the circuit
 * again: only the derived coefficients are re-evaluated.
 */

import {
  DEFAULT_INTRINSIC_GAIN, DEFAULT_PARASITIC_RATIO, bodeSketch, evaluateExpression, expressionSymbols, numericCoefficients,
  sketchParameters, sketchValues,
} from '../core/analysis/bode.js';
import { renderExpression } from '../core/analysis/present.js';
import { negate } from '../core/analysis/rational.js';
import { bodeFigure, cornerNames } from '../core/bode-figure.js';
import { normalizePlot, parseLabelRuns } from '../core/model.js';
import { texToMathML } from '../core/render.js';
import { editor } from './editor-state.js';
import { commit, render, selectedLabel, setLabelSelection, setSelection } from './main.js';
import { fitView } from './canvas-view.js';
import { logLine } from './status-bar-ui.js';
import { GRID, snap } from '../core/grid.js';

const QUANTITIES = [
  { key: 'transfer', label: 'Voltage gain', tex: 'A_{v}' },
  { key: 'output', label: 'Output impedance', tex: 'Z_{out}' },
  { key: 'input', label: 'Input impedance', tex: 'Z_{in}' },
];

const KIND_ORDER = ['transconductance', 'resistance', 'capacitance', 'inductance', 'other'];

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

/** 1-2-5 per decade, `index` 0 being 1. */
function step125(index) {
  const decade = Math.floor(index / 3);
  return [1, 2, 5][((index % 3) + 3) % 3] * 10 ** decade;
}

function index125(value) {
  const decade = Math.floor(Math.log10(value) + 1e-9);
  const mantissa = value / 10 ** decade;
  return decade * 3 + (mantissa >= 4.9 ? 2 : mantissa >= 1.9 ? 1 : 0);
}

/** 1-2-3-5 per decade, for g_m r_o (30 is a common starting point). */
function step1235(index) {
  const decade = Math.floor(index / 4);
  return [1, 2, 3, 5][((index % 4) + 4) % 4] * 10 ** decade;
}

function index1235(value) {
  const decade = Math.floor(Math.log10(value) + 1e-9);
  const mantissa = value / 10 ** decade;
  return decade * 4 + (mantissa >= 4.9 ? 3 : mantissa >= 2.9 ? 2 : mantissa >= 1.9 ? 1 : 0);
}

/** A slider's plain readout: ×0.002, ×1, ×500. */
function ratioText(value) {
  return `×${Number(value.toPrecision(3))}`;
}

/** A number as a reader wants it: 3 significant figures, powers of ten when
 *  it is very large or small. */
export function formatNumber(value) {
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
export function bodeAvailable(report) {
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
  return { parameters, values, sketch, corners, quantity: QUANTITIES.find((q) => q.key === state.quantity) };
}

// ----- drawing -----------------------------------------------------------------------

const SVG = 'http://www.w3.org/2000/svg';

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

/** `ω_{p1}`, `10^{-3}` as text with real sub- and superscripts. */
function markupText(element, text) {
  for (const run of parseLabelRuns(text)) {
    const span = svgElement('tspan', run.sub ? { 'baseline-shift': 'sub', 'font-size': '72%' } : run.super ? { 'baseline-shift': 'super', 'font-size': '72%' } : {});
    span.textContent = run.text;
    element.appendChild(span);
  }
}

/** The figure (core/bode-figure.js) as an SVG in the theme's colors. */
export function figureElement(figure) {
  const svg = svgElement('svg', { viewBox: `0 0 ${figure.width} ${figure.height}`, class: 'bode-figure', role: 'img' });
  for (const item of figure.items) {
    const cls = `bode-${item.role}`;
    if (item.type === 'line') svg.appendChild(svgElement('line', { x1: item.x1, y1: item.y1, x2: item.x2, y2: item.y2, class: cls }));
    else if (item.type === 'path' && item.points.length) {
      svg.appendChild(svgElement('polyline', { points: item.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '), class: cls }));
    } else if (item.type === 'dot') svg.appendChild(svgElement('circle', { cx: item.x, cy: item.y, r: 2.5, class: cls }));
    else if (item.type === 'text') {
      const text = svgElement('text', { x: item.x, y: item.y, 'text-anchor': item.anchor, class: cls });
      markupText(text, item.text);
      svg.appendChild(text);
    }
  }
  return svg;
}

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
  figureHost.appendChild(figureElement(bodeFigure(sketch, { width: 480, height: 300, corners, quantity: quantity.tex })));
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
  if (sketch.unityGain && quantity.key === 'transfer') {
    const item = document.createElement('li');
    item.appendChild(mathElement(`\\omega_{u} \\approx ${formatNumber(sketch.unityGain.w)}\\,g/C,\\ \\text{phase there } ${Math.round(sketch.unityGain.phase)}\\text{°}`));
    list.appendChild(item);
  }
}

/** Rebuild the tab for a new report (or a new quantity). */
export function renderBode(report) {
  state.report = report || null;
  const panel = panelEl();
  const tab = document.getElementById('analysis-tab-bode');
  const available = bodeAvailable(report);
  if (tab) tab.disabled = !available;
  if (!panel) return available;
  panel.replaceChildren();
  if (!available) return available;
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
    renderBode(state.report);
  });
  const place = document.createElement('button');
  place.type = 'button';
  place.className = 'bode-place';
  const selectedPlot = () => (selectedLabel()?.plot ? selectedLabel() : null);
  place.textContent = selectedPlot() ? 'Update sketch' : 'Place on drawing';
  place.title = 'A textbook sketch of this plot on the drawing: no numbers, the corners named. With a sketch selected, this updates it.';
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
    label: 'Intrinsic gain g_m r_o', tex: 'g_{m} r_{o}', index: index1235(state.intrinsicGain), min: 0, max: 16,
    text: (i) => String(step1235(i)), title: 'Every r_o (and resistor) starts at this many units of 1/g',
    onInput: (i) => { state.intrinsicGain = step1235(i); drawSketch(); },
  }));
  if (model?.parameters.some((parameter) => parameter.parasitic)) {
    sliders.appendChild(slider({
      label: 'Parasitic capacitance', tex: 'C_{par}/C', index: index125(state.parasiticRatio), min: -6, max: 3,
      text: (i) => String(Number(step125(i).toPrecision(3))), title: 'Every MOS C_gs and C_gd, in units of C',
      onInput: (i) => { state.parasiticRatio = step125(i); drawSketch(); },
    }));
  }
  const own = [...(model?.parameters || [])].filter((parameter) => !parameter.parasitic)
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const parameter of own) {
    sliders.appendChild(slider({
      label: parameter.name,
      tex: parameter.tex,
      index: index125(state.multipliers[parameter.name] ?? 1),
      min: -9,
      max: 9,
      text: (i) => ratioText(step125(i)),
      components: [parameter.component],
      title: parameter.load ? 'A load on the output: starts at 10 units' : '',
      onInput: (i) => {
        const value = step125(i);
        if (value === 1) delete state.multipliers[parameter.name];
        else state.multipliers[parameter.name] = value;
        drawSketch();
      },
    }));
  }
  drawSketch();
  return available;
}

/** The sketch as it stands, as a plot annotation's data (model.js normalizePlot). */
export function currentPlotData() {
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
    unityGain: quantity.key === 'transfer' ? sketch.unityGain : null,
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
