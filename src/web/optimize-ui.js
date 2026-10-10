/**
 * The signal-flow mode's coefficient optimizer (core/analysis/optimize.js):
 * a section under the coefficients where each coefficient is set free or
 * fixed (linked ones follow their links) with an optional range, the specs
 * are listed -- a transfer function's magnitude over a band, as a goal or a
 * limit -- and the swing test is set: stable at an amplitude, each limited
 * net under its limit. Run searches in worker threads (optimize-worker.js),
 * with a progress bar and Stop; the best numbers found come back beside
 * the coefficients, and Apply puts them into the sliders (Revert undoes
 * it). With fractions on, the search keeps the free coefficients fractions
 * m/n (rounding.js: n up to a largest, or exactly an n, per block or per
 * coefficient) -- each candidate snapped before it is scored -- so what it
 * finds is what can be built. The setup is saved with the document
 * (`analysisValues.flow.optimize`).
 */

import { MUTED_TRACE_COLOR, TRACE_COLORS, analyzeSignalFlow, diagramSymbols, responsePlot, signalFlowGraph, withCoefficients } from '../core/analysis/signal-flow.js';
import { openRunWindow } from './optimize-window.js';
import { arriving } from './motion.js';
import { createOptimizer, fitnessOf, isFeasible, optimizationParameters, parseConstraints, prepareObjective, scoreRequest, swingTestFrequency } from '../core/analysis/optimize.js';
import { POLE_MEASURES, normalizeOptimizeSetup } from '../core/analysis/optimize-setup.js';
import { coefficientGroups, fractionSnapper, polishSearch } from '../core/analysis/rounding.js';
import { SENSITIVE_DB, isSensitive, pruneCandidates, pruneSearch, sensitivitySearch } from '../core/analysis/refine.js';
import { prepareSimulation } from '../core/analysis/simulate.js';
import { symbolText } from '../core/analysis/present.js';
import { texToMathML } from '../core/render.js';

let api = null;
let root = null;
let running = null; // { stop(), optimizer }
let found = null; // { own (the best free numbers), score, start (its score), feasible, specs, fractions?, groups?, before?, shared? }
let reverting = null; // { coefficients, fractions } before the last Apply

const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== false && value !== null && value !== undefined) node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children);
  return node;
};

const math = (tex, className = 'signal-flow-optimize-math') => {
  const span = el('span', { class: className });
  span.innerHTML = texToMathML(tex);
  return span;
};

/** The setup in the document, made on first use: a quantizer's diagram
 *  starts with its NTF pushed down in the signal band and the swing test on. */
function setup() {
  const flow = api.flow();
  if (!flow.optimize) {
    const { sources } = signalFlowGraph(api.circuit());
    const quantizer = sources.find((s) => s.quantizer);
    const input = sources.find((s) => !s.quantizer && !s.dither);
    flow.optimize = normalizeOptimizeSetup({
      specs: quantizer ? [{ action: 'minimize', measure: 'average', input: quantizer.id, band: 'signal' }] : [],
      swing: { on: !!quantizer, amplitude: -6, input: input?.id || '' },
    });
  }
  return flow.optimize;
}

function changed() {
  api.markSettingsChanged();
}

const MEASURE_TEXT = { sigma3: '3-sigma level', sigma4: '4-sigma level', peak: 'highest peak' };
const plainName = (name) => name.replace(/_\{([^}]*)\}/g, '_$1');
const sourceName = (source) => (source.quantizer ? `${plainName(source.name)} (quantization error)` : plainName(source.name));

/** A spec in words, its transfer function as TeX. */
function specText(spec, sources) {
  const source = sources.find((s) => s.id === spec.input);
  const action = { minimize: 'Minimize', maximize: 'Maximize', below: 'Keep below', above: 'Keep above' }[spec.action];
  if (POLE_MEASURES.includes(spec.measure)) {
    return `${action} the poles' ${spec.measure === 'q' ? 'highest Q' : 'largest radius'} of H from ${source ? plainName(source.name) : spec.input}${spec.value !== undefined ? ` (${spec.value})` : ''}`;
  }
  const measure = { average: 'average', peak: 'peak', lowest: 'lowest' }[spec.measure];
  const band = spec.band === 'signal' ? 'in the signal band' : spec.band === 'outside' ? 'outside the signal band' : spec.band === 'all' ? 'over every frequency' : `from ${spec.f1Text ?? spec.f1} to ${spec.f2Text ?? spec.f2}`;
  return `${action} the ${measure} |H| from ${source ? plainName(source.name) : spec.input} ${band}${spec.value !== undefined ? ` (${spec.value} dB)` : ''}`;
}

// ----- the section ----------------------------------------------------------------------

/** The section, to place under the coefficients; `hooks` reach the mode's state. */
export function optimizeSection(hooks) {
  api = hooks;
  root = el('details', { class: 'analysis-approximations signal-flow-optimize' }, [
    el('summary', { text: 'Optimize coefficients' }),
    el('div', { class: 'signal-flow-optimize-body' }),
  ]);
  root.addEventListener('toggle', () => { if (root.open) renderOptimize(); });
  return root;
}

/** Rebuild the section's rows (not while a run is going: its numbers would jump). */
export function renderOptimize() {
  if (!root?.open || running) return;
  const body = root.querySelector('.signal-flow-optimize-body');
  const circuit = api.circuit();
  const { sources } = signalFlowGraph(circuit);
  const current = setup();
  body.replaceChildren(
    el('p', { class: 'field-hint', text: 'Searches the free coefficients (an evolution strategy, CMA-ES, from their numbers now) for the best goal that keeps every limit: specs on a transfer function\'s magnitude, in dB, and the swing test simulated. Any diagram: a modulator\'s loop filter or a plain filter.' }),
    coefficientTable(circuit, current),
    specList(current, sources),
    constraintsBlock(current),
    swingBlock(circuit, current, sources),
    fractionsBlock(current),
    runBlock(current),
    resultBlock(sources),
  );
}

