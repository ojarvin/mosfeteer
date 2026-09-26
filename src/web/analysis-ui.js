/**
 * The small-signal analysis dock: its form and remembered settings, running
 * the analysis, the equations, log, netlist, and model tabs, picking a
 * target on the canvas, and annotating results into the drawing. The form's
 * option rules are in analysis-options.js and analysis-state.js.
 */

import { INTERFACE_PIN_TYPES, parseLabelRuns } from '../core/model.js';
import { analyzeSmallSignalV2 } from '../core/analysis/engine.js';
import { EQUATION_GROUPS, adaptCombinedReport } from '../core/analysis/report-adapter.js';
import { smallSignalSchematic } from '../core/analysis/model-schematic.js';
import { svgString, texToMathML } from '../core/render.js';
import { componentsOfSymbols } from '../core/analysis/provenance.js';
import { noiseCandidates } from '../core/analysis/noise.js';
import { snap, GRID } from '../core/grid.js';
import { analysisNoiseRequest, analysisOptionDefaults, migrateAnalysisFormState, normalizeAnalysisOptions } from './analysis-options.js';
import { analysisFormDefaults, analysisFormStorageKey, analysisNetOptionText, formatAnalysisDeviceRegions, pruneAnalysisDeviceRegions, pruneAnalysisNetValues } from './analysis-state.js';
import { canvasEl, analysisButton, analysisDialog, analysisForm, analysisTarget, analysisReference, analysisInput, analysisAcGrounds, analysisDeviceRegions, analysisApproxRo, analysisApproxBody, analysisApproxMiller, analysisParasitics, analysisApproxGmRo, analysisApproxDominantPole, analysisNameSubexpressions, analysisNoiseThermal, analysisNoiseFlicker, analysisNoiseSources, analysisResult, analysisEquation, analysisDetails, analysisNetlistPanel, analysisNetlist, analysisModelPanel, analysisModelEl, analysisModelOpen, analysisCancel, analysisAnnotate } from './elements.js';
import { logLine, renderStatus } from './status-bar-ui.js';
import { fitView } from './canvas-view.js';
import { editor } from './editor-state.js';
import { commit, namedGroupNets, nearestTerminal, pickWire, render, selectedComps, setLabelSelection, sortedComps, visibleNets } from './main.js';

const analysisTransferInputs = [...document.querySelectorAll('[data-transfer-function]')];

const analysisTabButtons = [...document.querySelectorAll('[data-analysis-tab]')];

const analysisTabPanels = new Map([...document.querySelectorAll('.analysis-tab-panel')]
  .map((panel) => [panel.id.replace(/^analysis-panel-/, ''), panel]));

function setAnalysisResultTab(name = 'equations') {
  const requested = analysisTabPanels.has(name) ? name : 'equations';
  for (const button of analysisTabButtons) {
    const active = button.dataset.analysisTab === requested;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  }
  for (const [key, panel] of analysisTabPanels) panel.hidden = key !== requested;
}

/** One checkbox per device that can carry a noise generator, all checked. */
function fillNoiseSources() {
  if (!analysisNoiseSources) return;
  analysisNoiseSources.replaceChildren(...noiseCandidates(editor.circuit).map((refdes) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    input.dataset.noiseSource = refdes;
    label.append(input, ` ${refdes}`);
    return label;
  }));
}

function noiseSourceInputs() {
  return analysisNoiseSources ? [...analysisNoiseSources.querySelectorAll('[data-noise-source]')] : [];
}

/** Null while every device is checked, so devices drawn later join in. */
function checkedNoiseSources() {
  const inputs = noiseSourceInputs();
  return inputs.every((input) => input.checked) ? null : inputs.filter((input) => input.checked).map((input) => input.dataset.noiseSource);
}

function setNoiseInputs(options) {
  if (analysisNoiseThermal) analysisNoiseThermal.checked = options.noiseThermal;
  if (analysisNoiseFlicker) analysisNoiseFlicker.checked = options.noiseFlicker;
  for (const input of noiseSourceInputs()) input.checked = !options.noiseSources || options.noiseSources.includes(input.dataset.noiseSource);
  syncNoiseSourcesVisibility();
}

function syncNoiseSourcesVisibility() {
  if (analysisNoiseSources) analysisNoiseSources.hidden = !analysisNoiseThermal?.checked && !analysisNoiseFlicker?.checked;
}

function portNetIds(nets, type, role) {
  return nets
    .filter((net) => net.terminals?.some((terminal) => {
      const component = editor.circuit.components.get(terminal.comp);
      return component?.type === type || component?.analysis?.role === role;
    }))
    .map((net) => net.id);
}

function fillAnalysisDialog(targetNetId) {
  if (!analysisTarget || !analysisReference) return;
  const nets = visibleNets();
  const defaults = analysisFormDefaults(nets, {
    targetNetId,
    componentInputNetIds: portNetIds(nets, 'input', 'input'),
    componentOutputNetIds: portNetIds(nets, 'output', 'output'),
  });
  analysisTarget.replaceChildren();
  for (const net of nets) {
    const option = document.createElement('option');
    option.value = net.id;
    option.textContent = analysisNetOptionText(net);
    analysisTarget.appendChild(option);
  }
  if (defaults.target) analysisTarget.value = defaults.target;

  analysisReference.replaceChildren();
  const automatic = document.createElement('option');
  automatic.value = '';
  automatic.textContent = 'Automatic AC reference (marker group)';
  analysisReference.appendChild(automatic);
  for (const net of nets) {
    const option = document.createElement('option');
    option.value = net.id;
    option.textContent = analysisNetOptionText(net);
    analysisReference.appendChild(option);
  }

  if (analysisInput) {
    analysisInput.replaceChildren();
    for (const net of nets) {
      const option = document.createElement('option');
      option.value = net.id;
      option.textContent = analysisNetOptionText(net);
      analysisInput.appendChild(option);
    }
    if (defaults.input) analysisInput.value = defaults.input;
  }
  fillNoiseSources();
  return defaults;
}

function parseAnalysisList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

let latestAnalysisReport = null;

