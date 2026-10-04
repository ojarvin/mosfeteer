/**
 * The signal-flow mode's coefficient optimizer (core/analysis/optimize.js):
 * a section under the coefficients where each coefficient is set free or
 * fixed (linked ones follow their links) with an optional range, the specs
 * are listed -- a transfer function's magnitude over a band, as a goal or a
 * limit -- and the swing test is set: stable at an amplitude, each limited
 * net under its limit. Run searches in worker threads (optimize-worker.js),
 * with a progress bar and Stop; the best numbers found come back beside
 * the coefficients, and Apply puts them into the sliders (Revert undoes
 * it). The setup is saved with the document (`analysisValues.flow.optimize`).
 */

import { diagramSymbols, signalFlowGraph } from '../core/analysis/signal-flow.js';
import { createOptimizer, fitnessOf, isFeasible, optimizationParameters, prepareObjective } from '../core/analysis/optimize.js';
import { normalizeOptimizeSetup } from '../core/analysis/optimize-setup.js';
import { coefficientGroups, roundingSearch } from '../core/analysis/rounding.js';
import { prepareSimulation } from '../core/analysis/simulate.js';
import { symbolText } from '../core/analysis/present.js';
import { texToMathML } from '../core/render.js';

let api = null;
let root = null;
let running = null; // { stop(), optimizer }
let found = null; // { own (the best free numbers), score, start (its score), feasible, specs }
let rounded = null; // { own, fractions, groups, score, start, feasible, specs, swing, before }
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
    const input = sources.find((s) => !s.quantizer);
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

const plainName = (name) => name.replace(/_\{([^}]*)\}/g, '_$1');
const sourceName = (source) => (source.quantizer ? `${plainName(source.name)} (quantization error)` : plainName(source.name));