function coefficientTable(circuit, current) {
  const values = api.resolved();
  const links = api.links();
  const parameters = optimizationParameters(circuit, { values, links, setup: current });
  const free = new Set(parameters.free.map((p) => p.name));
  const rows = diagramSymbols(circuit).map((name) => {
    const entry = current.coefficients[name] || {};
    const linked = Object.hasOwn(links, name);
    const update = (patch) => {
      const next = { ...(current.coefficients[name] || {}), ...patch };
      for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
      if (Object.keys(next).length) current.coefficients[name] = next;
      else delete current.coefficients[name];
      changed();
    };
    const mode = linked
      ? el('span', { class: 'signal-flow-optimize-linked', text: `= ${links[name]}`, title: 'Linked: follows its link' })
      : el('select', { 'aria-label': `${name}: free or fixed`, onchange: (ev) => { update({ fixed: ev.target.value === 'fixed' }); renderOptimize(); } }, [
        el('option', { value: 'free', text: 'Free' }), el('option', { value: 'fixed', text: 'Fixed' }),
      ]);
    if (!linked) mode.value = free.has(name) ? 'free' : 'fixed';
    const bound = (key, label) => {
      const input = el('input', { type: 'text', class: 'signal-flow-optimize-bound', placeholder: key, 'aria-label': `${name}: ${label}`, title: `${label} (blank: none; a coefficient keeps its sign unless its range crosses zero)`, value: entry[key] ?? '', disabled: linked || !free.has(name) });
      input.addEventListener('change', () => {
        const text = input.value.trim();
        const number = Number(text);
        input.classList.toggle('invalid', !!text && !Number.isFinite(number));
        if (text && !Number.isFinite(number)) return;
        update({ [key]: text ? number : undefined });
      });
      return input;
    };
    const best = found?.own && Object.hasOwn(found.own, name) ? Number(found.own[name].toPrecision(4)) : '';
    return el('div', { class: 'signal-flow-optimize-coefficient' }, [
      math(symbolText(name)),
      mode,
      bound('min', 'Lowest value'),
      bound('max', 'Highest value'),
      el('span', { class: 'signal-flow-optimize-number', text: String(Number((values[name] ?? 1).toPrecision(4))), title: 'Its number now' }),
      el('span', { class: 'signal-flow-optimize-number signal-flow-optimize-found', text: String(best), title: best === '' ? '' : 'The best number found' }),
    ]);
  });
  return el('div', { class: 'signal-flow-optimize-group' }, [
    el('div', { class: 'signal-flow-optimize-heading', text: 'Coefficients' }),
    el('div', { class: 'signal-flow-optimize-coefficient signal-flow-optimize-head' }, ['', '', 'Min', 'Max', 'Now', 'Found'].map((text) => el('span', { text }))),
    ...rows,
    el('p', { class: 'field-hint', text: 'Timing (a sampler\'s period, a delay\'s T) starts fixed; the rest free. A coefficient moves on a log scale, keeping its sign; one at zero, or with a range across zero, moves linearly.' }),
  ]);
}

function specList(current, sources) {
  const rows = current.specs.map((spec, index) => {
    const save = () => { current.specs[index] = normalizeOptimizeSetup({ specs: [spec] }).specs[0]; changed(); };
    const select = (key, options, label) => {
      const node = el('select', { 'aria-label': label, onchange: (ev) => { spec[key] = ev.target.value; save(); renderOptimize(); } }, options.map(([value, text]) => el('option', { value, text })));
      node.value = spec[key];
      return node;
    };
    // f1 and f2 take a fraction (1/256) and show it again as typed.
    const field = (key, placeholder, label) => el('input', { type: 'text', class: 'signal-flow-optimize-field', placeholder, 'aria-label': label, value: spec[`${key}Text`] ?? spec[key] ?? '', onchange: (ev) => { const text = ev.target.value.trim(); delete spec[`${key}Text`]; spec[key] = text === '' ? undefined : text; save(); } });
    const inputs = sources.map((s) => [s.id, sourceName(s)]);
    if (spec.input && !sources.some((s) => s.id === spec.input)) inputs.push([spec.input, `${spec.input} (gone)`]);
    const limit = spec.action === 'below' || spec.action === 'above';
    const poles = POLE_MEASURES.includes(spec.measure);
    return el('div', { class: 'signal-flow-optimize-spec' }, [
      select('action', [['minimize', 'Minimize'], ['maximize', 'Maximize'], ['below', 'Keep below'], ['above', 'Keep above']], 'Goal or limit'),
      select('measure', [['average', 'average'], ['peak', 'peak'], ['lowest', 'lowest'], ['q', 'pole Q'], ['radius', 'pole radius']], 'Measure: of the magnitude over a band, or of the poles (the highest Q of a pair, the largest |z|)'),
      el('span', { class: 'signal-flow-optimize-word', text: poles ? 'of H from' : '|H| from' }),
      select('input', inputs.length ? inputs : [['', '(no source)']], 'The transfer function, from this source to the output'),
      ...(poles ? [] : [select('band', [['signal', 'in the signal band'], ['outside', 'outside the band'], ['all', 'over every frequency'], ['custom', 'from f1 to f2']], 'Band')]),
      ...(!poles && spec.band === 'custom' ? [field('f1', 'f1/fs', 'Band start, f/fs'), field('f2', 'f2/fs', 'Band end, f/fs')] : []),
      ...(limit ? [field('value', poles ? (spec.measure === 'q' ? 'Q' : '|z|') : 'dB', poles ? 'Limit' : 'Limit, dB'), ...(poles ? [] : [el('span', { class: 'signal-flow-optimize-word', text: 'dB' })])] : []),
      el('button', { type: 'button', class: 'signal-flow-legend-remove', text: '×', title: 'Remove this spec', 'aria-label': 'Remove this spec', onclick: () => { current.specs.splice(index, 1); changed(); renderOptimize(); } }),
    ]);
  });
  const add = () => {
    const quantizer = sources.find((s) => s.quantizer);
    // A second spec on a modulator: Lee's rule on its NTF.
    const spec = quantizer && current.specs.some((s) => s.input === quantizer.id)
      ? { action: 'below', measure: 'peak', input: quantizer.id, band: 'all', value: 3.5 }
      : { action: 'minimize', measure: 'average', input: (quantizer || sources[0])?.id || '', band: 'signal' };
    current.specs.push(spec);
    changed();
    renderOptimize();
  };
  return el('div', { class: 'signal-flow-optimize-group' }, [
    el('div', { class: 'signal-flow-optimize-heading', text: 'Specs' }),
    ...(rows.length ? rows : [el('p', { class: 'field-hint', text: 'No specs: add one, or use the swing test alone.' })]),
    el('div', { class: 'signal-flow-graph-actions' }, [el('button', { type: 'button', text: 'Add spec', onclick: add })]),
    el('p', { class: 'field-hint', text: '|H| is from the source to the output picked above, in dB, over f/fs (s read in units of 1/Ts); the band is the signal band set above the plots. Average is the power average (noise in band), peak and lowest the extremes. Every transfer function a spec reads must stay stable. Lee\'s rule for a modulator: the NTF\'s peak below 3.5 dB (1.5).' }),
    el('p', { class: 'field-hint', text: 'Pole Q is the highest Q of a pair of the transfer function\'s poles (a z pole read as s = ln z): how much it rings, at whatever frequency -- 0.5 for real poles, 0.707 a Butterworth pair. Pole radius is the largest |z|; the same radius rings more the higher its frequency. A loop\'s NTF and STF share their poles.' }),
  ]);
}