export function clearLatestAnalysisResult() {
  latestAnalysisReport = null;
  if (analysisResult) {
    analysisResult.hidden = true;
    if (analysisEquation) analysisEquation.replaceChildren();
    if (analysisDetails) analysisDetails.textContent = '';
    if (analysisNetlist) analysisNetlist.textContent = '';
    if (analysisNetlistPanel) analysisNetlistPanel.hidden = true;
  }
  if (analysisAnnotate) analysisAnnotate.hidden = true;
}

function analysisFormOptions() {
  return normalizeAnalysisOptions({
    neglectBodyEffect: !!analysisApproxBody?.checked,
    millerApproximation: !!analysisApproxMiller?.checked,
    parasitics: !!analysisParasitics?.checked,
    highIntrinsicGain: !!analysisApproxGmRo?.checked,
    neglectChannelLengthModulation: !!analysisApproxRo?.checked,
    dominantPole: !!analysisApproxDominantPole?.checked,
    nameSubexpressions: !!analysisNameSubexpressions?.checked,
    transferFunctions: analysisTransferInputs.filter((input) => input.checked).map((input) => input.dataset.transferFunction),
    deviceRegions: analysisDeviceRegions?.value || '',
    noiseThermal: !!analysisNoiseThermal?.checked,
    noiseFlicker: !!analysisNoiseFlicker?.checked,
    noiseSources: checkedNoiseSources(),
  });
}

function analysisFormValues() {
  const { deviceRegions = {}, ...options } = analysisFormOptions();
  return {
    input: analysisInput?.value || '',
    output: analysisTarget?.value || '',
    reference: analysisReference?.value || '',
    acGrounds: analysisAcGrounds?.value || '',
    deviceRegions,
    options,
    annotationExcluded: [...annotationExcluded],
    collapsedGroups: [...collapsedGroups],
  };
}

// Result-panel choices that outlive one derivation: rows left out of the
// annotation, and groups folded away. Keyed by row title and group id.
let annotationExcluded = new Set();
let collapsedGroups = new Set();

function analysisDeviceOptions() {
  const devices = {};
  for (const component of sortedComps()) {
    if (!['nmos', 'pmos', 'nmosb', 'pmosb'].includes(component.type)) continue;
    const source = component.analysis || {};
    const options = {};
    if (typeof source.ignoreBodyEffect === 'boolean') options.neglectBodyEffect = source.ignoreBodyEffect;
    if (typeof source.gmroLarge === 'boolean') options.highIntrinsicGain = source.gmroLarge;
    if (source.channelLengthModulation === 'ignore') options.neglectChannelLengthModulation = true;
    if (source.channelLengthModulation === 'finite') options.neglectChannelLengthModulation = false;
    if (Object.keys(options).length) devices[component.refdes] = options;
  }
  return devices;
}

export function migrateAnalysisFormStorage(previousName, nextName) {
  if (previousName === nextName) return;
  try {
    const fromKey = analysisFormStorageKey(previousName);
    const toKey = analysisFormStorageKey(nextName);
    const saved = localStorage.getItem(fromKey);
    if (saved && !localStorage.getItem(toKey)) localStorage.setItem(toKey, saved);
    if (saved) localStorage.removeItem(fromKey);
  } catch { /* storage unavailable */ }
}

/** Analysis settings belong to one document file; an unsaved document uses the "new" scope. */
export function analysisFormScope() {
  return editor.currentDocumentPath || '';
}

function persistAnalysisForm() {
  try { localStorage.setItem(analysisFormStorageKey(analysisFormScope()), JSON.stringify(analysisFormValues())); } catch { /* storage unavailable */ }
}

function restoreAnalysisForm(defaults = {}) {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(analysisFormStorageKey(analysisFormScope())) || 'null'); } catch { /* storage unavailable */ }
  if (!saved) {
    const options = analysisOptionDefaults();
    if (analysisReference) analysisReference.value = '';
    if (analysisAcGrounds) analysisAcGrounds.value = '';
    if (analysisDeviceRegions) analysisDeviceRegions.value = '';
    if (analysisApproxRo) analysisApproxRo.checked = options.neglectChannelLengthModulation;
    if (analysisApproxBody) analysisApproxBody.checked = options.neglectBodyEffect;
    if (analysisApproxMiller) analysisApproxMiller.checked = options.millerApproximation;
    if (analysisParasitics) analysisParasitics.checked = options.parasitics;
    if (analysisApproxGmRo) analysisApproxGmRo.checked = options.highIntrinsicGain;
    if (analysisApproxDominantPole) analysisApproxDominantPole.checked = options.dominantPole;
    if (analysisNameSubexpressions) analysisNameSubexpressions.checked = options.nameSubexpressions;
    setAnalysisTransferInputs(options.transferFunctions);
    setNoiseInputs(options);
    annotationExcluded = new Set();
    collapsedGroups = new Set();
    return false;
  }
  const { state, diagnostics } = migrateAnalysisFormState(saved);
  for (const diagnostic of diagnostics) logLine(diagnostic.message, diagnostic.severity === 'error' ? 'error' : 'status');
  const setSelect = (el, value, force = false) => {
    if (!el || !value || ![...el.options].some((option) => option.value === value)) return;
    if (!force && value === '') return;
    el.value = value;
  };
  setSelect(analysisTarget, defaults.targetMarked ? defaults.target : state.output);
  setSelect(analysisReference, state.reference);
  setSelect(analysisInput, defaults.inputMarked ? defaults.input : state.input);
  if (analysisAcGrounds) analysisAcGrounds.value = pruneAnalysisNetValues(state.acGrounds, visibleNets());
  if (analysisDeviceRegions) {
    analysisDeviceRegions.value = formatAnalysisDeviceRegions(pruneAnalysisDeviceRegions(
      state.deviceRegions,
      sortedComps().map((component) => component.refdes),
    ));
  }
  if (analysisApproxRo) analysisApproxRo.checked = state.options.neglectChannelLengthModulation;
  if (analysisApproxBody) analysisApproxBody.checked = state.options.neglectBodyEffect;
  if (analysisApproxMiller) analysisApproxMiller.checked = state.options.millerApproximation;
  if (analysisParasitics) analysisParasitics.checked = state.options.parasitics;
  if (analysisApproxGmRo) analysisApproxGmRo.checked = state.options.highIntrinsicGain;
  if (analysisApproxDominantPole) analysisApproxDominantPole.checked = state.options.dominantPole;
  if (analysisNameSubexpressions) analysisNameSubexpressions.checked = state.options.nameSubexpressions;
  setAnalysisTransferInputs(state.options.transferFunctions);
  setNoiseInputs(state.options);
  annotationExcluded = new Set(state.annotationExcluded);
  collapsedGroups = new Set(state.collapsedGroups);
  return true;
}