/** A spec in words, its transfer function as TeX. */
function specText(spec, sources) {
  const source = sources.find((s) => s.id === spec.input);
  const action = { minimize: 'Minimize', maximize: 'Maximize', below: 'Keep below', above: 'Keep above' }[spec.action];
  const measure = { average: 'average', peak: 'peak', lowest: 'lowest' }[spec.measure];
  const band = spec.band === 'signal' ? 'in the signal band' : spec.band === 'outside' ? 'outside the signal band' : spec.band === 'all' ? 'over every frequency' : `from ${spec.f1} to ${spec.f2}`;
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
    swingBlock(circuit, current, sources),
    runBlock(current),
    resultBlock(sources),
    roundingBlock(current),
    roundedBlock(sources),
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
    const denominator = el('input', { type: 'text', class: 'signal-flow-optimize-bound', placeholder: String(current.rounding.denominator), 'aria-label': `${name}: largest n when rounding`, title: 'The largest n of m/n when rounding, for this coefficient\'s block (blank: the one set under Rounding); a block takes the largest set among its gains', value: entry.denominator ?? '', disabled: linked || !free.has(name) });
    denominator.addEventListener('change', () => {
      const text = denominator.value.trim();
      const n = Math.round(Number(text));
      denominator.classList.toggle('invalid', !!text && !(n >= 1 && n <= 1024));
      if (text && !(n >= 1 && n <= 1024)) return;
      update({ denominator: text ? n : undefined });
    });
    return el('div', { class: 'signal-flow-optimize-coefficient' }, [
      math(symbolText(name)),
      mode,
      bound('min', 'Lowest value'),
      bound('max', 'Highest value'),
      denominator,
      el('span', { class: 'signal-flow-optimize-number', text: String(Number((values[name] ?? 1).toPrecision(4))), title: 'Its number now' }),
      el('span', { class: 'signal-flow-optimize-number signal-flow-optimize-found', text: String(best), title: best === '' ? '' : 'The best number found' }),
    ]);
  });
  return el('div', { class: 'signal-flow-optimize-group' }, [
    el('div', { class: 'signal-flow-optimize-heading', text: 'Coefficients' }),
    el('div', { class: 'signal-flow-optimize-coefficient signal-flow-optimize-head' }, ['', '', 'Min', 'Max', 'n ≤', 'Now', 'Found'].map((text) => el('span', { text }))),
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
    const field = (key, placeholder, label) => el('input', { type: 'text', class: 'signal-flow-optimize-field', placeholder, 'aria-label': label, value: spec[key] ?? '', onchange: (ev) => { spec[key] = ev.target.value.trim() === '' ? undefined : Number(ev.target.value); save(); } });
    const inputs = sources.map((s) => [s.id, sourceName(s)]);
    if (spec.input && !sources.some((s) => s.id === spec.input)) inputs.push([spec.input, `${spec.input} (gone)`]);
    const limit = spec.action === 'below' || spec.action === 'above';
    return el('div', { class: 'signal-flow-optimize-spec' }, [
      select('action', [['minimize', 'Minimize'], ['maximize', 'Maximize'], ['below', 'Keep below'], ['above', 'Keep above']], 'Goal or limit'),
      select('measure', [['average', 'average'], ['peak', 'peak'], ['lowest', 'lowest']], 'Measure of the magnitude over the band'),
      el('span', { class: 'signal-flow-optimize-word', text: '|H| from' }),
      select('input', inputs.length ? inputs : [['', '(no source)']], 'The transfer function, from this source to the output'),
      select('band', [['signal', 'in the signal band'], ['outside', 'outside the band'], ['all', 'over every frequency'], ['custom', 'from f1 to f2']], 'Band'),
      ...(spec.band === 'custom' ? [field('f1', 'f1/fs', 'Band start, f/fs'), field('f2', 'f2/fs', 'Band end, f/fs')] : []),
      ...(limit ? [field('value', 'dB', 'Limit, dB'), el('span', { class: 'signal-flow-optimize-word', text: 'dB' })] : []),
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
    el('p', { class: 'field-hint', text: '|H| is from the source to the output picked above, in dB, over f/fs (s read in units of 1/Ts); the band is the one set on the graph. Average is the power average (noise in band), peak and lowest the extremes. Every transfer function a spec reads must stay stable. Lee\'s rule for a modulator: the NTF\'s peak below 3.5 dB (1.5).' }),
  ]);
}

function swingBlock(circuit, current, sources) {
  const swing = current.swing;
  const toggle = el('input', { type: 'checkbox', 'aria-label': 'Run the swing test' });
  toggle.checked = swing.on;
  toggle.addEventListener('change', () => { swing.on = toggle.checked; changed(); renderOptimize(); });
  const real = sources.filter((s) => !s.quantizer);
  const source = el('select', { 'aria-label': 'Source the sine drives', onchange: (ev) => { swing.input = ev.target.value; changed(); renderOptimize(); } }, real.map((s) => el('option', { value: s.id, text: plainName(s.name) })));
  if (real.some((s) => s.id === swing.input)) source.value = swing.input;
  else if (real.length) { swing.input = real[0].id; }
  const amplitude = el('input', { type: 'text', class: 'signal-flow-optimize-field', 'aria-label': 'Amplitude, dBFS', value: String(swing.amplitude), onchange: (ev) => { const v = Number(ev.target.value); if (Number.isFinite(v)) { swing.amplitude = v; changed(); } } });
  const frequency = el('input', { type: 'text', class: 'signal-flow-optimize-field', placeholder: 'in band', 'aria-label': 'Sine frequency, f/fs', title: 'f/fs (1/64, 0.01); blank: the middle of the signal band', value: swing.frequency, onchange: (ev) => { swing.frequency = ev.target.value.trim(); changed(); } });
  const children = [
    el('div', { class: 'signal-flow-optimize-heading', text: 'Swing test' }),
    el('div', { class: 'signal-flow-swing-controls' }, [
      el('label', { class: 'signal-flow-spectrum-toggle' }, [toggle, el('span', { text: 'Stable at' })]), amplitude, el('label', { text: 'dBFS into' }), source, el('label', { text: 'at f/fs' }), frequency,
    ]),
  ];
  if (swing.on) {
    // The nets to limit: the integrators' outputs and the quantizers'
    // inputs, and any other already limited.
    const sim = prepareSimulation(circuit, { values: api.resolved(), sources: api.flow().sources, input: swing.input, output: api.flow().output, samples: 64 });
    if (!sim.ok) children.push(el('p', { class: 'analysis-error', text: sim.error }));
    else {
      const shown = sim.signals.filter((s) => s.role === 'state' || s.role === 'quantizer-input' || Object.hasOwn(swing.limits, s.key));
      const peaks = found?.score?.swing?.peaks;
      children.push(el('div', { class: 'signal-flow-optimize-limits' }, shown.map((signal) => {
        const input = el('input', { type: 'text', class: 'signal-flow-optimize-field', placeholder: 'none', 'aria-label': `${signal.name}: limit, dBFS`, value: swing.limits[signal.key] ?? '' });
        input.addEventListener('change', () => {
          const text = input.value.trim();
          const v = Number(text);
          input.classList.toggle('invalid', !!text && !Number.isFinite(v));
          if (text && !Number.isFinite(v)) return;
          if (text) swing.limits[signal.key] = v; else delete swing.limits[signal.key];
          changed();
        });
        const peak = peaks && Number.isFinite(peaks[signal.key]) ? `${peaks[signal.key].toFixed(1)}` : '';
        return el('div', { class: 'signal-flow-optimize-limit' }, [math(signal.name), input, el('span', { class: 'signal-flow-optimize-word', text: 'dBFS' }), el('span', { class: 'signal-flow-optimize-number', text: peak, title: peak ? 'Its peak at the best numbers found, dBFS' : '' })]);
      })));
    }
    const dither = api.flow().dither;
    const ditherText = dither && dither.shape !== 'none' ? ` With ${dither.shape === 'rect' ? 'rectangular' : 'triangular'} dither at ${dither.amplitude} dBFS, as set for the spectrum and the swing.` : ' No dither (set it with the spectrum or the swing).';
    children.push(el('p', { class: 'field-hint', text: `The diagram is simulated at each candidate's numbers, a sine of this amplitude in (rounding at each quantizer): it must not run away, and each net with a limit must peak under it (dBFS of the quantizer's full scale). Blank: no limit.${ditherText}` }));
  }
  return el('div', { class: 'signal-flow-optimize-group' }, children);
}

function runBlock(current) {
  const budget = el('input', { type: 'text', class: 'signal-flow-optimize-field', 'aria-label': 'Evaluations', title: 'How many candidates to score at most', value: String(current.evaluations), onchange: (ev) => { const v = Math.round(Number(ev.target.value)); if (v >= 50) { current.evaluations = v; changed(); } } });
  return el('div', { class: 'signal-flow-optimize-group' }, [
    el('div', { class: 'signal-flow-swing-controls' }, [
      el('label', { text: 'Budget' }), budget, el('label', { text: 'candidates' }),
      el('button', { type: 'button', class: 'signal-flow-optimize-run', text: 'Run', onclick: () => (running ? running.stop() : run()) }),
    ]),
    el('progress', { class: 'signal-flow-optimize-progress', max: '1', value: '0', hidden: true }),
    el('p', { class: 'field-hint signal-flow-optimize-status', 'aria-live': 'polite' }),
  ]);
}

/** Each spec and the swing test at the start and at the result: rows. */
function scoreRows(result, sources, [startLabel, endLabel]) {
  const specs = result.specs || [];
  const row = (label, start, best, ok) => el('div', { class: `signal-flow-optimize-metric${ok === false ? ' analysis-error' : ''}` }, [
    el('span', { text: label }),
    el('span', { class: 'signal-flow-optimize-number', text: start, title: 'At the numbers it started from' }),
    el('span', { class: 'signal-flow-optimize-number', text: best, title: `At the ${endLabel.toLowerCase()} numbers` }),
  ]);
  const db = (v) => (v === null || v === undefined ? '–' : `${v.toFixed(1)} dB`);
  const limits = setup().swing.limits;
  const over = (score) => Object.entries(limits).filter(([key, limit]) => score.swing.peaks?.[key] > limit + 0.01).length;
  const swingText = (score) => {
    if (!score?.swing) return score?.unstable ? 'unstable' : '–';
    if (score.swing.overloaded) return score.swing.stableAt !== null ? `holds to ${score.swing.stableAt} dBFS` : 'runs away';
    const count = over(score);
    return count ? `${count} net${count === 1 ? '' : 's'} over` : 'within limits';
  };
  const swingOk = (score) => !!score?.swing && !score.swing.overloaded && !over(score);
  return [
    row('', startLabel, endLabel),
    ...specs.map((spec, i) => {
      const value = result.score.specs?.[i];
      const ok = spec.action === 'below' ? value <= spec.value + 0.01 : spec.action === 'above' ? value >= spec.value - 0.01 : undefined;
      return row(specText(spec, sources), db(result.start?.specs?.[i]), db(value), ok);
    }),
    ...(result.swing ? [row('Swing test', swingText(result.start), swingText(result.score), swingOk(result.score))] : []),
  ];
}

function resultBlock(sources) {
  const host = el('div', { class: 'signal-flow-optimize-result' });
  if (!found) return host;
  host.append(
    el('div', { class: 'signal-flow-optimize-heading', text: found.feasible ? 'Found: every limit met' : 'Found: the best compromise, missing a limit' }),
    ...scoreRows(found, sources, ['Start', 'Found']),
    el('div', { class: 'signal-flow-graph-actions' }, [
      el('button', { type: 'button', text: 'Revert', title: 'Put back the coefficients from before Apply', disabled: !reverting, onclick: revert }),
      el('button', { type: 'button', class: 'primary-action', text: 'Apply', title: 'Put the numbers found into the coefficients (rounded to 4 digits)', onclick: apply }),
    ]),
  );
  if (!found.feasible) host.append(el('p', { class: 'field-hint', text: 'No candidate met every limit: loosen one, give a coefficient more range, free another, or run again (each run starts from the coefficients\' numbers now).' }));
  return host;
}

function apply() {
  if (!found?.own) return;
  reverting = api.snapshotCoefficients();
  const numbers = Object.fromEntries(Object.entries(found.own).map(([name, v]) => [name, Number(v.toPrecision(4))]));
  api.applyCoefficients(numbers);
  renderOptimize();
}

function revert() {
  if (!reverting) return;
  api.restoreCoefficients(reverting);
  reverting = null;
  renderOptimize();
}

// ----- rounding to fractions ------------------------------------------------------------

const DENOMINATORS = [4, 8, 16, 32, 64, 128, 256];

function roundingBlock(current) {
  const options = current.rounding;
  const denominator = el('select', { 'aria-label': 'Largest n', onchange: (ev) => { options.denominator = Number(ev.target.value); changed(); renderOptimize(); } },
    [...new Set([...DENOMINATORS, options.denominator])].sort((a, b) => a - b).map((n) => el('option', { value: String(n), text: String(n) })));
  denominator.value = String(options.denominator);
  const check = (key, text, title) => {
    const box = el('input', { type: 'checkbox', 'aria-label': text });
    box.checked = !!options[key];
    box.addEventListener('change', () => { options[key] = box.checked; changed(); });
    return el('label', { class: 'signal-flow-spectrum-toggle', title }, [box, el('span', { text })]);
  };
  return el('div', { class: 'signal-flow-optimize-group' }, [
    el('div', { class: 'signal-flow-optimize-heading', text: 'Rounding to fractions' }),
    el('p', { class: 'field-hint', text: 'Makes each free coefficient a simple fraction m/n -- m units over n, whatever the units are -- at the least cost to the specs above: a coarser n is cheaper to build and costs more performance. Starts from the coefficients\' numbers now (Apply a run first). The gains into one block share its n, so they read m1/n, m2/n, ...' }),
    el('div', { class: 'signal-flow-swing-controls' }, [
      el('label', { text: 'n up to' }), denominator,
      check('powersOfTwo', 'powers of two', 'n = 1, 2, 4, 8, ...: shifts in a digital filter, binary-weighted unit arrays'),
      check('shared', 'one n per block', 'The gains into the same block (through sums: an integrator, the quantizer) share one n, its reference element; off, each coefficient has its own'),
      el('button', { type: 'button', class: 'signal-flow-optimize-round', text: 'Round', onclick: () => (running ? running.stop() : roundCoefficients()) }),
    ]),
    el('progress', { class: 'signal-flow-optimize-progress signal-flow-round-progress', max: '1', value: '0', hidden: true }),
    el('p', { class: 'field-hint signal-flow-round-status', 'aria-live': 'polite' }),
  ]);
}

/** The smallest n that brings a value within 5% (its block alone). */
function denominatorFor(value, limit = 0.05) {
  for (let n = 1; n <= 4096; n++) {
    const m = Math.round(value * n) || Math.sign(value);
    if (Math.abs(m / n - value) <= limit * Math.abs(value)) return n;
  }
  return null;
}

function roundedBlock(sources) {
  const host = el('div', { class: 'signal-flow-optimize-result' });
  if (!rounded) return host;
  const rows = [];
  const far = [];
  const cramped = [];
  for (const group of rounded.groups) {
    // A gain far smaller than another into its block: it needs a large n.
    const sizes = group.names.map((name) => Math.abs(rounded.before[name])).filter((v) => v > 0);
    if (sizes.length > 1) {
      const smallest = group.names.find((name) => Math.abs(rounded.before[name]) === Math.min(...sizes));
      const need = denominatorFor(rounded.before[smallest]);
      if (need && need > group.n) cramped.push({ name: smallest, ratio: Math.max(...sizes) / Math.min(...sizes), need, n: group.n });
    }
    const into = group.into ? `into ${plainName(api.circuit().labelOf?.(group.into)?.text || group.into)}` : 'on its own';
    if (rounded.shared || group.names.length > 1) rows.push(el('div', { class: 'signal-flow-optimize-subhead', text: `${into}: n = ${group.n}` }));
    for (const name of group.names) {
      const f = rounded.fractions[name];
      const was = rounded.before[name];
      const value = f.m / f.n;
      const change = was ? (value - was) / Math.abs(was) : 0;
      const off = Math.abs(change) > 0.1;
      if (off) far.push(name);
      rows.push(el('div', { class: `signal-flow-optimize-fraction${off ? ' analysis-error' : ''}` }, [
        math(symbolText(name)),
        el('span', { class: 'signal-flow-optimize-number signal-flow-optimize-found', text: `${f.m}/${f.n}` }),
        el('span', { class: 'signal-flow-optimize-number', text: String(Number(value.toPrecision(4))), title: 'Its value' }),
        el('span', { class: 'signal-flow-optimize-number', text: String(Number(was.toPrecision(4))), title: 'Its number before rounding' }),
        el('span', { class: 'signal-flow-optimize-number', text: `${change >= 0 ? '+' : ''}${(100 * change).toFixed(1)}%`, title: 'The change rounding made (the rest re-optimized around it)' }),
      ]));
    }
  }
  host.append(
    el('div', { class: 'signal-flow-optimize-heading', text: rounded.feasible ? 'Rounded: every limit met' : 'Rounded: the best compromise, missing a limit' }),
    el('div', { class: 'signal-flow-optimize-fraction signal-flow-optimize-head' }, ['', 'm/n', 'Value', 'Before', 'Change'].map((text) => el('span', { text }))),
    ...rows,
    ...scoreRows(rounded, sources, ['Before', 'Rounded']),
  );
  if (!rounded.startFeasible) {
    host.append(el('p', { class: 'analysis-error', text: 'The numbers it started from already missed a limit, so rounding chased the limits before the goal. Run the optimizer and Apply its result first, then round.' }));
  }
  if (far.length) {
    host.append(el('p', { class: 'field-hint', text: `Changed more than 10%: ${far.map(plainName).join(', ')} -- by rounding, or by re-optimizing around the coefficients rounded before them (one coefficient can stand in for another: a resonator needs its product of gains, not each).` }));
  }
  for (const { name, ratio, need, n } of cramped) {
    host.append(el('p', { class: 'field-hint', text: `${plainName(name)} is ${Math.round(ratio)} times smaller than the largest gain into its block: within 5% it needs n ≥ ${need} there, where n = ${n}. Give it a larger n ≤ in the table, or turn off one n per block.` }));
  }
  host.append(el('div', { class: 'signal-flow-graph-actions' }, [
    el('button', { type: 'button', text: 'Revert', title: 'Put back the coefficients from before Apply', disabled: !reverting, onclick: revert }),
    el('button', { type: 'button', class: 'primary-action', text: 'Apply', title: 'Put the fractions into the coefficients, exactly', onclick: applyRounded }),
  ]));
  return host;
}

function applyRounded() {
  if (!rounded) return;
  reverting = api.snapshotCoefficients();
  const numbers = Object.fromEntries(Object.entries(rounded.fractions).map(([name, f]) => [name, f.m / f.n]));
  const texts = Object.fromEntries(Object.entries(rounded.fractions).map(([name, f]) => [name, `${f.m}/${f.n}`]));
  api.applyCoefficients(numbers, { fractions: texts });
  renderOptimize();
}

function roundCoefficients() {
  const circuit = api.circuit();
  const current = setup();
  const links = api.links();
  const own = Object.fromEntries(diagramSymbols(circuit).map((name) => [name, api.coefficients()[name] ?? 1]));
  const parameters = optimizationParameters(circuit, { values: own, links, setup: current });
  const names = parameters.free.map((p) => p.name);
  const options = current.rounding;
  // A block's largest n: the largest set among its gains, else the setting.
  const groups = options.shared ? coefficientGroups(circuit, names) : null;
  const denominators = {};
  for (const group of groups || names.map((name) => ({ names: [name] }))) {
    const set = group.names.map((name) => current.coefficients[name]?.denominator).filter(Boolean);
    if (set.length) for (const name of group.names) denominators[name] = Math.max(...set);
  }
  const specs = normalizeOptimizeSetup(current).specs.filter((spec) => spec.input);
  return startRun({
    button: '.signal-flow-optimize-round',
    status: '.signal-flow-round-status',
    progress: '.signal-flow-round-progress',
    parameters,
    async work({ pool, say, progress, stopped }) {
      const search = roundingSearch(parameters, { values: own, links, denominator: options.denominator, denominators, powersOfTwo: options.powersOfTwo, groups, seed: Math.floor(Math.random() * 2 ** 31) });
      let step = search.next();
      let evaluations = 0;
      while (!step.done) {
        if (stopped()) return 'Stopped: nothing rounded.';
        const { batch, phase, step: k, steps } = step.value;
        const scores = await pool.evaluate(batch);
        evaluations += batch.length;
        progress((k - (phase === 'round' ? 1 : 0.5)) / Math.max(1, steps));
        say(`${phase === 'polish' ? 'Fine-tuning by one unit' : phase === 'reoptimize' ? `Re-optimizing the rest after ${k} of ${steps}` : phase === 'round' ? `Rounding ${k} of ${steps} ${options.shared ? 'blocks' : 'coefficients'}` : 'Scoring the start'}... ${evaluations} candidates${pool.count ? ` on ${pool.count} threads` : ''}`);
        step = search.next(scores);
      }
      const result = step.value;
      rounded = {
        ...result,
        shared: !!groups,
        feasible: isFeasible(result),
        specs,
        swing: normalizeOptimizeSetup(current).swing.on,
        before: Object.fromEntries(names.map((name) => [name, own[name]])),
        startFeasible: fitnessOf(result.start) < 1e6,
      };
      return { text: `Rounded after ${evaluations} candidates.`, error: !rounded.feasible };
    },
  });
}

// ----- the run --------------------------------------------------------------------------

/** Score batches in worker threads; null where workers cannot run (the
 *  page opened from a file), and the run scores in this thread instead. */
async function workerPool(circuitJson, problem) {
  if (typeof Worker === 'undefined' || location.protocol === 'file:') return null;
  const count = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1));
  const workers = [];
  try {
    for (let i = 0; i < count; i++) workers.push(new Worker('optimize-worker.js', { type: 'module' }));
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
      for (const values of batch) {
        scores.push(objective.evaluate(values));
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
async function startRun({ button: buttonSelector, status: statusSelector, progress: progressSelector, parameters, work }) {
  const circuit = api.circuit();
  const current = setup();
  const status = root.querySelector(statusSelector);
  const progress = root.querySelector(progressSelector);
  const button = root.querySelector(buttonSelector);
  const say = (text, error = false) => { status.textContent = text; status.classList.toggle('analysis-error', error); };
  if (!parameters.free.length) { say('No coefficient is free: set one to Free.', true); return; }
  const problem = { output: api.flow().output, sources: api.flow().sources, band: api.band(), values: api.resolved(), setup: current, dither: api.flow().dither };
  let stopped = false;
  running = { stop: () => { stopped = true; } };
  const label = button.textContent;
  button.textContent = 'Stop';
  root.querySelectorAll('.signal-flow-optimize-body select, .signal-flow-optimize-body input, .signal-flow-optimize-body button').forEach((node) => { if (node !== button) node.disabled = true; });
  say('Preparing...');
  progress.hidden = false;
  progress.value = 0;
  let pool = null;
  let message = { text: '', error: false };
  const startedAt = performance.now();
  try {
    pool = await workerPool(circuit.toJSON(), problem);
    if (!pool) pool = localPool(circuit, problem);
    if (pool.error) { message = { text: pool.error, error: true }; return; }
    const closing = await work({ pool, say, progress: (v) => { progress.value = v; }, stopped: () => stopped });
    message = typeof closing === 'string' ? { text: closing, error: false } : closing;
    message.text = `${message.text.replace(/\.$/, '')} in ${((performance.now() - startedAt) / 1000).toFixed(1)} s.`;
  } catch (error) {
    message = { text: `The search failed: ${error.message}`, error: true };
  } finally {
    pool?.close?.();
    running = null;
    button.textContent = label;
    renderOptimize();
    const after = root.querySelector(statusSelector);
    if (after) {
      after.textContent = message.text;
      after.classList.toggle('analysis-error', !!message.error);
    }
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
    button: '.signal-flow-optimize-run',
    status: '.signal-flow-optimize-status',
    progress: '.signal-flow-optimize-progress:not(.signal-flow-round-progress)',
    parameters,
    async work({ pool, say, progress, stopped }) {
      const objectiveSpecs = normalizeOptimizeSetup(current).specs.filter((spec) => spec.input);
      const goals = objectiveSpecs.some((spec) => spec.action === 'minimize' || spec.action === 'maximize');
      const optimizer = createOptimizer(parameters, { values: own, links, evaluations: current.evaluations, seed: Math.floor(Math.random() * 2 ** 31), stopEarly: !goals });
      let start = null;
      while (!optimizer.done && !stopped()) {
        const batch = optimizer.ask();
        const scores = await pool.evaluate(batch.map((c) => c.values));
        if (!start) start = scores[0];
        optimizer.tell(scores);
        progress(optimizer.evaluations / optimizer.budget);
        const best = optimizer.best;
        const goalText = objectiveSpecs.map((spec, i) => (spec.action === 'minimize' || spec.action === 'maximize') && Number.isFinite(best?.score?.specs?.[i]) ? `${best.score.specs[i].toFixed(1)} dB` : null).filter(Boolean).join(', ');
        say(`${optimizer.evaluations} of ${optimizer.budget} candidates${pool.count ? ` on ${pool.count} threads` : ''}${optimizer.restarts ? `, restart ${optimizer.restarts}` : ''} -- best: ${isFeasible(best) ? `every limit met${goalText ? `, goal ${goalText}` : ''}` : 'still missing a limit'}`);
      }
      const best = optimizer.best;
      found = {
        own: Object.fromEntries(parameters.free.map((p) => [p.name, best.own[p.name]])),
        score: best.score,
        start,
        feasible: isFeasible(best),
        specs: objectiveSpecs,
        swing: normalizeOptimizeSetup(current).swing.on,
      };
      return { text: `${stopped() ? 'Stopped' : 'Done'} after ${optimizer.evaluations} candidates${isFeasible(best) ? '' : ': no candidate met every limit'}.`, error: !isFeasible(best) };
    },
  });
}

/** Another document: its own setup, nothing found yet. */
export function resetOptimize() {
  running?.stop();
  found = null;
  rounded = null;
  reverting = null;
}