function swingBlock(circuit, current, sources) {
  const swing = current.swing;
  const toggle = el('input', { type: 'checkbox', 'aria-label': 'Run the swing test' });
  toggle.checked = swing.on;
  toggle.addEventListener('change', () => { swing.on = toggle.checked; changed(); renderOptimize(); });
  const real = sources.filter((s) => !s.quantizer && !s.dither);
  const source = el('select', { 'aria-label': 'Source the sine drives', onchange: (ev) => { swing.input = ev.target.value; changed(); renderOptimize(); } }, real.map((s) => el('option', { value: s.id, text: plainName(s.name) })));
  if (real.some((s) => s.id === swing.input)) source.value = swing.input;
  else if (real.length) { swing.input = real[0].id; }
  const amplitude = el('input', { type: 'text', class: 'signal-flow-optimize-field', 'aria-label': 'Amplitude, dBFS', value: String(swing.amplitude), onchange: (ev) => { const v = Number(ev.target.value); if (Number.isFinite(v)) { swing.amplitude = v; changed(); } } });
  const measure = el('select', { 'aria-label': 'What a limit compares with', title: 'What each limit compares with. A net\'s 3-sigma level is the one its swing passes as rarely as a Gaussian passes +-3 sigma (0.27% of the samples); 4 sigma, 0.006%. The swings are not Gaussian: sigma names how rare. The highest peak is strict but noisy -- a loop near overload makes rare large excursions, so it scatters by dBs with the coefficients\' last digits.', onchange: (ev) => { swing.measure = ev.target.value; changed(); renderOptimize(); } }, [
    el('option', { value: 'sigma3', text: '3σ level' }), el('option', { value: 'sigma4', text: '4σ level' }), el('option', { value: 'peak', text: 'highest peak' }),
  ]);
  measure.value = swing.measure;
  const frequency = el('input', { type: 'text', class: 'signal-flow-optimize-field', placeholder: `${Number(swingTestFrequency({ frequency: '' }, api.band()).toPrecision(3))}`, 'aria-label': 'Sine frequency, f/fs', title: 'f/fs (1/64, 0.01); blank: the middle of the signal band set above the plots', value: swing.frequency, onchange: (ev) => { swing.frequency = ev.target.value.trim(); changed(); } });
  const children = [
    el('div', { class: 'signal-flow-optimize-heading', text: 'Swing test' }),
    el('div', { class: 'signal-flow-swing-controls' }, [
      el('label', { class: 'signal-flow-spectrum-toggle' }, [toggle, el('span', { text: 'Stable at' })]), amplitude, el('label', { text: 'dBFS into' }), source, el('label', { text: 'at f/fs' }), frequency,
    ]),
    ...(swing.on ? [el('div', { class: 'signal-flow-swing-controls' }, [el('label', { text: 'Limits on each net\'s' }), measure])] : []),
  ];
  if (swing.on) {
    // The nets to limit: the integrators' outputs and the quantizers'
    // inputs, and any other already limited.
    const sim = prepareSimulation(circuit, { values: api.resolved(), sources: api.flow().sources, input: swing.input, output: api.flow().output, samples: 64 });
    if (!sim.ok) children.push(el('p', { class: 'analysis-error', text: sim.error }));
    else {
      const shown = sim.signals.filter((s) => s.role === 'state' || s.role === 'quantizer-input' || Object.hasOwn(swing.limits, s.key));
      const peaks = found?.score?.swing?.peaks;
      const levels = found?.score?.swing?.levels;
      children.push(el('div', { class: 'signal-flow-optimize-limits' }, shown.map((signal) => {
        const input = el('input', { type: 'text', class: 'signal-flow-optimize-field', placeholder: 'none', 'aria-label': `${signal.name}: limit, dBFS`, value: swing.limits[signal.key] ?? '' });
        input.addEventListener('change', () => {
          const text = input.value.trim();
          const v = Number(text);
          input.classList.toggle('invalid', !!text && !Number.isFinite(v));
          if (text && !Number.isFinite(v)) return;
          if (text) swing.limits[signal.key] = v; else { delete swing.limits[signal.key]; if (swing.targets) delete swing.targets[signal.key]; }
          changed();
          renderOptimize();
        });
        // A limit aimed at: the net brought up to it as a goal, not only kept under it.
        const aim = el('input', { type: 'checkbox', 'aria-label': `${signal.name}: aim at the limit`, disabled: !Object.hasOwn(swing.limits, signal.key) });
        aim.checked = !!swing.targets?.[signal.key];
        aim.addEventListener('change', () => {
          swing.targets = { ...(swing.targets || {}) };
          if (aim.checked) swing.targets[signal.key] = true;
          else delete swing.targets[signal.key];
          changed();
        });
        // At the best found: its level by the measure (if limited) and its highest peak.
        const level = levels && Number.isFinite(levels[signal.key]) ? levels[signal.key].toFixed(1) : '';
        const peak = peaks && Number.isFinite(peaks[signal.key]) ? peaks[signal.key].toFixed(1) : '';
        const text = level && swing.measure !== 'peak' ? `${level} (${peak})` : peak;
        return el('div', { class: 'signal-flow-optimize-limit' }, [math(signal.name), input, el('span', { class: 'signal-flow-optimize-word', text: 'dBFS' }),
          el('label', { class: 'signal-flow-optimize-aim', title: 'Aim at it: a goal as well as a limit -- the net brought up to its limit, each dB under it counted against the result, so no swing is scaled down for nothing (an integrator\'s swing set by its supply, its noise by its size). Off: only kept under it.' }, [aim, el('span', { text: 'aim' })]),
          el('span', { class: 'signal-flow-optimize-number', text, title: text ? `At the best numbers found, verified at length: ${level && swing.measure !== 'peak' ? `its ${MEASURE_TEXT[swing.measure]} (its highest peak in brackets)` : 'its highest peak'}, dBFS` : '' })]);
      })));
    }
    const sources = [...api.circuit().components.values()].filter((c) => c.type === 'dither').map((c) => c.refdes);
    const ditherText = sources.length ? ` The dither sources (${sources.join(', ')}) draw their numbers in every run.` : ' No dither: draw a dither source, with a gain after it, for some.';
    children.push(el('p', { class: 'field-hint', text: `The diagram is simulated at each candidate's numbers, a sine of this amplitude in (rounding at each quantizer): it must not run away, also 1 dB above it, and each net with a limit must stay under it by its ${MEASURE_TEXT[swing.measure]} (dBFS of the quantizer's full scale; blank: no limit). Candidates are ranked by four runs of 4096 samples; each new best is verified with eight runs of 16384 and two more 1 dB above, which must all hold, and those are the numbers shown.${ditherText}` }));
  }
  return el('div', { class: 'signal-flow-optimize-group' }, children);
}