function setAnalysisTransferInputs(names) {
  for (const input of analysisTransferInputs) input.checked = names.includes(input.dataset.transferFunction);
}

function prefillAnalysisAttributes() {
  const markedGrounds = visibleNets()
    .filter((net) => net.analysis?.acGround || net.analysis?.role === 'dc-bias')
    .map((net) => net.name || net.id);
  const groundValues = parseAnalysisList(analysisAcGrounds?.value);
  for (const value of markedGrounds) if (!groundValues.includes(value)) groundValues.push(value);
  if (analysisAcGrounds && groundValues.length) analysisAcGrounds.value = groundValues.join(', ');
  const regions = analysisFormOptions().deviceRegions || {};
  for (const component of sortedComps()) {
    if (component.analysis?.model === 'triode') regions[component.refdes] = { region: 'triode' };
  }
  if (analysisDeviceRegions) analysisDeviceRegions.value = formatAnalysisDeviceRegions(regions);
}

function analysisReportText(report) {
  const lines = [report?.complete ? 'All equations derived.' : report?.error || 'Some equations are unavailable.'];
  for (const { title, result } of report?.equationEntries || []) {
    if (result?.equation) lines.push(`${title}: ${result.equation}`);
    if (result?.exactEquation && result.exactEquation !== result.equation) {
      lines.push(`${title}, exact: ${result.exactEquation}`);
    }
  }
  for (const assumption of report?.assumptions || []) lines.push(`Assumption: ${assumption}`);
  const log = Array.isArray(report?.log) ? report.log.join('\n') : String(report?.log || '').trim();
  if (log) lines.push(log);
  return lines.join('\n');
}

/**
 * Solver messages name nodes by physical net id (`V(N4)`), which says nothing
 * to someone looking at a drawing. Give them back the net's own name so a
 * floating node can be found and grounded.
 */
function analysisMessageWithNetNames(message) {
  return String(message || '').replace(/\b([VI])\((N\d+)\)/g, (whole, quantity, id) => {
    const net = editor.circuit.nets.get(id);
    const name = net?.name ? parseLabelRuns(net.name).map((run) => run.text).join('') : '';
    return name ? `${quantity}(${name})` : whole;
  });
}

function analysisEquationEntries(report) {
  return Array.isArray(report?.equationEntries) ? report.equationEntries : [];
}

/**
 * The rows the drawing gets: every checked row, and after them the
 * definitions those rows use (and the ones those use), whatever their own
 * rows say -- a named symbol must never reach the drawing undefined.
 */
function analysisAnnotationEntries(report) {
  const entries = analysisEquationEntries(report).filter(({ result }) => result?.ok && result.equation);
  const chosen = entries.filter(({ group, title }) => group !== 'definitions' && !annotationExcluded.has(title));
  const where = entries.find(({ group }) => group === 'definitions');
  const lines = where ? neededDefinitionLines(where.result.lines, chosen.map(({ result }) => result.equation)) : [];
  return [
    ...chosen.map(({ title, result }) => ({ title, equation: result.equation })),
    ...(lines.length ? [{ title: where.title, lines }] : []),
  ];
}

function neededDefinitionLines(lines, equations) {
  const nameOf = (line) => line.slice(0, line.indexOf(' = '));
  const uses = (text, name) => text.includes(name);
  const needed = new Set();
  let texts = equations;
  for (let grown = true; grown;) {
    grown = false;
    for (const line of lines) {
      if (needed.has(line) || !texts.some((text) => uses(text, nameOf(line)))) continue;
      needed.add(line);
      grown = true;
    }
    texts = [...equations, ...needed];
  }
  return lines.filter((line) => needed.has(line));
}

/**
 * Tag each rendered sub-expression with the components it was derived from.
 *
 * `texToMathML` has already turned `present.js`'s provenance markers into
 * `data-node` attributes; this resolves each node's symbol names through the
 * report's `symbolProvenance` table. A node naming nothing on the canvas (a
 * bare number, or `s`) is left undecorated and stays inert.
 */
function decorateEquationProvenance(container, provenance, table) {
  if (!container || !provenance || !table) return;
  const symbols = new Map(provenance.nodes.map((node) => [String(node.id), node.symbols]));
  for (const element of container.querySelectorAll('[data-node]')) {
    const components = componentsOfSymbols(symbols.get(element.dataset.node) || [], table);
    if (components.length) element.dataset.components = components.join(' ');
  }
}

function renderEquationMath(container, equation, provenance = null, table = null) {
  if (!container) return;
  container.replaceChildren();
  const normalized = equationForDiagram(equation);
  container.setAttribute('aria-label', normalized);
  // The shared parser escapes literal text and emits only MathML markup. The
  // provenance render differs from the displayed one by markers alone, which
  // `analysis-provenance-v2.test.js` asserts against the whole golden corpus,
  // so rendering from it cannot change what the row looks like.
  container.innerHTML = texToMathML(provenance?.tex || equation);
  decorateEquationProvenance(container, provenance, table);
}

let equationLockedTerm = null;

function equationTermComponents(element) {
  return element?.dataset?.components ? element.dataset.components.split(' ') : [];
}