/** Relations the coefficients must keep, typed as one list. */
function constraintsBlock(current) {
  const field = el('input', { type: 'text', class: 'signal-flow-optimize-constraints', placeholder: 'c_1 >= c_2, c_2 >= c_3', 'aria-label': 'Coefficient constraints', spellcheck: 'false', value: current.constraints || '' });
  const note = el('p', { class: 'field-hint' });
  const check = () => {
    try {
      const parsed = parseConstraints(field.value);
      field.classList.remove('invalid');
      note.textContent = parsed.length ? `${parsed.length} constraint${parsed.length === 1 ? '' : 's'}, kept like a limit: a candidate breaking one misses by how far it is short.` : 'Relations between coefficients, kept like a limit: a >= b, a <= b, > or <; each side any expression of coefficients (2*g_1). Commas between them.';
      note.classList.remove('analysis-error');
      return true;
    } catch (error) {
      field.classList.add('invalid');
      note.textContent = error.message;
      note.classList.add('analysis-error');
      return false;
    }
  };
  field.addEventListener('change', () => {
    if (!check()) return;
    current.constraints = field.value.trim();
    changed();
  });
  check();
  return el('div', { class: 'signal-flow-optimize-group' }, [
    el('div', { class: 'signal-flow-optimize-heading', text: 'Constraints' }),
    field,
    note,
  ]);
}

function runBlock(current) {
  const budget = el('input', { type: 'text', class: 'signal-flow-optimize-field', 'aria-label': 'Evaluations', title: 'How many candidates to score at most', value: String(current.evaluations), onchange: (ev) => { const v = Math.round(Number(ev.target.value)); if (v >= 50) { current.evaluations = v; changed(); } } });
  const prune = el('input', { type: 'checkbox', 'aria-label': 'Zero coefficients that barely matter' });
  prune.checked = current.prune !== false;
  prune.addEventListener('change', () => { current.prune = prune.checked; changed(); });
  return el('div', { class: 'signal-flow-optimize-group' }, [
    el('label', { class: 'signal-flow-spectrum-toggle', title: 'After the search, a coefficient under 5% of the largest into its block is tried at zero (smallest first, verified at length): it stays zero, one part fewer, if every limit still holds and the goals lose at most 0.5 dB. Apply then fixes it at zero.' }, [prune, el('span', { text: 'Zero coefficients that barely matter' })]),
    el('div', { class: 'signal-flow-swing-controls' }, [
      el('label', { text: 'Budget' }), budget, el('label', { text: 'candidates' }),
      el('button', { type: 'button', class: 'signal-flow-optimize-run', text: 'Run', onclick: () => (running ? running.stop() : run()) }),
    ]),
    el('progress', { class: 'signal-flow-optimize-progress', max: '1', value: '0', hidden: true }),
    el('p', { class: 'field-hint signal-flow-optimize-status', 'aria-live': 'polite' }),
  ]);
}

/**
 * Rows of cells as a table: `head` the column titles, each row an element
 * whose children are its cells (the first one names the row), or a
 * sub-heading (`.signal-flow-optimize-subhead`) spanning the row. A row
 * marked as an error, and any title, carry over.
 */
function gridTable(head, rows) {
  const tr = (row) => {
    if (row.classList.contains('signal-flow-optimize-subhead')) {
      return el('tr', { class: 'table-group' }, [el('th', { scope: 'rowgroup', colspan: String(head.length), text: row.textContent })]);
    }
    const cells = [...row.children].map((cell, i) => {
      const node = el(i ? 'td' : 'th', i ? {} : { scope: 'row' });
      if (cell.title) node.title = cell.title;
      node.append(...cell.childNodes);
      return node;
    });
    const out = el('tr', { class: row.classList.contains('analysis-error') ? 'bad' : '' }, cells);
    if (row.title) out.title = row.title;
    return out;
  };
  return el('table', { class: 'analysis-table' }, [
    el('thead', {}, [el('tr', {}, head.map((text) => el('th', { scope: 'col', text })))]),
    el('tbody', {}, rows.map(tr)),
  ]);
}

const brokenText = (score) => (!score || score.broken === undefined ? '–' : score.broken ? `${score.broken} broken` : 'all kept');

/** Each spec and the swing test at the start and at the result: a table. */
function scoreRows(result, sources, [startLabel, endLabel]) {
  const specs = result.specs || [];
  const row = (label, start, best, ok) => el('div', { class: `signal-flow-optimize-metric${ok === false ? ' analysis-error' : ''}` }, [
    el('span', { text: label }),
    el('span', { class: 'signal-flow-optimize-number', text: start, title: 'At the numbers it started from' }),
    el('span', { class: 'signal-flow-optimize-number', text: best, title: `At the ${endLabel.toLowerCase()} numbers` }),
  ]);
  const db = (v) => (v === null || v === undefined ? '–' : `${v.toFixed(1)} dB`);
  const limits = setup().swing.limits;
  const over = (score) => Object.entries(limits).filter(([key, limit]) => (score.swing.levels?.[key] ?? score.swing.peaks?.[key]) > limit + 0.01).length;
  const swingText = (score) => {
    if (!score?.swing) return score?.unstable ? 'unstable' : '–';
    const runs = score.swing.runs ? `${score.swing.held}/${score.swing.runs} held` : '';
    if (score.swing.overloaded) return `${runs ? `${runs}; ` : ''}${score.swing.stableAt !== null ? `holds to ${score.swing.stableAt} dBFS` : 'runs away'}`;
    const count = over(score);
    const margin = score.swing.marginRuns && score.swing.marginHeld < score.swing.marginRuns ? ', not 1 dB above' : '';
    return `${runs}${margin}${count ? `, ${count} net${count === 1 ? '' : 's'} over` : ', within limits'}`;
  };
  const swingOk = (score) => !!score?.swing && !score.swing.overloaded && !over(score) && !(score.swing.marginHeld < score.swing.marginRuns);
  return [gridTable(['', startLabel, endLabel], [
    ...specs.map((spec, i) => {
      const value = result.score.specs?.[i];
      const poles = POLE_MEASURES.includes(spec.measure);
      const tolerance = poles ? 1e-3 : 0.01;
      const ok = spec.action === 'below' ? value <= spec.value + tolerance : spec.action === 'above' ? value >= spec.value - tolerance : undefined;
      const show = (v) => (v === null || v === undefined ? '–' : poles ? (spec.measure === 'q' ? `Q ${v.toFixed(2)}` : `|z| ${v.toFixed(3)}`) : db(v));
      return row(specText(spec, sources), show(result.start?.specs?.[i]), show(value), ok);
    }),
    ...(result.swing ? [row('Swing test', swingText(result.start), swingText(result.score), swingOk(result.score))] : []),
    ...(setup().constraints ? [row('Constraints', brokenText(result.start), brokenText(result.score), !(result.score?.broken > 0))] : []),
  ])];
}

function resultBlock(sources) {
  const host = el('div', { class: 'signal-flow-optimize-result' });
  if (!found) return host;
  host.append(
    el('div', { class: 'signal-flow-optimize-heading', text: `${found.fractions ? 'Found, as fractions' : 'Found'}: ${found.feasible ? 'every limit met' : 'the best compromise, missing a limit'}` }),
    ...(found.fractions ? fractionsTable(found) : []),
    ...scoreRows(found, sources, ['Start', found.fractions ? 'Fractions' : 'Found']),
    el('div', { class: 'signal-flow-graph-actions' }, [
      el('button', { type: 'button', text: 'Revert', title: 'Put back the coefficients from before Apply', disabled: !reverting, onclick: revert }),
      el('button', { type: 'button', class: 'primary-action', text: 'Apply', title: found.fractions ? 'Put the fractions into the coefficients, exactly' : 'Put the numbers found into the coefficients (rounded to 4 digits)', onclick: apply }),
    ]),
  );
  if (!found.feasible) host.append(el('p', { class: 'field-hint', text: found.fractions ? 'No candidate on fractions met every limit: allow a larger n (or n = a finer one), turn off one n per block, loosen a limit, or run again.' : 'No candidate met every limit: loosen one, give a coefficient more range, free another, or run again (each run starts from the coefficients\' numbers now).' }));
  if (found.zeroed?.length) {
    host.append(el('p', { class: 'field-hint signal-flow-optimize-zeroed' }, [
      el('span', { text: 'Set to zero, as they barely mattered (every limit still met): ' }),
      ...found.zeroed.flatMap((name, i) => [...(i ? [el('span', { text: ', ' })] : []), math(symbolText(name))]),
      el('span', { text: '. Apply fixes them at zero; set one Free to bring it back.' }),
    ]));
  }
  if (found.sensitivity?.length) host.append(sensitivityBlock(found.sensitivity, found.specs, sources));
  return host;
}

/** How much each spec moves per 1% of each coefficient, at the numbers found. */
function sensitivityBlock(entries, specs, sources) {
  const fragile = entries.filter(isSensitive);
  const row = (entry) => {
    const what = entry.unstable ? 'unstable at 1% off' : `${entry.perPercent.toFixed(2)} dB per 1%${entry.breaks ? ', on a limit' : ''}`;
    const spec = entry.spec !== null && specs[entry.spec] ? specText(specs[entry.spec], sources) : '';
    return el('div', { class: `signal-flow-optimize-metric${isSensitive(entry) ? ' analysis-error' : ''}` }, [
      math(symbolText(entry.name)),
      el('span', { class: 'signal-flow-optimize-number', text: what, title: spec ? `The spec it moves most: ${spec}` : '' }),
    ]);
  };
  return el('div', { class: 'signal-flow-optimize-sensitivity' }, [
    el('div', { class: 'signal-flow-optimize-heading', text: fragile.length ? `Sensitive to ${fragile.length === 1 ? 'one coefficient' : `${fragile.length} coefficients`}` : 'Sensitivity: none fragile' }),
    el('p', { class: 'field-hint', text: `Each coefficient moved 1% of itself, the others held: the largest change of any spec (the transfer functions; the swing test is too noisy to difference). ${SENSITIVE_DB} dB per 1% or more, or the stability lost at 1% off, is marked: the parts realizing it must match that well. "On a limit": 1% off misses a limit the result just meets.` }),
    gridTable(['Coefficient', 'Change'], entries.map(row)),
  ]);
}

function apply() {
  if (!found?.own) return;
  reverting = api.snapshotCoefficients();
  const numbers = Object.fromEntries(Object.entries(found.own).map(([name, v]) => [name, Number(v.toPrecision(4))]));
  // A coefficient set to zero stays there: fixed, so the next search leaves it out.
  const current = setup();
  reverting.fixed = {};
  for (const name of found.zeroed || []) {
    reverting.fixed[name] = current.coefficients[name] ? { ...current.coefficients[name] } : null;
    current.coefficients[name] = { ...(current.coefficients[name] || {}), fixed: true };
  }
  if (found.zeroed?.length) changed();
  if (found.fractions) {
    const exact = Object.fromEntries(Object.entries(found.fractions).map(([name, f]) => [name, f.m / f.n]));
    const texts = Object.fromEntries(Object.entries(found.fractions).map(([name, f]) => [name, `${f.m}/${f.n}`]));
    api.applyCoefficients({ ...numbers, ...exact }, { fractions: texts });
  } else api.applyCoefficients(numbers);
  renderOptimize();
}

function revert() {
  if (!reverting) return;
  const current = setup();
  for (const [name, entry] of Object.entries(reverting.fixed || {})) {
    if (entry) current.coefficients[name] = entry;
    else delete current.coefficients[name];
  }
  if (Object.keys(reverting.fixed || {}).length) changed();
  api.restoreCoefficients(reverting);
  reverting = null;
  renderOptimize();
}

/** The snapping to fractions the setup asks for (rounding.js): the gains
 *  into one block share an n unless that is off; a block takes the
 *  largest n set among its gains, exactly if any is set exactly. */
function fractionsFor(circuit, parameters, current) {
  const options = current.rounding;
  const names = parameters.free.map((p) => p.name);
  const groups = options.shared ? coefficientGroups(circuit, names) : null;
  const denominators = {};
  const exact = {};
  for (const group of groups || names.map((name) => ({ names: [name] }))) {
    const set = group.names.map((name) => current.coefficients[name]).filter((entry) => entry?.denominator);
    if (!set.length) continue;
    const n = Math.max(...set.map((entry) => entry.denominator));
    for (const name of group.names) {
      if (set.some((entry) => entry.denominatorFixed)) exact[name] = n;
      else denominators[name] = n;
    }
  }
  return fractionSnapper(parameters, { denominator: options.denominator, fixed: options.fixed, denominators, exact, powersOfTwo: options.powersOfTwo, groups });
}

/** Drive a refine generator (refine.js), scoring its batches with `pool`. */
async function driveSearch(search, pool) {
  let step = search.next();
  while (!step.done) step = search.next(await pool.evaluate(step.value.batch));
  return step.value;
}