function setEquationEmphasis(element, { locked = false } = {}) {
  const root = analysisEquation;
  if (!root) return;
  if (locked) equationLockedTerm = element;
  const active = element || equationLockedTerm;
  for (const marked of root.querySelectorAll('.equation-term-hover, .equation-term-locked')) {
    marked.classList.remove('equation-term-hover', 'equation-term-locked');
  }
  if (equationLockedTerm?.isConnected) equationLockedTerm.classList.add('equation-term-locked');
  else equationLockedTerm = null;
  if (active?.isConnected && active !== equationLockedTerm) active.classList.add('equation-term-hover');
  const components = equationTermComponents(active?.isConnected ? active : equationLockedTerm);
  const changed = components.length !== editor.equationEmphasis.length
    || components.some((ref, index) => ref !== editor.equationEmphasis[index]);
  editor.equationEmphasis = components;
  if (changed) render();
}

function clearEquationEmphasis() {
  equationLockedTerm = null;
  setEquationEmphasis(null);
}

/**
 * Draw the small-signal model beside its equations. The primitives come from
 * the pipeline after its pre-solve transforms, so the figure shows the circuit
 * the displayed equations describe -- Miller shunts included -- rather than
 * the schematic they were derived from.
 */
function renderSmallSignalModel(report) {
  editor.latestSmallSignalModel = null;
  if (!analysisModelEl) return false;
  analysisModelEl.replaceChildren();
  if (!report?.ok) return false;
  let model;
  try { model = smallSignalSchematic(report, { circuit: editor.circuit }); }
  catch (error) { model = { ok: false, error: error.message }; }
  if (!model?.ok) {
    const message = document.createElement('div');
    message.className = 'analysis-equation-unavailable';
    message.textContent = model?.error || 'No small-signal model is available.';
    analysisModelEl.appendChild(message);
    return false;
  }
  editor.latestSmallSignalModel = model;
  const figure = document.createElement('div');
  figure.className = 'analysis-model-figure';
  figure.innerHTML = svgString(model.circuit, {
    themeInk: true,
    grid: false,
    terminals: false,
    junctions: true,
    background: false,
    emptyHint: false,
  });
  const svg = figure.querySelector('svg');
  if (svg) {
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Small-signal equivalent circuit');
  }
  analysisModelEl.appendChild(figure);
  for (const entry of model.legend || []) {
    const row = document.createElement('div');
    row.className = 'analysis-equation-row';
    const heading = document.createElement('div');
    heading.className = 'analysis-equation-label';
    heading.textContent = entry.symbol.replace(/[_^]\{([^}]*)\}/g, '$1');
    const value = document.createElement('div');
    value.className = 'analysis-equation-value';
    renderEquationMath(value, `${entry.symbol} = ${entry.value}`);
    row.append(heading, value);
    analysisModelEl.appendChild(row);
  }
  const notes = [...(model.notes || [])];
  const count = model.correspondence?.size || 0;
  if (count > 15) notes.unshift(`${count} branches: open it full size to read the figure.`);
  if (notes.length) {
    const list = document.createElement('ul');
    list.className = 'analysis-model-notes';
    for (const note of notes) {
      const item = document.createElement('li');
      item.textContent = note;
      list.appendChild(item);
    }
    analysisModelEl.appendChild(list);
  }
  return true;
}

const GROUP_TITLES = new Map(EQUATION_GROUPS);

/** One collapsible report section; its toggle annotates all of its rows. */
function analysisEquationGroup(id) {
  const group = document.createElement('details');
  group.className = 'analysis-equation-group';
  group.dataset.group = id;
  group.open = !collapsedGroups.has(id);
  const summary = document.createElement('summary');
  const title = document.createElement('span');
  title.className = 'analysis-equation-group-title';
  title.textContent = GROUP_TITLES.get(id) || 'Other';
  summary.append(title);
  if (id !== 'definitions') {
    const toggle = annotateToggle(`Annotate all ${title.textContent.toLowerCase()}`);
    toggle.dataset.annotateGroup = id;
    summary.prepend(toggle);
  } else {
    const note = document.createElement('span');
    note.className = 'analysis-equation-group-note';
    note.textContent = 'annotated with the rows that use them';
    summary.append(note);
  }
  group.append(summary);
  group.addEventListener('toggle', () => {
    if (group.open) collapsedGroups.delete(id);
    else collapsedGroups.add(id);
    persistAnalysisForm();
  });
  return group;
}

function annotateToggle(label) {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'analysis-annotate-toggle';
  input.title = label;
  input.setAttribute('aria-label', label);
  return input;
}

function syncGroupAnnotateToggle(group) {
  const toggle = group.querySelector(':scope > summary [data-annotate-group]');
  if (!toggle) return;
  const rows = [...group.querySelectorAll('[data-annotate-row]')];
  const checked = rows.filter((input) => input.checked).length;
  toggle.checked = checked > 0;
  toggle.indeterminate = checked > 0 && checked < rows.length;
}

function analysisEquationRow({ title, group, result: child }, report) {
  const row = document.createElement('div');
  row.className = 'analysis-equation-row';
  const heading = document.createElement('div');
  heading.className = 'analysis-equation-label';
  if (group !== 'definitions' && child?.ok && child.equation) {
    const toggle = annotateToggle(`Annotate ${title.toLowerCase()}`);
    toggle.dataset.annotateRow = title;
    toggle.checked = !annotationExcluded.has(title);
    heading.append(toggle);
  }
  heading.append(title);
  if (child?.table) {
    const note = document.createElement('span');
    note.className = 'analysis-equation-label-note';
    note.textContent = 'panel only, not annotated';
    heading.append(note);
  }
  // A group's only row under the group's own title needs no second heading;
  // the group toggle drives its hidden row toggle.
  heading.hidden = title === GROUP_TITLES.get(group);
  row.appendChild(heading);
  if (child?.ok && child.table) {
    row.appendChild(noiseTableElement(child.table, report));
  } else if (child?.ok && child.equation) {
    const equation = document.createElement('div');
    equation.className = 'analysis-equation-value';
    // A definition row states several things at once; stack them so the
    // row reads down instead of scrolling sideways.
    if (child.definition && Array.isArray(child.lines) && child.lines.length > 1) {
      equation.classList.add('analysis-equation-lines');
      child.lines.forEach((line, index) => {
        const item = document.createElement('div');
        renderEquationMath(item, line, child.lineProvenance?.[index], report.symbolProvenance);
        equation.appendChild(item);
      });
    } else renderEquationMath(equation, child.equation, child.equationProvenance, report.symbolProvenance);
    row.appendChild(equation);
  } else {
    const unavailable = document.createElement('div');
    unavailable.className = 'analysis-equation-unavailable';
    unavailable.textContent = `Unsupported: ${child?.error || 'analysis unavailable'}`;
    row.appendChild(unavailable);
  }
  return row;
}