// ----- fractions ------------------------------------------------------------------------

/** Whether a coefficient's n reads exactly (=) or as the largest (≤). */
function nControls(entry, { placeholder, label, onChange }) {
  const kind = el('select', { class: 'signal-flow-optimize-nkind', 'aria-label': `${label}: n up to, or n exactly`, title: '≤: n up to this, the most accurate taken; =: exactly this n' }, [
    el('option', { value: 'max', text: '≤' }), el('option', { value: 'fixed', text: '=' }),
  ]);
  kind.value = entry.fixed ? 'fixed' : 'max';
  const field = el('input', { type: 'text', inputmode: 'numeric', class: 'signal-flow-optimize-bound', placeholder, 'aria-label': `${label}: n`, value: entry.n ?? '' });
  const save = () => {
    const text = field.value.trim();
    const n = Math.round(Number(text));
    const valid = !text || (n >= 1 && n <= 1024);
    field.classList.toggle('invalid', !valid);
    if (valid) onChange({ n: text ? n : undefined, fixed: kind.value === 'fixed' });
  };
  kind.addEventListener('change', save);
  field.addEventListener('change', save);
  return [kind, field];
}

/** The fractions the run makes the free coefficients: on or off, n, and
 *  each coefficient's own n. */
function fractionsBlock(current) {
  const options = current.rounding;
  const toggle = el('input', { type: 'checkbox', 'aria-label': 'Make the free coefficients fractions' });
  toggle.checked = options.on;
  toggle.addEventListener('change', () => { options.on = toggle.checked; changed(); renderOptimize(); });
  const check = (key, text, title) => {
    const box = el('input', { type: 'checkbox', 'aria-label': text });
    box.checked = !!options[key];
    box.addEventListener('change', () => { options[key] = box.checked; changed(); });
    return el('label', { class: 'signal-flow-spectrum-toggle', title }, [box, el('span', { text })]);
  };
  const children = [
    el('div', { class: 'signal-flow-optimize-heading', text: 'Fractions' }),
    el('label', { class: 'signal-flow-spectrum-toggle' }, [toggle, el('span', { text: 'Make the free coefficients fractions m/n' })]),
  ];
  if (options.on) {
    const [kind, field] = nControls({ n: options.denominator, fixed: options.fixed }, {
      placeholder: '32', label: 'Every block',
      onChange: ({ n, fixed }) => { if (n) options.denominator = n; options.fixed = fixed; changed(); renderOptimize(); },
    });
    // Each free coefficient's own n, beside the setting it overrides.
    const circuit = api.circuit();
    const free = optimizationParameters(circuit, { values: api.resolved(), links: api.links(), setup: current }).free.map((p) => p.name);
    const limitRow = (name) => {
      const entry = current.coefficients[name] || {};
      const cells = nControls({ n: entry.denominator, fixed: entry.denominatorFixed }, {
        placeholder: String(options.denominator), label: name,
        onChange: ({ n, fixed }) => {
          const next = { ...entry, denominator: n, denominatorFixed: n && fixed ? true : undefined };
          for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
          if (Object.keys(next).length) current.coefficients[name] = next;
          else delete current.coefficients[name];
          changed();
        },
      });
      return el('tr', {}, [el('th', { scope: 'row' }, [math(symbolText(name))]), el('td', {}, cells)]);
    };
    const setCount = free.filter((name) => current.coefficients[name]?.denominator).length;
    children.push(
      el('div', { class: 'signal-flow-swing-controls' }, [
        el('span', { class: 'signal-flow-optimize-fractions-n' }, [el('label', { text: 'n' }), kind, field]),
        check('powersOfTwo', 'powers of two', 'n = 1, 2, 4, 8, ...: shifts in a digital filter, binary-weighted unit arrays (with ≤)'),
        check('shared', 'one n per block', 'The gains into the same block (through sums: an integrator, the quantizer) share one n, its reference element; off, each coefficient has its own'),
      ]),
      ...(free.length ? [el('details', { class: 'signal-flow-paste-box signal-flow-round-limits', ...(setCount ? { open: '' } : {}) }, [
        el('summary', { text: `n per coefficient (${setCount} set)` }),
        el('table', { class: 'analysis-table' }, [
          el('thead', {}, [el('tr', {}, [el('th', { scope: 'col', text: 'Coefficient' }), el('th', { scope: 'col', text: 'n' })])]),
          el('tbody', {}, free.map(limitRow)),
        ]),
      ])] : []),
    );
  }
  children.push(el('p', { class: 'field-hint', text: 'The search keeps each free coefficient a simple fraction m/n -- m units over n, whatever the units are: every candidate is snapped to fractions before it is scored, so the limits, constraints, and goals are weighed on numbers that can be built, and then each moves by one unit while that helps. The gains into one block share its n (m1/n, m2/n, ...). n ≤ takes the n up to it that fits each candidate best; n = that n exactly. A block takes the largest n set among its gains.' }));
  return el('div', { class: 'signal-flow-optimize-group' }, children);
}

/** The fractions found, by block: each coefficient's m/n and value. */
function fractionsTable(result) {
  const rows = [];
  const coarse = [];
  for (const group of result.groups) {
    const into = group.into ? `into ${plainName(api.circuit().labelOf?.(group.into)?.text || group.into)}` : 'on its own';
    if (result.shared || group.names.length > 1) rows.push(el('div', { class: 'signal-flow-optimize-subhead', text: `${into}: n = ${group.n}` }));
    for (const name of group.names) {
      const f = result.fractions[name];
      if (!f) continue;
      // One unit beside a far larger block-mate: its n leaves it no finer step.
      if (Math.abs(f.m) === 1 && group.names.some((other) => Math.abs(result.fractions[other]?.m || 0) >= 8)) coarse.push({ name, n: f.n });
      rows.push(el('div', { class: 'signal-flow-optimize-fraction' }, [
        math(symbolText(name)),
        el('span', { class: 'signal-flow-optimize-number signal-flow-optimize-found', text: `${f.m}/${f.n}` }),
        el('span', { class: 'signal-flow-optimize-number', text: String(Number((f.m / f.n).toPrecision(4))), title: 'Its value' }),
      ]));
    }
  }
  const notes = coarse.map(({ name, n }) => el('p', { class: 'field-hint', text: `${plainName(name)} is a single unit of n = ${n}, far smaller than a gain beside it: a larger n for its block would let it be set finer.` }));
  return [gridTable(['', 'm/n', 'Value'], rows), ...notes];
}

// ----- the run --------------------------------------------------------------------------

/** A worker thread: from its module beside the page, or -- opened from a
 *  file, where no worker script may load -- from the source the browser-only
 *  build carries (a blob). Null when neither can start. */
let workerUrl = null;
function startWorker() {
  if (location.protocol !== 'file:') return new Worker('optimize-worker.js', { type: 'module' });
  const source = globalThis.__MOSFETEER_WORKER_SOURCE;
  if (!source) return null;
  workerUrl ||= URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  return new Worker(workerUrl);
}

/** Score batches in worker threads; null where workers cannot run, and the
 *  run scores in this thread instead. */
async function workerPool(circuitJson, problem) {
  if (typeof Worker === 'undefined') return null;
  const count = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1));
  const workers = [];
  try {
    for (let i = 0; i < count; i++) {
      const worker = startWorker();
      if (!worker) throw new Error('no worker source');
      workers.push(worker);
    }
  } catch {
    workers.forEach((w) => w.terminate());
    return null;
  }
  const ready = await Promise.all(workers.map((worker) => new Promise((resolve) => {
    const done = (value) => { worker.onmessage = null; worker.onerror = null; resolve(value); };
    worker.onmessage = ({ data }) => { if (data.type === 'ready') done(data); };
    worker.onerror = (ev) => { ev.preventDefault?.(); done({ ok: false, broken: true }); };
    worker.postMessage({ type: 'init', circuit: circuitJson, problem });
  })));
  if (ready.some((r) => r.broken)) {
    workers.forEach((w) => w.terminate());
    return null;
  }
  if (!ready[0].ok) {
    workers.forEach((w) => w.terminate());
    return { error: ready[0].error };
  }
  let id = 0;
  return {
    count,
    evaluate(batch) {
      const size = Math.ceil(batch.length / workers.length);
      const parts = workers.map((worker, k) => batch.slice(k * size, (k + 1) * size)).map((part, k) => (part.length ? new Promise((resolve) => {
        const ticket = ++id;
        const listener = ({ data }) => {
          if (data.type !== 'scores' || data.id !== ticket) return;
          workers[k].removeEventListener('message', listener);
          resolve(data.scores);
        };
        workers[k].addEventListener('message', listener);
        workers[k].postMessage({ type: 'evaluate', id: ticket, batch: part });
      }) : Promise.resolve([])));
      return Promise.all(parts).then((lists) => lists.flat());
    },
    close() { workers.forEach((w) => w.terminate()); },
  };
}

/** Scoring in this thread, a candidate at a time between frames. */
function localPool(circuit, problem) {
  const objective = prepareObjective(circuit, problem);
  if (!objective.ok) return { error: objective.error };
  return {
    count: 0,
    async evaluate(batch) {
      const scores = [];
      let started = performance.now();
      for (const request of batch) {
        scores.push(scoreRequest(objective, request));
        if (performance.now() - started > 30) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          started = performance.now();
        }
      }
      return scores;
    },
    close() {},
  };
}

/**
 * A search in worker threads, its button turned to Stop: `work({ pool, say,
 * progress, stopped })` returns the closing message (text, or `{ text, error }`).
 */
/**
 * The run window's plot: each spec's transfer function at the numbers the
 * run started from (grey) and at its best so far (in colour). The diagram
 * is solved once a run (`solved`); each set of numbers only evaluates it.
 */
function runPlotter() {
  let solved;
  const solve = () => {
    if (solved !== undefined) return solved;
    const inputs = [...new Set(normalizeOptimizeSetup(setup()).specs.filter((spec) => spec.input).map((spec) => spec.input))];
    solved = null;
    if (!inputs.length) return solved;
    const sources = { ...api.flow().sources };
    for (const input of inputs) sources[input] = 'input';
    try {
      const result = analyzeSignalFlow(api.circuit(), { output: api.flow().output, sources, values: api.resolved() });
      if (result.ok) solved = { variable: result.variable, entries: result.entries.filter((entry) => inputs.includes(entry.input)) };
    } catch { solved = null; }
    return solved;
  };
  const traces = (values, role) => {
    const result = values && solve();
    if (!result) return [];
    return result.entries.map((entry, i) => {
      let value = null;
      try { value = withCoefficients(entry.value, values); } catch { value = null; }
      return value && { label: entry.label, color: role === 'start' ? MUTED_TRACE_COLOR : TRACE_COLORS[i % TRACE_COLORS.length], value, variable: result.variable, ...(role === 'start' ? { start: true } : {}) };
    }).filter(Boolean);
  };
  return ({ start, best }) => {
    const shown = [...traces(start, 'start'), ...traces(best, 'best')];
    if (!shown.length) return null;
    const plot = responsePlot(shown, shown[0].variable, { sAxis: 'normalized', band: api.band() });
    return plot ? api.plotSpec(plot, (range) => responsePlot(shown, shown[0].variable, { sAxis: 'normalized', band: api.band(), detail: range })) : null;
  };
}

async function startRun({ title, button: buttonSelector, status: statusSelector, progress: progressSelector, parameters, work }) {
  const circuit = api.circuit();
  const current = setup();
  const status = root.querySelector(statusSelector);
  const progress = root.querySelector(progressSelector);
  const button = root.querySelector(buttonSelector);
  const say = (text, error = false) => {
    const here = root.querySelector(statusSelector) || status;
    here.textContent = text;
    here.classList.toggle('analysis-error', error);
  };
  if (!parameters.free.length) { say('No coefficient is free: set one to Free.', true); return; }
  const problem = { output: api.flow().output, sources: api.flow().sources, band: api.band(), values: api.resolved(), setup: current };
  let stopped = false;
  running = { stop: () => { stopped = true; } };
  // The run in its own window: its plot, its progress, its status, Stop.
  // While the window is open they show there alone; closed, the run goes
  // on and they are back here.
  let latest = { text: 'Preparing...', error: false };
  const runWindow = openRunWindow({
    title, plotAt: runPlotter(), onStop: () => running?.stop(),
    onClose: () => {
      if (running) root.querySelector(progressSelector).hidden = false;
      say(latest.text, latest.error);
    },
  });
  runWindow.start(problem.values);
  const sayBoth = (text, error = false) => {
    latest = { text, error };
    if (runWindow.isOpen()) runWindow.say(text, error);
    else say(text, error);
  };
  const label = button.textContent;
  button.textContent = 'Stop';
  root.querySelectorAll('.signal-flow-optimize-body select, .signal-flow-optimize-body input, .signal-flow-optimize-body button').forEach((node) => { if (node !== button && !node.classList.contains('hint-more')) node.disabled = true; });
  sayBoth('Preparing...');
  progress.hidden = runWindow.isOpen();
  progress.value = 0;
  let pool = null;
  let message = { text: '', error: false };
  const startedAt = performance.now();
  try {
    pool = await workerPool(circuit.toJSON(), problem);
    if (!pool) pool = localPool(circuit, problem);
    if (pool.error) { message = { text: pool.error, error: true }; return; }
    const closing = await work({ pool, say: sayBoth, progress: (v) => { root.querySelectorAll(progressSelector).forEach((bar) => { bar.value = v; }); runWindow.progress(v); }, stopped: () => stopped, best: (values) => runWindow.best(values) });
    message = typeof closing === 'string' ? { text: closing, error: false } : closing;
    message.text = `${message.text.replace(/\.$/, '')} in ${((performance.now() - startedAt) / 1000).toFixed(1)} s.`;
  } catch (error) {
    message = { text: `The search failed: ${error.message}`, error: true };
  } finally {
    pool?.close?.();
    running = null;
    latest = { text: message.text, error: !!message.error };
    runWindow.done(message.text, !!message.error);
    button.textContent = label;
    renderOptimize();
    arriving(root.querySelector('.signal-flow-optimize-result'));
    if (!runWindow.isOpen()) say(message.text, !!message.error);
  }
}