// Which referral the per-device noise table shows; a viewing choice only.
let noiseTableReferral = 'input';

const NOISE_REFERRAL_NAMES = Object.freeze({ input: 'Input-referred', output: 'Output' });

/**
 * Each device's share of the noise, one row per device and one column per
 * noise kind, for the referral picked above the table. A device's name
 * highlights it on the canvas like any term does.
 */
function noiseTableElement(table, report) {
  const wrapper = document.createElement('div');
  wrapper.className = 'analysis-noise-table';
  if (!table.referrals.includes(noiseTableReferral)) noiseTableReferral = table.referrals[0];
  const switcher = document.createElement('div');
  switcher.className = 'analysis-noise-referral';
  switcher.setAttribute('role', 'group');
  switcher.setAttribute('aria-label', 'Noise referral');
  const scroller = document.createElement('div');
  scroller.className = 'analysis-noise-table-scroll';
  const draw = () => {
    for (const button of switcher.children) button.setAttribute('aria-pressed', String(button.dataset.referral === noiseTableReferral));
    scroller.replaceChildren(noiseTableFor(table, noiseTableReferral, report));
  };
  if (table.referrals.length > 1) {
    for (const referral of table.referrals) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.referral = referral;
      button.textContent = NOISE_REFERRAL_NAMES[referral];
      button.addEventListener('click', () => { noiseTableReferral = referral; draw(); });
      switcher.appendChild(button);
    }
    wrapper.appendChild(switcher);
  }
  wrapper.appendChild(scroller);
  draw();
  return wrapper;
}

function noiseTableFor(table, referral, report) {
  const element = document.createElement('table');
  const head = element.createTHead().insertRow();
  const device = document.createElement('th');
  device.scope = 'col';
  device.textContent = 'Device';
  head.appendChild(device);
  for (const kind of table.kinds) {
    const header = document.createElement('th');
    header.scope = 'col';
    renderEquationMath(header, table.headers[`${referral}-${kind}`] || '');
    head.appendChild(header);
  }
  const body = element.createTBody();
  for (const { component, cells } of table.rows) {
    const row = body.insertRow();
    const name = document.createElement('th');
    name.scope = 'row';
    name.textContent = component;
    name.dataset.components = component;
    row.appendChild(name);
    for (const kind of table.kinds) {
      const cell = row.insertCell();
      const value = cells[`${referral}-${kind}`];
      if (value) renderEquationMath(cell, value.tex, value.provenance, report.symbolProvenance);
      else {
        cell.className = 'analysis-noise-empty';
        cell.textContent = '—';
      }
    }
  }
  return element;
}

function renderAnalysisResult(report) {
  if (!analysisResult) return;
  analysisResult.hidden = !report;
  if (!report) {
    if (analysisEquation) analysisEquation.replaceChildren();
    if (analysisDetails) analysisDetails.textContent = '';
    if (analysisNetlist) analysisNetlist.textContent = '';
    if (analysisNetlistPanel) analysisNetlistPanel.hidden = true;
    renderSmallSignalModel(null);
    if (analysisModelPanel) analysisModelPanel.hidden = true;
    for (const id of ['analysis-tab-netlist', 'analysis-tab-model']) {
      const tab = document.getElementById(id);
      if (tab) tab.disabled = true;
    }
    setAnalysisResultTab('equations');
    return;
  }
  const text = analysisReportText(report);
  if (analysisEquation) {
    clearEquationEmphasis();
    analysisEquation.replaceChildren();
    const entries = analysisEquationEntries(report);
    if (entries.length) {
      const groups = new Map();
      for (const entry of entries) {
        const id = entry.group || 'other';
        if (!groups.has(id)) groups.set(id, analysisEquationGroup(id));
        groups.get(id).append(analysisEquationRow(entry, report));
      }
      for (const group of groups.values()) {
        syncGroupAnnotateToggle(group);
        analysisEquation.appendChild(group);
      }
      analysisEquation.setAttribute('aria-label', text);
    } else {
      const unavailable = document.createElement('div');
      unavailable.className = 'analysis-equation-unavailable analysis-error';
      unavailable.textContent = analysisMessageWithNetNames(report.error) || 'Analysis unavailable.';
      analysisEquation.appendChild(unavailable);
      analysisEquation.removeAttribute('aria-label');
    }
  }
  if (analysisDetails) analysisDetails.textContent = text;
  const netlist = report.smallSignalNetlist || '';
  if (analysisNetlistPanel) analysisNetlistPanel.hidden = !netlist;
  if (analysisNetlist) analysisNetlist.textContent = netlist || '';
  const netlistTab = document.getElementById('analysis-tab-netlist');
  if (netlistTab) {
    netlistTab.disabled = !netlist;
    if (!netlist && netlistTab.getAttribute('aria-selected') === 'true') setAnalysisResultTab('equations');
  }
  const drawn = renderSmallSignalModel(report);
  if (analysisModelPanel) analysisModelPanel.hidden = !drawn;
  const modelTab = document.getElementById('analysis-tab-model');
  if (modelTab) modelTab.disabled = !drawn;
  if (analysisModelOpen) analysisModelOpen.disabled = !drawn;
  const selectedTab = analysisTabButtons.find((button) => button.getAttribute('aria-selected') === 'true')?.dataset.analysisTab || 'equations';
  const stillAvailable = (selectedTab === 'netlist' && !netlist) || (selectedTab === 'model' && !drawn);
  setAnalysisResultTab(stillAvailable ? 'equations' : selectedTab);
}