function run() {
  const circuit = api.circuit();
  const current = setup();
  const links = api.links();
  // Own numbers for every coefficient the diagram names (1 until set).
  const own = Object.fromEntries(diagramSymbols(circuit).map((name) => [name, api.coefficients()[name] ?? 1]));
  const parameters = optimizationParameters(circuit, { values: own, links, setup: current });
  return startRun({
    title: 'Optimizer',
    button: '.signal-flow-optimize-run',
    status: '.signal-flow-optimize-status',
    progress: '.signal-flow-optimize-progress',
    parameters,
    async work({ pool, say, progress, stopped, best: showBest }) {
      const objectiveSpecs = normalizeOptimizeSetup(current).specs.filter((spec) => spec.input);
      const goals = objectiveSpecs.some((spec) => spec.action === 'minimize' || spec.action === 'maximize') || Object.keys(normalizeOptimizeSetup(current).swing.targets).length > 0;
      const swingOn = normalizeOptimizeSetup(current).swing.on;
      // Kept to fractions, every candidate is snapped to them before it is
      // scored: the search weighs only numbers that can be built.
      const snap = current.rounding.on ? fractionsFor(circuit, parameters, current) : null;
      const optimizer = createOptimizer(parameters, { values: own, links, evaluations: current.evaluations, seed: Math.floor(Math.random() * 2 ** 31), stopEarly: !goals, verify: swingOn, snap });
      let shownBest = null;
      while (!optimizer.done && !stopped()) {
        const batch = optimizer.ask();
        const scores = await pool.evaluate(batch.map((c) => c.request));
        optimizer.tell(scores);
        // Each new best, verified, redraws the run window's plot.
        if (optimizer.best && optimizer.best !== shownBest) {
          shownBest = optimizer.best;
          showBest(shownBest.values);
        }
        progress(optimizer.evaluations / optimizer.budget);
        const best = optimizer.best;
        const goalText = objectiveSpecs.map((spec, i) => (spec.action === 'minimize' || spec.action === 'maximize') && Number.isFinite(best?.score?.specs?.[i]) ? `${best.score.specs[i].toFixed(1)} dB` : null).filter(Boolean).join(', ');
        const verifying = batch.some((c) => c.request?.verify);
        say(`${optimizer.evaluations} of ${optimizer.budget} candidates${pool.count ? ` on ${pool.count} threads` : ''}${optimizer.restarts ? `, restart ${optimizer.restarts}` : ''}${optimizer.verified ? `, ${optimizer.verified} verified at length` : ''}${verifying ? ' (verifying a new best)' : ''} -- best: ${!best ? 'none verified yet' : isFeasible(best) ? `every limit met${goalText ? `, goal ${goalText}` : ''}` : 'still missing a limit'}`);
      }
      const best = optimizer.best;
      if (!best) return { text: 'Stopped before any candidate was verified.', error: true };
      const names = parameters.free.map((p) => p.name);
      let final = { own: best.own, score: best.score, zeroed: [] };
      // The coefficients that barely matter, tried at zero.
      if (current.prune !== false && isFeasible(best) && !stopped()) {
        const groups = coefficientGroups(circuit, names).map((group) => group.names);
        const candidates = pruneCandidates(names, best.own, groups);
        if (candidates.length) {
          say(`Trying ${candidates.length === 1 ? 'a coefficient that barely matters' : `${candidates.length} coefficients that barely matter`} at zero, verified at length...`);
          final = await driveSearch(pruneSearch(candidates, { own: best.own, start: best.score, links }), pool);
        }
      }
      // On fractions: each moved a unit at a time while that helps.
      let fractioned = null;
      if (snap && !stopped()) {
        say('Fractions: fine-tuning each by one unit...');
        const result = await driveSearch(polishSearch(parameters, { own: final.own, snapped: snap(final.own), links }), pool);
        fractioned = result;
        final = { ...final, own: { ...final.own, ...result.own }, score: result.score };
        showBest(result.values);
      } else if (snap) {
        // Stopped first: the best is on fractions all the same; it reads as them.
        const snapped = snap(final.own);
        fractioned = { fractions: snapped.fractions, groups: snapped.groups, fitness: best.fitness };
      }
      // How much each spec moves per 1% of each coefficient.
      let sensitivity = [];
      if (objectiveSpecs.length && !stopped()) {
        say('Measuring each coefficient\'s sensitivity...');
        sensitivity = await driveSearch(sensitivitySearch(parameters, objectiveSpecs, { own: final.own, links }), pool);
      }
      const feasible = isFeasible(fractioned || best);
      found = {
        own: Object.fromEntries(names.map((name) => [name, final.own[name]])),
        zeroed: final.zeroed,
        sensitivity,
        score: final.score,
        start: optimizer.start,
        feasible,
        specs: objectiveSpecs,
        swing: normalizeOptimizeSetup(current).swing.on,
        ...(fractioned ? { fractions: fractioned.fractions, groups: fractioned.groups, shared: current.rounding.shared } : {}),
      };
      const zeroedText = final.zeroed.length ? `; ${final.zeroed.length === 1 ? 'one coefficient' : `${final.zeroed.length} coefficients`} set to zero` : '';
      const fractionText = snap ? ', every one on fractions' : '';
      return { text: `${stopped() ? 'Stopped' : 'Done'} after ${optimizer.evaluations} candidates${fractionText}${feasible ? zeroedText : ': no candidate met every limit'}.`, error: !feasible };
    },
  });
}

/** Another document: its own setup, nothing found yet. */
export function resetOptimize() {
  running?.stop();
  found = null;
  reverting = null;
}