function analysisAnnotationAssumptions(report) {
  const options = report?.analysisOptions || {};
  const lines = [];
  if (options.highIntrinsicGain) lines.push('g_{m}r_{o} \\gg 1');
  if (options.neglectChannelLengthModulation) lines.push('r_{o} = \\infty');
  if (options.neglectBodyEffect) lines.push('g_{mb} = 0');
  if (options.dominantPoleApplied) lines.push('\\text{Dominant-pole approximation}');
  for (const assumption of report?.assumptions || []) {
    if (assumption.startsWith('Miller approximation')) lines.push(`\\text{${assumption}}`);
  }
  return lines;
}

function openAnalysisDialog(targetNetId) {
  if (!analysisDialog) return;
  const defaults = fillAnalysisDialog(targetNetId);
  const restored = restoreAnalysisForm(defaults);
  prefillAnalysisAttributes();
  if (!restored) groundUnusedInputPorts(null, analysisInput?.value);
  analysisInputPrevious = analysisInput?.value || '';
  if (!restored && targetNetId && analysisTarget && [...analysisTarget.options].some((option) => option.value === targetNetId)) analysisTarget.value = targetNetId;
  persistAnalysisForm();
  renderAnalysisResult(latestAnalysisReport);
  if (analysisAnnotate) analysisAnnotate.hidden = !latestAnalysisReport?.ok;
  const context = document.getElementById('analysis-bias-context');
  if (context && (analysisAcGrounds?.value || analysisDeviceRegions?.value)) context.open = true;
  analysisDockRevision = editor.modelRevision;
  analysisDialog.hidden = false;
  analysisButton?.setAttribute('aria-pressed', 'true');
  analysisInput?.focus();
}

let analysisInputPrevious = '';

/**
 * A stage is driven from one port; every other input port is held at AC
 * ground. That covers a differential pair, and it covers taking the input
 * somewhere else entirely -- a supply rail, say -- where every signal input
 * has to be quiet for the answer to mean anything.
 */
function groundUnusedInputPorts(previousInput, nextInput) {
  if (!analysisAcGrounds) return;
  const nets = visibleNets();
  const inputPorts = new Set(portNetIds(nets, 'input', 'input'));
  if (!inputPorts.size) return;
  const nameOf = (id) => {
    const net = editor.circuit.nets.get(id);
    return net ? net.name || net.id : '';
  };
  let values = parseAnalysisList(analysisAcGrounds.value);
  const next = nameOf(nextInput);
  values = values.filter((value) => value !== next && value !== nextInput);
  const additions = previousInput
    ? (inputPorts.has(previousInput) ? [nameOf(previousInput)] : [])
    : [...inputPorts].filter((id) => id !== nextInput).map(nameOf);
  for (const value of additions) if (value && !values.includes(value)) values.push(value);
  analysisAcGrounds.value = values.join(', ');
}

function isAnalysisDockOpen() {
  return !!analysisDialog && !analysisDialog.hidden;
}

function closeAnalysisDock() {
  if (!isAnalysisDockOpen()) return;
  setAnalysisPick(null);
  // The equation-to-schematic highlight belongs to the dock: leaving it drawn
  // over the canvas with nothing to explain it is just a stuck selection.
  clearEquationEmphasis();
  analysisDialog.hidden = true;
  analysisButton?.setAttribute('aria-pressed', 'false');
  canvasEl.focus();
}

let analysisDockRevision = null;

let analysisReportRevision = null;

/** Keep dock selects in step with model edits while it stays open. */
export function syncAnalysisDock() {
  if (!isAnalysisDockOpen() || analysisDockRevision === editor.modelRevision) return;
  analysisDockRevision = editor.modelRevision;
  const kept = [analysisInput, analysisTarget, analysisReference].map((el) => el?.value);
  fillAnalysisDialog();
  [analysisInput, analysisTarget, analysisReference].forEach((el, index) => {
    if (el && [...el.options].some((option) => option.value === kept[index])) el.value = kept[index];
  });
  const stale = document.getElementById('analysis-stale');
  if (stale) stale.hidden = !latestAnalysisReport || analysisReportRevision === editor.modelRevision;
}

export function setAnalysisPick(selectId) {
  editor.analysisPick = selectId && document.getElementById(selectId) ? selectId : null;
  for (const button of document.querySelectorAll('[data-analysis-pick]')) {
    button.setAttribute('aria-pressed', String(button.dataset.analysisPick === editor.analysisPick));
  }
  canvasEl.classList.toggle('mode-analysis-pick', !!editor.analysisPick);
  renderStatus();
}

/** Resolve a canvas click to a net for the armed analysis field. */
export function completeAnalysisPick(world) {
  const select = document.getElementById(editor.analysisPick);
  if (!select) return setAnalysisPick(null);
  const terminal = nearestTerminal(world);
  const net = terminal
    ? editor.circuit.netOfTerminal(`${terminal.refdes}.${terminal.term}`)
    : pickWire(world)?.net;
  const optionNet = net && [...select.options].find((option) => option.value === net.id)
    ? net
    : net && visibleNets().find((candidate) => namedGroupNets(candidate).some((member) => member.id === net.id));
  if (!optionNet) {
    logLine('Click a wire or a connected pin to choose a net.', 'error');
    return;
  }
  select.value = optionNet.id;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  logLine(`${select.labels?.[0]?.textContent || 'Analysis node'}: ${optionNet.name || optionNet.id}`, 'status');
  setAnalysisPick(null);
  editor.selectedNets = new Set(namedGroupNets(optionNet).map((member) => member.id));
  render();
}

function equationForDiagram(equation) {
  return String(equation || '')
    .replace(/\\left|\\right/g, '')
    .replace(/\\Big\\Vert|\\Vert/g, '||')
    .replace(/\\\|\\\|/g, '||')
    .replace(/\\parallel/g, '||')
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1/$2)')
    .replace(/\b([AGZ])_([imv])\b/g, '$1_{$2}')
    .replace(/\s+/g, ' ')
    // The live analysis preview is built from rich-text spans rather than
    // MathML. Apply these after whitespace normalization so the em-space is
    // not collapsed back to an ordinary space; persisted math labels are
    // handled by texToMathML in the SVG renderer.
    .replace(/\\qquad/g, '\u2003\u2003')
    .replace(/\\quad/g, '\u2003')
    .trim();
}

function equationForLabel(equation) {
  const normalized = String(equation || '')
    .replace(/\\parallel/g, '\\Vert')
    .replace(/\\Big\\\|\\\|/g, '\\Big\\Vert')
    .replace(/\\\|\\\|/g, '\\Vert')
    // Keep labels editable as valid TeX even if a legacy report or manually
    // entered equation still contains the plain `||` spelling.
    .replace(/(?<!\\)\|\|/g, '\\Vert')
    .replace(/\b([AGZ])_([imv])\b/g, '$1_{$2}')
    .replace(/\s+/g, ' ')
    .trim();
  // A parallel operator sharing a line with a fraction needs the larger
  // delimiter form to reach the fraction's numerator/denominator height.
  return /\\frac\b/.test(normalized)
    ? normalized.replace(/(?<!\\Big)\\Vert/g, '\\Big\\Vert')
    : normalized;
}

function annotateAnalysisResult() {
  const report = latestAnalysisReport;
  if (!report?.ok) return;
  const entries = analysisAnnotationEntries(report);
  if (!entries.length) return;
  // Keep generated equations below the figure. Label boxes are centered on
  // their anchors, so place each center from the figure's left and bottom
  // edges after learning its model dimensions.
  const circuitBounds = editor.circuit.bounds();
  const leftEdge = circuitBounds.w > 0 ? circuitBounds.x : editor.cursor.x;
  const bottomEdge = circuitBounds.h > 0 ? circuitBounds.y + circuitBounds.h : editor.cursor.y;
  const topGap = 2 * GRID;
  let nextTop = bottomEdge + topGap;
  const labels = [];
  const equationLabels = [];
  let assumptionsLabel = null;
  commit(() => {
    for (const entry of entries) {
      const label = editor.circuit.addLabel({
        text: entry.lines
          ? [`\\text{${entry.title}:}`, ...entry.lines.map(equationForLabel)].join('\n')
          : equationForLabel(`\\text{${entry.title}: }\\;${entry.equation}`),
        x: 0,
        y: 0,
        align: 'left',
        math: true,
      });
      const box = label.bbox();
      const left = snap(leftEdge);
      const x = snap(left + box.w / 2);
      const y = snap(nextTop + box.h / 2);
      label.moveTo(x, y);
      nextTop = label.bbox().y + label.bbox().h + GRID;
      labels.push(label);
      equationLabels.push(label);
    }
    const assumptions = analysisAnnotationAssumptions(report);
    if (assumptions.length) {
      const label = editor.circuit.addLabel({
        text: ['\\text{Assumptions\\:}', ...assumptions].join('\n'),
        x: 0,
        y: 0,
        align: 'left',
        math: true,
      });
      const box = label.bbox();
      const left = snap(leftEdge);
      label.moveTo(snap(left + box.w / 2), snap(nextTop + box.h / 2));
      labels.push(label);
      assumptionsLabel = label;
    }
  });
  editor.equationAnnotationLayout = {
    equationIds: equationLabels.map((label) => label.id),
    assumptionsId: assumptionsLabel?.id || null,
    leftEdge,
    bottomEdge,
    topGap,
    signature: null,
  };
  setLabelSelection(labels.map((label) => label.id), labels[0]?.id);
  const equationCount = entries.length;
  logLine(`annotated schematic with ${equationCount} equation${equationCount === 1 ? '' : 's'}${labels.length > equationCount ? ' and assumptions' : ''}`, 'status');
  fitView();
}

/** An explicit selection hints the output; otherwise the form defaults decide. */
function suggestedAnalysisTarget() {
  const selectedNet = [...editor.selectedNets][0];
  if (selectedNet && editor.circuit.nets.has(selectedNet)) return selectedNet;
  const component = editor.selected && editor.circuit.components.get(editor.selected);
  if (component) {
    for (const term of ['d', 'o', 'y', 'a', 'b']) {
      const net = editor.circuit.netOfTerminal({ comp: component.refdes, term });
      if (net) return net.id;
    }
  }
  return '';
}

export const SMALL_SIGNAL_TRANSISTOR_TYPES = new Set(['nmos', 'pmos', 'nmosb', 'pmosb']);

export const SMALL_SIGNAL_RESISTOR_TYPES = new Set(['resistor', 'variable_resistor']);

export const SMALL_SIGNAL_PORT_TYPES = INTERFACE_PIN_TYPES;

/**
 * Resolve the component scope for a side-panel analysis menu. A context menu
 * opened on a selected component applies to every selected component of the
 * requested kind; opening it on an unselected row intentionally scopes the
 * action to that row so an old multi-selection cannot be changed by accident.
 */
export function analysisComponentTargets(target, predicate = () => true) {
  const selectedRefs = new Set(selectedComps().map((comp) => comp.refdes));
  const refs = selectedRefs.has(target.refdes) ? selectedRefs : new Set([target.refdes]);
  return [...refs]
    .map((refdes) => editor.circuit.components.get(refdes))
    .filter((component) => component && predicate(component));
}

/** Resolve the analogous scope for a side-panel net analysis menu. */
export function analysisNetTargets(target) {
  const selectedIds = new Set(editor.selectedNets);
  const ids = selectedIds.has(target.id) ? selectedIds : new Set([target.id]);
  return [...ids].map((id) => editor.circuit.nets.get(id)).filter(Boolean);
}

export function applyComponentAnalysis(target, attrs, predicate = () => true) {
  const components = analysisComponentTargets(target, predicate);
  if (!components.length) return;
  commit(() => {
    for (const component of components) editor.circuit.setComponentAnalysis(component.refdes, attrs);
  });
  logLine(`applied small-signal attributes to ${components.length} component${components.length === 1 ? '' : 's'}`, 'status');
}

export function applyNetAnalysis(target, attrs) {
  const nets = analysisNetTargets(target);
  if (!nets.length) return;
  commit(() => {
    for (const net of nets) editor.circuit.setNetAnalysis(net, attrs);
  });
  logLine(`applied analysis attributes to ${nets.length} net${nets.length === 1 ? '' : 's'}`, 'status');
}

export function installAnalysisUi() {
  for (const button of analysisTabButtons) {
    button.addEventListener('click', () => setAnalysisResultTab(button.dataset.analysisTab));
    button.addEventListener('keydown', (ev) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) return;
      ev.preventDefault();
      const enabled = analysisTabButtons.filter((tab) => !tab.disabled);
      const index = enabled.indexOf(button);
      const next = ev.key === 'Home' ? 0
        : ev.key === 'End' ? enabled.length - 1
          : (index + (ev.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length;
      enabled[next]?.focus();
      if (enabled[next]) setAnalysisResultTab(enabled[next].dataset.analysisTab);
    });
  }

  setAnalysisResultTab();

  if (analysisEquation) {
    analysisEquation.addEventListener('change', (event) => {
      const input = event.target;
      const group = input.closest?.('.analysis-equation-group');
      if (!group) return;
      const rows = input.dataset.annotateGroup
        ? [...group.querySelectorAll('[data-annotate-row]')]
        : input.dataset.annotateRow ? [input] : [];
      for (const row of rows) {
        row.checked = input.checked;
        if (row.checked) annotationExcluded.delete(row.dataset.annotateRow);
        else annotationExcluded.add(row.dataset.annotateRow);
      }
      syncGroupAnnotateToggle(group);
      persistAnalysisForm();
    });
    analysisEquation.addEventListener('pointermove', (event) => {
      setEquationEmphasis(event.target.closest?.('[data-components]') || null);
    });
    analysisEquation.addEventListener('pointerleave', () => setEquationEmphasis(null));
    analysisEquation.addEventListener('click', (event) => {
      const term = event.target.closest?.('[data-components]');
      if (!term) { clearEquationEmphasis(); return; }
      // A second click on the locked term widens to the sub-expression that
      // contains it, one level per click, up to the whole equation.
      const next = term === equationLockedTerm
        ? term.parentElement?.closest('[data-components]') || term
        : term;
      setEquationEmphasis(next, { locked: true });
    });
  }

  analysisForm?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const output = analysisTarget?.value;
    const input = analysisInput?.value;
    if (!output || !input) {
      const error = !output
        ? 'Select an output node before deriving equations.'
        : 'Select an input node before deriving equations.';
      latestAnalysisReport = { query: 'combined', ok: false, complete: false, error, reports: {} };
      renderAnalysisResult(latestAnalysisReport);
      if (analysisAnnotate) analysisAnnotate.hidden = true;
      logLine(error, 'error');
      return;
    }
    persistAnalysisForm();
    const formOptions = analysisFormOptions();
    const devices = analysisDeviceOptions();
    const noise = analysisNoiseRequest(formOptions);
    const request = {
      ...formOptions,
      ...(noise ? { noise } : {}),
      ...(Object.keys(devices).length ? { devices } : {}),
      input,
      output,
      reference: analysisReference?.value || undefined,
      acGrounds: parseAnalysisList(analysisAcGrounds?.value),
    };
    let report;
    try {
      report = adaptCombinedReport(analyzeSmallSignalV2(editor.circuit, request), { nameSubexpressions: formOptions.nameSubexpressions });
      report.analysisOptions = {
        ...formOptions,
        devices,
        dominantPoleApplied: formOptions.dominantPole
          && report.assumptions?.includes('dominant-pole approximation'),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report = adaptCombinedReport({ ok: false, error: `analysis failed: ${message}` });
    }
    latestAnalysisReport = report;
    analysisReportRevision = editor.modelRevision;
    const stale = document.getElementById('analysis-stale');
    if (stale) stale.hidden = true;
    renderAnalysisResult(report);
    if (analysisAnnotate) analysisAnnotate.hidden = !report.ok;
    requestAnimationFrame(() => analysisResult?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    logLine(report.complete ? 'derived the selected transfer functions and the input and output impedances' : 'some requested analyses are unavailable', report.complete ? 'status' : 'error');
    for (const { title, result } of report.equationEntries || []) logLine(`${title}: ${result.equation}`, 'status');
    for (const assumption of report.assumptions || []) logLine(`Assumption: ${assumption}`, 'status');
  });

  analysisInput?.addEventListener('change', () => {
    if (analysisInput.value === analysisInputPrevious) return;
    groundUnusedInputPorts(analysisInputPrevious, analysisInput.value);
    analysisInputPrevious = analysisInput.value;
  });

  for (const control of [analysisTarget, analysisReference, analysisInput, analysisAcGrounds, analysisDeviceRegions, analysisApproxRo, analysisApproxBody, analysisApproxGmRo, analysisApproxDominantPole, analysisNameSubexpressions, analysisNoiseThermal, analysisNoiseFlicker, ...analysisTransferInputs]) {
    control?.addEventListener('input', persistAnalysisForm);
    control?.addEventListener('change', persistAnalysisForm);
  }
  // The source checkboxes are rebuilt per circuit; their changes bubble here.
  analysisNoiseSources?.addEventListener('change', persistAnalysisForm);
  for (const control of [analysisNoiseThermal, analysisNoiseFlicker]) control?.addEventListener('change', syncNoiseSourcesVisibility);

  analysisAnnotate?.addEventListener('click', annotateAnalysisResult);

  analysisButton?.addEventListener('click', () => {
    if (isAnalysisDockOpen()) closeAnalysisDock();
    else openAnalysisDialog(suggestedAnalysisTarget());
  });

  analysisCancel?.addEventListener('click', closeAnalysisDock);

  for (const button of document.querySelectorAll('[data-analysis-pick]')) {
    button.addEventListener('click', () => setAnalysisPick(editor.analysisPick === button.dataset.analysisPick ? null : button.dataset.analysisPick));
  }

  analysisDialog?.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    if (editor.analysisPick) setAnalysisPick(null);
    else closeAnalysisDock();
  });
}
