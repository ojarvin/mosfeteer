import { componentLabelText, isReferenceMarker, referenceMarkerInfo, referenceMarkerIsLocal, referenceMarkerName } from '../model.js';

/**
 * Small-signal, textbook-style analysis helpers.
 *
 * This module deliberately does not evaluate values or run a numerical
 * simulator.  It recognizes a small, conservative set of topologies and
 * returns a symbolic expression together with the assumptions that made the
 * expression valid.  Unsupported topologies are reported rather than
 * guessed, which is important for an educational tool.
 */

function symbol(name, source = null) {
  return { kind: 'symbol', name, source };
}

function combine(kind, terms) {
  const flat = terms.flatMap((term) => term?.kind === kind ? term.terms : [term]).filter(Boolean);
  return flat.length === 1 ? flat[0] : { kind, terms: flat };
}

function sum(...terms) { return combine('sum', terms); }
function parallel(...terms) { return combine('parallel', terms); }
function product(...terms) { return combine('product', terms); }

// Keep multiplicative factors in textbook order without changing the symbolic
// tree used by the solver.  Frequency and component symbols come first; grouped
// factors such as (1 - A_v) stay at the end of a product.
function factorOrderRank(value) {
  if (!value) return 99;
  if (value.kind === 'number') return -1;
  if (value.kind === 'symbol') {
    const name = String(value.name || '');
    if (name === 's') return 0;
    if (/^g(?:_|$)/i.test(name)) return 1;
    if (/^r(?:_|$)/i.test(name) || /^R(?:_|$)/.test(name)) return 2;
    if (/^l(?:_|$)/i.test(name)) return 3;
    if (/^c(?:_|$)/i.test(name)) return 4;
    return 5;
  }
  if (value.kind === 'inv' || value.kind === 'neg') return factorOrderRank(value.value);
  if (value.kind === 'add' || value.kind === 'sum' || value.kind === 'parallel') return 8;
  if (value.kind === 'mul' || value.kind === 'product') {
    return Math.min(...(value.terms || []).map(factorOrderRank), 5);
  }
  if (value.terms?.length) return Math.min(...value.terms.map(factorOrderRank));
  return 99;
}

function orderedProductTerms(terms) {
  return terms
    .map((term, index) => ({ term, index, rank: factorOrderRank(term) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ term }) => term);
}

function combineRepeatedDisplayFactors(terms) {
  const combined = [];
  const symbols = new Map();
  for (const term of terms) {
    if (term?.kind !== 'symbol') {
      combined.push({ term, exponent: 1 });
      continue;
    }
    const key = sxKey(term);
    const prior = symbols.get(key);
    if (prior) {
      prior.exponent += 1;
      continue;
    }
    const entry = { term, exponent: 1 };
    symbols.set(key, entry);
    combined.push(entry);
  }
  return combined.map(({ term, exponent }) => exponent === 1
    ? term
    : { kind: 'power', base: term, exponent });
}

function expressionText(expr, parentKind = null) {
  if (!expr) return '';
  if (expr.kind === 'symbol') return expr.name;
  const terms = expr.kind === 'product' ? orderedProductTerms(expr.terms) : expr.terms;
  const rendered = terms.map((term) => expressionText(term, expr.kind));
  let body = rendered[0] || '';
  for (let i = 1; i < rendered.length; i++) {
    const join = expr.kind === 'parallel'
      ? ' \\|\\| '
      : expr.kind === 'product' ? ' \\, ' : ' + ';
    body += join + rendered[i];
  }
  // Keep parallel groups visually textbook-like: the renderer turns the
  // TeX-safe `\\|\\|` source spelling is converted by the editor label path
  // to the LaTeX-style `\\Vert` glyph, while the renderer keeps the operator
  // scalable when fractions/scripts are present.
  const needsParens = parentKind && parentKind !== expr.kind;
  return needsParens ? `\\left(${body}\\right)` : body;
}

function expressionDependencies(expr, out = new Set()) {
  if (!expr) return out;
  if (expr.kind === 'symbol') {
    if (expr.source) out.add(expr.source);
    return out;
  }
  for (const term of expr.terms) expressionDependencies(term, out);
  return out;
}

function indexedName(refdes, prefix = null) {
  const raw = String(refdes);
  const match = raw.match(/^([A-Za-z]+)([0-9]+)$/);
  const p = prefix || match?.[1];
  if (!p) return raw;
  if (match) return `${p}_{${match[2]}}`;
  if (raw.startsWith(p) && raw.length > p.length) return `${p}_{${raw.slice(p.length)}}`;
  return raw;
}

function mosOutputName(refdes) {
  const index = String(refdes).match(/[0-9]+$/)?.[0] || String(refdes);
  return `r_{o${index}}`;
}

function netLabel(net) {
  return net?.name || net?.id || '';
}

function resolveNet(circuit, value, role) {
  const raw = String(value ?? '').trim();
  if (!raw) return { ok: false, error: `${role} net is required` };
  const byId = circuit.nets.get(raw);
  if (byId) return { ok: true, net: byId };

  // A terminal reference is a convenient, unambiguous way to select a net.
  if (raw.includes('.')) {
    try {
      const net = circuit.netOfTerminal(circuit.resolveTerm(raw));
      if (net) return { ok: true, net };
      return { ok: false, error: `${role} terminal "${raw}" is not connected to a net` };
    } catch {
      return { ok: false, error: `unknown ${role} net or terminal "${raw}"` };
    }
  }

  const matches = [...circuit.nets.values()].filter((net) => net.name === raw);
  if (matches.length === 1) return { ok: true, net: matches[0] };
  if (matches.length > 1) {
    return { ok: false, error: `${role} name "${raw}" identifies multiple physical nets; use a net id or terminal reference` };
  }
  return { ok: false, error: `unknown ${role} net "${raw}"` };
}

function likelyInputNet(circuit, net) {
  if (!net) return false;
  if (net.analysis?.role === 'input') return true;
  if (/^(?:v_?in|input|in)$/i.test(String(net.name || '').trim())) return true;
  return (net.terminals || []).some((terminal) => {
    const component = circuit.components.get(terminal.comp);
    return component?.type === 'input' || component?.analysis?.role === 'input';
  });
}

// Older schematics commonly named a ground-attached bias net `VBIAS` (or a
// `VCAS*` variant) after placing the marker. The model marks those synthesized
// compatibility labels as non-local, so keep them as AC references; an owned
// label committed through the editor is explicitly local and bypasses this.
function isBiasReferenceAlias(component, net) {
  if (!component || component.type !== 'ground' || !net) return false;
  if (referenceMarkerIsLocal(component)) return false;
  return /^V(?:BIAS|B[NP]|CAS(?:C|CODE)?[NP]?|CM|REF)/i.test(String(net.name || '').trim());
}

function findReferenceNet(circuit, requested) {
  const globalNets = new Map();
  for (const component of circuit.components.values()) {
    if (!isReferenceMarker(component)) continue;
    const info = referenceMarkerInfo(component.type);
    const net = circuit.netOfTerminal({ comp: component.refdes, term: info.terminal });
    if (net && (!referenceMarkerName(component) || isBiasReferenceAlias(component, net))) globalNets.set(net.id, net);
  }
  const group = (net, inferred = false) => net
    ? { ok: true, net, netIds: new Set(globalNets.keys()).has(net.id) ? new Set(globalNets.keys()) : new Set([net.id]), global: new Set(globalNets.keys()).has(net.id), inferred }
    : { ok: false, error: 'no reference net supplied and no connected ground, supply, or VCM marker was found' };
  if (requested) {
    const resolved = resolveNet(circuit, requested, 'reference');
    if (!resolved.ok) return resolved;
    return group(resolved.net);
  }
  if (globalNets.size) return group([...globalNets.values()][0], true);
  return { ok: false, error: 'no reference net supplied and no connected ground, supply, or VCM marker was found' };
}

function splitContextValues(value) {
  if (Array.isArray(value)) return value.flatMap((item) => splitContextValues(item));
  if (value === undefined || value === null) return [];
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function resolveAcGrounds(circuit, value) {
  const values = splitContextValues(value);
  const nets = [];
  const seen = new Set();
  for (const token of values) {
    const resolved = resolveNet(circuit, token, 'AC-ground');
    if (!resolved.ok) return { ok: false, error: resolved.error };
    if (!seen.has(resolved.net.id)) {
      seen.add(resolved.net.id);
      nets.push(resolved.net);
    }
  }
  return { ok: true, values: [...new Set(values)], nets };
}

function contextAssumptions(options) {
  const assumptions = [];
  const mode = String(options.mode || 'single-ended').toLowerCase();
  if (mode === 'single-ended' || mode === 'single_ended' || mode === 'differential') {
    assumptions.push(mode === 'differential'
      ? (String(options.differentialSide || '').trim()
        ? `Differential analysis is reduced to a single-ended equivalent; ${String(options.differentialSide).trim()} is the complementary side and is treated as AC ground.`
        : 'Differential analysis is reduced to a single-ended equivalent; the complementary side is treated as AC ground.')
      : 'Single-ended equivalent selected; any complementary differential side is treated as AC ground.');
  }
  for (const value of splitContextValues(options.acGrounds ?? options.acGround)) {
    assumptions.push(`${value} is treated as AC ground by user request.`);
  }
  const context = String(options.context || '').trim();
  if (context) assumptions.push(`User context: ${context}`);
  return assumptions;
}

function modelOverrides(value) {
  const overrides = new Map();
  if (value && !Array.isArray(value) && typeof value === 'object') {
    for (const [refdes, model] of Object.entries(value)) overrides.set(refdes, String(model).toLowerCase());
    return overrides;
  }
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  for (const entry of entries) {
    const match = String(entry).match(/^([^=:]+)[=:](.+)$/);
    if (match) overrides.set(match[1], match[2].toLowerCase());
  }
  return overrides;
}

function circuitModelOverrides(circuit, value) {
  const overrides = modelOverrides(value);
  for (const component of circuit.components.values()) {
    const model = component.analysis?.model;
    if (model) overrides.set(component.refdes, String(model).toLowerCase());
  }
  return overrides;
}

function normalizeChannelLengthModulationPolicy(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase().replace(/_/g, '-');
  if (['ignore', 'ignore-ro', 'ro-infinity', 'infinite', 'infinity'].includes(normalized)) return 'ignore';
  if (['finite', 'keep-ro', 'retain-ro', 'ro-finite'].includes(normalized)) return 'finite';
  return null;
}

/** Resolve the effective r_o policy for one MOS device.  A persisted finite
 * override deliberately wins over the form-wide approximation, allowing a
 * user to simplify only the bias/cascode devices they intend to idealize. */
function componentIgnoresRo(component, options = {}) {
  if (options.ignoreDeviceRoOverrides) return false;
  const policy = normalizeChannelLengthModulationPolicy(component?.analysis?.channelLengthModulation);
  if (policy === 'finite') return false;
  if (policy === 'ignore') return true;
  const selected = splitContextValues(options.ignoreRoDevices ?? options.ignoreChannelLengthModulationDevices);
  if (selected.includes(component?.refdes)) return true;
  // A large-g_m r_o cascode reduction needs a finite symbolic r_o in order
  // to expose the intrinsic-gain factor.  Keep that factor for devices that
  // have no explicit per-device ignore override; the form-wide r_o→∞ option
  // still applies to all other devices in the same analysis.
  const retainFinite = splitContextValues(options.retainFiniteRoDevices);
  if (retainFinite.includes(component?.refdes)) return false;
  return normalizeAnalysisApproximations(options).ignoreChannelLengthModulation;
}

function componentIgnoresResistance(component, options = {}) {
  if (options.ignoreResistanceOverrides) return false;
  if (!['resistor', 'variable_resistor'].includes(component?.type)) return false;
  const value = component?.analysis?.resistance;
  return value === true || ['infinite', 'inf', 'ignore', 'open', 'large'].includes(String(value || '').trim().toLowerCase());
}

function resistorApproximationSelected(circuit, options = {}) {
  return [...(circuit?.components?.values?.() || [])].some((component) => componentIgnoresResistance(component, options));
}

function optionalBooleanOverride(value) {
  if (value === true || value === false) return value;
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (['true', 'yes', 'large', 'ignore', 'ignored'].includes(normalized)) return true;
  if (['false', 'no', 'exact', 'finite', 'include', 'included', 'retain'].includes(normalized)) return false;
  return null;
}

function componentIgnoresBodyEffect(component, options = {}) {
  const global = normalizeAnalysisApproximations(options).ignoreBodyEffect;
  if (options.ignoreDeviceApproximationOverrides) return global;
  const override = optionalBooleanOverride(component?.analysis?.ignoreBodyEffect);
  return override === null ? global : override;
}

function commonGateBodyIsSourceTied(circuit, component, options = {}) {
  if (component?.def?.terminals?.some((term) => term.name === 'b')) return false;
  const inputNetId = options.inputNetId;
  const references = options.referenceIds;
  if (!inputNetId || !references?.has) return false;
  const source = circuit.netOfTerminal({ comp: component.refdes, term: 's' });
  const gate = circuit.netOfTerminal({ comp: component.refdes, term: 'g' });
  return source?.id === inputNetId && !!gate && references.has(gate.id);
}

function componentAssumesGmRoLarge(component, options = {}) {
  const global = normalizeAnalysisApproximations(options).gmroLarge;
  if (options.ignoreDeviceApproximationOverrides || options.ignoreDeviceGmroOverrides) return global;
  const override = optionalBooleanOverride(component?.analysis?.gmroLarge);
  return override === null ? global : override;
}

const MILLER_IMPEDANCE_TYPES = new Set([
  'resistor', 'variable_resistor',
  'capacitor', 'variable_capacitor',
  'inductor', 'variable_inductor',
]);
const MILLER_MOS_TYPES = new Set(['nmos', 'pmos', 'nmosb', 'pmosb']);

function millerImpedanceValue(component) {
  const refdes = component?.refdes;
  if (!refdes) return null;
  if (component.type === 'resistor' || component.type === 'variable_resistor') {
    return sxSymbol(systemRefdes(refdes, 'R'), refdes);
  }
  if (component.type === 'capacitor' || component.type === 'variable_capacitor') {
    return sxInv(sxMul(sxSymbol('s'), sxSymbol(systemCapName(refdes), refdes)));
  }
  if (component.type === 'inductor' || component.type === 'variable_inductor') {
    return sxMul(sxSymbol('s'), sxSymbol(indexedName(refdes, 'L'), refdes));
  }
  return null;
}

function millerReferenceIds(circuit) {
  const ids = new Set(markedAcGrounds(circuit));
  try {
    const reference = findReferenceNet(circuit);
    if (reference.ok) for (const id of reference.netIds || [reference.net.id]) ids.add(id);
  } catch { /* an explicit reference is not required for candidate discovery */ }
  return ids;
}

/** Derive a conservative low-frequency gain for parallel inverting MOS stages.
 * Use the textbook estimate only when their sources are AC references and the
 * drain has a directly visible passive load. */
function millerForwardGain(circuit, candidate, options = {}) {
  const referenceIds = millerReferenceIds(circuit);
  const overrides = circuitModelOverrides(circuit, options.models);
  const stageDevices = [...circuit.components.values()].filter((component) => {
    if (!MILLER_MOS_TYPES.has(component.type)) return false;
    const override = overrides.get(component.refdes);
    if (isCurrentSourceModel(override) || isTriodeModel(override)) return false;
    const gate = circuit.netOfTerminal({ comp: component.refdes, term: 'g' });
    const drain = circuit.netOfTerminal({ comp: component.refdes, term: 'd' });
    const source = circuit.netOfTerminal({ comp: component.refdes, term: 's' });
    return gate?.id === candidate.gate.id
      && drain?.id === candidate.drain.id
      && source && referenceIds.has(source.id);
  });
  if (!stageDevices.length) return null;
  const loads = [];
  for (const stage of stageDevices) {
    if (!componentIgnoresRo(stage, options)) loads.push(sxSymbol(systemMosName(stage.refdes, 'ro'), stage.refdes));
  }
  for (const load of circuit.components.values()) {
    if (load.refdes === candidate.impedance.refdes) continue;
    if (load.type !== 'resistor' && load.type !== 'variable_resistor') continue;
    if (componentIgnoresResistance(load, options)) continue;
    const a = circuit.netOfTerminal({ comp: load.refdes, term: 'a' });
    const b = circuit.netOfTerminal({ comp: load.refdes, term: 'b' });
    if (!a || !b) continue;
    const other = a.id === candidate.drain.id && referenceIds.has(b.id) ? a
      : b.id === candidate.drain.id && referenceIds.has(a.id) ? b
      : null;
    if (other) loads.push(sxSymbol(systemRefdes(load.refdes, 'R'), load.refdes));
  }
  if (!loads.length) return null;
  const load = loads.length === 1
    ? loads[0]
    : sxInv(sxAdd(...loads.map((term) => sxInv(term))));
  const gm = sxAdd(...stageDevices.map((stage) => sxSymbol(systemMosName(stage.refdes, 'gm'), stage.refdes)));
  const gain = sxMul(sxNumber(-1), gm, load);
  return {
    expression: gain,
    load,
    devices: stageDevices,
    conditions: 'source at AC ground with a directly visible resistive drain load; DC capacitive/inductive branches are omitted',
  };
}

function expressionContainsGm(value) {
  if (!value) return false;
  if (value.kind === 'symbol') return /^g_\{m(?:b)?/.test(String(value.name || ''));
  if (value.kind === 'neg' || value.kind === 'inv') return expressionContainsGm(value.value);
  return (value.terms || []).some(expressionContainsGm) || expressionContainsGm(value.value);
}

/** Solve the forward voltage ratio between the two terminals of an arbitrary
 * feedback impedance after removing that impedance from the model.  This is
 * the generalized Miller step: unlike the legacy one-MOS shortcut, the path
 * may contain any number of small-signal gain stages and internal nodes. */
function millerForwardGainAcrossPath(circuit, impedance, input, output, options = {}) {
  const referenceIds = millerReferenceIds(circuit);
  if (referenceIds.has(input.id) || referenceIds.has(output.id)) return null;
  const solverOptions = {
    ...options,
    millerApproximation: false,
    miller: false,
    excludeMillerImpedance: impedance.refdes,
  };
  const model = buildSystematicModel(circuit, { target: output, referenceIds, options: solverOptions });
  const solved = systematicTransferResult(circuit, model, { target: output, input, referenceIds }, solverOptions);
  if (!solved.ok) return null;
  const expression = simplifySx(solved.expression || solved.exactExpression);
  // Keep the recognizer bounded; the exact nodal result remains available.
  if (!expression || !expressionContainsGm(expression) || sxTreeSize(expression) > 180) return null;
  return {
    expression,
    input,
    output,
    stageLabel: `A_{v,${impedance.refdes}}`,
    conditions: 'feedback impedance removed; solved DC forward path contains one or more explicitly high-gain MOS stages',
  };
}

/** Find feedback impedances that can use a Miller split. Direct gate/drain
 * stages retain their compact textbook estimate; otherwise a bounded generic
 * endpoint solve recognizes a multi-stage forward path. Every reduction still
 * requires an explicit high-gain assumption. */
export function millerApproximationCandidates(circuit, options = {}) {
  if (!normalizeAnalysisApproximations(options).miller) return [];
  const mos = [...(circuit?.components?.values?.() || [])]
    .filter((component) => MILLER_MOS_TYPES.has(component.type))
    .filter((component) => componentAssumesGmRoLarge(component, options));
  if (!mos.length) return [];
  const impedances = [...(circuit?.components?.values?.() || [])]
    .filter((component) => MILLER_IMPEDANCE_TYPES.has(component.type))
    .filter((component) => !componentIgnoresResistance(component, options));
  const candidates = [];
  for (const impedance of impedances) {
    const a = circuit.netOfTerminal({ comp: impedance.refdes, term: 'a' });
    const b = circuit.netOfTerminal({ comp: impedance.refdes, term: 'b' });
    if (!a || !b || a.id === b.id) continue;
    for (const device of mos) {
      const gate = circuit.netOfTerminal({ comp: device.refdes, term: 'g' });
      const drain = circuit.netOfTerminal({ comp: device.refdes, term: 'd' });
      if (!gate || !drain || gate.id === drain.id) continue;
      if (!((a.id === gate.id && b.id === drain.id) || (a.id === drain.id && b.id === gate.id))) continue;
      const gain = millerForwardGain(circuit, { impedance, gate, drain }, options);
      if (gain) candidates.push({ impedance, device, gate, drain, gain });
      break;
    }
    if (candidates.some((candidate) => candidate.impedance.refdes === impedance.refdes)) continue;
    // Generalized feedback: a passive can span multiple gain stages (for
    // example the feedback resistor of a two-stage TIA).  Miller's theorem is
    // admitted only when every MOS device in the small-signal path has the
    // explicit g_m r_o >> 1 assumption; the exact nodal result remains the
    // fallback when that condition is not established.
    const allMosHighGain = [...(circuit?.components?.values?.() || [])]
      .filter((component) => MILLER_MOS_TYPES.has(component.type))
      .every((component) => componentAssumesGmRoLarge(component, options));
    if (!allMosHighGain) continue;
    for (const [input, output] of [[a, b], [b, a]]) {
      const gain = millerForwardGainAcrossPath(circuit, impedance, input, output, options);
      if (!gain) continue;
      candidates.push({ impedance, device: null, gate: input, drain: output, gain, generalized: true, stageLabel: gain.stageLabel });
      break;
    }
  }
  return candidates;
}

function gmRoApproximationRefs(circuit, options = {}) {
  const flags = normalizeAnalysisApproximations(options);
  const mos = [...(circuit?.components?.values?.() || [])]
    .filter((component) => ['nmos', 'pmos', 'nmosb', 'pmosb'].includes(component.type));
  if (!mos.length) return flags.gmroLarge ? null : new Set();
  const refs = new Set(mos
    .filter((component) => componentAssumesGmRoLarge(component, options))
    .map((component) => component.refdes));
  // A fully global approximation can use the existing unrestricted rewrite;
  // partial overrides are carried as a reference set for selective rewriting.
  return refs.size === mos.length ? null : refs;
}

function gmRoApproximationSelected(circuit, options = {}) {
  const refs = gmRoApproximationRefs(circuit, options);
  return refs === null || refs.size > 0;
}

function deviceRoApproximationSelected(circuit, options = {}) {
  if (normalizeAnalysisApproximations(options).ignoreChannelLengthModulation) {
    const mos = [...(circuit?.components?.values?.() || [])]
      .filter((component) => ['nmos', 'pmos', 'nmosb', 'pmosb'].includes(component.type));
    // Preserve the form's explicit approximation marker even for a passive
    // or otherwise MOS-free target; there is simply no device policy to apply.
    return !mos.length || mos.some((component) => componentIgnoresRo(component, options));
  }
  return [...(circuit?.components?.values?.() || [])].some((component) =>
    ['nmos', 'pmos', 'nmosb', 'pmosb'].includes(component.type)
    && componentIgnoresRo(component, options)
    && normalizeChannelLengthModulationPolicy(component.analysis?.channelLengthModulation) === 'ignore');
}

function analysisApproximationSelected(circuit, options = {}) {
  // Exact/reference passes must never schedule another exact pass, even if a
  // future approximation option is added without being cleared below.
  if (options.exactAnalysis) return false;
  const flags = normalizeAnalysisApproximations(options);
  const mos = [...(circuit?.components?.values?.() || [])]
    .filter((component) => ['nmos', 'pmos', 'nmosb', 'pmosb'].includes(component.type));
  return flags.dcOnly || flags.cascodeApproximation || flags.ignoreBodyEffect || flags.gmroLarge || deviceRoApproximationSelected(circuit, options)
    || resistorApproximationSelected(circuit, options)
    || millerApproximationCandidates(circuit, options).length > 0
    || mos.some((component) => componentAssumesGmRoLarge(component, options) || componentIgnoresBodyEffect(component, options));
}

function finiteRoOverrideRefs(circuit) {
  return [...(circuit?.components?.values?.() || [])]
    .filter((component) => normalizeChannelLengthModulationPolicy(component.analysis?.channelLengthModulation) === 'finite')
    .map((component) => component.refdes);
}

function markedAcGrounds(circuit) {
  return [...circuit.nets.values()]
    .filter((net) => net.analysis?.acGround || net.analysis?.role === 'dc-bias')
    .map((net) => net.id);
}

// ---------------------------------------------------------------------------
// Systematic small-signal model / nodal-equation layer
// ---------------------------------------------------------------------------

// These expressions are intentionally separate from the compact R||R reducer
// above.  The reducer keeps the first report format stable while this generic
// layer supplies a topology-independent model that can later serve gain,
// impedance, and pole/zero queries alike.
function sxSymbol(name, source = null) { return { kind: 'symbol', name, source }; }
function sxNumber(value) { return { kind: 'number', value }; }
function sxInfinitySign(value) {
  let sign = 1;
  let current = value;
  while (current?.kind === 'neg') {
    sign *= -1;
    current = current.value;
  }
  return current?.kind === 'symbol' && current.name === '\\infty' ? sign : 0;
}
function sxAdd(...values) {
  const terms = values.flatMap((value) => value?.kind === 'add' ? value.terms : [value]).filter((value) => value && !(value.kind === 'number' && value.value === 0));
  if (!terms.length) return sxNumber(0);
  if (terms.length === 1) return terms[0];
  return { kind: 'add', terms };
}
function sxNeg(value) {
  if (!value || (value.kind === 'number' && value.value === 0)) return sxNumber(0);
  if (value.kind === 'number') return sxNumber(-value.value);
  if (value.kind === 'neg') return value.value;
  if (value.kind === 'add') return sxAdd(...value.terms.map((term) => sxNeg(term)));
  if (value.kind === 'mul') return sxMul(sxNumber(-1), ...value.terms);
  return { kind: 'neg', value };
}
function sxSub(a, b) { return sxAdd(a, sxNeg(b)); }
function sxMul(...values) {
  const terms = values.flatMap((value) => value?.kind === 'mul' ? value.terms : [value]).filter(Boolean);
  if (terms.some((value) => value.kind === 'number' && value.value === 0)) return sxNumber(0);
  if (terms.some((value) => sxInfinitySign(value))) {
    const sign = terms.reduce((total, value) => {
      if (value.kind === 'number') return total * Math.sign(value.value || 1);
      return total * (value.kind === 'neg' ? -1 : 1);
    }, 1);
    return sign < 0 ? sxNeg(sxSymbol('\\infty')) : sxSymbol('\\infty');
  }
  let numeric = 1;
  let sign = 1;
  const expanded = [];
  for (const term of terms) {
    if (term.kind === 'number') numeric *= term.value;
    else if (term.kind === 'neg') { sign *= -1; expanded.push(term.value); }
    else expanded.push(term);
  }
  numeric *= sign;
  if (numeric === 0) return sxNumber(0);
  const kept = expanded.filter((value) => !(value.kind === 'number' && value.value === 1));
  if (numeric !== 1) kept.unshift(sxNumber(numeric));
  if (!kept.length) return sxNumber(1);
  if (kept.length === 2 && kept[0].kind === 'number' && kept[0].value === -1) return sxNeg(kept[1]);
  if (kept.length === 1) return kept[0];
  return { kind: 'mul', terms: kept };
}
function sxInv(value) {
  if (value.kind === 'number') return value.value === 0 ? sxSymbol('\\infty') : sxNumber(1 / value.value);
  if (sxInfinitySign(value)) return sxNumber(0);
  if (value.kind === 'inv') return value.value;
  return { kind: 'inv', value };
}
function sxDiv(a, b) {
  // Keep a small amount of cancellation here; Gaussian elimination otherwise
  // needlessly turns a resistor into (I_test R)/I_test.
  const cancelled = sxCancelFactor(a, b);
  if (cancelled) return cancelled;
  if (a?.kind === 'mul') {
    const remaining = [...a.terms];
    const index = remaining.findIndex((term) => sxKey(term) === sxKey(b));
    if (index >= 0) {
      remaining.splice(index, 1);
      return sxMul(...remaining);
    }
  }
  return sxMul(a, sxInv(b));
}

export function expressionHasFrequency(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.kind === 'symbol') return value.name === 's' || /(?:^|[^A-Za-z])s(?:[^A-Za-z]|$)/.test(String(value.name || ''));
  if ((value.terms || []).some(expressionHasFrequency)) return true;
  return value.value && typeof value.value === 'object' ? expressionHasFrequency(value.value) : false;
}

function acQuantityLabel(label, expression) {
  return expressionHasFrequency(expression) ? `${label}(s)` : label;
}

const sxKeyCache = new WeakMap();

function sxKey(value) {
  if (!value) return '';
  if (value.kind === 'number') return `number:${value.value}`;
  const cached = sxKeyCache.get(value);
  if (cached) return cached;
  // `source` is dependency metadata, not part of the algebraic identity. Two
  // independently stamped occurrences of g_m5 must cancel even if only one
  // occurrence still carries its originating refdes.
  if (value.kind === 'symbol') {
    const key = `symbol:${JSON.stringify(value.name)}`;
    sxKeyCache.set(value, key);
    return key;
  }
  if (value.kind === 'neg') {
    const key = `neg:${sxKey(value.value)}`;
    sxKeyCache.set(value, key);
    return key;
  }
  if (value.terms) {
    const terms = value.terms.map((term) => sxKey(term));
    // Addition, multiplication, and parallel composition are commutative in
    // this symbolic model. Canonicalizing their factor order lets the
    // simplifier recognize A·1/A even when Gaussian elimination encountered
    // the two factors in different orders.
    if (['add', 'mul', 'parallel', 'product'].includes(value.kind)) terms.sort();
    const key = `${value.kind}:${terms.join(',')}`;
    sxKeyCache.set(value, key);
    return key;
  }
  if (value.value && typeof value.value === 'object') {
    const key = `${value.kind}:${sxKey(value.value)}`;
    sxKeyCache.set(value, key);
    return key;
  }
  const key = JSON.stringify(value);
  sxKeyCache.set(value, key);
  return key;
}

function sxTreeSize(value) {
  if (!value || typeof value !== 'object') return 0;
  return 1
    + (value.terms || []).reduce((sum, term) => sum + sxTreeSize(term), 0)
    + (value.value?.kind ? sxTreeSize(value.value) : 0);
}

function sxIsIntrinsicOnly(value) {
  if (!value) return false;
  if (value.kind === 'number') return true;
  if (value.kind === 'symbol') return /^g_\{m(?:b)?/.test(String(value.name || ''));
  if (value.kind === 'neg' || value.kind === 'inv') return sxIsIntrinsicOnly(value.value);
  if (value.terms) return value.terms.every((term) => sxIsIntrinsicOnly(term));
  return false;
}

function millerGainName(deviceOrCandidate) {
  if (deviceOrCandidate?.stageLabel) return deviceOrCandidate.stageLabel;
  if (deviceOrCandidate?.gain?.stageLabel) return deviceOrCandidate.gain.stageLabel;
  const refdes = deviceOrCandidate?.refdes || deviceOrCandidate?.device?.refdes || '1';
  const suffix = String(refdes).match(/[0-9]+$/)?.[0] || String(refdes);
  return `A_{v${suffix}}`;
}

/** Replace only for presentation.  The solver keeps the expanded gain in
 * `expression`; equations can still show a stable `A_{v1}` token so the two
 * Miller shunts visibly share the same stage gain.  The positive counterpart
 * of an inverting gain is rendered as `-A_{v1}`, preserving `1-A_{v1}` rather
 * than displaying the algebraically expanded `1+g_m R_L`.
 */
function displaySx(value, aliases = []) {
  if (!value || !aliases?.length) return value;
  for (const alias of aliases) {
    if (sxKey(value) === alias.key) return sxSymbol(alias.name);
    if (sxKey(value) === alias.negativeKey) return sxNeg(sxSymbol(alias.name));
  }
  if (value.kind === 'neg') return sxNeg(displaySx(value.value, aliases));
  if (value.kind === 'inv') return sxInv(displaySx(value.value, aliases));
  if (value.kind === 'mul') return sxMul(...value.terms.map((term) => displaySx(term, aliases)));
  if (value.kind === 'add') return sxAdd(...value.terms.map((term) => displaySx(term, aliases)));
  return value;
}

/** Keep the compact Miller gain token readable while exposing its definition
 * on the same equation line.  The alias is presentation-only; the solver
 * still uses the expanded expression. */
function appendMillerDefinitions(equation, aliases = []) {
  if (!equation || !aliases?.length) return equation;
  const used = aliases.filter((alias) => equation.includes(alias.name));
  if (!used.length) return equation;
  const definitions = used.map((alias) => `${alias.name}\\approx${sxText(alias.expression)}`);
  return `${equation},\\quad ${definitions.join(',\\quad ')}`;
}

/** Return the load term from a two-element parallel group represented as an
 * inverse conductance sum.  This stays internal to the symbolic reducer; the
 * renderer continues to spell the value as `R_a \|\| R_b`. */
function parallelPair(value) {
  if (value?.kind !== 'inv' || value.value?.kind !== 'add' || value.value.terms.length !== 2) return null;
  const terms = value.value.terms;
  if (!terms.every((term) => term?.kind === 'inv')) return null;
  return { first: terms[0].value, second: terms[1].value };
}

function productTerms(value) {
  const unwrapped = unwrapSxNeg(value);
  const terms = unwrapped.value?.kind === 'mul' ? [...unwrapped.value.terms] : [unwrapped.value];
  return { sign: unwrapped.sign * (terms[0]?.kind === 'number' && terms[0].value < 0 ? -1 : 1), terms: terms.filter((term) => !(term.kind === 'number' && Math.abs(term.value) === 1)) };
}

function hasExactProductFactors(value, factors) {
  const product = productTerms(value);
  if (product.sign !== -1) return false;
  const remaining = product.terms.map(sxKey);
  for (const factor of factors) {
    const index = remaining.indexOf(sxKey(factor));
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return remaining.length === 0;
}

/**
 * Collapse the recurring loaded-common-gate identity exposed by Gaussian
 * elimination after g_m r_o >> 1:
 *
 *   -g_m (r_o || R_L) / [g_m - g_m (r_o || R_L)/r_o] = -R_L.
 *
 * Keeping this as a structural rewrite avoids expanding a whole cascode into
 * a large rational polynomial while remaining exact for the already-selected
 * approximation.  The strict two-term shape prevents it from changing exact
 * finite-r_o equations.
 */
function collapseLoadedCommonGate(terms) {
  for (let denominatorIndex = 0; denominatorIndex < terms.length; denominatorIndex++) {
    const denominatorFactor = terms[denominatorIndex];
    if (denominatorFactor?.kind !== 'inv' || denominatorFactor.value?.kind !== 'add' || denominatorFactor.value.terms.length !== 2) continue;
    const denominator = denominatorFactor.value.terms;
    for (let parallelIndex = 0; parallelIndex < terms.length; parallelIndex++) {
      if (parallelIndex === denominatorIndex) continue;
      const pair = parallelPair(terms[parallelIndex]);
      if (!pair) continue;
      for (let gmIndex = 0; gmIndex < terms.length; gmIndex++) {
        if (gmIndex === denominatorIndex || gmIndex === parallelIndex) continue;
        const gm = unwrapSxNeg(terms[gmIndex]).value;
        if (!isGmSymbol(gm)) continue;
        const feedback = denominator.find((term) => hasExactProductFactors(term, [gm, terms[parallelIndex], sxInv(pair.first)]));
        if (!feedback) continue;
        const directGm = denominator.find((term) => sxKey(unwrapSxNeg(term).value) === sxKey(gm));
        if (!directGm) continue;
        const rest = terms.filter((_, index) => ![denominatorIndex, parallelIndex, gmIndex].includes(index));
        // Preserve the conventional gain ordering (`-g_m R_L`) even when
        // elimination encountered the load parallel group first.
        return sxMul(sxNumber(-1), ...rest, pair.second);
      }
    }
  }
  return null;
}

function isNegatedSxEquivalent(value, target) {
  // Gaussian elimination often materializes `-A` as an additive expression
  // with every term negated (`-a + b`) rather than as a unary `neg` node. Work
  // with signed additive terms so both representations compare identically.
  const parts = (value) => {
    const outer = unwrapSxNeg(value);
    const terms = outer.value?.kind === 'add' ? outer.value.terms : [outer.value];
    return terms.map((term) => {
      const inner = unwrapSxNeg(term);
      return { sign: outer.sign * inner.sign, key: sxKey(inner.value) };
    }).sort((a, b) => a.key.localeCompare(b.key) || a.sign - b.sign);
  };
  const left = parts(value);
  const right = parts(target);
  if (left.length !== right.length) return false;
  return left.every((part, index) => part.sign === -right[index].sign && part.key === right[index].key);
}

/**
 * Apply conservative algebraic cleanup to symbolic expressions produced by
 * Gaussian elimination.  This is identity-preserving: it only removes exact
 * inverse pairs and additive opposites, so textbook approximation choices can
 * operate on a readable expression without changing the exact result.
 */
function simplifySx(value) {
  if (!value || value.kind === 'number' || value.kind === 'symbol') return value;
  if (value.kind === 'neg') return sxNeg(simplifySx(value.value));
  if (value.kind === 'inv') {
    const inner = simplifySx(value.value);
    if (inner?.kind === 'inv') return simplifySx(inner.value);
    if (inner?.kind === 'neg') return sxNeg(sxInv(inner.value));
    const signedInner = signedSxTerm(inner);
    if (signedInner.sign < 0) return sxNeg(sxInv(signedInner.value));
    if (inner?.kind === 'number' && inner.value === 0) return sxSymbol('\\infty');
    if (inner?.kind === 'number' && inner.value !== 0) return sxNumber(1 / inner.value);
    // Pull exact reciprocal factors out of a product before rendering it.
    // Gaussian elimination frequently emits `1/(A · 1/B · C)`; keeping that
    // shape produces several nested fractions even though the identity is
    // simply `B/(A · C)`. This is an algebraic rewrite only—no asymptotic
    // approximation or commutation across sums is involved.
    if (inner?.kind === 'mul') {
      const numerators = inner.terms.filter((term) => term?.kind === 'inv').map((term) => term.value);
      if (numerators.length) {
        const denominators = inner.terms
          .filter((term) => term?.kind !== 'inv')
          .map((term) => sxInv(term));
        return simplifySx(sxMul(...numerators, ...denominators));
      }
    }
    return { kind: 'inv', value: inner };
  }
  if (value.kind === 'mul') {
    const terms = value.terms.flatMap((term) => {
      const simplified = simplifySx(term);
      return simplified?.kind === 'mul' ? simplified.terms : [simplified];
    }).filter(Boolean);
    let numeric = 1;
    const kept = [];
    for (const term of terms) {
      if (term.kind === 'number') numeric *= term.value;
      else if (term.kind === 'neg') {
        numeric *= -1;
        kept.push(term.value);
      }
      else kept.push(term);
    }
    if (numeric === 0) return sxNumber(0);
    // In a multiplicative context, factor additive terms even when their
    // common factor is a resistance rather than a transconductance. A later
    // inverse-factor pass can then cancel it against the solved denominator.
    for (let index = 0; index < kept.length; index++) {
      if (kept[index]?.kind !== 'add') continue;
      const factored = factorCommonSxAdd(kept[index].terms, true);
      if (factored) kept[index] = factored;
    }
    const loadedCommonGate = collapseLoadedCommonGate(terms);
    if (loadedCommonGate) return simplifySx(loadedCommonGate);
    // Move a leading sign into an additive factor so identities such as
    // `-(1/r_o + g_m) r_o = 1 + g_m r_o` can be recognized below.
    if (numeric === -1) {
      const addIndex = kept.findIndex((term) => term.kind === 'add');
      if (addIndex >= 0) {
        kept[addIndex] = simplifySx(sxNeg(kept[addIndex]));
        numeric = 1;
      }
    }
    if (kept.length > 1 && kept.every((term) => term.kind === 'inv')) {
      return simplifySx(sxInv(sxMul(...kept.map((term) => term.value))));
    }
    // Distribute only when an additive term has an exact inverse/direct factor
    // beside it.  This keeps ordinary textbook products compact while
    // collapsing the recurring cascode `(1/r_o + g_m) r_o` identity.
    const addIndex = kept.findIndex((term) => term.kind === 'add');
    if (addIndex >= 0) {
      const add = kept[addIndex];
      const factors = kept.filter((_, index) => index !== addIndex);
      const matchesFactor = add.terms.some((term) => factors.some((factor) =>
        (factor.kind === 'inv' && sxKey(factor.value) === sxKey(term)) ||
        (term.kind === 'inv' && sxKey(term.value) === sxKey(factor))));
      if (matchesFactor) {
        return simplifySx(sxAdd(...add.terms.map((term) => simplifySx({ kind: 'mul', terms: [...factors, term] }))));
      }
    }
    for (let index = kept.length - 1; index >= 0; index--) {
      const term = kept[index];
      if (!term || term.kind !== 'inv') continue;
      const direct = kept.findIndex((candidate, candidateIndex) => candidateIndex !== index && sxKey(candidate) === sxKey(term.value));
      if (direct >= 0) {
        kept.splice(Math.max(index, direct), 1);
        kept.splice(Math.min(index, direct), 1);
        continue;
      }
      const negated = kept.findIndex((candidate, candidateIndex) => candidateIndex !== index
        && isNegatedSxEquivalent(candidate, term.value));
      if (negated >= 0) {
        kept.splice(Math.max(index, negated), 1);
        kept.splice(Math.min(index, negated), 1);
        numeric *= -1;
      }
    }
    if (numeric !== 1) kept.unshift(sxNumber(numeric));
    if (!kept.length) return sxNumber(1);
    if (kept.length === 1) return kept[0];
    if (kept.length === 2 && kept[0].kind === 'number' && kept[0].value === -1) return sxNeg(kept[1]);
    return { kind: 'mul', terms: kept };
  }
  if (value.kind === 'add') {
    const terms = value.terms.flatMap((term) => {
      const simplified = simplifySx(term);
      return simplified?.kind === 'add' ? simplified.terms : [simplified];
    }).filter(Boolean);
    let numeric = 0;
    const kept = [];
    for (const term of terms) {
      if (term.kind === 'number') numeric += term.value;
      else kept.push(term);
    }
    for (let index = kept.length - 1; index >= 0; index--) {
      const term = kept[index];
      if (!term) continue;
      const signed = signedSxTerm(term);
      const match = kept.findIndex((candidate, candidateIndex) => {
        if (candidateIndex === index) return false;
        const other = signedSxTerm(candidate);
        return signed.sign === -other.sign && sxKey(signed.value) === sxKey(other.value);
      });
      if (match >= 0) {
        kept.splice(Math.max(index, match), 1);
        kept.splice(Math.min(index, match), 1);
      }
    }
    if (numeric !== 0) kept.unshift(sxNumber(numeric));
    if (!kept.length) return sxNumber(0);
    if (kept.length === 1) return kept[0];
    return { kind: 'add', terms: kept };
  }
  return value;
}

// Gaussian elimination naturally produces nested fractions.  Local inverse
// cancellation is not enough for expressions such as
//
//   1/D + (1/D)(-D)(1/D)(1/g_m)(1/r_o) + (1/D)(-D)(1/D)
//
// where the first and last terms cancel only after each product is put over a
// common denominator.  Normalize supported symbolic expressions as a rational
// numerator/denominator pair, cancel exact factors, and only then render them.
// This is algebraic normalization, not an approximation: asymptotic rules are
// still applied by applyAnalysisApproximations afterwards.
function sxFactorList(value) {
  if (value?.kind === 'mul') return value.terms.flatMap((term) => sxFactorList(term));
  return value ? [value] : [];
}

function sxRationalCancel(num, den) {
  let numerator = simplifySx(num);
  let denominator = simplifySx(den);
  if (sxIsZero(numerator)) return { num: sxNumber(0), den: sxNumber(1) };
  const numerators = sxFactorList(numerator);
  const denominators = sxFactorList(denominator);
  let sign = 1;
  for (let ni = numerators.length - 1; ni >= 0; ni--) {
    const factor = numerators[ni];
    const match = denominators.findIndex((candidate) => sxKey(candidate) === sxKey(factor)
      || isNegatedSxEquivalent(candidate, factor));
    if (match < 0) continue;
    if (isNegatedSxEquivalent(denominators[match], factor)) sign *= -1;
    numerators.splice(ni, 1);
    denominators.splice(match, 1);
  }
  numerator = sxMul(sxNumber(sign), ...numerators);
  denominator = sxMul(...denominators);
  return { num: simplifySx(numerator), den: simplifySx(denominator) };
}

function sxRationalAdd(left, right) {
  const leftFactors = sxFactorList(left.den);
  const rightFactors = sxFactorList(right.den);
  const shared = [];
  const remainingRight = [...rightFactors];
  const remainingLeft = [];
  for (const factor of leftFactors) {
    const match = remainingRight.findIndex((candidate) => sxKey(candidate) === sxKey(factor));
    if (match >= 0) {
      shared.push(factor);
      remainingRight.splice(match, 1);
    } else {
      remainingLeft.push(factor);
    }
  }
  // Use the least common product instead of multiplying both complete
  // denominators. This keeps Gaussian-elimination results factored and lets
  // the following cancellation pass see identities such as D-D immediately.
  return sxRationalCancel(
    sxAdd(sxMul(left.num, ...remainingRight), sxMul(right.num, ...remainingLeft)),
    sxMul(...shared, ...remainingLeft, ...remainingRight),
  );
}

function sxRationalize(value) {
  if (!value) return { num: sxNumber(0), den: sxNumber(1) };
  if (value.kind === 'number' || value.kind === 'symbol') return { num: value, den: sxNumber(1) };
  if (value.kind === 'neg') {
    const inner = sxRationalize(value.value);
    return sxRationalCancel(sxNeg(inner.num), inner.den);
  }
  if (value.kind === 'inv') {
    const inner = sxRationalize(value.value);
    return sxRationalCancel(inner.den, inner.num);
  }
  if (value.kind === 'parallel') {
    return sxRationalize(sxInv(sxAdd(...value.terms.map((term) => sxInv(term)))));
  }
  if (value.kind === 'mul' || value.kind === 'product') {
    return value.terms.reduce((result, term) => {
      const next = sxRationalize(term);
      return sxRationalCancel(sxMul(result.num, next.num), sxMul(result.den, next.den));
    }, { num: sxNumber(1), den: sxNumber(1) });
  }
  if (value.kind === 'add' || value.kind === 'sum') {
    return value.terms.reduce((result, term) => sxRationalAdd(result, sxRationalize(term)), { num: sxNumber(0), den: sxNumber(1) });
  }
  return { num: value, den: sxNumber(1) };
}

const MAX_EXPANDED_TERMS = 64;

function expandSx(value, limit = MAX_EXPANDED_TERMS) {
  if (!value || value.kind === 'number' || value.kind === 'symbol') return value;
  if (value.kind === 'neg') return sxNeg(expandSx(value.value, limit));
  if (value.kind === 'inv') return { kind: 'inv', value: expandSx(value.value, limit) };
  if (value.kind === 'add' || value.kind === 'parallel') {
    return { ...value, terms: value.terms.map((term) => expandSx(term, limit)) };
  }
  if (value.kind !== 'mul' && value.kind !== 'product') return value;
  let products = [sxNumber(1)];
  for (const term of value.terms) {
    const expanded = expandSx(term, limit);
    const choices = expanded?.kind === 'add' ? expanded.terms : [expanded];
    if (products.length * choices.length > limit) return value;
    products = products.flatMap((product) => choices.map((choice) => sxMul(product, choice)));
  }
  return sxAdd(...products);
}

function combineLikeSxTerms(terms) {
  const groups = new Map();
  for (const term of terms) {
    const signed = signedSxTerm(term);
    let coefficient = signed.sign;
    const factors = [];
    for (const factor of sxFactorList(signed.value)) {
      if (factor?.kind === 'number') coefficient *= factor.value;
      else factors.push(factor);
    }
    const base = sxMul(...factors);
    const key = sxKey(base);
    const group = groups.get(key) || { base, coefficient: 0 };
    group.coefficient += coefficient;
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter(({ coefficient }) => coefficient !== 0)
    .map(({ base, coefficient }) => sxMul(sxNumber(coefficient), base));
}

function simplifyExpandedSx(value, factorAdds = true) {
  if (!value || value.kind === 'number' || value.kind === 'symbol') return value;
  if (value.kind === 'neg') return sxNeg(simplifyExpandedSx(value.value, factorAdds));
  if (value.kind === 'inv') return { kind: 'inv', value: simplifyExpandedSx(value.value) };
  if (value.kind === 'add') {
    const terms = value.terms.flatMap((term) => {
      const simplified = simplifyExpandedSx(term, false);
      return simplified?.kind === 'add' ? simplified.terms : [simplified];
    }).filter(Boolean);
    const combined = combineLikeSxTerms(terms);
    if (!combined.length) return sxNumber(0);
    const factored = factorAdds ? factorCommonSxAdd(combined, true) : null;
    return factored || (combined.length === 1 ? combined[0] : { kind: 'add', terms: combined });
  }
  if (value.kind === 'mul' || value.kind === 'product') {
    return sxMul(...value.terms.map((term) => simplifyExpandedSx(term, false)));
  }
  if (value.kind === 'parallel') {
    return { ...value, terms: value.terms.map((term) => simplifyExpandedSx(term, false)) };
  }
  return value;
}

function hasProductOfSums(value) {
  if (!value) return false;
  if (value.kind === 'mul' || value.kind === 'product') {
    const additive = value.terms.some((term) => term?.kind === 'add' || term?.kind === 'sum'
      || ((term?.kind === 'inv' || term?.kind === 'neg')
        && (term.value?.kind === 'add' || term.value?.kind === 'sum')));
    if (additive) return true;
    return value.terms.some(hasProductOfSums);
  }
  if (value.kind === 'inv' || value.kind === 'neg') return hasProductOfSums(value.value);
  return (value.terms || []).some(hasProductOfSums);
}

function normalizeSxRational(value, algebraic = false) {
  const legacy = simplifySx(value);
  if (!algebraic || !hasProductOfSums(value)) return legacy;
  const rational = sxRationalize(value);
  const numerator = simplifyExpandedSx(expandSx(rational.num));
  const denominator = simplifyExpandedSx(expandSx(rational.den));
  const cancelled = sxRationalCancel(numerator, denominator);
  if (sxIsZero(cancelled.num)) return sxNumber(0);
  const candidateRaw = sxKey(cancelled.den) === sxKey(sxNumber(1))
    ? simplifySx(cancelled.num)
    : simplifySx(sxMul(cancelled.num, sxInv(cancelled.den)));
  const candidate = hasProductOfSums(candidateRaw)
    ? simplifyExpandedSx(expandSx(candidateRaw))
    : candidateRaw;
  // Preserve compact parallel/product forms when rational normalization does
  // not materially reduce the expression. This keeps textbook R||R and RC
  // displays stable while still replacing elimination explosions.
  return sxTreeSize(candidate) < sxTreeSize(legacy) ? candidate : legacy;
}

/** Cancel a common symbolic factor through products and sums.  Gaussian
 * elimination often produces `(g_m V_in + g_ds V_in)/V_in`; retaining that
 * literal ratio makes a valid common-gate gain look wrong to a reader.  Only
 * cancel when every additive branch contains the factor, so this remains a
 * conservative algebraic simplification rather than a numerical assumption.
 */
function sxCancelFactor(value, factor) {
  if (!value || !factor) return null;
  const same = sxKey(value) === sxKey(factor);
  if (same) return sxNumber(1);
  if (value.kind === 'neg') {
    const reduced = sxCancelFactor(value.value, factor);
    return reduced ? sxNeg(reduced) : null;
  }
  if (value.kind === 'mul') {
    const direct = value.terms.findIndex((term) => sxKey(term) === sxKey(factor));
    if (direct >= 0) return sxMul(...value.terms.filter((_, index) => index !== direct));
    for (let index = 0; index < value.terms.length; index++) {
      const reduced = sxCancelFactor(value.terms[index], factor);
      if (!reduced) continue;
      return sxMul(reduced, ...value.terms.filter((_, termIndex) => termIndex !== index));
    }
    return null;
  }
  if (value.kind === 'add') {
    const reduced = value.terms.map((term) => sxCancelFactor(term, factor));
    return reduced.every(Boolean) ? sxAdd(...reduced) : null;
  }
  return null;
}

function reciprocalParallelTerms(value) {
  // Do not reinterpret an ordinary denominator such as `1 + g_m r_o` as
  // `1 || 1/(g_m r_o)`; that was the source of misleading common-gate Zin
  // equations.  Admittance terms such as `1/R + sC` are still a valid
  // parallel group even though the capacitor term is not syntactically an
  // inverse node.
  if (value?.kind !== 'add' || value.terms.length < 2) return null;
  if (value.terms.some((term) => term?.kind === 'number' || term?.kind === 'neg')) return null;
  if (!value.terms.some((term) => term?.kind === 'inv')) return null;
  return value.terms.map((term) => term?.kind === 'inv' ? term.value : { kind: 'inv', value: term });
}
function isReciprocalParallel(value) {
  return !!reciprocalParallelTerms(value);
}
function parallelSeparator(rendered) {
  return ' \\|\\| ';
}
function sxIsZero(value) { return !value || (value.kind === 'number' && value.value === 0); }
function sxDependencies(value, out = new Set()) {
  if (!value) return out;
  if (value.source) out.add(value.source);
  for (const child of value.terms || []) sxDependencies(child, out);
  if (value.value && typeof value.value === 'object') sxDependencies(value.value, out);
  return out;
}
function sxText(value, parent = null, clean = false) {
  if (!value) return '0';
  if (value.kind === 'number') return String(value.value);
  if (value.kind === 'symbol') return value.name;
  if (value.kind === 'power') return `${sxText(value.base, 'power', clean)}^{${value.exponent}}`;
  if (value.kind === 'neg') {
    return value.value.kind === 'add'
      ? `-\\left(${sxText(value.value, null, clean)}\\right)`
      : `-${sxText(value.value, 'neg', clean)}`;
  }
  if (value.kind === 'inv') {
    const parallelTerms = reciprocalParallelTerms(value.value);
    if (parallelTerms) {
      const rendered = parallelTerms.map((term) => sxText(term, 'parallel', clean));
      const body = rendered.join(parallelSeparator(rendered));
      return parent && parent !== 'parallel' ? `\\left(${body}\\right)` : body;
    }
    return `\\frac{1}{${sxText(value.value, null, clean)}}`;
  }
  // Compact impedance reducers use the same lightweight expression tree as
  // the nodal solver but keep parallel groups as `parallel` nodes.  Accept
  // those nodes here so a Norton gain can multiply G_m by the compact R_out
  // expression without dropping the load from the rendered equation.
  if (value.kind === 'parallel' || value.kind === 'product' || value.kind === 'sum') {
    if (value.kind === 'product' && value.terms.length === 2) {
      const inverseIndex = value.terms.findIndex((term) => term?.kind === 'inv');
      const numerator = value.terms[1 - inverseIndex];
      const denominator = inverseIndex >= 0 ? value.terms[inverseIndex]?.value : null;
      if (inverseIndex >= 0 && numerator && denominator && numerator.kind !== 'inv'
        && parent === null && !isReciprocalParallel(denominator)) {
        const fraction = `\\frac{${sxText(numerator, null, clean)}}{${sxText(denominator, null, clean)}}`;
        return parent === 'sum' ? `\\left(${fraction}\\right)` : fraction;
      }
    }
    const terms = value.kind === 'product' ? orderedProductTerms(value.terms) : value.terms;
    const rendered = terms.map((term) => sxText(term, value.kind, clean));
    let body = rendered[0] || '';
    for (let i = 1; i < rendered.length; i++) {
      const previous = terms[i - 1];
      const current = terms[i];
      const join = value.kind === 'parallel' ? parallelSeparator(rendered)
        : value.kind === 'product'
          ? (previous?.kind === 'inv' && current?.kind === 'inv' ? ' \\, \\cdot \\, ' : ' \\, ')
          : ' + ';
      body += join + rendered[i];
    }
    return parent && parent !== value.kind ? `\\left(${body}\\right)` : body;
  }
  if (value.kind === 'mul') {
    const negativeAdd = clean && value.terms.find((term) => term?.kind === 'neg' && term.value?.kind === 'add');
    if (negativeAdd) {
      const rest = value.terms.map((term) => term === negativeAdd ? negativeAdd.value : term);
      return `-${sxText(sxMul(...rest), parent, clean)}`;
    }
    const allNegativeAdd = clean && value.terms.find((term) => term?.kind === 'add'
      && term.terms.length > 1 && term.terms.every((child) => signedSxTerm(child).sign < 0));
    if (allNegativeAdd) {
      const positiveTerms = allNegativeAdd.terms
        .map((child) => signedSxTerm(child).value)
        // Put a scalar constant after the physical factors in a normalized
        // magnitude such as `-(r_o + 1)`.
        .sort((left, right) => (left.kind === 'number') - (right.kind === 'number'));
      const positive = sxAdd(...positiveTerms);
      const rest = value.terms.map((term) => term === allNegativeAdd ? positive : term);
      return `-${sxText(sxMul(...rest), parent, clean)}`;
    }
    // Keep polarity readable in textbook form: `-g_{m1}`, never the noisy
    // intermediate `-1 \\, g_{m1}` that can appear after elimination.
    const negativeOne = value.terms.findIndex((term) => term.kind === 'number' && term.value === -1);
    if (negativeOne >= 0) {
      const rest = value.terms.filter((_, index) => index !== negativeOne);
      if (rest.length) return `-${sxText(sxMul(...rest), parent, clean)}`;
    }
    // A reciprocal used as the complete top-level second factor reads much
    // more clearly as one fraction: `A \\, 1/B` becomes `\\frac{A}{B}`. Keep
    // nested products in multiplicative form; rewriting every inner factor
    // creates a stack of fractions in a nodal impedance. Also leave an
    // inverse admittance group alone so its `R_1 \\|\\| R_2` rendering is not
    // replaced by the underlying `1/R_1 + 1/R_2` when it is used in A_v.
    if (value.terms.some((term) => term?.kind === 'inv')) {
      const inverseIndex = value.terms.findIndex((term) => term?.kind === 'inv');
      const numerator = sxMul(...value.terms.filter((_, index) => index !== inverseIndex));
      const denominator = inverseIndex >= 0 ? value.terms[inverseIndex]?.value : null;
      if (inverseIndex >= 0 && numerator && denominator && numerator.kind !== 'inv'
        && parent === null && !isReciprocalParallel(denominator)) {
        const numeratorText = sxText(numerator, null, clean);
        const denominatorText = sxText(denominator, null, clean);
        const fraction = `\\frac{${numeratorText}}{${denominatorText}}`;
        return parent === 'add' && !clean ? `\\left(${fraction}\\right)` : fraction;
      }
    }
    const terms = orderedProductTerms(value.terms);
    const displayTerms = clean ? combineRepeatedDisplayFactors(terms) : terms;
    const rendered = displayTerms.map((term) => sxText(term, 'mul', clean));
    // Back-to-back reciprocal terms are visually ambiguous once rendered as
    // stacked fractions.  Use an explicit multiplication dot between them;
    // ordinary products keep the lighter textbook spacing.
    let body = rendered[0] || '';
    for (let i = 1; i < rendered.length; i++) {
      const previous = displayTerms[i - 1];
      const current = displayTerms[i];
      const separator = previous?.kind === 'inv' && current?.kind === 'inv'
        ? ' \\, \\cdot \\, '
        : ' \\, ';
      body += separator + rendered[i];
    }
    return clean ? body : parent === 'add' ? `\\left(${body}\\right)` : body;
  }
  if (value.kind === 'add') {
    const signedTerms = value.terms.map(signedSxTerm);
    if (signedTerms.length > 1 && signedTerms.every(({ sign }) => sign < 0)) {
      const positive = sxAdd(...signedTerms.map(({ value: term }) => term));
      return `-\\left(${sxText(positive, null, clean)}\\right)`;
    }
    const body = value.terms.map((term, index) => {
      const signed = signedSxTerm(term);
      const body = sxText(signed.value, 'add', clean);
      if (index === 0) return signed.sign < 0 ? `-${body}` : body;
      return signed.sign < 0 ? `- ${body}` : `+ ${body}`;
    }).join(' ');
    return parent && parent !== 'add' ? `\\left(${body}\\right)` : body;
  }
  return '';
}

function polynomialConstant(value) {
  return sxIsZero(value) ? new Map() : new Map([[0, value]]);
}

function polynomialClean(value) {
  return new Map([...value.entries()]
    .map(([power, coefficient]) => {
      const simplified = simplifySx(coefficient);
      const factored = simplified?.kind === 'add' ? factorCommonSxAdd(simplified.terms) : null;
      return [power, factored ? simplifySx(factored) : simplified];
    })
    .filter(([, coefficient]) => !sxIsZero(coefficient))
    .sort(([left], [right]) => left - right));
}

function polynomialAdd(...values) {
  const result = new Map();
  for (const polynomial of values) {
    for (const [power, coefficient] of polynomial || []) {
      result.set(power, sxAdd(result.get(power), coefficient));
    }
  }
  return polynomialClean(result);
}

function polynomialNeg(value) {
  return polynomialClean(new Map([...value.entries()].map(([power, coefficient]) => [power, sxNeg(coefficient)])));
}

function polynomialMul(left, right) {
  const result = new Map();
  for (const [leftPower, leftCoefficient] of left || []) {
    for (const [rightPower, rightCoefficient] of right || []) {
      const power = leftPower + rightPower;
      result.set(power, sxAdd(result.get(power), sxMul(leftCoefficient, rightCoefficient)));
    }
  }
  return polynomialClean(result);
}

function polynomialRationalAdd(values) {
  let numerator = new Map();
  let denominator = polynomialConstant(sxNumber(1));
  for (const value of values) {
    numerator = polynomialAdd(
      polynomialMul(numerator, value.denominator),
      polynomialMul(value.numerator, denominator),
    );
    denominator = polynomialMul(denominator, value.denominator);
  }
  return { numerator, denominator };
}

function sxFrequencyRational(value) {
  if (!value) return { numerator: new Map(), denominator: polynomialConstant(sxNumber(1)) };
  if (value.kind === 'number') return { numerator: polynomialConstant(value), denominator: polynomialConstant(sxNumber(1)) };
  if (value.kind === 'symbol') {
    const power = value.name === 's' ? 1 : String(value.name || '').match(/^s\^\{(\d+)\}$/)?.[1];
    return power
      ? { numerator: new Map([[Number(power), sxNumber(1)]]), denominator: polynomialConstant(sxNumber(1)) }
      : { numerator: polynomialConstant(value), denominator: polynomialConstant(sxNumber(1)) };
  }
  if (value.kind === 'neg') {
    const inner = sxFrequencyRational(value.value);
    return { numerator: polynomialNeg(inner.numerator), denominator: inner.denominator };
  }
  if (value.kind === 'inv') {
    const inner = sxFrequencyRational(value.value);
    return { numerator: inner.denominator, denominator: inner.numerator };
  }
  if (value.kind === 'mul' || value.kind === 'product') {
    return value.terms.reduce((result, term) => {
      const next = sxFrequencyRational(term);
      return {
        numerator: polynomialMul(result.numerator, next.numerator),
        denominator: polynomialMul(result.denominator, next.denominator),
      };
    }, { numerator: polynomialConstant(sxNumber(1)), denominator: polynomialConstant(sxNumber(1)) });
  }
  if (value.kind === 'add' || value.kind === 'sum') {
    return polynomialRationalAdd(value.terms.map((term) => sxFrequencyRational(term)));
  }
  if (value.kind === 'parallel') {
    return sxFrequencyRational(sxInv(sxAdd(...value.terms.map((term) => sxInv(term)))));
  }
  return { numerator: polynomialConstant(value), denominator: polynomialConstant(sxNumber(1)) };
}

function polynomialDegree(value) {
  return value?.size ? Math.max(...value.keys()) : -1;
}

function polynomialToSx(value) {
  const terms = [...(value || [])].sort(([left], [right]) => right - left).map(([power, coefficient]) => {
    if (power === 0) return coefficient;
    const frequency = sxSymbol(power === 1 ? 's' : `s^{${power}}`);
    return sxMul(coefficient, frequency);
  });
  return sxAdd(...terms);
}

function polynomialCancelCommonFactors(numerator, denominator) {
  let nextNumerator = polynomialClean(numerator);
  let nextDenominator = polynomialClean(denominator);
  const first = [...nextNumerator.values()][0];
  const candidates = sxFactorList(first).filter((factor) => factor?.kind !== 'number');
  for (const factor of candidates) {
    const numeratorReduced = [...nextNumerator].map(([power, coefficient]) => [power, sxCancelFactor(coefficient, factor)]);
    const denominatorReduced = [...nextDenominator].map(([power, coefficient]) => [power, sxCancelFactor(coefficient, factor)]);
    if (numeratorReduced.some(([, coefficient]) => !coefficient) || denominatorReduced.some(([, coefficient]) => !coefficient)) continue;
    nextNumerator = polynomialClean(new Map(numeratorReduced));
    nextDenominator = polynomialClean(new Map(denominatorReduced));
  }
  return { numerator: nextNumerator, denominator: nextDenominator };
}

function frequencyResponseFromExpression(expression) {
  const rational = sxFrequencyRational(expression);
  const cancelled = polynomialCancelCommonFactors(rational.numerator, rational.denominator);
  const numerator = cancelled.numerator;
  const denominator = cancelled.denominator;
  return {
    numerator,
    denominator,
    numeratorDegree: polynomialDegree(numerator),
    denominatorDegree: polynomialDegree(denominator),
    expression: simplifySx(sxDiv(polynomialToSx(numerator), polynomialToSx(denominator))),
  };
}

function dominantPoleResponse(response) {
  if (!response || response.denominatorDegree <= 1) return response;
  const denominator = polynomialClean(new Map([...response.denominator].filter(([power]) => power <= 1)));
  if (polynomialDegree(denominator) < 1) return response;
  return {
    ...response,
    denominator,
    denominatorDegree: polynomialDegree(denominator),
    expression: simplifySx(sxDiv(polynomialToSx(response.numerator), polynomialToSx(denominator))),
    dominantPoleApplied: true,
  };
}

function polynomialRootDescriptors(polynomial, prefix) {
  const degree = polynomialDegree(polynomial);
  if (degree < 1) return [];
  const coefficient = (power) => sxText(polynomial.get(power) || sxNumber(0), null, true);
  if (degree === 1) {
    const constant = polynomial.get(0) || sxNumber(0);
    const factoredConstant = constant.kind === 'add'
      ? factorCommonSxAdd(constant.terms) || constant
      : constant;
    const root = simplifySx(sxDiv(sxNeg(factoredConstant), polynomial.get(1)));
    return [{
      name: `${prefix}_{0}`,
      equation: `${prefix}_{0} = ${sxText(root, null, true)}`,
      expression: root,
      explicit: true,
    }];
  }
  if (degree === 2) {
    const a0 = coefficient(0);
    const a1 = coefficient(1);
    const a2 = coefficient(2);
    return [{
      name: `${prefix}_{0,1}`,
      equation: `${prefix}_{0,1} = \\frac{-(${a1}) \\pm \\sqrt{(${a1})^2 - 4 \\, (${a2}) \\, (${a0})}}{2 \\, (${a2})}`,
      explicit: true,
    }];
  }
  return [{
    name: `${prefix}_{0\\ldots${degree - 1}}`,
    equation: `${prefix}_{0\\ldots${degree - 1}}: \\text{roots of } ${sxText(polynomialToSx(polynomial), null, true)} = 0`,
    explicit: false,
  }];
}

function frequencyResponseSummary(model, selectedExpression, exactExpression, options = {}) {
  const hasAcComponents = model.elements.some((element) => element.kind === 'capacitor' || element.kind === 'inductor');
  if (!hasAcComponents || (!expressionHasFrequency(selectedExpression) && !expressionHasFrequency(exactExpression))) return null;
  const exact = frequencyResponseFromExpression(exactExpression || selectedExpression);
  const selectedBase = frequencyResponseFromExpression(selectedExpression || exactExpression);
  const flags = normalizeAnalysisApproximations(options);
  const selected = flags.dominantPoleApproximation ? dominantPoleResponse(selectedBase) : selectedBase;
  const poles = polynomialRootDescriptors(selected.denominator, 'p');
  const zeros = polynomialRootDescriptors(selected.numerator, 'z');
  return {
    hasFrequency: true,
    numerator: polynomialToSx(selected.numerator),
    denominator: polynomialToSx(selected.denominator),
    numeratorDegree: selected.numeratorDegree,
    denominatorDegree: selected.denominatorDegree,
    expression: selected.expression,
    poles,
    zeros,
    dominantPoleApplied: !!selected.dominantPoleApplied,
    exact: {
      numerator: polynomialToSx(exact.numerator),
      denominator: polynomialToSx(exact.denominator),
      numeratorDegree: exact.numeratorDegree,
      denominatorDegree: exact.denominatorDegree,
      expression: exact.expression,
      poles: polynomialRootDescriptors(exact.denominator, 'p'),
      zeros: polynomialRootDescriptors(exact.numerator, 'z'),
    },
  };
}

function nodeLabel(circuit, nodeId, targetId, referenceIds, inputId = null) {
  if (nodeId === '@AC_GROUND' || referenceIds.has(nodeId)) return '0';
  if (nodeId === targetId) return 'V_{out}';
  if (inputId && nodeId === inputId) return 'V_{in}';
  return netLabel(circuit.nets.get(nodeId)) || nodeId;
}

function modelNodeId(model, nodeId) {
  return model?.nodeAliases?.get(nodeId) || nodeId;
}

function systemRefdes(refdes, prefix, fallback = prefix) {
  return indexedName(refdes, prefix) || `${fallback}_{${String(refdes)}}`;
}

function systemMosName(refdes, kind) {
  const raw = String(refdes);
  const ordinary = raw.match(/^M([0-9]+)$/i)?.[1];
  // Keep the familiar textbook spelling for the canonical M1/M2/... names.
  // Non-standard prefixes (MN1, MP1, MN_1, ...) retain the complete refdes so
  // distinct device identities cannot alias merely because their suffixes
  // happen to match.
  const identity = ordinary ? ordinary : raw.replace(/[^A-Za-z0-9_]/g, '_');
  if (kind === 'ro') return ordinary ? `r_{o${identity}}` : `r_{o,${identity}}`;
  if (kind === 'rds') return ordinary ? `r_{ds${identity}}` : `r_{ds,${identity}}`;
  if (kind === 'gmb') return ordinary ? `g_{mb${identity}}` : `g_{mb,${identity}}`;
  return ordinary ? `g_{m${identity}}` : `g_{m,${identity}}`;
}

function systemCapName(refdes) {
  return indexedName(refdes, 'C');
}

function isCurrentSourceModel(model) {
  return ['current-source', 'current_source', 'ideal-current-source', 'open'].includes(model);
}

function isTriodeModel(model) {
  return ['triode', 'resistor', 'rds', 'r_ds'].includes(model);
}

/** Normalize the small set of textbook approximations exposed by the UI. */
export function normalizeAnalysisApproximations(options = {}) {
  const values = new Set((Array.isArray(options.approximations) ? options.approximations : [options.approximations])
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase().replace(/_/g, '-')));
  const has = (...names) => names.some((name) => values.has(name));
  const dcOnly = !!options.dcOnly || !!options.dcOperatingPoint || has('dc', 'dc-only', 'dc-operating-point');
  const cascodeApproximation = !!options.cascodeApproximation || !!options.cascodeReduction
    || has('cascode', 'cascode-reduction', 'cascode-approximation', 'cascode-dominant');
  const dominantPoleApproximation = !!options.dominantPoleApproximation || !!options.dominantPole
    || has('dominant-pole', 'dominant-pole-approximation', 'dominant-pole-reduction');
  const explicitMiller = options.millerApproximation ?? options.miller;
  return {
    ignoreChannelLengthModulation: !!options.ignoreChannelLengthModulation || has('ignore-channel-length-modulation', 'ignore-clm', 'ro-infinity', 'neglect-ro'),
    ignoreBodyEffect: !!options.ignoreBodyEffect || has('ignore-body-effect', 'ignore-gmb', 'gmb-zero'),
    gmroLarge: !!options.gmroLarge || !!options.assumeGmRoLarge || has('gmro-large', 'gmro>>1', 'gm-ro-large', 'large-gmro'),
    dcOnly,
    cascodeApproximation,
    dominantPoleApproximation,
    // Miller is the normal textbook reduction. Callers can opt out with an
    // explicit false (the exact/reference pass does this); legacy option
    // objects that omit the field therefore get the useful default-on path.
    miller: dcOnly ? false : explicitMiller === undefined ? true : !!explicitMiller,
  };
}

function textbookApproximationNotes(options = {}, circuit = null) {
  const flags = normalizeAnalysisApproximations(options);
  const assumptions = [];
  const approximations = [];
  if (flags.ignoreChannelLengthModulation) {
    const finite = [...new Set([
      ...finiteRoOverrideRefs(circuit),
      ...splitContextValues(options.retainFiniteRoDevices),
    ])];
    assumptions.push(finite.length
      ? `Channel-length modulation is ignored for MOS devices by default; ${finite.join(', ')} explicitly retain finite r_o.`
      : 'Channel-length modulation is ignored, so each MOS output resistance r_o is treated as infinite.');
    approximations.push(finite.length
      ? `Textbook approximation: r_o \u2192 \u221e except for ${finite.join(', ')} (finite r_o override).`
      : 'Textbook approximation: r_o \u2192 \u221e (MOS output conductance g_o = 0).');
  }
  if (flags.ignoreBodyEffect) {
    assumptions.push('Body effect is ignored, so g_{mb} is set to zero for the small-signal model.');
    approximations.push('Textbook approximation: g_{mb} = 0.');
  }
  if (flags.gmroLarge) {
    assumptions.push('The strong intrinsic-gain condition g_m r_o \u226b 1 is assumed wherever a lower-order term is discarded.');
    approximations.push('Textbook approximation: g_m r_o \\gg 1.');
  }
  if (flags.dcOnly) {
    assumptions.push('DC-only reduction: capacitors are open circuits and inductors are short circuits.');
    approximations.push('DC operating-point topology: C \u2192 open, L \u2192 short.');
  }
  if (flags.dominantPoleApproximation) {
    assumptions.push('The dominant-pole option keeps the constant and first-order terms of the AC denominator when it has higher order.');
    approximations.push('Dominant-pole approximation selected; it applies only when the AC denominator has multiple poles.');
  }
  const miller = millerApproximationCandidates(circuit, options);
  if (flags.miller && miller.length) {
    assumptions.push(`Miller approximation is applied to feedback impedances with an explicitly high forward gain (${miller.map((candidate) => {
      const devices = candidate.gain?.devices?.map((device) => device.refdes).join('/') || candidate.device?.refdes || candidate.stageLabel || 'multi-stage path';
      return `${candidate.impedance.refdes}/${devices}`;
    }).join(', ')}).`);
    approximations.push('Miller approximation: each eligible feedback impedance is split into input and output shunt impedances using the derived DC stage gain.');
  }
  return { flags, assumptions, approximations };
}

function exactAnalysisOptions(options = {}) {
  return {
    ...options,
    // Preserve the selected topology/context, but make the recursive
    // reference pass unambiguously exact.  The marker above prevents future
    // approximation switches from re-introducing recursion.
    exactAnalysis: true,
    approximations: [],
    dcOnly: false,
    dcOperatingPoint: false,
    ignoreChannelLengthModulation: false,
    ignoreBodyEffect: false,
    gmroLarge: false,
    assumeGmRoLarge: false,
    millerApproximation: false,
    miller: false,
    cascodeApproximation: false,
    cascodeReduction: false,
    dominantPoleApproximation: false,
    dominantPole: false,
    ignoreResistanceOverrides: true,
    ignoreRoDevices: [],
    ignoreChannelLengthModulationDevices: [],
    ignoreDeviceGmroOverrides: true,
  };
}

function isRoSymbol(value) {
  return value?.kind === 'symbol' && /^r_\{o/.test(value.name || '');
}

function isGmSymbol(value) {
  return value?.kind === 'symbol' && /^g_\{m/.test(value.name || '');
}

function symbolRefdes(value) {
  const base = unwrapSxNeg(value).value;
  if (base?.source) return String(base.source);
  const match = String(base?.name || '').match(/^[gr]_\{(?:m|mb|o)([^}]*)\}/);
  return match?.[1] ? `M${match[1]}` : null;
}

function approximationAppliesToSymbol(value, refs) {
  if (!refs) return true;
  const refdes = symbolRefdes(value);
  return !!refdes && refs.has(refdes);
}

function unwrapSxNeg(value) {
  let current = value;
  let sign = 1;
  while (current?.kind === 'neg') {
    sign *= -1;
    current = current.value;
  }
  return { sign, value: current };
}

function signedSxTerm(value) {
  const unwrapped = unwrapSxNeg(value);
  let current = unwrapped.value;
  let sign = unwrapped.sign;
  if (current?.kind === 'number' && current.value < 0) {
    sign *= -1;
    current = sxNumber(-current.value);
  }
  if (current?.kind === 'mul') {
    const negativeOne = current.terms.findIndex((term) => term.kind === 'number' && term.value === -1);
    if (negativeOne >= 0) {
      sign *= -1;
      current = sxMul(...current.terms.filter((_, index) => index !== negativeOne));
    }
  }
  return { sign, value: current };
}

function isStandaloneRo(value) {
  const base = unwrapSxNeg(value).value;
  return isRoSymbol(base);
}

function isInverseRo(value) {
  const base = unwrapSxNeg(value).value;
  return base?.kind === 'inv' && isRoSymbol(base.value);
}

function isInverseGm(value) {
  const base = unwrapSxNeg(value).value;
  return base?.kind === 'inv' && isGmSymbol(base.value);
}

function hasLowerOrderGmRoCorrection(value, refs = null) {
  const terms = value?.kind === 'mul' ? value.terms : [value];
  // Output-short solutions commonly expose the cascode correction as
  // g_m1/(g_m2 r_o2).  Under g_m2 r_o2 >> 1 it is lower order than the direct
  // input-device transconductance, even though it is not syntactically a
  // g_m·r_o product yet.
  return terms.some((term) => isInverseRo(term) && approximationAppliesToSymbol(term.value, refs))
    && terms.some((term) => isInverseGm(term) && approximationAppliesToSymbol(term.value, refs));
}

function isStandaloneOne(value) {
  const base = unwrapSxNeg(value);
  return base.value?.kind === 'number' && Math.abs(base.value.value) === 1;
}

function isStandaloneGm(value) {
  return isGmSymbol(unwrapSxNeg(value).value);
}

function gmRoProduct(value) {
  const base = unwrapSxNeg(value).value;
  if (base?.kind !== 'mul') return null;
  const ros = base.terms.filter((term) => isRoSymbol(unwrapSxNeg(term).value));
  const gm = base.terms.find((term) => isGmSymbol(unwrapSxNeg(term).value));
  return ros.length && gm ? { ros, gm } : null;
}

/** Factor an exact symbolic product shared by every additive branch. */
function factorCommonSxAdd(terms, allowAny = false) {
  if (!Array.isArray(terms) || terms.length < 2) return null;
  const factorsOf = (term) => {
    const unwrapped = unwrapSxNeg(term);
    const factors = unwrapped.value?.kind === 'mul' ? [...unwrapped.value.terms] : [unwrapped.value];
    return unwrapped.sign < 0 ? [sxNumber(-1), ...factors] : factors;
  };
  const first = factorsOf(terms[0]);
  if (!first.length) return null;
  const used = terms.map(() => new Map());
  const common = [];
  for (const candidate of first) {
    const key = sxKey(candidate);
    const available = terms.every((term, index) => {
      const count = factorsOf(term).filter((factor) => sxKey(factor) === key).length;
      const consumed = used[index].get(key) || 0;
      if (consumed >= count) return false;
      used[index].set(key, consumed + 1);
      return true;
    });
    if (available) common.push(candidate);
  }
  // Do not factor a lone numeric sign. Symbolic common factors are useful
  // here because they expose cancellations between a solved numerator and
  // denominator (`g_m r_o + g_m g_n r_o r_n`).
  const symbolicCommon = common.filter((factor) => factor?.kind !== 'number');
  if (!symbolicCommon.length || (!allowAny && !symbolicCommon.some((factor) => isGmSymbol(factor))
    && !symbolicCommon.some((factor) => factor?.kind === 'inv'))) return null;
  const reduced = terms.map((term) => {
    const factors = factorsOf(term);
    for (const candidate of symbolicCommon) {
      const index = factors.findIndex((factor) => sxKey(factor) === sxKey(candidate));
      if (index >= 0) factors.splice(index, 1);
    }
    return sxMul(...factors);
  });
  const signed = reduced.map(signedSxTerm);
  if (signed.every(({ sign }) => sign < 0)) {
    return sxNeg(sxMul(...symbolicCommon, sxAdd(...signed.map(({ value }) => value))));
  }
  return sxMul(...symbolicCommon, sxAdd(...reduced));
}

function factorSxAddOnce(value) {
  if (value?.kind !== 'add' || value.terms.length < 3 || value.terms.length > 12) return value;
  const factorsOf = (term) => sxFactorList(signedSxTerm(term).value)
    .filter((factor) => factor?.kind !== 'number');
  let best = null;
  for (const factors of value.terms.map(factorsOf)) {
    const unique = [...new Map(factors.map((factor) => [sxKey(factor), factor])).values()];
    for (let mask = 1; mask < (1 << unique.length); mask++) {
      const selected = unique.filter((_, index) => mask & (1 << index));
      const group = value.terms.filter((term) => {
        const available = factorsOf(term).map(sxKey);
        return selected.every((factor) => {
          const index = available.indexOf(sxKey(factor));
          if (index < 0) return false;
          available.splice(index, 1);
          return true;
        });
      });
      if (group.length < 2 || group.length === value.terms.length
        || (group.length === 2 && selected.length === 1)) continue;
      const score = selected.length * group.length;
      if (!best || score > best.score || (score === best.score && selected.length > best.selected.length)) {
        best = { selected, group, score };
      }
    }
  }
  if (!best) return value;
  const factored = factorCommonSxAdd(best.group, true);
  if (!factored) return value;
  const grouped = new Set(best.group);
  return sxAdd(...[...value.terms.filter((term) => !grouped.has(term)), factored]
    .sort((left, right) => sxTreeSize(left) - sxTreeSize(right) || sxText(left).localeCompare(sxText(right))));
}

/** Keep only the dominant term in familiar `1 + g_m r_o` / cascode sums. */
function applyGmRoApproximation(value, refs = null) {
  if (!value) return value;
  if (value.kind === 'neg') return sxNeg(applyGmRoApproximation(value.value, refs));
  if (value.kind === 'inv') return { kind: 'inv', value: applyGmRoApproximation(value.value, refs) };
  if (value.kind === 'mul') return simplifySx({ kind: 'mul', terms: value.terms.map((term) => applyGmRoApproximation(term, refs)) });
  if (value.kind !== 'add') return value;
  let terms = value.terms.map((term) => applyGmRoApproximation(term, refs));
  const dominant = terms.filter((term) => {
    const pair = gmRoProduct(term);
    return pair && approximationAppliesToSymbol(pair.gm, refs);
  });
  // A transconductance dominates the output conductance of the same
  // small-signal device when g_m r_o >> 1.  The old reducer only recognized
  // an already-expanded `g_m r_o` product, so it left common-gate factors such
  // as `(g_m + 1/r_o)` and nested conductance sums untouched.  Remove the
  // lower-order output-conductance terms before simplifying the surrounding
  // products; this lets exact inverse pairs cancel through a cascode chain.
  const hasGm = terms.some((term) => isStandaloneGm(term) && approximationAppliesToSymbol(term, refs));
  if (hasGm || dominant.length) {
    terms = terms.filter((term) => {
      if (isStandaloneOne(term)) return false;
      if (isStandaloneRo(term) || isInverseRo(term)) {
        return !approximationAppliesToSymbol(term.kind === 'inv' ? term.value : term, refs);
      }
      if (hasGm && hasLowerOrderGmRoCorrection(term, refs)) return false;
      return true;
    });
  }
  const factored = factorCommonSxAdd(terms);
  if (factored) return applyGmRoApproximation(simplifySx(factored), refs);
  if (!dominant.length && !hasGm) return simplifySx({ kind: 'add', terms });
  const dominantRos = new Set(dominant.flatMap((term) => {
    const pair = gmRoProduct(term);
    return pair
      ? pair.ros.filter((ro) => approximationAppliesToSymbol(ro, refs)).map((ro) => unwrapSxNeg(ro).value.name)
      : [];
  }));
  const kept = terms.filter((term) => {
    if (term.kind === 'number' && term.value === 1) return false;
    const base = unwrapSxNeg(term).value;
    if (isRoSymbol(base) && dominantRos.has(base.name)) return false;
    return true;
  });
  return simplifySx(kept.length ? { kind: 'add', terms: kept } : sxNumber(0));
}

function applyAnalysisApproximations(value, options = {}, circuit = null) {
  let simplified = simplifySx(value);
  const refs = gmRoApproximationRefs(circuit, options);
  if (refs && refs.size === 0) return simplified;
  if (!normalizeAnalysisApproximations(options).gmroLarge && refs === null && !circuit) return simplified;
  // One asymptotic rewrite can expose a new inverse pair in the surrounding
  // node equation (especially through a cascoded stack). Repeat to a small
  // fixed point so newly exposed `g_m/g_m` and additive cancellations are not
  // left in the displayed equation.
  for (let pass = 0; pass < 8; pass++) {
    const next = simplifySx(applyGmRoApproximation(simplified, refs));
    if (sxKey(next) === sxKey(simplified)) break;
    simplified = next;
  }
  return simplified;
}

// An asymptotic rewrite may accidentally discard every term of a rational
// expression when the solved numerator/denominator still contains a feedback
// cancellation that the local rewrite cannot see.  Zero is only a valid
// approximation when the exact symbolic result is already zero; otherwise
// keep the exact expression rather than reporting a physically impossible
// zero transfer or impedance.
function applyNonZeroApproximation(value, options = {}, circuit = null) {
  const approximate = applyAnalysisApproximations(value, options, circuit);
  return sxIsZero(approximate) && !sxIsZero(value) ? value : approximate;
}

function equationOperator(exact, simplified, options = {}, circuit = null) {
  return !analysisApproximationSelected(circuit, options) && sxKey(exact) === sxKey(simplified) ? '=' : '\\approx';
}

function systemTerminalNet(circuit, component, term) {
  return circuit.netOfTerminal({ comp: component.refdes, term });
}

function buildSystematicModel(circuit, { target, referenceIds, options = {} }) {
  const overrides = circuitModelOverrides(circuit, options.models);
  const textbook = textbookApproximationNotes(options, circuit);
  const dcOnly = textbook.flags.dcOnly;
  const shortParent = new Map();
  const shortFind = (id) => {
    if (!shortParent.has(id)) shortParent.set(id, id);
    let root = shortParent.get(id);
    while (shortParent.get(root) !== root) root = shortParent.get(root);
    let current = id;
    while (shortParent.get(current) !== current) {
      const next = shortParent.get(current);
      shortParent.set(current, root);
      current = next;
    }
    return root;
  };
  const shortUnion = (a, b) => {
    if (!a || !b) return;
    const first = shortFind(a);
    const second = shortFind(b);
    if (first !== second) shortParent.set(second, first);
  };
  const shortCircuits = [];
  if (dcOnly) {
    for (const component of circuit.components.values()) {
      if (!['inductor', 'variable_inductor'].includes(component.type)) continue;
      const a = systemTerminalNet(circuit, component, 'a');
      const b = systemTerminalNet(circuit, component, 'b');
      if (a && b) shortUnion(a.id, b.id);
    }
  }
  // An independent DC voltage source is an AC short. Apply this before
  // building node aliases so every analysis (including compact-looking
  // topologies) sees the same merged nodes.
  for (const component of circuit.components.values()) {
    if (component.type !== 'voltage_source') continue;
    const a = systemTerminalNet(circuit, component, 'a');
    const b = systemTerminalNet(circuit, component, 'b');
    if (a && b) {
      shortUnion(a.id, b.id);
      shortCircuits.push({ component: component.refdes });
    }
  }
  const shortReferenceIds = new Set([...referenceIds].map((id) => shortFind(id)));
  const shortGroups = new Map();
  for (const net of circuit.nets.values()) {
    const root = shortFind(net.id);
    if (!shortGroups.has(root)) shortGroups.set(root, []);
    shortGroups.get(root).push(net);
  }
  const nodeAliases = new Map();
  for (const [root, nets] of shortGroups) {
    if (shortReferenceIds.has(root)) {
      for (const net of nets) nodeAliases.set(net.id, '@AC_GROUND');
      continue;
    }
    // Preserve a useful schematic name after an inductor short aliases
    // several physical nets. Prefer the requested target, then a named net,
    // then the stable physical ID so equations never lose their label.
    const preferred = [...nets].sort((left, right) => {
      const leftScore = left.id === target.id ? 0 : netLabel(left) ? 1 : 2;
      const rightScore = right.id === target.id ? 0 : netLabel(right) ? 1 : 2;
      return leftScore - rightScore || left.id.localeCompare(right.id);
    })[0]?.id || root;
    for (const net of nets) nodeAliases.set(net.id, preferred);
  }
  const elements = [];
  const nodes = new Set(['@AC_GROUND', nodeAliases.get(target.id) || target.id]);
  const assumptions = [...textbook.assumptions];
  const approximations = [...textbook.approximations];
  const unsupportedDevices = [];
  const openCircuits = [];
  const addNode = (net) => {
    const node = net ? nodeAliases.get(net.id) || net.id : null;
    if (node) nodes.add(node);
    return node;
  };
  const addBranch = (kind, component, a, b, value, extra = {}) => {
    const na = addNode(a);
    const nb = addNode(b);
    if (!na || !nb || na === nb) return;
    elements.push({ kind, component: component.refdes, a: na, b: nb, value, ...extra });
  };
  const addShuntBranch = (kind, component, net, value, extra = {}) => {
    const node = addNode(net);
    if (!node || node === '@AC_GROUND') return;
    elements.push({ kind, component: component.refdes, a: node, b: '@AC_GROUND', value, ...extra });
  };
  const millerByImpedance = new Map(millerApproximationCandidates(circuit, options)
    .map((candidate) => [candidate.impedance.refdes, candidate]));
  const millerAliases = [...millerByImpedance.values()].map((candidate) => ({
    name: millerGainName(candidate),
    expression: candidate.gain.expression,
    key: sxKey(candidate.gain.expression),
    negativeKey: sxKey(sxNeg(candidate.gain.expression)),
  }));

  const addMillerSplit = (component, candidate, kind) => {
    const impedance = millerImpedanceValue(component);
    const gain = candidate.gain.expression;
    const inputImpedance = sxDiv(impedance, sxSub(sxNumber(1), gain));
    const outputImpedance = sxDiv(impedance, sxSub(sxNumber(1), sxInv(gain)));
    const displayGain = sxSymbol(millerGainName(candidate));
    const inputDisplayImpedance = sxDiv(impedance, sxSub(sxNumber(1), displayGain));
    const outputDisplayImpedance = sxDiv(impedance, sxSub(sxNumber(1), sxInv(displayGain)));
    const stage = candidate.gain?.devices?.map((device) => device.refdes).join('/')
      || candidate.device?.refdes
      || `${sxText(sxSymbol(netLabel(candidate.gate) || 'input'))}\\to${sxText(sxSymbol(netLabel(candidate.drain) || 'output'))}`;
    addShuntBranch(kind, component, candidate.gate, inputImpedance, {
      millerRole: 'input', millerDevice: stage, millerGain: gain,
      displayValue: inputDisplayImpedance,
    });
    addShuntBranch(kind, component, candidate.drain, outputImpedance, {
      millerRole: 'output', millerDevice: stage, millerGain: gain,
      displayValue: outputDisplayImpedance,
    });
    const impedanceName = sxText(impedance);
    const gainName = millerGainName(candidate);
    assumptions.push(`${component.refdes} is split by Miller's theorem around ${stage}: Z_{in}(s)=${sxText(displaySx(inputImpedance, millerAliases))}, Z_{out}(s)=${sxText(displaySx(outputImpedance, millerAliases))} using ${gainName}\\approx${sxText(gain)}.`);
    approximations.push(`Miller approximation: ${component.refdes} is split around ${stage} using ${gainName}\\approx${sxText(gain)}; ${impedanceName} is otherwise unchanged.`);
  };

  for (const component of circuit.components.values()) {
    const type = component.type;
    if (options.excludeMillerImpedance && component.refdes === options.excludeMillerImpedance) {
      continue;
    }
    if (type === 'voltage_source') {
      const a = systemTerminalNet(circuit, component, 'a');
      const b = systemTerminalNet(circuit, component, 'b');
      if (a && b) {
        assumptions.push(`${component.refdes} is an independent DC voltage source and is shorted in the small-signal model.`);
        approximations.push(`Small-signal approximation: independent voltage source ${component.refdes} has zero small-signal impedance.`);
      }
      continue;
    }
    if (type === 'resistor' || type === 'variable_resistor') {
      if (componentIgnoresResistance(component, options)) {
        openCircuits.push({ component: component.refdes, reason: 'explicitly infinite small-signal resistance' });
        assumptions.push(`${component.refdes} is marked R = \\infty and is treated as open relative to the other resistive paths on its nets.`);
        approximations.push(`Per-device approximation: ${component.refdes} R \\to \\infty.`);
        continue;
      }
      const miller = millerByImpedance.get(component.refdes);
      if (miller) addMillerSplit(component, miller, 'resistor');
      else addBranch('resistor', component, systemTerminalNet(circuit, component, 'a'), systemTerminalNet(circuit, component, 'b'), sxSymbol(systemRefdes(component.refdes, 'R'), component.refdes));
      continue;
    }
    if (type === 'capacitor' || type === 'variable_capacitor') {
      if (dcOnly) {
        openCircuits.push({ component: component.refdes, reason: 'capacitor is open at DC' });
        assumptions.push(component.refdes + ' is open at DC; its capacitor branch is omitted.');
        continue;
      }
      const miller = millerByImpedance.get(component.refdes);
      if (miller) addMillerSplit(component, miller, 'capacitor');
      else {
        const capacitance = sxMul(sxSymbol('s'), sxSymbol(systemCapName(component.refdes), component.refdes));
        addBranch('capacitor', component, systemTerminalNet(circuit, component, 'a'), systemTerminalNet(circuit, component, 'b'), sxInv(capacitance));
        assumptions.push(`${component.refdes} is represented by the small-signal impedance \\frac{1}{s ${systemCapName(component.refdes)}}.`);
      }
      approximations.push(`Small-signal approximation: ${component.refdes} is treated as an ideal capacitor in the frequency domain.`);
      continue;
    }
    if (type === 'inductor' || type === 'variable_inductor') {
      if (dcOnly) {
        assumptions.push(component.refdes + ' is shorted at DC; its terminal nets are merged.');
        continue;
      }
      const miller = millerByImpedance.get(component.refdes);
      if (miller) addMillerSplit(component, miller, 'inductor');
      else {
        const impedance = millerImpedanceValue(component);
        addBranch('inductor', component, systemTerminalNet(circuit, component, 'a'), systemTerminalNet(circuit, component, 'b'), impedance);
        assumptions.push(`${component.refdes} is represented by the small-signal impedance s ${indexedName(component.refdes, 'L')}.`);
      }
      approximations.push(`Small-signal approximation: ${component.refdes} is treated as an ideal inductor in the frequency domain.`);
      continue;
    }
    const isMos = ['nmos', 'pmos', 'nmosb', 'pmosb'].includes(type);
    if (isMos) {
      const override = overrides.get(component.refdes);
      if (override && isCurrentSourceModel(override)) {
        openCircuits.push({ component: component.refdes, reason: 'ideal small-signal current source' });
        assumptions.push(`${component.refdes} is explicitly treated as an ideal small-signal current source, so it is open in the node model.`);
        approximations.push(`Model override: ${component.refdes} current-source behavior is approximated as infinite small-signal output resistance.`);
        continue;
      }
      if (override && isTriodeModel(override)) {
        const drain = systemTerminalNet(circuit, component, 'd');
        const source = systemTerminalNet(circuit, component, 's');
        if (drain && source) {
          addBranch('triode-resistance', component, drain, source, sxSymbol(systemMosName(component.refdes, 'rds'), component.refdes));
          assumptions.push(`${component.refdes} is explicitly modeled as a triode device, represented by a symbolic r_{ds}.`);
          approximations.push(`Model override: ${component.refdes} triode behavior is reduced to a small-signal resistance.`);
        }
        continue;
      }
      if (override && !['ro', 'r_o', 'output-resistance', 'small-signal'].includes(override)) {
        const overrideNets = component.def.terminals.map((term) => systemTerminalNet(circuit, component, term.name)).filter(Boolean);
        unsupportedDevices.push({ refdes: component.refdes, type, netIds: overrideNets.map((net) => net.id), reason: `unknown small-signal model override "${override}"` });
        continue;
      }
      const drain = systemTerminalNet(circuit, component, 'd');
      const source = systemTerminalNet(circuit, component, 's');
      const gate = systemTerminalNet(circuit, component, 'g');
      const hasBulk = component.def.terminals.some((term) => term.name === 'b');
      const bulk = hasBulk ? systemTerminalNet(circuit, component, 'b') : null;
      if (!drain || !source || !gate) {
        unsupportedDevices.push({ refdes: component.refdes, type, reason: 'missing transistor terminal connection' });
        continue;
      }
      const d = addNode(drain);
      const s = addNode(source);
      const g = addNode(gate);
      // Plain MOS symbols do not expose a bulk pin, but their bulk is still
      // implicitly tied to the device's global body reference (GND for NMOS,
      // VDD for PMOS).  Both are AC grounds in this model.  Keep that implicit
      // bulk as an actual control node so a moving source produces the usual
      // -g_mb*v_s body-effect contribution in source-followers and other
      // source-degenerated stages.
      const b = addNode(bulk) || '@AC_GROUND';
      // The branch current is defined from drain to source and the control is
      // v_g - v_s, so both MOS polarities use a positive gm coefficient.
      const polarity = 1;
      const bodyReference = type.startsWith('pmos') ? 'VDD' : 'GND';
      const ignoreRo = componentIgnoresRo(component, options);
      if (!ignoreRo) {
        addBranch('output-resistance', component, drain, source, sxSymbol(systemMosName(component.refdes, 'ro'), component.refdes));
      }
      elements.push({
        kind: 'vccs', component: component.refdes, a: d, b: s,
        controlPlus: g, controlMinus: s,
        controlPlusNetId: gate.id, controlMinusNetId: source.id,
        value: sxSymbol(systemMosName(component.refdes, 'gm'), component.refdes), polarity,
      });
      const bodyTiedToInput = commonGateBodyIsSourceTied(circuit, component, { ...options, referenceIds });
      const bodyEffectActive = !componentIgnoresBodyEffect(component, options) && !bodyTiedToInput && b !== s;
      if (bodyEffectActive) {
        elements.push({
          kind: 'vccs', component: component.refdes, a: d, b: s,
          controlPlus: b, controlMinus: s,
          controlPlusNetId: bulk?.id || null, controlMinusNetId: source.id,
          value: sxSymbol(systemMosName(component.refdes, 'gmb'), component.refdes), polarity,
        });
      }
      if (bodyTiedToInput) {
        assumptions.push(`${component.refdes} is a common-gate input device with V_{BS} = 0; its implicit bulk follows the source input node.`);
      } else if (!hasBulk || !bulk) {
        assumptions.push(`${component.refdes} bulk is unused and is assumed tied to ${bodyReference}; in the small-signal model this is an AC-ground assumption.`);
      }
      if (component.analysis?.ignoreBodyEffect === true && !options.ignoreDeviceApproximationOverrides) {
        assumptions.push(`${component.refdes} has an explicit per-device override: body effect is ignored, so g_{mb} = 0.`);
        approximations.push(`Per-device approximation: ${component.refdes} g_{mb} = 0.`);
      } else if (component.analysis?.ignoreBodyEffect === false && textbook.flags.ignoreBodyEffect && !options.ignoreDeviceApproximationOverrides) {
        assumptions.push(`${component.refdes} has an explicit per-device override: body effect is retained despite the form-wide approximation.`);
      }
      if (component.analysis?.gmroLarge === true && !options.ignoreDeviceApproximationOverrides) {
        assumptions.push(`${component.refdes} has an explicit per-device override: g_m r_o \\gg 1 is assumed.`);
        approximations.push(`Per-device approximation: ${component.refdes} g_m r_o \\gg 1.`);
      } else if (component.analysis?.gmroLarge === false && textbook.flags.gmroLarge && !options.ignoreDeviceApproximationOverrides) {
        assumptions.push(`${component.refdes} has an explicit per-device override: finite g_m r_o is retained despite the form-wide approximation.`);
      }
      const deviceTerms = [!ignoreRo ? 'r_o' : null, 'g_m', bodyEffectActive ? 'g_{mb}' : null].filter(Boolean);
      assumptions.push(`${component.refdes} is represented by ${deviceTerms.join(', ')} in the small-signal model.`);
      if (normalizeChannelLengthModulationPolicy(component.analysis?.channelLengthModulation) === 'ignore') {
        assumptions.push(`${component.refdes} has an explicit per-device override: channel-length modulation is ignored and r_o is treated as infinite.`);
        approximations.push(`Per-device approximation: ${component.refdes} r_o \u2192 \u221e.`);
      } else if (normalizeChannelLengthModulationPolicy(component.analysis?.channelLengthModulation) === 'finite' && textbook.flags.ignoreChannelLengthModulation) {
        assumptions.push(`${component.refdes} has an explicit per-device override: finite r_o is retained despite the form-wide channel-length modulation approximation.`);
      }
      approximations.push(`Small-signal approximation: ${component.refdes} parasitic capacitances are omitted.`);
      continue;
    }
    if (type === 'current_source') {
      openCircuits.push({ component: component.refdes, reason: 'independent DC current source' });
      assumptions.push(`${component.refdes} is an independent DC current source and is open in the small-signal model.`);
      continue;
    }
    if (['ground', 'supply', 'vcm', 'port', 'port_filled', 'input', 'output', 'inputoutput', 'solder'].includes(type)) continue;
    const nets = component.def.terminals.map((term) => systemTerminalNet(circuit, component, term.name)).filter(Boolean);
    if (nets.length) unsupportedDevices.push({ refdes: component.refdes, type, netIds: nets.map((net) => net.id), reason: 'no small-signal element model is registered' });
  }
  return { elements, nodes: [...nodes].sort(), nodeAliases, assumptions, approximations, unsupportedDevices, openCircuits, shortCircuits, millerAliases };
}

/** Render the stamped symbolic primitives in a compact SPICE-like form.  The
 * netlist is descriptive only: it is not fed to a numerical simulator. */
export function formatSmallSignalNetlist(circuit, model, { referenceIds = new Set(), inputId = null, inputZeroed = false } = {}) {
  const references = new Set([...(referenceIds instanceof Set ? referenceIds : new Set(referenceIds || []))]
    .map((id) => modelNodeId(model, id)));
  const normalizedInputId = modelNodeId(model, inputId);
  const netlistNetName = (net) => {
    const raw = netLabel(net);
    return /^V(?:IO|I|O)\d+$/.test(raw)
      ? componentLabelText(raw)
      : /^V[A-Za-z]+(?:[0-9]+)?$/.test(raw) ? indexedName(raw, 'V') : raw;
  };
  const nodeName = (node) => node === '@AC_GROUND' || references.has(node)
    ? '0'
    : netlistNetName(circuit.nets.get(node)) || node;
  const controlNodeName = (node, netId) => inputId
    && netId === inputId
    ? netlistNetName(circuit.nets.get(inputId)) || 'V_{in}'
    : nodeName(node);
  const lines = ['* Small-signal equivalent (symbolic; no numerical values)'];
  for (const short of model?.shortCircuits || []) lines.push(`* SHORT ${short.component}: independent DC voltage source`);
  for (const open of model?.openCircuits || []) lines.push(`* OPEN ${open.component}: ${open.reason}`);
  for (const element of model?.elements || []) {
    const a = nodeName(element.a);
    const b = nodeName(element.b);
    if (element.millerRole === 'input' && element.millerDevice) {
      lines.push(`* MILLER ${element.component} split around ${element.millerDevice} (input/output shunts)`);
    }
    if (element.kind === 'vccs') {
      const controlPlus = controlNodeName(element.controlPlus, element.controlPlusNetId);
      const controlMinus = controlNodeName(element.controlMinus, element.controlMinusNetId);
      const value = sxText(element.polarity === -1 ? sxNeg(element.value) : element.value);
      lines.push(`* G_${element.component} current: ${value} (${controlPlus} - ${controlMinus})`);
      lines.push(`G_${element.component} ${a} ${b} ${controlPlus} ${controlMinus} ${value}`);
    } else if (element.kind === 'resistor' || element.kind === 'output-resistance' || element.kind === 'triode-resistance') {
      const suffix = element.millerRole ? `_${element.millerRole}` : '';
      lines.push(`R_${element.component}${suffix} ${a} ${b} ${sxText(element.value)}`);
    } else if (element.kind === 'capacitor') {
      const suffix = element.millerRole ? `_${element.millerRole}` : '';
      lines.push(`C_${element.component}${suffix} ${a} ${b} ${sxText(element.value)}`);
    } else if (element.kind === 'inductor') {
      const suffix = element.millerRole ? `_${element.millerRole}` : '';
      lines.push(`L_${element.component}${suffix} ${a} ${b} ${sxText(element.value)}`);
    }
  }
  for (const device of model?.unsupportedDevices || []) {
    lines.push(`* UNSUPPORTED ${device.refdes}: ${device.reason || 'no small-signal model'}`);
  }
  if (inputId && inputZeroed) {
    const inputName = netlistNetName(circuit.nets.get(inputId)) || 'V_{in}';
    lines.splice(1, 0, `* ${inputName} = 0 (input source zeroed for output impedance)`);
  }
  if (lines.length === 1 + (inputId && inputZeroed ? 1 : 0)) lines.push('* (no small-signal primitives were stamped)');
  return lines.join('\n');
}

function coupledSystemNodes(model, roots) {
  const adjacency = new Map();
  const link = (nodes) => {
    const active = [...new Set(nodes.filter((node) => node && node !== '@AC_GROUND'))];
    for (const node of active) if (!adjacency.has(node)) adjacency.set(node, new Set());
    for (let left = 0; left < active.length; left++) {
      for (let right = left + 1; right < active.length; right++) {
        adjacency.get(active[left]).add(active[right]);
        adjacency.get(active[right]).add(active[left]);
      }
    }
  };
  for (const element of model.elements) {
    link(element.kind === 'vccs'
      ? [element.a, element.b, element.controlPlus, element.controlMinus]
      : [element.a, element.b]);
  }
  const seen = new Set(roots.filter((node) => node && node !== '@AC_GROUND'));
  const queue = [...seen];
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index];
    for (const next of adjacency.get(node) || []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

function systemRows(model, { testTarget = null, inputNode = null, fixedNodes = [], observedNodes = [] }) {
  const canonicalInput = modelNodeId(model, inputNode);
  const fixed = new Set((fixedNodes || []).map((node) => modelNodeId(model, node)));
  const canonicalTarget = modelNodeId(model, testTarget);
  const observed = (observedNodes || []).map((node) => modelNodeId(model, node));
  const coupled = coupledSystemNodes(model, [canonicalTarget, canonicalInput, ...fixed, ...observed]);
  const unknowns = [...model.nodes].filter((node) => coupled.has(node) && node !== canonicalInput && !fixed.has(node)).sort();
  const rows = new Map(unknowns.map((node) => [node, { node, coefficients: new Map(), rhs: sxNumber(0) }]));
  const addCoefficient = (rowNode, columnNode, value) => {
    if (!rows.has(rowNode) || columnNode === '@AC_GROUND' || fixed.has(columnNode)) return;
    if (columnNode === canonicalInput) {
      addRhs(rowNode, sxNeg(sxMul(value, sxSymbol('V_{in}'))));
      return;
    }
    const row = rows.get(rowNode);
    row.coefficients.set(columnNode, sxAdd(row.coefficients.get(columnNode), value));
  };
  const addRhs = (rowNode, value) => {
    if (!rows.has(rowNode)) return;
    rows.get(rowNode).rhs = sxAdd(rows.get(rowNode).rhs, value);
  };
  const stampConductance = (a, b, conductance) => {
    addCoefficient(a, a, conductance); addCoefficient(b, b, conductance);
    addCoefficient(a, b, sxNeg(conductance)); addCoefficient(b, a, sxNeg(conductance));
  };
  const stampVccs = (element) => {
    const gain = element.polarity === -1 ? sxNeg(element.value) : element.value;
    addCoefficient(element.a, element.controlPlus, gain);
    addCoefficient(element.a, element.controlMinus, sxNeg(gain));
    addCoefficient(element.b, element.controlPlus, sxNeg(gain));
    addCoefficient(element.b, element.controlMinus, gain);
  };
  for (const element of model.elements) {
    if (element.kind === 'resistor' || element.kind === 'output-resistance' || element.kind === 'triode-resistance'
      || element.kind === 'capacitor' || element.kind === 'inductor') stampConductance(element.a, element.b, sxInv(element.value));
    else if (element.kind === 'vccs') stampVccs(element);
  }
  if (canonicalTarget && rows.has(canonicalTarget)) addRhs(canonicalTarget, sxSymbol('I_{test}'));
  return { unknowns, rows };
}

function renderSystemEquation(row, circuit, targetId, referenceIds, inputId) {
  const terms = [];
  for (const [node, coefficient] of row.coefficients) {
    if (sxIsZero(coefficient)) continue;
    const variable = sxSymbol(nodeLabel(circuit, node, targetId, referenceIds, inputId));
    const product = sxMul(coefficient, variable);
    terms.push(product);
  }
  const left = terms.length ? sxText(sxAdd(...terms)) : '0';
  return `${left} = ${sxText(row.rhs)}`;
}

function modelPathDevice(model, context) {
  const starts = new Set([modelNodeId(model, context.target.id)]);
  if (context.input) starts.add(modelNodeId(model, context.input.id));
  const references = new Set([...context.referenceIds].map((id) => modelNodeId(model, id)));
  for (const id of [...starts]) if (references.has(id)) { starts.delete(id); starts.add('@AC_GROUND'); }
  const adjacency = new Map();
  const link = (a, b) => {
    if (!a || !b) return;
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a).add(b); adjacency.get(b).add(a);
  };
  for (const element of model.elements) {
    link(element.a, element.b);
    if (element.kind === 'vccs') {
      link(element.a, element.controlPlus);
      link(element.a, element.controlMinus);
    }
  }
  const reachable = new Set(starts);
  const queue = [...starts];
  while (queue.length) {
    const node = queue.shift();
    for (const next of adjacency.get(node) || []) {
      if (reachable.has(next)) continue;
      reachable.add(next);
      queue.push(next);
    }
  }
  return model.unsupportedDevices.find((device) =>
    (device.netIds || []).some((id) => reachable.has(references.has(modelNodeId(model, id)) ? '@AC_GROUND' : modelNodeId(model, id))));
}

function solveSystem(rows, unknowns) {
  const matrix = unknowns.map((node) => ({
    node,
    coefficients: new Map(unknowns.map((column) => [column, rows.get(node)?.coefficients.get(column) || sxNumber(0)])),
    rhs: rows.get(node)?.rhs || sxNumber(0),
  }));
  for (let pivot = 0; pivot < unknowns.length; pivot++) {
    const pivotRow = matrix.slice(pivot).findIndex((row) => !sxIsZero(row.coefficients.get(unknowns[pivot])));
    if (pivotRow < 0) return { ok: false, error: `node-equation system is singular at ${unknowns[pivot]}` };
    const actual = pivot + pivotRow;
    [matrix[pivot], matrix[actual]] = [matrix[actual], matrix[pivot]];
    const pivotValue = matrix[pivot].coefficients.get(unknowns[pivot]);
    for (const column of unknowns) matrix[pivot].coefficients.set(column, sxDiv(matrix[pivot].coefficients.get(column), pivotValue));
    matrix[pivot].rhs = sxDiv(matrix[pivot].rhs, pivotValue);
    for (let rowIndex = 0; rowIndex < matrix.length; rowIndex++) {
      if (rowIndex === pivot) continue;
      const row = matrix[rowIndex];
      const factor = row.coefficients.get(unknowns[pivot]);
      if (sxIsZero(factor)) continue;
      for (const column of unknowns) row.coefficients.set(column, sxSub(row.coefficients.get(column), sxMul(factor, matrix[pivot].coefficients.get(column))));
      row.rhs = sxSub(row.rhs, sxMul(factor, matrix[pivot].rhs));
    }
  }
  return { ok: true, values: new Map(unknowns.map((node, index) => [node, matrix[index].rhs])) };
}

function systematicImpedanceResult(circuit, model, context, label = 'Z_{out}', options = {}, algebraic = false) {
  const targetNode = modelNodeId(model, context.target.id);
  const inputNode = modelNodeId(model, context.inputId || null);
  const referenceIds = new Set([...context.referenceIds].map((id) => modelNodeId(model, id)));
  const netlist = formatSmallSignalNetlist(circuit, model, {
    referenceIds,
    inputId: context.inputId || null,
    // Keep this tab as the reusable, driven small-signal equivalent. The
    // output-impedance test condition is reported with the KCL equations,
    // rather than mutating the netlist into an output-only snapshot.
    inputZeroed: false,
  });
  const unsupportedDevice = modelPathDevice(model, context);
  if (unsupportedDevice) return { ok: false, error: `${unsupportedDevice.refdes} (${unsupportedDevice.type}) touches the analyzed path and has no symbolic small-signal model yet`, equations: [], unknowns: [], model, netlist };
  if (targetNode === '@AC_GROUND') {
    const resultLabel = acQuantityLabel(label, sxNumber(0));
    return {
      ok: true,
      equation: `${resultLabel} = 0`,
      expression: sxNumber(0),
      exactEquation: `${resultLabel} = 0`,
      equations: ['V_{AC} = 0'],
      equationCount: 1,
      unknowns: [],
      unknownCount: 0,
      solution: {},
      model,
      netlist,
    };
  }
  const system = systemRows(model, { testTarget: targetNode });
  // For Zin the selected target is the driven input node, so label it V_in in
  // the exposed KCL equations rather than misreporting it as V_out.
  const equationTargetId = label === 'Z_{in}' ? null : targetNode;
  const equationInputId = label === 'Z_{in}' ? targetNode : inputNode;
  const zeroedInputRaw = label === 'Z_{out}' && context.inputId
    ? netLabel(circuit.nets.get(context.inputId)) || context.inputId
    : null;
  const zeroedInputName = zeroedInputRaw
    ? (/^V(?:IO|I|O)?[A-Za-z]+(?:[0-9]+)?$/.test(zeroedInputRaw)
      ? indexedName(zeroedInputRaw, 'V')
      : componentLabelText(zeroedInputRaw))
    : null;
  const equations = [
    'V_{AC} = 0',
    ...(zeroedInputName ? [`${zeroedInputName} = 0 (input source zeroed for output impedance)`] : []),
    ...[...system.rows.values()].map((row) => renderSystemEquation(row, circuit, equationTargetId, referenceIds, equationInputId)),
  ];
  if (!system.unknowns.length) return { ok: false, error: 'node-equation system has no unknown node voltage', equations, equationCount: equations.length, unknowns: [], unknownCount: 0, model, netlist };
  const testRow = system.rows.get(targetNode);
  if (testRow && [...testRow.coefficients.values()].every((coefficient) => sxIsZero(coefficient))) {
    const expression = sxSymbol('\\infty');
    const resultLabel = acQuantityLabel(label, expression);
    return {
      ok: true,
      equation: `${resultLabel} = \\infty`,
      expression,
      equations,
      equationCount: equations.length,
      unknowns: system.unknowns.map((node) => nodeLabel(circuit, node, equationTargetId, context.referenceIds, equationInputId)),
      unknownCount: system.unknowns.length,
      solution: {},
      model,
      netlist,
    };
  }
  const solved = solveSystem(system.rows, system.unknowns);
  if (!solved.ok) return { ok: false, error: solved.error, equations, equationCount: equations.length, unknowns: system.unknowns, unknownCount: system.unknowns.length, model, netlist };
  const outputNode = targetNode;
  const outputVoltage = solved.values.get(outputNode);
  if (!outputVoltage) return { ok: false, error: 'target node was not solvable in the node-equation system', equations, equationCount: equations.length, unknowns: system.unknowns, unknownCount: system.unknowns.length, model, netlist };
  const exactImpedance = normalizeSxRational(sxDiv(outputVoltage, sxSymbol('I_{test}')), algebraic);
  const impedance = applyNonZeroApproximation(exactImpedance, options, circuit);
  // Re-solve only the presentation copy with Miller shunts represented by
  // `A_{v1}`. The solver above keeps the expanded DC gain, while this copy
  // preserves the recognizable Miller forms in both input and output
  // impedance equations without changing any model or netlist values.
  let displayExactImpedance = exactImpedance;
  if (model.elements?.some((element) => element.displayValue)) {
    const displayModel = {
      ...model,
      elements: model.elements.map((element) => element.displayValue
        ? { ...element, value: element.displayValue }
        : element),
    };
    const displaySystem = systemRows(displayModel, { testTarget: targetNode });
    const displaySolved = solveSystem(displaySystem.rows, displaySystem.unknowns);
    const displayVoltage = displaySolved.ok ? displaySolved.values.get(outputNode) : null;
    if (displayVoltage) displayExactImpedance = normalizeSxRational(sxDiv(displayVoltage, sxSymbol('I_{test}')), algebraic);
  }
  const displayImpedance = applyNonZeroApproximation(displayExactImpedance, options, circuit);
  const resultLabel = acQuantityLabel(label, displayImpedance);
  const display = (value) => sxText(displaySx(value, model.millerAliases), null, true);
  const equation = appendMillerDefinitions(
    `${resultLabel} ${equationOperator(exactImpedance, impedance, options, circuit)} ${display(displayImpedance)}`,
    model.millerAliases,
  );
  const exactEquation = appendMillerDefinitions(
    `${resultLabel} = ${display(displayExactImpedance)}`,
    model.millerAliases,
  );
  return {
    ok: true,
    equation,
    exactEquation,
    expression: impedance,
    exactExpression: exactImpedance,
    equations,
    equationCount: equations.length,
      unknowns: system.unknowns.map((node) => nodeLabel(circuit, node, equationTargetId, referenceIds, equationInputId)),
    unknownCount: system.unknowns.length,
    solution: Object.fromEntries([...solved.values].map(([node, value]) => [nodeLabel(circuit, node, equationTargetId, referenceIds, equationInputId), sxText(value)])),
    model,
    netlist,
  };
}

function systematicOutputResult(circuit, model, context, options = {}, algebraic = false) {
  return systematicImpedanceResult(circuit, model, context, 'Z_{out}', options, algebraic);
}

/** Recognize the textbook common-gate half-circuit for input impedance.  The
 * selected input must land on a MOS source while its gate is an AC reference;
 * a finite passive load at the drain then gives
 * Z_in = (r_o + R_L) / (1 + g_m r_o).  The full nodal result remains attached
 * to the report, but this compact form keeps the educational equation legible.
 */
function commonGateInputReduction(circuit, context, model, options) {
  const inputNet = context.target;
  const overrides = circuitModelOverrides(circuit, options.models);
  const textbook = textbookApproximationNotes(options, circuit);
  for (const component of circuit.components.values()) {
    if (!['nmos', 'pmos', 'nmosb', 'pmosb'].includes(component.type)) continue;
    if (isCurrentSourceModel(overrides.get(component.refdes)) || isTriodeModel(overrides.get(component.refdes))) continue;
    const source = circuit.netOfTerminal({ comp: component.refdes, term: 's' });
    const gate = circuit.netOfTerminal({ comp: component.refdes, term: 'g' });
    const drain = circuit.netOfTerminal({ comp: component.refdes, term: 'd' });
    if (!source || source.id !== inputNet.id || !gate || !context.referenceIds.has(gate.id) || !drain || context.referenceIds.has(drain.id)) continue;
    const output = analyzeOutputImpedance(circuit, drain.id, {
      ...options,
      input: inputNet.id,
    });
    const ro = sxSymbol(systemMosName(component.refdes, 'ro'), component.refdes);
    const gm = sxSymbol(systemMosName(component.refdes, 'gm'), component.refdes);
    const ignoreRo = componentIgnoresRo(component, options);
    const hasBulk = component.def.terminals.some((term) => term.name === 'b');
    const bulk = hasBulk
      ? circuit.netOfTerminal({ comp: component.refdes, term: 'b' })
      : null;
    // A common-gate source-input stage uses V_{BS}=0 for a plain MOS device.
    // Other unexposed bulks remain tied to their global AC reference.
    const bulkIsAcGround = !bulk || context.referenceIds.has(bulk.id);
    const bodyTiedToInput = commonGateBodyIsSourceTied(circuit, component, {
      ...options,
      inputNetId: inputNet.id,
      referenceIds: context.referenceIds,
    });
    const gmb = !componentIgnoresBodyEffect(component, options) && !bodyTiedToInput
      && bulkIsAcGround && (!bulk || bulk.id !== source.id)
      ? sxSymbol(systemMosName(component.refdes, 'gmb'), component.refdes)
      : null;
    const effectiveGm = gmb ? sxAdd(gm, gmb) : gm;
    const expression = output.expression;
    const terms = expression?.kind === 'parallel' ? expression.terms : [expression];
    if (ignoreRo) {
      const compact = sxInv(effectiveGm);
      return {
        expression: compact,
        exactExpression: compact,
        assumptions: [
          `${component.refdes} is recognized as a common-gate device: its source is the selected input node and its gate is AC-grounded.`,
          ...(bodyTiedToInput ? [`${component.refdes} uses V_{BS} = 0; its implicit bulk follows the source input node.`] : []),
          `${component.refdes} has channel-length modulation ignored, so the common-gate input reduces to the inverse transconductance.`,
        ],
      };
    }
    const roIndex = terms.findIndex((term) => term?.kind === 'symbol' && term.name === ro.name);
    if (roIndex < 0 || terms.length < 2) continue;
    const loadTerms = terms.filter((_, index) => index !== roIndex);
    const load = loadTerms.length === 1 ? loadTerms[0] : parallel(...loadTerms);
    const exactCompact = sxDiv(sxAdd(ro, load), sxAdd(sxNumber(1), sxMul(effectiveGm, ro)));
    const compact = componentAssumesGmRoLarge(component, options)
      ? sxDiv(sxAdd(ro, load), sxMul(effectiveGm, ro))
      : exactCompact;
    return {
      expression: applyAnalysisApproximations(compact, options, circuit),
      exactExpression: applyAnalysisApproximations(exactCompact, {
        ...options,
        gmroLarge: false,
        assumeGmRoLarge: false,
        approximations: [],
        ignoreDeviceApproximationOverrides: true,
      }, circuit),
      assumptions: [
        `${component.refdes} is recognized as a common-gate device: its source is the selected input node and its gate is AC-grounded.`,
        ...(bodyTiedToInput ? [`${component.refdes} uses V_{BS} = 0; its implicit bulk follows the source input node.`] : []),
        `The common-gate input impedance is reduced with the finite drain load and r_o retained symbolically.`,
      ],
    };
  }
  return null;
}

/** Reduce a source-degenerated common-source stage to its textbook form.  The
 * generic nodal result remains available for verification:
 *
 *   R_out = R_L || [r_o + R_S + (g_m + g_mb) r_o R_S].
 *
 * This requires one MOS device, one source resistor, and resistive drain loads.
 * Ambiguous topologies use the complete nodal expression.
 */
function sourceDegenerationTopology(circuit, target, referenceIds, options = {}) {
  const overrides = circuitModelOverrides(circuit, options.models);
  const mos = [...circuit.components.values()].filter((component) => MOS_TYPES.has(component.type));
  for (const component of mos) {
    if (isCurrentSourceModel(overrides.get(component.refdes)) || isTriodeModel(overrides.get(component.refdes))) continue;
    const drain = circuit.netOfTerminal({ comp: component.refdes, term: 'd' });
    const source = circuit.netOfTerminal({ comp: component.refdes, term: 's' });
    const gate = circuit.netOfTerminal({ comp: component.refdes, term: 'g' });
    if (!drain || drain.id !== target.id || !source || referenceIds.has(source.id) || !gate || !referenceIds.has(gate.id)) continue;
    const hasBulk = component.def.terminals.some((term) => term.name === 'b');
    const bulk = hasBulk ? circuit.netOfTerminal({ comp: component.refdes, term: 'b' }) : null;
    if (bulk && !referenceIds.has(bulk.id)) continue;
    const sourceLoads = [];
    const outputLoads = [];
    for (const load of circuit.components.values()) {
      if (load.refdes === component.refdes || !['resistor', 'variable_resistor'].includes(load.type)) continue;
      if (componentIgnoresResistance(load, options)) continue;
      const a = circuit.netOfTerminal({ comp: load.refdes, term: 'a' });
      const b = circuit.netOfTerminal({ comp: load.refdes, term: 'b' });
      if (!a || !b) continue;
      const refAtA = referenceIds.has(a.id);
      const refAtB = referenceIds.has(b.id);
      if (a.id === source.id && refAtB) sourceLoads.push(load);
      else if (b.id === source.id && refAtA) sourceLoads.push(load);
      else if (a.id === target.id && refAtB) outputLoads.push(load);
      else if (b.id === target.id && refAtA) outputLoads.push(load);
    }
    // A single source resistor is the unambiguous degeneration form. Parallel
    // source resistors are deliberately left to the nodal reducer so we do
    // not silently change the user's intended bias network.
    if (sourceLoads.length !== 1) continue;
    const ro = sxSymbol(systemMosName(component.refdes, 'ro'), component.refdes);
    const gm = sxSymbol(systemMosName(component.refdes, 'gm'), component.refdes);
    const bodyEffect = !componentIgnoresBodyEffect(component, options) && (!bulk || bulk.id !== source.id);
    const gmb = bodyEffect ? sxSymbol(systemMosName(component.refdes, 'gmb'), component.refdes) : null;
    const effectiveGm = gmb ? sxAdd(gm, gmb) : gm;
    const rs = sxSymbol(indexedName(sourceLoads[0].refdes, 'R'), sourceLoads[0].refdes);
    const loadTerms = outputLoads.map((load) => sxSymbol(indexedName(load.refdes, 'R'), load.refdes));
    return {
      component,
      exactRo: componentIgnoresRo(component, options) ? null : ro,
      effectiveGm,
      sourceResistor: sourceLoads[0],
      sourceResistance: rs,
      outputLoads,
      outputLoad: loadTerms.length ? parallel(...loadTerms) : null,
      bodyEffect,
      gmroLarge: componentAssumesGmRoLarge(component, options),
    };
  }
  return null;
}

function sourceDegenerationOutputReduction(circuit, target, referenceIds, options = {}) {
  const topology = sourceDegenerationTopology(circuit, target, referenceIds, options);
  if (!topology) return null;
  if (!topology.exactRo) {
    const expression = topology.outputLoad || sxSymbol('\\infty');
    return { ...topology, exactExpression: expression, expression };
  }
  const { exactRo: ro, effectiveGm, sourceResistance: rs, outputLoad } = topology;
  const exactBranch = sxAdd(ro, rs, sxMul(effectiveGm, ro, rs));
  const approximateBranch = topology.gmroLarge ? sxMul(effectiveGm, ro, rs) : exactBranch;
  const exactExpression = outputLoad ? parallel(outputLoad, exactBranch) : exactBranch;
  const expression = outputLoad ? parallel(outputLoad, approximateBranch) : approximateBranch;
  return { ...topology, exactExpression, expression };
}

function sourceDegenerationTransferReduction(circuit, target, referenceIds, options = {}) {
  const topology = sourceDegenerationTopology(circuit, target, referenceIds, options);
  if (!topology?.outputLoad) return null;
  const { exactRo: ro, effectiveGm, sourceResistance: rs, outputLoad } = topology;
  const exactExpression = ro
    ? sxNeg(sxDiv(sxMul(effectiveGm, outputLoad, ro), sxAdd(ro, outputLoad, rs, sxMul(effectiveGm, ro, rs))))
    : sxNeg(sxDiv(sxMul(effectiveGm, outputLoad), sxAdd(sxNumber(1), sxMul(effectiveGm, rs))));
  const expression = !ro || topology.gmroLarge
    ? sxNeg(sxDiv(sxMul(effectiveGm, outputLoad), sxAdd(sxNumber(1), sxMul(effectiveGm, rs))))
    : exactExpression;
  return { ...topology, exactExpression, expression };
}

function systematicTransferResult(circuit, model, context, options = {}) {
  const targetNode = modelNodeId(model, context.target.id);
  const inputNode = modelNodeId(model, context.input.id);
  const referenceIds = new Set([...context.referenceIds].map((id) => modelNodeId(model, id)));
  const netlist = formatSmallSignalNetlist(circuit, model, {
    referenceIds,
    inputId: context.input.id,
  });
  const unsupportedDevice = modelPathDevice(model, context);
  if (unsupportedDevice) return { ok: false, error: `${unsupportedDevice.refdes} (${unsupportedDevice.type}) touches the analyzed path and has no symbolic small-signal model yet`, equations: [], unknowns: [], model, netlist };
  const system = systemRows(model, { inputNode, observedNodes: [targetNode] });
  const equations = ['V_{AC} = 0', 'V_{in} = V_{in}', ...[...system.rows.values()].map((row) => renderSystemEquation(row, circuit, targetNode, referenceIds, inputNode))];
  if (targetNode === inputNode) {
    return {
      ok: true,
      equation: 'A_v = 1',
      expression: sxNumber(1),
      exactExpression: sxNumber(1),
      equations: [...equations, 'V_{out} = V_{in}'],
      unknowns: system.unknowns.map((node) => nodeLabel(circuit, node, targetNode, referenceIds, inputNode)),
      model,
      netlist,
    };
  }
  if (!system.unknowns.length) return { ok: false, error: 'node-equation system has no internal unknown node voltage', equations, equationCount: equations.length, unknowns: [], unknownCount: 0, model, netlist };
  const solved = solveSystem(system.rows, system.unknowns);
  if (!solved.ok) return { ok: false, error: solved.error, equations, equationCount: equations.length, unknowns: system.unknowns, unknownCount: system.unknowns.length, model, netlist };
  const outputVoltage = solved.values.get(targetNode) || (targetNode === '@AC_GROUND' ? sxNumber(0) : null);
  if (!outputVoltage) return { ok: false, error: 'output node was not solvable in the node-equation system', equations, equationCount: equations.length, unknowns: system.unknowns, unknownCount: system.unknowns.length, model, netlist };
  const exactGain = simplifySx(sxDiv(outputVoltage, sxSymbol('V_{in}')));
  const gain = applyNonZeroApproximation(exactGain, options, circuit);
  const display = (value) => sxText(displaySx(value, model.millerAliases));
  const equation = appendMillerDefinitions(
    `A_v ${equationOperator(exactGain, gain, options, circuit)} ${display(gain)}`,
    model.millerAliases,
  );
  const exactEquation = appendMillerDefinitions(
    `A_v = ${display(exactGain)}`,
    model.millerAliases,
  );
  return {
    ok: true,
    equation,
    exactEquation,
    expression: gain,
    exactExpression: exactGain,
    equations,
    equationCount: equations.length,
    unknowns: system.unknowns.map((node) => nodeLabel(circuit, node, targetNode, referenceIds, inputNode)),
    unknownCount: system.unknowns.length,
    solution: Object.fromEntries([...solved.values].map(([node, value]) => [nodeLabel(circuit, node, targetNode, referenceIds, inputNode), sxText(value)])),
    model,
    netlist,
  };
}

/**
 * Derive the effective transconductance seen at the output node.  The output
 * is shorted to the AC reference, the selected input is driven by V_in, and
 * the current required to hold that short is measured.  This is the Norton
 * form of the same linear small-signal network used for R_out:
 *
 *   A_v = G_m,eff · R_out,
 *
 * where G_m,eff includes all internal node feedback and cascode attenuation.
 * It is therefore safe for multi-stage topologies as long as the stamped
 * small-signal model is valid; it is not a hand-coded device case.
 */
function systematicTransconductanceResult(circuit, model, context, options = {}) {
  const inputNode = modelNodeId(model, context.input.id);
  const targetNode = modelNodeId(model, context.target.id);
  const referenceIds = new Set([...context.referenceIds].map((id) => modelNodeId(model, id)));
  const netlist = formatSmallSignalNetlist(circuit, model, {
    referenceIds,
    inputId: context.input.id,
  });
  const unsupportedDevice = modelPathDevice(model, context);
  if (unsupportedDevice) {
    return { ok: false, error: `${unsupportedDevice.refdes} (${unsupportedDevice.type}) touches the analyzed path and has no symbolic small-signal model yet`, equations: [], unknowns: [], model, netlist };
  }
  const system = systemRows(model, { inputNode, fixedNodes: [targetNode] });
  const equations = [
    'V_{out} = 0',
    'V_{in} = V_{in}',
    ...[...system.rows.values()].map((row) => renderSystemEquation(row, circuit, targetNode, referenceIds, inputNode)),
  ];
  const solved = solveSystem(system.rows, system.unknowns);
  if (!solved.ok) return { ok: false, error: solved.error, equations, equationCount: equations.length, unknowns: system.unknowns, unknownCount: system.unknowns.length, model, netlist };
  const voltage = (node) => {
    if (!node || node === '@AC_GROUND' || referenceIds.has(node) || node === targetNode) return sxNumber(0);
    if (node === inputNode) return sxSymbol('V_{in}');
    return solved.values.get(node) || sxNumber(0);
  };
  const targetCurrent = (element) => {
    let branchCurrent = null;
    if (['resistor', 'output-resistance', 'triode-resistance', 'capacitor', 'inductor'].includes(element.kind)) {
      branchCurrent = sxMul(sxInv(element.value), sxSub(voltage(element.a), voltage(element.b)));
    } else if (element.kind === 'vccs') {
      const gain = element.polarity === -1 ? sxNeg(element.value) : element.value;
      branchCurrent = sxMul(gain, sxSub(voltage(element.controlPlus), voltage(element.controlMinus)));
    }
    if (!branchCurrent) return sxNumber(0);
    if (element.a === targetNode) return branchCurrent;
    if (element.b === targetNode) return sxNeg(branchCurrent);
    return sxNumber(0);
  };
  const naturalCurrent = simplifySx(sxAdd(...model.elements.map(targetCurrent)));
  const exactGm = simplifySx(sxDiv(sxNeg(naturalCurrent), sxSymbol('V_{in}')));
  const gm = applyNonZeroApproximation(exactGm, options, circuit);
  const display = (value) => sxText(displaySx(value, model.millerAliases));
  const equation = appendMillerDefinitions(
    `G_{m,eff} ${equationOperator(exactGm, gm, options, circuit)} ${display(gm)}`,
    model.millerAliases,
  );
  const exactEquation = appendMillerDefinitions(
    `G_{m,eff} = ${display(exactGm)}`,
    model.millerAliases,
  );
  return {
    ok: true,
    equation,
    exactEquation,
    expression: gm,
    exactExpression: exactGm,
    equations,
    equationCount: equations.length,
    unknowns: system.unknowns.map((node) => nodeLabel(circuit, node, targetNode, referenceIds, inputNode)),
    unknownCount: system.unknowns.length,
    solution: Object.fromEntries([...solved.values].map(([node, value]) => [nodeLabel(circuit, node, targetNode, referenceIds, inputNode), sxText(value)])),
    model,
    netlist,
  };
}

function resolveAnalysisContext(circuit, targetName, options = {}) {
  const targetResult = resolveNet(circuit, targetName, 'target');
  if (!targetResult.ok) return { ok: false, error: targetResult.error, target: null, reference: null };
  const acGroundResult = resolveAcGrounds(circuit, [markedAcGrounds(circuit), options.acGrounds ?? options.acGround, options.mode === 'differential' ? options.differentialSide : null]);
  if (!acGroundResult.ok) return { ok: false, error: acGroundResult.error, target: targetResult.net, reference: null };
  let referenceResult = findReferenceNet(circuit, options.reference);
  if (!referenceResult.ok && acGroundResult.nets.length) {
    const first = acGroundResult.nets[0];
    referenceResult = { ok: true, net: first, netIds: new Set([first.id]), global: false, inferred: true, userSelected: true };
  }
  if (!referenceResult.ok) return { ok: false, error: referenceResult.error, target: targetResult.net, reference: null };
  const referenceIds = new Set(referenceResult.netIds || [referenceResult.net.id]);
  for (const net of acGroundResult.nets) referenceIds.add(net.id);
  return {
    ok: true,
    target: targetResult.net,
    reference: referenceResult.net,
    referenceResult,
    referenceIds,
    acGroundResult,
  };
}

/**
 * Build the generic small-signal element model used by all future analyses.
 * This does not solve anything or evaluate values; it only names nodes,
 * stamps device primitives, and records explicit assumptions.
 */
export function deriveSmallSignalModel(circuit, targetName, options = {}) {
  const context = resolveAnalysisContext(circuit, targetName, options);
  if (!context.ok) return { ok: false, error: context.error, target: context.target, reference: context.reference };
  const inputResult = options.input || options.inputName
    ? resolveNet(circuit, options.input || options.inputName, 'input')
    : null;
  const modelOptions = {
    ...options,
    referenceIds: context.referenceIds,
    ...(inputResult?.ok ? { inputNetId: inputResult.net.id } : {}),
  };
  const model = buildSystematicModel(circuit, { ...context, options: modelOptions });
  return {
    ok: true,
    target: { netId: context.target.id, name: netLabel(context.target) },
    reference: { netId: context.reference.id, name: context.referenceResult.global || context.acGroundResult.nets.length ? 'AC_GROUND' : netLabel(context.reference), netIds: [...context.referenceIds].sort() },
    model,
    netlist: formatSmallSignalNetlist(circuit, model, { referenceIds: context.referenceIds }),
    assumptions: [...contextAssumptions(options), ...model.assumptions],
    approximations: model.approximations,
  };
}

function parallelizeDcRatio(numerator, denominator) {
  if (denominator?.kind !== 'add' || denominator.terms.length !== 2) return null;
  const numeratorParts = productTerms(numerator);
  const pair = denominator.terms.map((term) => simplifySx(term)).sort((left, right) => {
    const rank = (term) => /^r_\{(?:o|ds)/i.test(String(term?.name || '')) ? 0 : 1;
    return rank(left) - rank(right);
  });
  const remaining = [...numeratorParts.terms];
  for (const term of pair) {
    const index = remaining.findIndex((candidate) => sxKey(candidate) === sxKey(term));
    if (index < 0) return null;
    remaining.splice(index, 1);
  }
  return sxMul(sxNumber(numeratorParts.sign), ...remaining, parallel(...pair));
}

function parallelizeSxRatio(value) {
  const rational = sxRationalize(value);
  if (rational.den?.kind !== 'add') return null;
  const numerator = sxFactorList(rational.num);
  const denominator = rational.den.terms;
  if (numerator.length !== 2 || denominator.length < 2) return null;
  for (const [first, second] of [[numerator[0], numerator[1]], [numerator[1], numerator[0]]]) {
    const index = denominator.findIndex((term) => sxKey(term) === sxKey(first));
    if (index < 0) continue;
    const other = sxAdd(...denominator.filter((_, termIndex) => termIndex !== index));
    if (sxKey(other) === sxKey(second)) return parallel(first, factorSxAddOnce(other));
  }
  return null;
}

function dcLimitExpression(expression) {
  const { numerator, denominator } = frequencyResponseFromExpression(expression);
  if (!numerator.size) return sxNumber(0);
  if (!denominator.size) return sxSymbol('\\infty');
  const numeratorMin = Math.min(...numerator.keys());
  const denominatorMin = Math.min(...denominator.keys());
  if (numeratorMin > denominatorMin) return sxNumber(0);
  if (numeratorMin < denominatorMin) {
    const ratio = sxDiv(numerator.get(numeratorMin), denominator.get(denominatorMin));
    return productTerms(ratio).sign < 0 ? sxNeg(sxSymbol('\\infty')) : sxSymbol('\\infty');
  }
  return parallelizeDcRatio(numerator.get(numeratorMin), denominator.get(denominatorMin))
    || simplifySx(sxDiv(numerator.get(numeratorMin), denominator.get(denominatorMin)));
}

function dcResultSummary(result, label) {
  if (!result?.ok) return { ok: false, error: result?.error || 'DC analysis could not be solved' };
  const dcExpression = normalizeSxRational(dcLimitExpression(result.exactExpression || result.expression), true);
  const expression = parallelizeSxRatio(dcExpression) || dcExpression;
  const equation = `${label} = ${sxText(expression, null, true)}`;
  return { ok: true, equation, exactEquation: equation, expression };
}

function compactDcResultSummary(exactExpression, label, expression = exactExpression) {
  if (!exactExpression) return { ok: false, error: 'DC analysis could not be solved' };
  const approximate = sxKey(expression) !== sxKey(exactExpression);
  return {
    ok: true,
    equation: `${label} ${approximate ? '\\approx' : '='} ${sxText(expression, null, true)}`,
    exactEquation: `${label} = ${sxText(exactExpression, null, true)}`,
    expression,
  };
}

function deriveDcAnalysisSummary(circuit, context, input, options = {}) {
  try {
    // DC is the zero-frequency limit of the exact AC model. Keep the full
    // RLC model here so capacitors contribute 1/(sC) and inductors contribute
    // sL before the limit is taken.
    const fullOptions = exactAnalysisOptions({
      ...options,
      inputNetId: input.id,
      referenceIds: context.referenceIds,
    });
    const fullContext = { ...context, input };
    const fullModel = buildSystematicModel(circuit, { ...fullContext, options: fullOptions });
    const fullTransfer = systematicTransferResult(circuit, fullModel, fullContext, fullOptions);

    const fullInputContext = { ...context, target: input };
    const fullInput = systematicImpedanceResult(circuit, fullModel, fullInputContext, 'Z_{in}', fullOptions);
    const fullOutputReferenceIds = new Set([...context.referenceIds, input.id]);
    const fullOutput = context.referenceIds.has(context.target.id) || input.id === context.target.id
      ? { ok: false, error: 'target and reference must be different physical nets' }
      : (() => {
        const fullOutputContext = { ...context, referenceIds: fullOutputReferenceIds };
        const fullOutputModel = buildSystematicModel(circuit, { ...fullOutputContext, options: fullOptions });
        return systematicOutputResult(circuit, fullOutputModel, {
          target: context.target,
          referenceIds: fullOutputReferenceIds,
          inputId: input.id,
        }, fullOptions);
      })();
    const hasReactiveElements = fullModel.elements.some((element) => element.kind === 'capacitor' || element.kind === 'inductor');
    const outputBranches = !hasReactiveElements
      ? (foldedCascodeOutputBranches(circuit, context.target, fullOutputReferenceIds, circuitModelOverrides(circuit, options.models), options)
        || cascodeOutputBranches(circuit, context.target, fullOutputReferenceIds, circuitModelOverrides(circuit, options.models), options))
      : null;
    const compactParallelOutput = outputBranches
      ? analyzeOutputImpedance(circuit, netLabel(context.target), {
        ...options,
        reference: context.reference.id,
        input: input.id,
      })
      : null;
    const exactCompactParallelOutput = outputBranches && compactParallelOutput?.ok
      ? analyzeOutputImpedance(circuit, netLabel(context.target), {
        ...fullOptions,
        reference: context.reference.id,
        input: input.id,
      })
      : null;
    const compactSeriesCascode = !hasReactiveElements
      ? seriesCascodeLoadReduction(circuit, context.target, fullOutputReferenceIds, circuitModelOverrides(circuit, options.models), options)
      : null;
    const exactCompactSeriesCascode = !hasReactiveElements
      ? seriesCascodeLoadReduction(circuit, context.target, fullOutputReferenceIds, circuitModelOverrides(circuit, fullOptions.models), fullOptions)
      : null;
    const compactSourceDegeneration = !hasReactiveElements
      ? sourceDegenerationOutputReduction(circuit, context.target, fullOutputReferenceIds, options)
      : null;
    const exactCompactSourceDegeneration = !hasReactiveElements
      ? sourceDegenerationOutputReduction(circuit, context.target, fullOutputReferenceIds, fullOptions)
      : null;
    const compactSourceDegenerationGain = !hasReactiveElements
      ? sourceDegenerationTransferReduction(circuit, context.target, fullOutputReferenceIds, options)
      : null;
    const exactCompactSourceDegenerationGain = !hasReactiveElements
      ? sourceDegenerationTransferReduction(circuit, context.target, fullOutputReferenceIds, fullOptions)
      : null;
    const compactOutputExpression = compactParallelOutput?.ok
      ? compactParallelOutput.expression
      : compactSeriesCascode?.expression || null;
    const exactCompactOutputExpression = compactParallelOutput?.ok
      ? exactCompactParallelOutput?.expression || compactParallelOutput.exactExpression
      : exactCompactSeriesCascode?.exactExpression || null;
    const compactGainModel = compactOutputExpression
      ? buildSystematicModel(circuit, { ...fullContext, options })
      : null;
    const compactGainResult = compactGainModel
      ? systematicTransconductanceResult(circuit, compactGainModel, fullContext, options)
      : null;
    const exactCompactGainResult = exactCompactOutputExpression
      ? systematicTransconductanceResult(circuit, fullModel, fullContext, fullOptions)
      : null;
    const compactGain = compactGainResult?.ok
      ? simplifySx(sxMul(compactGainResult.expression, compactOutputExpression))
      : null;
    const exactCompactGain = exactCompactGainResult?.ok
      ? simplifySx(sxMul(exactCompactGainResult.exactExpression, exactCompactOutputExpression))
      : null;
    return {
      dcGain: compactSourceDegenerationGain
        ? compactDcResultSummary(
          exactCompactSourceDegenerationGain?.exactExpression || dcLimitExpression(fullTransfer.exactExpression || fullTransfer.expression),
          'A_v(0)',
          compactSourceDegenerationGain.expression,
        )
        : compactGain
        ? compactDcResultSummary(
          exactCompactGain || dcLimitExpression(fullTransfer.exactExpression || fullTransfer.expression),
          'A_v(0)',
          compactGain,
        )
        : dcResultSummary(fullTransfer, 'A_v(0)'),
      dcInputImpedance: dcResultSummary(fullInput, 'Z_{in}(0)'),
      dcOutputImpedance: compactParallelOutput?.ok
        ? compactDcResultSummary(
          exactCompactParallelOutput?.expression || compactParallelOutput.exactExpression,
          'Z_{out}(0)',
          compactParallelOutput.expression,
        )
        : compactSeriesCascode
        ? compactDcResultSummary(
          exactCompactSeriesCascode?.exactExpression || dcLimitExpression(fullOutput.exactExpression || fullOutput.expression),
          'Z_{out}(0)',
          compactSeriesCascode.expression,
        )
        : compactSourceDegeneration
        ? compactDcResultSummary(
          exactCompactSourceDegeneration?.exactExpression || dcLimitExpression(fullOutput.exactExpression || fullOutput.expression),
          'Z_{out}(0)',
          compactSourceDegeneration.expression,
        )
        : dcResultSummary(fullOutput, 'Z_{out}(0)'),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const unavailable = { ok: false, error: `DC companion analysis failed: ${message}` };
    return { dcGain: unavailable, dcInputImpedance: unavailable, dcOutputImpedance: unavailable };
  }
}

/** Derive a symbolic voltage transfer from an ideal input-node drive to the
 * requested output node using the same nodal system as impedance analysis. */
export function analyzeTransferFunction(circuit, outputName, options = {}) {
  const inputName = options.input || options.inputName;
  if (!inputName) return { ok: false, query: 'voltage-transfer', error: 'input net is required', assumptions: contextAssumptions(options), approximations: [] };
  const context = resolveAnalysisContext(circuit, outputName, options);
  if (!context.ok) return { ok: false, query: 'voltage-transfer', error: context.error, assumptions: contextAssumptions(options), approximations: [] };
  const inputResult = resolveNet(circuit, inputName, 'input');
  if (!inputResult.ok) return { ok: false, query: 'voltage-transfer', error: inputResult.error, assumptions: contextAssumptions(options), approximations: [] };
  if (context.referenceIds.has(inputResult.net.id)) return { ok: false, query: 'voltage-transfer', error: 'input and reference must be different physical nets', assumptions: contextAssumptions(options), approximations: [] };
  const modelOptions = {
    ...options,
    inputNetId: inputResult.net.id,
    referenceIds: context.referenceIds,
  };
  const model = buildSystematicModel(circuit, { ...context, options: modelOptions });
  const dcSummary = deriveDcAnalysisSummary(circuit, context, inputResult.net, modelOptions);
  const solved = systematicTransferResult(circuit, model, { ...context, input: inputResult.net }, options);
  if (!solved.ok) {
    return {
      ok: false,
      query: 'voltage-transfer',
      target: { netId: context.target.id, name: netLabel(context.target) },
      input: { netId: inputResult.net.id, name: netLabel(inputResult.net) },
      reference: { netId: context.reference.id, name: context.referenceResult.global || context.acGroundResult.nets.length ? 'AC_GROUND' : netLabel(context.reference), netIds: [...context.referenceIds].sort() },
      error: solved.error,
      equations: solved.equations,
      equationCount: solved.equationCount,
      unknowns: solved.unknowns,
      unknownCount: solved.unknownCount,
      smallSignalModel: model,
      smallSignalNetlist: solved.netlist,
      assumptions: [...contextAssumptions(options), ...model.assumptions],
      approximations: model.approximations,
      ...dcSummary,
    };
  }
  // Form the gain from the same two-port quantities used by the output
  // impedance analysis.  With the output shorted, the stamped model yields
  // the total effective transconductance; multiplying it by R_out avoids
  // exposing the large, elimination-order-dependent rational expression that
  // otherwise obscures cascoded and multi-stage behavior.
  const useNortonGain = context.target.id !== inputResult.net.id;
  const effectiveGm = useNortonGain
    ? systematicTransconductanceResult(circuit, model, { ...context, input: inputResult.net }, modelOptions)
    : null;
  const outputImpedance = useNortonGain
    ? analyzeOutputImpedance(circuit, outputName, { ...modelOptions, input: inputResult.net.id })
    : null;
  const approximationSelected = analysisApproximationSelected(circuit, options);
  const exactOptions = approximationSelected ? exactAnalysisOptions(modelOptions) : null;
  const exactModel = exactOptions ? buildSystematicModel(circuit, { ...context, options: exactOptions }) : model;
  const exactGm = exactOptions
    ? systematicTransconductanceResult(circuit, exactModel, { ...context, input: inputResult.net }, exactOptions)
    : effectiveGm;
  const exactOutputImpedance = exactOptions
    ? analyzeOutputImpedance(circuit, outputName, { ...exactOptions, input: inputResult.net.id })
    : outputImpedance;
  const nortonGain = effectiveGm?.ok && outputImpedance?.ok && outputImpedance.expression
    ? simplifySx(sxMul(effectiveGm.expression, outputImpedance.expression))
    : null;
  const exactNortonGain = exactGm?.ok && exactOutputImpedance?.ok && exactOutputImpedance.expression
    ? simplifySx(sxMul(exactGm.expression, exactOutputImpedance.expression))
    : null;
  // Vout/Vin is authoritative; the Norton shortcut can lose a floating
  // high-impedance feedback node contribution.
  // Prefer the direct Vout/Vin result whenever it is already compact.  The
  // Norton product is only a display reduction for genuinely expanded
  // multi-node solutions; it must not replace a readable source-follower
  // result with an unrelated Rout·Gm expression.
  const directGainReadable = solved.expression
    && sxTreeSize(solved.expression) <= 18
    && sxIsIntrinsicOnly(solved.expression);
  const gainFromNorton = !directGainReadable && nortonGain && !(sxIsZero(nortonGain) && !sxIsZero(solved.expression))
    ? nortonGain
    : null;
  const directExactGainReadable = solved.exactExpression
    && sxTreeSize(solved.exactExpression) <= 18
    && sxIsIntrinsicOnly(solved.exactExpression);
  const exactGainFromNorton = !directExactGainReadable && exactNortonGain && !(sxIsZero(exactNortonGain) && !sxIsZero(solved.exactExpression))
    ? exactNortonGain
    : null;
  const selectedGain = gainFromNorton || solved.expression;
  const selectedExactGain = exactGainFromNorton || solved.exactExpression || solved.expression;
  const sourceDegenerationGain = model.elements.some((element) => element.kind === 'capacitor' || element.kind === 'inductor')
    ? null
    : sourceDegenerationTransferReduction(circuit, context.target, new Set([...context.referenceIds, inputResult.net.id]), options);
  const exactSourceDegenerationGain = sourceDegenerationGain && approximationSelected
    ? sourceDegenerationTransferReduction(circuit, context.target, new Set([...context.referenceIds, inputResult.net.id]), exactOptions)
    : sourceDegenerationGain;
  const displayedGain = sourceDegenerationGain?.expression || selectedGain;
  const displayedExactGain = exactSourceDegenerationGain?.exactExpression || selectedExactGain;
  const exactReport = approximationSelected
    ? { ok: !!displayedExactGain, equation: displayedExactGain ? `A_v = ${sxText(displayedExactGain)}` : solved.exactEquation }
    : null;
  const gainEquation = displayedGain
    ? `A_v ${equationOperator(displayedExactGain || displayedGain, displayedGain, options, circuit)} ${sxText(displayedGain)}`
    : solved.equation;
  // Keep the frequency response tied to the direct nodal Vout/Vin solution.
  // The compact Norton display can contain legacy impedance text symbols such
  // as `1/(s C)`; the direct tree preserves `s` for polynomial extraction.
  const frequencyResponse = frequencyResponseSummary(model, solved.expression || selectedGain, solved.exactExpression || selectedExactGain, options);
  const acTransfer = frequencyResponse ? {
    ok: true,
    equation: `A_v(s) ${frequencyResponse.dominantPoleApplied || approximationSelected ? '\\approx' : '='} ${sxText(displaySx(frequencyResponse.expression, model.millerAliases), null, true)}`,
    exactEquation: `A_v(s) = ${sxText(displaySx(frequencyResponse.exact.expression, model.millerAliases), null, true)}`,
    expression: frequencyResponse.expression,
    exactExpression: frequencyResponse.exact.expression,
  } : null;
  const gainEquations = gainFromNorton
    ? [...solved.equations, 'Effective transconductance:', ...(effectiveGm.equations || []), 'Output impedance:', ...(outputImpedance.nodeEquations || outputImpedance.equations || [])]
    : solved.equations;
  return {
    ok: true,
    query: 'voltage-transfer',
    target: { netId: context.target.id, name: netLabel(context.target) },
    input: { netId: inputResult.net.id, name: netLabel(inputResult.net) },
    reference: { netId: context.reference.id, name: context.referenceResult.global || context.acGroundResult.nets.length ? 'AC_GROUND' : netLabel(context.reference), netIds: [...context.referenceIds].sort() },
    equation: gainEquation,
    exactEquation: exactReport?.ok
      ? exactReport.equation
      : sourceDegenerationGain
        ? `A_v = ${sxText(displayedExactGain)}`
        : (exactGainFromNorton ? `A_v = ${sxText(exactGainFromNorton)}` : (solved.exactEquation || solved.equation)),
    expression: displayedGain,
    directExpression: solved.expression,
    directExactExpression: solved.exactExpression || null,
    equations: gainEquations,
    equationCount: gainEquations.length,
    unknowns: solved.unknowns,
    unknownCount: solved.unknownCount,
    solution: solved.solution,
    effectiveTransconductance: effectiveGm?.ok ? {
      equation: effectiveGm.equation,
      exactEquation: effectiveGm.exactEquation,
      expression: effectiveGm.expression,
      equations: effectiveGm.equations,
      solution: effectiveGm.solution,
    } : null,
    outputImpedance: outputImpedance?.ok ? {
      equation: outputImpedance.equation,
      exactEquation: outputImpedance.exactEquation,
      expression: outputImpedance.expression,
    } : null,
    ...dcSummary,
    acTransfer,
    frequencyResponse,
    smallSignalModel: model,
    smallSignalNetlist: solved.netlist,
    assumptions: [
      ...contextAssumptions(options),
      ...(gainFromNorton ? ['Voltage gain is cross-checked as the output-short effective transconductance G_{m,eff} multiplied by the independently derived R_{out}.'] : []),
      ...model.assumptions,
    ],
    approximations: model.approximations,
  };
}

/** Derive the small-signal input impedance seen at a selected input net.
 * The selected net receives an AC test current; independent DC sources and
 * marked bias/reference nets are held at AC ground, then Z_in = V_test/I_test
 * is obtained from the same nodal system used for output impedance. */
export function analyzeInputImpedance(circuit, inputName, options = {}) {
  if (!inputName) return { ok: false, query: 'input-impedance', error: 'input net is required', assumptions: contextAssumptions(options), approximations: [] };
  const context = resolveAnalysisContext(circuit, inputName, options);
  if (!context.ok) return { ok: false, query: 'input-impedance', error: context.error, assumptions: contextAssumptions(options), approximations: [] };
  const modelOptions = {
    ...options,
    inputNetId: context.target.id,
    referenceIds: context.referenceIds,
  };
  const model = buildSystematicModel(circuit, { ...context, options: modelOptions });
  const systematic = systematicImpedanceResult(circuit, model, { ...context }, 'Z_{in}', modelOptions);
  const commonGate = normalizeAnalysisApproximations(options).dcOnly
    ? null
    : commonGateInputReduction(circuit, context, model, options);
  if (commonGate?.expression && systematic.ok) {
    systematic.expression = commonGate.expression;
    const resultLabel = acQuantityLabel('Z_{in}', commonGate.expression);
    systematic.equation = `${resultLabel} ${equationOperator(commonGate.exactExpression || commonGate.expression, commonGate.expression, options, circuit)} ${sxText(displaySx(commonGate.expression, model.millerAliases), null, true)}`;
    systematic.exactEquation = `${resultLabel} = ${sxText(displaySx(commonGate.exactExpression || commonGate.expression, model.millerAliases), null, true)}`;
  }
  const input = { netId: context.target.id, name: netLabel(context.target) };
  const reference = {
    netId: context.reference.id,
    name: context.referenceResult.global || context.acGroundResult.nets.length ? 'AC_GROUND' : netLabel(context.reference),
    netIds: [...context.referenceIds].sort(),
    inferred: !!context.referenceResult.inferred,
  };
  const assumptions = [
    ...contextAssumptions(options),
    'An AC test source is applied at the selected input node and independent sources are set to AC ground.',
    ...(commonGate?.assumptions || []),
    ...model.assumptions,
  ];
  if (!systematic.ok) {
    return {
      ok: false,
      query: 'input-impedance',
      target: input,
      input,
      reference,
      error: systematic.error,
      equations: systematic.equations,
      equationCount: systematic.equationCount,
      unknowns: systematic.unknowns,
      unknownCount: systematic.unknownCount,
      smallSignalModel: model,
      smallSignalNetlist: systematic.netlist,
      assumptions,
      approximations: model.approximations,
    };
  }
  const exactReport = analysisApproximationSelected(circuit, options)
    ? analyzeInputImpedance(circuit, inputName, exactAnalysisOptions(options))
    : null;
  return {
    ok: true,
    query: 'input-impedance',
    target: input,
    input,
    reference,
    equation: systematic.equation,
    exactEquation: exactReport?.ok ? exactReport.equation : (systematic.exactEquation || systematic.equation),
    expression: systematic.expression,
    equations: systematic.equations,
    equationCount: systematic.equationCount,
    unknowns: systematic.unknowns,
    unknownCount: systematic.unknownCount,
    solution: systematic.solution,
    smallSignalModel: model,
    smallSignalNetlist: systematic.netlist,
    assumptions,
    approximations: model.approximations,
  };
}

function edgeKey(a, b) {
  return [a, b].sort().join('|');
}

function mergeParallelEdges(edges) {
  const grouped = new Map();
  for (const edge of edges) {
    const key = edgeKey(edge.a, edge.b);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(edge);
  }
  const merged = [];
  for (const group of grouped.values()) {
    const first = group[0];
    merged.push({
      a: first.a,
      b: first.b,
      expr: group.length === 1 ? first.expr : parallel(...group.map((edge) => edge.expr)),
      sources: group.flatMap((edge) => edge.sources || []),
    });
  }
  return merged;
}

function reduceNetwork(edges, targetId, referenceId) {
  let current = mergeParallelEdges(edges);
  let changed = true;
  while (changed) {
    changed = false;
    const degree = new Map();
    for (const edge of current) {
      degree.set(edge.a, (degree.get(edge.a) || 0) + 1);
      degree.set(edge.b, (degree.get(edge.b) || 0) + 1);
    }
    const internal = [...degree.keys()].find((node) => node !== targetId && node !== referenceId && degree.get(node) === 2);
    if (internal) {
      const incident = current.filter((edge) => edge.a === internal || edge.b === internal);
      const rest = current.filter((edge) => edge.a !== internal && edge.b !== internal);
      const left = incident[0].a === internal ? incident[0].b : incident[0].a;
      const right = incident[1].a === internal ? incident[1].b : incident[1].a;
      if (left !== right) {
        rest.push({
          a: left,
          b: right,
          expr: sum(incident[0].expr, incident[1].expr),
          sources: [...incident[0].sources, ...incident[1].sources],
        });
      }
      current = mergeParallelEdges(rest);
      changed = true;
    }
  }
  const result = current.filter((edge) => edgeKey(edge.a, edge.b) === edgeKey(targetId, referenceId));
  if (current.length === 1 && result.length === 1) return { ok: true, expression: result[0].expr, edges: current };
  return { ok: false, edges: current };
}

function connectedEdges(edges, start) {
  const adjacency = new Map();
  for (const edge of edges) {
    if (!adjacency.has(edge.a)) adjacency.set(edge.a, []);
    if (!adjacency.has(edge.b)) adjacency.set(edge.b, []);
    adjacency.get(edge.a).push(edge.b);
    adjacency.get(edge.b).push(edge.a);
  }
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const node = queue.shift();
    for (const next of adjacency.get(node) || []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return edges.filter((edge) => seen.has(edge.a) && seen.has(edge.b));
}

function unsupported(target, reference, reason, dependencies = []) {
  return {
    ok: false,
    query: 'output-impedance',
    target: { netId: target?.id || null, name: netLabel(target) },
    reference: { netId: reference?.id || null, name: netLabel(reference) },
    error: reason,
    dependencies: [...new Set(dependencies)].sort(),
    assumptions: [],
    approximations: ['No numerical values are evaluated; this is a symbolic topology result only.'],
  };
}

const MOS_TYPES = new Set(['nmos', 'pmos', 'nmosb', 'pmosb']);

/**
 * Retain finite r_o only when it participates in a genuine small-signal
 * feedback edge.  The global r_o -> infinity approximation is applied after
 * the exact nodal graph has been built; this graph pass preserves the output
 * resistance needed by any controlled source whose control node is directly
 * connected to another device's drain/source node.  It is deliberately
 * topology-agnostic: no FVF/cascode names or device numbering are involved.
 */
function feedbackFiniteRoDevices(circuit, referenceIds, overrides, options = {}) {
  const flags = normalizeAnalysisApproximations(options);
  if (!flags.ignoreChannelLengthModulation) return [];
  const references = new Set(referenceIds);
  const ignored = (component) => {
    if (options.ignoreDeviceRoOverrides) return false;
    if (normalizeChannelLengthModulationPolicy(component.analysis?.channelLengthModulation) === 'ignore') return true;
    return splitContextValues(options.ignoreRoDevices ?? options.ignoreChannelLengthModulationDevices).includes(component.refdes);
  };
  const node = (net) => net && (references.has(net.id) ? '@AC_GROUND' : net.id);
  const mos = [...circuit.components.values()]
    .filter((component) => MOS_TYPES.has(component.type))
    .filter((component) => !isCurrentSourceModel(overrides.get(component.refdes)) && !isTriodeModel(overrides.get(component.refdes)))
    .filter((component) => !ignored(component));
  const outputEdges = [];
  const feedbackEdges = [];
  for (const component of mos) {
    const drain = node(circuit.netOfTerminal({ comp: component.refdes, term: 'd' }));
    const source = node(circuit.netOfTerminal({ comp: component.refdes, term: 's' }));
    const gate = node(circuit.netOfTerminal({ comp: component.refdes, term: 'g' }));
    const bulk = component.def.terminals.some((term) => term.name === 'b')
      ? node(circuit.netOfTerminal({ comp: component.refdes, term: 'b' })) : null;
    if (!drain || !source) continue;
    outputEdges.push({ refdes: component.refdes, a: drain, b: source });
    const controls = [gate];
    if (!componentIgnoresBodyEffect(component, options) && bulk) controls.push(bulk);
    for (const control of controls) {
      if (!control || control === '@AC_GROUND') continue;
      // Each controlled source connects its control node to both output
      // terminals in the undirected dependency graph.
      feedbackEdges.push({ control, output: drain });
      feedbackEdges.push({ control, output: source });
    }
  }
  const retained = new Set();
  for (const candidate of outputEdges) {
    for (const edge of feedbackEdges) {
      const samePair = (candidate.a === edge.control && candidate.b === edge.output)
        || (candidate.b === edge.control && candidate.a === edge.output);
      if (samePair) {
        retained.add(candidate.refdes);
        break;
      }
    }
  }
  return [...retained].sort();
}

function cascodeOutputBranches(circuit, target, referenceIds, overrides, options = {}) {
  const terminalsByNet = new Map();
  for (const net of circuit.nets.values()) {
    terminalsByNet.set(net.id, new Set(net.terminals.map(({ comp }) => comp)));
  }
  const devices = [...circuit.components.values()]
    .filter((component) => MOS_TYPES.has(component.type))
    .filter((component) => !isCurrentSourceModel(overrides.get(component.refdes)) && !isTriodeModel(overrides.get(component.refdes)))
    .map((component) => {
      const drain = circuit.netOfTerminal({ comp: component.refdes, term: 'd' });
      const source = circuit.netOfTerminal({ comp: component.refdes, term: 's' });
      const gate = circuit.netOfTerminal({ comp: component.refdes, term: 'g' });
      const bulk = component.def.terminals.some((term) => term.name === 'b')
        ? circuit.netOfTerminal({ comp: component.refdes, term: 'b' })
        : null;
      if (!drain || !source || !gate || !referenceIds.has(gate.id) || (bulk && !referenceIds.has(bulk.id))) return null;
      return { component, terminals: [drain.id, source.id], drain, source };
    })
    .filter(Boolean);
  const targetId = target.id;
  const branches = [];
  for (let left = 0; left < devices.length; left++) {
    for (let right = left + 1; right < devices.length; right++) {
      const first = devices[left];
      const second = devices[right];
      const shared = first.terminals.filter((id) => second.terminals.includes(id)
        && id !== targetId && !referenceIds.has(id));
      if (shared.length !== 1) continue;
      const sharedId = shared[0];
      const firstOther = first.terminals.find((id) => id !== sharedId);
      const secondOther = second.terminals.find((id) => id !== sharedId);
      if (!((firstOther === targetId && referenceIds.has(secondOther))
        || (secondOther === targetId && referenceIds.has(firstOther)))) continue;
      if (first.component.type.startsWith('nmos') !== second.component.type.startsWith('nmos')) continue;
      const branchRefs = new Set([first.component.refdes, second.component.refdes]);
      const loaded = [...(terminalsByNet.get(sharedId) || [])].some((refdes) => !branchRefs.has(refdes));
      if (loaded) continue;
      const targetDevice = firstOther === targetId ? first : second;
      const referenceDevice = firstOther === targetId ? second : first;
      const outer = referenceDevice.component;
      const cascode = targetDevice.component;
      branches.push({
        outer,
        cascode,
        sharedId,
        finiteOuter: !componentIgnoresRo(outer, options),
        finiteCascode: !componentIgnoresRo(cascode, options),
        bodyEffect: !componentIgnoresBodyEffect(cascode, options),
        gmroLarge: componentAssumesGmRoLarge(cascode, options),
      });
    }
  }
  const unique = [];
  for (const branch of branches) {
    const key = [branch.outer.refdes, branch.cascode.refdes].sort().join('|');
    if (!unique.some((candidate) => [candidate.outer.refdes, candidate.cascode.refdes].sort().join('|') === key)) unique.push(branch);
  }
  return unique.length >= 2 ? unique : null;
}

/** Recognize a folded cascode side whose cascode source/drain node is loaded
 * by an opposite-polarity MOS device with an AC-grounded gate.  The folded
 * device contributes its output resistance in parallel with the current
 * source transistor at the cascode's internal node. */
function foldedCascodeOutputBranches(circuit, target, referenceIds, overrides, options = {}) {
  const devices = [...circuit.components.values()]
    .filter((component) => MOS_TYPES.has(component.type))
    .filter((component) => !isCurrentSourceModel(overrides.get(component.refdes)) && !isTriodeModel(overrides.get(component.refdes)))
    .map((component) => {
      const drain = circuit.netOfTerminal({ comp: component.refdes, term: 'd' });
      const source = circuit.netOfTerminal({ comp: component.refdes, term: 's' });
      const gate = circuit.netOfTerminal({ comp: component.refdes, term: 'g' });
      const bulk = component.def.terminals.some((term) => term.name === 'b')
        ? circuit.netOfTerminal({ comp: component.refdes, term: 'b' }) : null;
      if (!drain || !source || !gate || !referenceIds.has(gate.id) || (bulk && !referenceIds.has(bulk.id))) return null;
      return { component, drain, source, polarity: component.type.startsWith('nmos') ? 'n' : 'p' };
    })
    .filter(Boolean);
  const targetId = target.id;
  const branches = [];
  for (let left = 0; left < devices.length; left++) {
    for (let right = left + 1; right < devices.length; right++) {
      const first = devices[left];
      const second = devices[right];
      if (first.polarity !== second.polarity) continue;
      const shared = [first.drain.id, first.source.id].filter((id) =>
        [second.drain.id, second.source.id].includes(id) && id !== targetId && !referenceIds.has(id));
      if (shared.length !== 1) continue;
      const sharedId = shared[0];
      const firstOther = first.drain.id === sharedId ? first.source.id : first.drain.id;
      const secondOther = second.drain.id === sharedId ? second.source.id : second.drain.id;
      if (!((firstOther === targetId && referenceIds.has(secondOther))
        || (secondOther === targetId && referenceIds.has(firstOther)))) continue;
      const targetDevice = firstOther === targetId ? first : second;
      const referenceDevice = firstOther === targetId ? second : first;
      const loadDevices = devices
        .filter((device) => device.polarity !== first.polarity)
        .filter((device) => device.component.refdes !== targetDevice.component.refdes
          && device.component.refdes !== referenceDevice.component.refdes)
        .filter((device) => device.drain.id === sharedId || device.source.id === sharedId)
        .map((device) => device.component);
      branches.push({
        outer: referenceDevice.component,
        cascode: targetDevice.component,
        sharedId,
        ...(loadDevices.length ? { loadDevices: [referenceDevice.component, ...loadDevices] } : {}),
        options,
        finiteOuter: !componentIgnoresRo(referenceDevice.component, options),
        finiteCascode: !componentIgnoresRo(targetDevice.component, options),
        bodyEffect: !componentIgnoresBodyEffect(targetDevice.component, options),
        gmroLarge: componentAssumesGmRoLarge(targetDevice.component, options),
      });
    }
  }
  const unique = [];
  for (const branch of branches) {
    const key = [branch.outer.refdes, branch.cascode.refdes].sort().join('|');
    if (!unique.some((candidate) => [candidate.outer.refdes, candidate.cascode.refdes].sort().join('|') === key)) unique.push(branch);
  }
  return unique.length >= 2 && unique.some((branch) => branch.loadDevices?.length > 1) ? unique : null;
}

function cascodeBranchExpression(branch, approximate) {
  if (!branch.finiteOuter || !branch.finiteCascode) return symbol('\\infty');
  const outerRo = symbol(mosOutputName(branch.outer.refdes), branch.outer.refdes);
  const cascodeRo = symbol(mosOutputName(branch.cascode.refdes), branch.cascode.refdes);
  const cascodeIndex = String(branch.cascode.refdes).match(/[0-9]+$/)?.[0] || branch.cascode.refdes;
  const gm = symbol(`g_{m${cascodeIndex}}`, branch.cascode.refdes);
  const gmb = symbol(`g_{mb${cascodeIndex}}`, branch.cascode.refdes);
  const cascodeGm = branch.bodyEffect ? sum(gm, gmb) : gm;
  return approximate
    ? product(outerRo, cascodeGm, cascodeRo)
    : sum(outerRo, cascodeRo, product(outerRo, cascodeGm, cascodeRo));
}

function foldedCascodeBranchExpression(branch, approximate) {
  if (!branch.finiteCascode) return symbol('\\infty');
  const internal = finiteParallel((branch.loadDevices || []).map((device) => {
    if (componentIgnoresRo(device, branch.options || {})) return symbol('\\infty');
    return symbol(mosOutputName(device.refdes), device.refdes);
  }));
  if (internal.kind === 'symbol' && internal.name === '\\infty') return internal;
  const cascodeIndex = String(branch.cascode.refdes).match(/[0-9]+$/)?.[0] || branch.cascode.refdes;
  const gm = symbol(`g_{m${cascodeIndex}}`, branch.cascode.refdes);
  const gmb = symbol(`g_{mb${cascodeIndex}}`, branch.cascode.refdes);
  const cascodeGm = branch.bodyEffect ? sum(gm, gmb) : gm;
  return approximate
    ? product(internal, cascodeGm, symbol(mosOutputName(branch.cascode.refdes), branch.cascode.refdes))
    : sum(internal, symbol(mosOutputName(branch.cascode.refdes), branch.cascode.refdes), product(internal, cascodeGm, symbol(mosOutputName(branch.cascode.refdes), branch.cascode.refdes)));
}

function foldedCascodeDominantCondition(branch) {
  const index = String(branch.cascode.refdes).match(/[0-9]+$/)?.[0] || branch.cascode.refdes;
  const gm = branch.bodyEffect ? `(g_{m${index}} + g_{mb${index}})` : `g_{m${index}}`;
  const load = (branch.loadDevices || []).map((device) => mosOutputName(device.refdes)).join(' \\|\\| ');
  return `${gm} (${load} \\|\\| ${mosOutputName(branch.cascode.refdes)}) \\gg 1`;
}

function cascodeDominantCondition(branch) {
  const cascodeIndex = String(branch.cascode.refdes).match(/[0-9]+$/)?.[0] || branch.cascode.refdes;
  const outerRo = mosOutputName(branch.outer.refdes);
  const cascodeRo = mosOutputName(branch.cascode.refdes);
  const gm = branch.bodyEffect
    ? '(g_{m' + cascodeIndex + '} + g_{mb' + cascodeIndex + '})'
    : 'g_{m' + cascodeIndex + '}';
  return gm + ' (' + outerRo + ' \\|\\| ' + cascodeRo + ') \\gg 1; equivalently '
    + gm + ' ' + outerRo + ' ' + cascodeRo + ' \\gg ' + outerRo + ' + ' + cascodeRo;
}

function finiteParallel(terms) {
  const finite = terms.filter((term) => term?.kind !== 'symbol' || term.name !== '\\infty');
  return finite.length ? parallel(...finite) : symbol('\\infty');
}

/**
 * Under the explicit large-g_m r_o approximation, a cascoded transistor
 * stack is normally much higher impedance than a directly attached passive
 * load.  Recognize that load-limited shape for arbitrary stack depth so the
 * gain shortcut can use the same R_out that the output report displays.
 */
function loadLimitedCascodeResistance(circuit, target, referenceIds, overrides, options = {}) {
  const flags = normalizeAnalysisApproximations(options);
  if (!flags.cascodeApproximation || !gmRoApproximationSelected(circuit, options)) return null;
  const loadTerms = [];
  for (const component of circuit.components.values()) {
    if (!['resistor', 'variable_resistor'].includes(component.type)) continue;
    if (componentIgnoresResistance(component, options)) continue;
    const a = circuit.netOfTerminal({ comp: component.refdes, term: 'a' });
    const b = circuit.netOfTerminal({ comp: component.refdes, term: 'b' });
    if (!a || !b) continue;
    const other = a.id === target.id && referenceIds.has(b.id) ? b
      : b.id === target.id && referenceIds.has(a.id) ? a
        : null;
    if (other) loadTerms.push(symbol(indexedName(component.refdes, 'R'), component.refdes));
  }
  if (!loadTerms.length) return null;

  const adjacency = new Map();
  const link = (a, b, component) => {
    if (!a || !b) return;
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a).push({ node: b, component });
    adjacency.get(b).push({ node: a, component });
  };
  for (const component of circuit.components.values()) {
    if (!MOS_TYPES.has(component.type)) continue;
    const override = overrides.get(component.refdes);
    if (isCurrentSourceModel(override) || isTriodeModel(override)) continue;
    const drain = circuit.netOfTerminal({ comp: component.refdes, term: 'd' });
    const source = circuit.netOfTerminal({ comp: component.refdes, term: 's' });
    const gate = circuit.netOfTerminal({ comp: component.refdes, term: 'g' });
    const bulk = component.def.terminals.some((term) => term.name === 'b')
      ? circuit.netOfTerminal({ comp: component.refdes, term: 'b' })
      : null;
    if (!drain || !source || !gate || !referenceIds.has(gate.id) || (bulk && !referenceIds.has(bulk.id))) continue;
    link(drain.id, source.id, component);
  }
  const seen = new Set([target.id]);
  const mosRefs = new Set();
  const queue = [target.id];
  while (queue.length) {
    const node = queue.shift();
    for (const edge of adjacency.get(node) || []) {
      mosRefs.add(edge.component.refdes);
      if (seen.has(edge.node)) continue;
      seen.add(edge.node);
      queue.push(edge.node);
    }
  }
  if (![...referenceIds].some((id) => seen.has(id)) || mosRefs.size < 2) return null;
  return loadTerms.length === 1 ? loadTerms[0] : parallel(...loadTerms);
}

/** Reduce a grounded-gate series MOS stack with direct resistive loading. */
function seriesCascodeLoadReduction(circuit, target, referenceIds, overrides, options = {}) {
  const adjacency = new Map();
  const link = (a, b, component) => {
    if (!a || !b || a === b) return;
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a).push({ node: b, component });
    adjacency.get(b).push({ node: a, component });
  };
  for (const component of circuit.components.values()) {
    if (!MOS_TYPES.has(component.type)) continue;
    const override = overrides.get(component.refdes);
    if (isCurrentSourceModel(override) || isTriodeModel(override)) continue;
    const drain = circuit.netOfTerminal({ comp: component.refdes, term: 'd' });
    const source = circuit.netOfTerminal({ comp: component.refdes, term: 's' });
    const gate = circuit.netOfTerminal({ comp: component.refdes, term: 'g' });
    const bulk = component.def.terminals.some((term) => term.name === 'b')
      ? circuit.netOfTerminal({ comp: component.refdes, term: 'b' })
      : null;
    if (!drain || !source || !gate || !referenceIds.has(gate.id) || (bulk && !referenceIds.has(bulk.id))) continue;
    link(drain.id, source.id, component);
  }
  const path = [];
  const visited = new Set();
  let node = target.id;
  let previous = null;
  while (!referenceIds.has(node)) {
    if (visited.has(node)) return null;
    visited.add(node);
    const candidates = (adjacency.get(node) || []).filter((edge) => edge.component.refdes !== previous);
    if (candidates.length !== 1) return null;
    const edge = candidates[0];
    path.push(edge.component);
    previous = edge.component.refdes;
    node = edge.node;
  }
  if (path.length < 2) return null;
  if (path.some((component) => component.type.startsWith('nmos') !== path[0].type.startsWith('nmos'))) return null;
  const pathRefs = new Set(path.map((component) => component.refdes));
  for (let index = 0; index < path.length - 1; index++) {
    const source = circuit.netOfTerminal({ comp: path[index].refdes, term: 's' });
    const drain = circuit.netOfTerminal({ comp: path[index + 1].refdes, term: 'd' });
    if (!source || source.id !== drain?.id) return null;
    if ([...(circuit.nets.get(source.id)?.terminals || [])].some(({ comp }) => !pathRefs.has(comp))) return null;
  }

  const loads = [];
  for (const component of circuit.components.values()) {
    if (!['resistor', 'variable_resistor'].includes(component.type)) continue;
    if (componentIgnoresResistance(component, options)) continue;
    const a = circuit.netOfTerminal({ comp: component.refdes, term: 'a' });
    const b = circuit.netOfTerminal({ comp: component.refdes, term: 'b' });
    if (!a || !b) continue;
    if ((a.id === target.id && referenceIds.has(b.id)) || (b.id === target.id && referenceIds.has(a.id))) {
      loads.push(component);
    }
  }
  // Keep the established current-source presentation; longer stacks use the
  // recursive reducer when the generic nodal result would expand.
  if (!loads.length && path.length === 2) return null;
  const makeBranch = (branchOptions, approximate = false) => {
    let branch = null;
    for (let index = path.length - 1; index >= 0; index--) {
      const component = path[index];
      if (componentIgnoresRo(component, branchOptions)) return symbol('\\infty');
      const ro = symbol(systemMosName(component.refdes, 'ro'), component.refdes);
      if (!branch) {
        branch = ro;
        continue;
      }
      const gm = symbol(systemMosName(component.refdes, 'gm'), component.refdes);
      const gmb = componentIgnoresBodyEffect(component, branchOptions)
        ? null
        : symbol(systemMosName(component.refdes, 'gmb'), component.refdes);
      const effectiveGm = gmb ? sum(gm, gmb) : gm;
      const exact = sum(branch, ro, product(branch, effectiveGm, ro));
      branch = approximate && componentAssumesGmRoLarge(component, branchOptions)
        ? product(branch, effectiveGm, ro)
        : exact;
    }
    return branch;
  };
  const load = loads.length === 1
    ? symbol(indexedName(loads[0].refdes, 'R'), loads[0].refdes)
    : loads.length ? parallel(...loads.map((component) => symbol(indexedName(component.refdes, 'R'), component.refdes))) : null;
  const exactBranch = makeBranch(exactAnalysisOptions(options));
  const branch = makeBranch(options, normalizeAnalysisApproximations(options).cascodeApproximation);
  return {
    exactExpression: finiteParallel([load, exactBranch]),
    expression: finiteParallel([load, branch]),
    devices: path,
    loads,
  };
}

/**
 * Derive a symbolic output impedance between a target net and an AC reference.
 * The compact display recognizes resistor/variable-resistor series-parallel
 * networks and the common-source MOS form.  Other modelable topologies fall
 * back to the generic nodal solver above; truly unsupported devices remain
 * explicit errors rather than guesses.
 */
export function analyzeOutputImpedance(circuit, targetName, options = {}) {
  const targetResult = resolveNet(circuit, targetName, 'target');
  if (!targetResult.ok) return unsupported(null, null, targetResult.error);
  const acGroundResult = resolveAcGrounds(circuit, [markedAcGrounds(circuit), options.acGrounds ?? options.acGround, options.mode === 'differential' ? options.differentialSide : null]);
  if (!acGroundResult.ok) return unsupported(targetResult.net, null, acGroundResult.error);
  let referenceResult = findReferenceNet(circuit, options.reference);
  if (!referenceResult.ok && acGroundResult.nets.length) {
    const first = acGroundResult.nets[0];
    referenceResult = {
      ok: true,
      net: first,
      netIds: new Set([first.id]),
      global: false,
      inferred: true,
      userSelected: true,
    };
  }
  if (!referenceResult.ok) return unsupported(targetResult.net, null, referenceResult.error);
  const target = targetResult.net;
  const reference = referenceResult.net;
  const referenceIds = new Set(referenceResult.netIds || [reference.id]);
  for (const net of acGroundResult.nets) referenceIds.add(net.id);
  const inputName = options.input || options.inputName;
  let zeroedInput = null;
  let inputWasInferred = false;
  if (inputName) {
    const inputResult = resolveNet(circuit, inputName, 'input/source');
    if (!inputResult.ok) return unsupported(target, reference, inputResult.error);
    zeroedInput = inputResult.net;
    referenceIds.add(zeroedInput.id);
  } else {
    const candidates = [...circuit.nets.values()].filter((net) => net.id !== target.id && !referenceIds.has(net.id) && likelyInputNet(circuit, net));
    if (candidates.length === 1) {
      [zeroedInput] = candidates;
      inputWasInferred = true;
      referenceIds.add(zeroedInput.id);
    }
  }
  const referenceNode = '@AC_GROUND';
  const nodeForNet = (net) => referenceIds.has(net.id) ? referenceNode : net.id;
  if (referenceIds.has(target.id)) return unsupported(target, reference, 'target and reference must be different physical nets');

  const approximationFlags = normalizeAnalysisApproximations(options);
  const edges = [];
  const dependencies = [];
  const overrides = circuitModelOverrides(circuit, options.models);
  // Resolve this topology before stamping the nodal model.  When both
  // large-g_m r_o and the form-wide r_o→∞ approximation are selected, the
  // former is the more useful cascode description: retain finite symbolic
  // r_o for recognized branch devices so compact cascode products remain
  // meaningful, while honoring explicit per-device or named-device omissions.
  const preliminaryFoldedBranches = foldedCascodeOutputBranches(circuit, target, referenceIds, overrides, options);
  const preliminaryCascodeBranches = preliminaryFoldedBranches || cascodeOutputBranches(circuit, target, referenceIds, overrides, options);
  const singleCascodeTopology = !preliminaryCascodeBranches
    ? seriesCascodeLoadReduction(circuit, target, referenceIds, overrides, options)
    : null;
  const explicitlyIgnoredRoRefs = new Set(splitContextValues(options.ignoreRoDevices ?? options.ignoreChannelLengthModulationDevices));
  const retainedCascodeDevices = preliminaryCascodeBranches
    ? preliminaryCascodeBranches.flatMap((branch) => branch.loadDevices
      ? [...branch.loadDevices, branch.cascode]
      : [branch.outer, branch.cascode])
    : singleCascodeTopology?.devices || [];
  const cascodeGmroSelected = preliminaryCascodeBranches
    ? preliminaryCascodeBranches.some((branch) => branch.gmroLarge)
    : retainedCascodeDevices.some((component) => componentAssumesGmRoLarge(component, options));
  const retainedCascodeRefs = retainedCascodeDevices.length && approximationFlags.cascodeApproximation
    && cascodeGmroSelected && approximationFlags.ignoreChannelLengthModulation
    ? [...new Set(retainedCascodeDevices.map((component) => component.refdes))]
      .filter((refdes) => normalizeChannelLengthModulationPolicy(circuit.components.get(refdes)?.analysis?.channelLengthModulation) !== 'ignore')
      .filter((refdes) => !explicitlyIgnoredRoRefs.has(refdes))
    : [];
  // Preserve finite r_o for feedback edges while applying the global
  // r_o -> infinity approximation to ordinary output branches. This is
  // derived from the small-signal graph, not from a named topology.
  const feedbackRoRefs = feedbackFiniteRoDevices(circuit, referenceIds, overrides, options);
  const retainedFiniteRoRefs = [...new Set([
    ...splitContextValues(options.retainFiniteRoDevices),
    ...retainedCascodeRefs,
    ...feedbackRoRefs,
  ])];
  const modelOptions = {
    ...(retainedFiniteRoRefs.length ? { ...options, retainFiniteRoDevices: retainedFiniteRoRefs } : options),
    referenceIds,
    ...(zeroedInput ? { inputNetId: zeroedInput.id } : {}),
  };
  // A global g_m r_o approximation is useful for ordinary stages, but it
  // must not silently turn a recognized cascode stack into its dominant
  // product.  That extra structural reduction has its own explicit form
  // option; keep the systematic reference exact until it is selected.
  const singleCascodeCandidate = !preliminaryCascodeBranches
    ? seriesCascodeLoadReduction(circuit, target, referenceIds, overrides, modelOptions)
    : null;
  const cascodeDevices = [...circuit.components.values()]
    .filter((component) => MOS_TYPES.has(component.type))
    .map((component) => ({
      component,
      drain: circuit.netOfTerminal({ comp: component.refdes, term: 'd' })?.id,
      source: circuit.netOfTerminal({ comp: component.refdes, term: 's' })?.id,
    }))
    .filter((device) => device.drain && device.source);
  const cascodeStackDetected = cascodeDevices.some((first, index) => cascodeDevices.slice(index + 1).some((second) => {
    const shared = [first.drain, first.source].filter((id) => [second.drain, second.source].includes(id)
      && id !== target.id && !referenceIds.has(id));
    if (shared.length !== 1) return false;
    const ends = [first.drain, first.source, second.drain, second.source].filter((id) => id !== shared[0]);
    return ends.includes(target.id) && ends.some((id) => referenceIds.has(id));
  }));
  const cascodeRecognized = !!preliminaryCascodeBranches || !!singleCascodeCandidate || cascodeStackDetected;
  const systematicOptions = cascodeRecognized && !approximationFlags.cascodeApproximation
    ? { ...modelOptions, gmroLarge: false, assumeGmRoLarge: false }
    : modelOptions;
  const textbook = textbookApproximationNotes(modelOptions, circuit);
  const assumptions = [
    ...textbook.assumptions,
    referenceResult.global
      ? 'Unnamed ground, supply, and VCM markers are treated as one global AC reference.'
      : 'The requested reference is treated as AC ground.',
    'No numerical values are evaluated; component values remain symbolic names.',
    ...contextAssumptions(options),
  ];
  if (zeroedInput) assumptions.push(`${netLabel(zeroedInput) || zeroedInput.id} ${inputWasInferred ? 'was inferred as the input source' : 'is the input source'} and is set to zero (AC ground) for output-impedance analysis.`);
  const approximations = [...textbook.approximations];
  const deferredUnsupported = [];
  const systematicModel = buildSystematicModel(circuit, { target, referenceIds, options: systematicOptions });
  const needsAlgebraicOutput = !preliminaryFoldedBranches && !preliminaryCascodeBranches && !singleCascodeCandidate;
  const systematic = systematicOutputResult(circuit, systematicModel, {
    target,
    referenceIds,
    inputId: zeroedInput?.id || null,
  }, systematicOptions, needsAlgebraicOutput);
  const resultLabel = acQuantityLabel('Z_{out}', systematic.expression);
  const withSystematic = (report, includeExtraFields = true) => {
    report.smallSignalModel = systematicModel;
    report.smallSignalNetlist = systematic.netlist;
    report.nodeEquations = systematic.equations || [];
    report.equationCount = systematic.equationCount || report.nodeEquations.length;
    report.nodeUnknowns = systematic.unknowns || [];
    report.unknownCount = systematic.unknownCount || report.nodeUnknowns.length;
    report.systematicEquation = null;
    report.systematicRawEquation = systematic.ok ? systematic.equation : null;
    report.systematicExactEquation = systematic.ok ? (systematic.exactEquation || systematic.equation) : null;
    if (includeExtraFields) report.systematicExactExpression = systematic.ok ? (systematic.exactExpression || null) : null;
    report.systematicError = systematic.ok ? null : systematic.error;
    if (includeExtraFields && zeroedInput) {
      report.input = { netId: zeroedInput.id, name: netLabel(zeroedInput), zeroed: true, inferred: inputWasInferred };
      report.reference = {
        ...(report.reference || {}),
        name: 'AC_GROUND',
        inferred: true,
        netIds: [...referenceIds].sort(),
      };
    }
    return report;
  };
  const genericOutputReport = (report) => {
    if (!systematic.ok) return withSystematic(report);
    // The compact reducer may have reached a topology it cannot collapse
    // (source degeneration, feedback, etc.) even though the systematic
    // nodal model solved it successfully. Do not leak the compact reducer's
    // provisional `error` into an otherwise valid report.
    delete report.error;
    report.ok = true;
    report.query = 'output-impedance';
    report.equation = systematic.equation;
    report.expression = systematic.expression;
    report.dependencies = [...sxDependencies(systematic.expression)].sort();
    report.assumptions = [...new Set([...assumptions, ...systematicModel.assumptions])];
    report.approximations = [...new Set([...approximations, ...systematicModel.approximations])];
    report.exactEquation = systematic.exactEquation || systematic.equation;
    return withSystematic(report);
  };
  const unsupportedOutputReport = (report, reportApproximations = approximations, generic = false) => {
    report.assumptions = assumptions;
    report.approximations = reportApproximations;
    return generic ? genericOutputReport(report) : withSystematic(report, false);
  };

  // Independent voltage sources alter connectivity by becoming shorts. The
  // compact resistor/cascode reducers operate on the original physical net
  // graph, so use the aliased nodal model whenever one is present.
  if (systematicModel.shortCircuits?.length) {
    return genericOutputReport({
      ok: false,
      query: 'output-impedance',
      target: { netId: target.id, name: netLabel(target) },
      reference: { netId: reference.id, name: netLabel(reference) },
      assumptions,
      approximations,
    });
  }

  // The compact reducer only knows the original two-terminal passive branch.
  // Once Miller splitting is actually applicable, expose the stamped nodal
  // model so the displayed impedance includes the transformed input/output
  // shunts for any supported impedance type.
  if (millerApproximationCandidates(circuit, modelOptions).length) {
    return genericOutputReport({
      ok: false,
      query: 'output-impedance',
      target: { netId: target.id, name: netLabel(target) },
      reference: { netId: reference.id, name: netLabel(reference) },
      assumptions,
      approximations,
    });
  }

  // DC-only analysis changes the topology itself (capacitors open, inductors
  // shorted), so the frequency-domain compact reducers must not inspect the
  // original component graph.  The stamped model above already contains the
  // reduced topology; use its nodal result as the sole source of truth.
  if (approximationFlags.dcOnly) {
    return genericOutputReport({
      ok: false,
      query: 'output-impedance',
      target: { netId: target.id, name: netLabel(target) },
      reference: { netId: reference.id, name: netLabel(reference) },
      assumptions,
      approximations,
    });
  }

  // Complementary and folded cascodes are independent small-signal branches
  // from the output node to AC ground. Keep each branch visible instead of
  // exposing the expanded nodal expression.
  const cascodeBranches = preliminaryCascodeBranches
    ? (preliminaryFoldedBranches
      ? foldedCascodeOutputBranches(circuit, target, referenceIds, overrides, modelOptions)
      : cascodeOutputBranches(circuit, target, referenceIds, overrides, modelOptions))
    : null;
  if (cascodeBranches) {
    const cascodeReductionSelected = approximationFlags.cascodeApproximation;
    const cascodeReductionApplied = cascodeReductionSelected
      && cascodeBranches.some((branch) => branch.gmroLarge && branch.finiteOuter && branch.finiteCascode);
    const branchExpression = (branch, approximate) => branch.loadDevices
      ? foldedCascodeBranchExpression(branch, approximate)
      : cascodeBranchExpression(branch, approximate);
    const approximateExpression = finiteParallel(cascodeBranches.map((branch) => branchExpression(branch, cascodeReductionApplied && branch.gmroLarge)));
    const finiteExpression = finiteParallel(cascodeBranches.map((branch) => branchExpression(branch, false)));
    const exactBranches = (preliminaryFoldedBranches
      ? foldedCascodeOutputBranches
      : cascodeOutputBranches)(circuit, target, referenceIds, overrides, {
      ...options,
      ignoreChannelLengthModulation: false,
      ignoreRoDevices: [],
      ignoreChannelLengthModulationDevices: [],
      ignoreDeviceRoOverrides: true,
      ignoreDeviceApproximationOverrides: true,
    });
    const exactExpression = finiteParallel((exactBranches || cascodeBranches)
      .map((branch) => branchExpression({ ...branch, finiteOuter: true, finiteCascode: true, options: { ...options, ignoreDeviceRoOverrides: true } }, false)));
    const expression = cascodeReductionApplied ? approximateExpression : finiteExpression;
    const approximationSelected = cascodeReductionApplied
      || approximationFlags.ignoreChannelLengthModulation
      || approximationFlags.ignoreBodyEffect
      || [...cascodeBranches].some((branch) => branch.finiteOuter !== true || branch.finiteCascode !== true);
    const branchText = cascodeBranches
      .map((branch) => `${branch.outer.refdes}/${branch.cascode.refdes}`)
      .join(', ');
    if (preliminaryFoldedBranches) {
      const loadedText = cascodeBranches
        .filter((branch) => branch.loadDevices?.length > 1)
        .map((branch) => `${branch.cascode.refdes} source node: ${branch.loadDevices.map((device) => mosOutputName(device.refdes)).join(' \\|\\| ')}`)
        .join('; ');
      assumptions.push(`The output is recognized as parallel folded-cascode branches (${branchText}) from the target node to AC ground.`);
      if (loadedText) assumptions.push(`The folded cascode internal load is modeled as parallel output resistances (${loadedText}).`);
    } else {
      assumptions.push(`The output is recognized as parallel cascode branches (${branchText}) from the target node to AC ground.`);
    }
    const dominantBranches = cascodeReductionApplied
      ? cascodeBranches.filter((branch) => branch.gmroLarge && branch.finiteOuter && branch.finiteCascode)
      : [];
    approximations.push(dominantBranches.length
      ? 'Cascode dominant-term approximation: ' + dominantBranches.map((branch) => branch.loadDevices ? foldedCascodeDominantCondition(branch) : cascodeDominantCondition(branch)).join('; ') + '.'
      : 'Cascode branch impedances are retained as explicit series and controlled-source terms.');
    if (retainedCascodeRefs.length) {
      assumptions.push(`Finite symbolic r_o is retained for the selected cascode branch devices (${retainedCascodeRefs.join(', ')}) so the g_m r_o \\gg 1 approximation remains meaningful; explicit per-device r_o omissions still produce an open branch.`);
      approximations.push('Cascode-specific precedence: the large-g_m r_o reduction retains finite r_o instead of rendering the recognized branch as infinity.');
    }
    const equation = `${resultLabel} ${approximationSelected ? '\\approx' : '='} ${expressionText(expression)}`;
    return withSystematic({
      ok: true,
      query: 'output-impedance',
      target: { netId: target.id, name: netLabel(target) },
      reference: { netId: reference.id, name: netLabel(reference) },
      equation,
      exactEquation: `${resultLabel} = ${expressionText(exactExpression)}`,
      expression,
      dependencies: [...expressionDependencies(expression)].sort(),
      assumptions: [...new Set([...assumptions, ...systematicModel.assumptions])],
      approximations: [...new Set([...approximations, ...systematicModel.approximations])],
    });
  }

  const loadLimited = loadLimitedCascodeResistance(circuit, target, referenceIds, overrides, options);
  if (loadLimited) {
    const equation = `${resultLabel} \\approx ${expressionText(loadLimited)}`;
    assumptions.push('The cascoded device stack is recognized as a high-impedance branch in parallel with the directly attached passive load.');
    approximations.push('Large-g_m r_o approximation: the cascoded branch is neglected relative to the explicit output load.');
    return withSystematic({
      ok: true,
      query: 'output-impedance',
      target: { netId: target.id, name: netLabel(target) },
      reference: { netId: reference.id, name: netLabel(reference) },
      equation,
      exactEquation: systematic.ok ? systematic.exactEquation : equation,
      expression: loadLimited,
      dependencies: [...expressionDependencies(loadLimited)].sort(),
      assumptions: [...new Set([...assumptions, ...systematicModel.assumptions])],
      approximations: [...new Set([...approximations, ...systematicModel.approximations])],
    });
  }

  const singleCascode = singleCascodeCandidate || seriesCascodeLoadReduction(circuit, target, referenceIds, overrides, options);
  if (singleCascode) {
    const exactExpression = singleCascode.exactExpression;
    const expression = singleCascode.expression;
    const approximationSelected = analysisApproximationSelected(circuit, options)
      && sxKey(expression) !== sxKey(exactExpression);
    assumptions.push(`The output is recognized as a grounded-gate series cascode branch in parallel with the direct load (${singleCascode.devices.map((device) => device.refdes).join('/')}).`);
    if (singleCascode.devices.length === 2) {
      const singleBranch = {
        outer: singleCascode.devices[1],
        cascode: singleCascode.devices[0],
        finiteOuter: !componentIgnoresRo(singleCascode.devices[1], options),
        finiteCascode: !componentIgnoresRo(singleCascode.devices[0], options),
        bodyEffect: !componentIgnoresBodyEffect(singleCascode.devices[0], options),
        gmroLarge: componentAssumesGmRoLarge(singleCascode.devices[0], options),
      };
      approximations.push(singleBranch.gmroLarge && singleBranch.finiteOuter && singleBranch.finiteCascode
        ? 'Cascode dominant-term approximation: ' + cascodeDominantCondition(singleBranch) + '.'
        : 'Cascode branch kept compact (exact finite-r_o form; algebraic presentation only).');
    } else {
      approximations.push('Series cascode branch is composed recursively from exact finite-r_o device sections.');
    }
    return withSystematic({
      ok: true,
      query: 'output-impedance',
      target: { netId: target.id, name: netLabel(target) },
      reference: { netId: reference.id, name: netLabel(reference) },
      equation: `${resultLabel} ${approximationSelected ? '\\approx' : '='} ${expressionText(expression)}`,
      exactEquation: `${resultLabel} = ${expressionText(exactExpression)}`,
      expression,
      dependencies: [...expressionDependencies(expression)].sort(),
      assumptions: [...new Set([...assumptions, ...systematicModel.assumptions])],
      approximations: [...new Set([...approximations, ...systematicModel.approximations])],
    });
  }

  const sourceDegeneration = sourceDegenerationOutputReduction(circuit, target, referenceIds, options);
  if (sourceDegeneration) {
    const exactReduction = sourceDegenerationOutputReduction(circuit, target, referenceIds, exactAnalysisOptions(options));
    const exactExpression = exactReduction?.exactExpression || sourceDegeneration.exactExpression;
    const expression = sourceDegeneration.expression;
    const approximationSelected = analysisApproximationSelected(circuit, options)
      && sxKey(expression) !== sxKey(exactExpression);
    assumptions.push(`${sourceDegeneration.component.refdes} source degeneration is reduced to its finite-r_o output resistance with the source resistor and body effect retained symbolically; the nodal source-feedback effects are captured by this compact reduction.`);
    approximations.push('Source-degenerated common-source reduction: the nodal result is shown as the transistor output resistance in parallel with the drain load.');
    const report = withSystematic({
      ok: true,
      query: 'output-impedance',
      target: { netId: target.id, name: netLabel(target) },
      reference: { netId: reference.id, name: netLabel(reference) },
      equation: `${resultLabel} ${approximationSelected ? '\\approx' : '='} ${sxText(expression)}`,
      exactEquation: `${resultLabel} = ${sxText(exactExpression)}`,
      expression,
      dependencies: [...expressionDependencies(expression)].sort(),
      assumptions: [...new Set([...assumptions, ...systematicModel.assumptions])],
      approximations: [...new Set([...approximations, ...systematicModel.approximations])],
    });
    return report;
  }

  for (const component of circuit.components.values()) {
    const type = component.type;
    const isResistor = type === 'resistor' || type === 'variable_resistor';
    if (isResistor) {
      if (componentIgnoresResistance(component, options)) {
        dependencies.push(component.refdes);
        assumptions.push(`${component.refdes} is marked R = \\infty and is treated as an open branch relative to other resistors on the same nets.`);
        approximations.push(`Per-device approximation: ${component.refdes} R \\to \\infty.`);
        continue;
      }
      const a = circuit.netOfTerminal({ comp: component.refdes, term: 'a' });
      const b = circuit.netOfTerminal({ comp: component.refdes, term: 'b' });
      if (!a || !b) continue;
      const expr = symbol(indexedName(component.refdes, 'R'), component.refdes);
      edges.push({ a: nodeForNet(a), b: nodeForNet(b), expr, sources: [component.refdes] });
      dependencies.push(component.refdes);
      continue;
    }
    const isCapacitor = type === 'capacitor' || type === 'variable_capacitor';
    if (isCapacitor) {
      const a = circuit.netOfTerminal({ comp: component.refdes, term: 'a' });
      const b = circuit.netOfTerminal({ comp: component.refdes, term: 'b' });
      if (!a || !b) continue;
      const capacitance = `s \\, ${indexedName(component.refdes, 'C')}`;
      const expr = symbol(`\\frac{1}{${capacitance}}`, component.refdes);
      edges.push({ a: nodeForNet(a), b: nodeForNet(b), expr, sources: [component.refdes] });
      dependencies.push(component.refdes);
      assumptions.push(`${component.refdes} is represented by the small-signal impedance \\frac{1}{s ${indexedName(component.refdes, 'C')}}.`);
      approximations.push(`Small-signal approximation: ${component.refdes} is treated as an ideal capacitor in the frequency domain.`);
      continue;
    }
    const isInductor = type === 'inductor' || type === 'variable_inductor';
    if (isInductor) {
      const a = circuit.netOfTerminal({ comp: component.refdes, term: 'a' });
      const b = circuit.netOfTerminal({ comp: component.refdes, term: 'b' });
      if (!a || !b) continue;
      const inductance = `s \, ${indexedName(component.refdes, 'L')}`;
      const expr = symbol(inductance, component.refdes);
      edges.push({ a: nodeForNet(a), b: nodeForNet(b), expr, sources: [component.refdes] });
      dependencies.push(component.refdes);
      assumptions.push(`${component.refdes} is represented by the small-signal impedance s ${indexedName(component.refdes, 'L')}.`);
      approximations.push(`Small-signal approximation: ${component.refdes} is treated as an ideal inductor in the frequency domain.`);
      continue;
    }

    const isMos = ['nmos', 'pmos', 'nmosb', 'pmosb'].includes(type);
    if (!isMos) {
      const ignoredMarker = ['ground', 'port', 'port_filled', 'input', 'output', 'inputoutput', 'solder', 'supply', 'vcm'].includes(type);
      if (!ignoredMarker && type !== 'current_source') {
        const nets = component.def.terminals
          .map((term) => circuit.netOfTerminal({ comp: component.refdes, term: term.name }))
          .filter(Boolean);
        if (nets.length) deferredUnsupported.push({ refdes: component.refdes, type, netIds: nets.map((net) => net.id) });
      }
      continue;
    }
    const override = overrides.get(component.refdes);
    if (override && isCurrentSourceModel(override)) {
      dependencies.push(component.refdes);
      assumptions.push(`${component.refdes} is explicitly treated as an ideal small-signal current source, so it is an open circuit.`);
      approximations.push(`Model override: ${component.refdes} current-source behavior is approximated as infinite small-signal output resistance.`);
      continue;
    }
    if (override && isTriodeModel(override)) {
      const drain = circuit.netOfTerminal({ comp: component.refdes, term: 'd' });
      const source = circuit.netOfTerminal({ comp: component.refdes, term: 's' });
      if (!drain || !source) return genericOutputReport(unsupported(target, reference, `${component.refdes} triode model requires drain and source connections`, dependencies));
      edges.push({ a: nodeForNet(drain), b: nodeForNet(source), expr: symbol(`r_{ds${component.refdes.replace(/^[A-Za-z]+/, '')}}`, component.refdes), sources: [component.refdes] });
      dependencies.push(component.refdes);
      assumptions.push(`${component.refdes} is explicitly modeled as a triode device, represented by a symbolic r_{ds}.`);
      approximations.push(`Model override: ${component.refdes} triode behavior is reduced to a small-signal resistance.`);
      continue;
    }
    if (override && !['ro', 'r_o', 'output-resistance', 'small-signal'].includes(override)) {
      return withSystematic(unsupported(target, reference, `unknown small-signal model override "${override}" for ${component.refdes}`, [component.refdes]));
    }
    const drain = circuit.netOfTerminal({ comp: component.refdes, term: 'd' });
    const source = circuit.netOfTerminal({ comp: component.refdes, term: 's' });
    const gate = circuit.netOfTerminal({ comp: component.refdes, term: 'g' });
    const hasBulkTerminal = component.def.terminals.some((term) => term.name === 'b');
    const bulk = hasBulkTerminal
      ? circuit.netOfTerminal({ comp: component.refdes, term: 'b' })
      : null;
    dependencies.push(component.refdes);
    if (!drain || !source || !gate || nodeForNet(gate) !== referenceNode || (bulk && nodeForNet(bulk) !== referenceNode)) {
      return genericOutputReport(unsupported(target, reference,
        `${component.refdes} is not in the supported AC-grounded common-source form; gate and source must be tied to the AC reference, and any connected bulk must use that reference`,
        dependencies));
    }
    if (nodeForNet(source) !== referenceNode) {
      assumptions.push(`${component.refdes} has source degeneration; its source node and g_m source-feedback effects are retained in the nodal small-signal model.`);
      approximations.push(`Systematic small-signal approximation: ${component.refdes} source degeneration is solved by KCL rather than collapsed into a compact series/parallel form.`);
      return genericOutputReport({
        ok: false,
        query: 'output-impedance',
        target: { netId: target.id, name: netLabel(target) },
        reference: { netId: reference.id, name: netLabel(reference) },
        dependencies,
      });
    }
    const ignoreRo = componentIgnoresRo(component, options);
    if (!ignoreRo) {
      edges.push({
        a: nodeForNet(drain),
        b: nodeForNet(source),
        expr: symbol(mosOutputName(component.refdes), component.refdes),
        sources: [component.refdes],
      });
    }
    const defaultBulk = component.type.startsWith('pmos') ? 'VDD' : 'GND';
    if (!hasBulkTerminal || !bulk) {
      assumptions.push(`${component.refdes} bulk is unused and is assumed tied to ${defaultBulk}; in the small-signal model this is an AC-ground assumption.`);
    } else {
      assumptions.push(`${component.refdes} bulk is explicitly tied to the AC reference.`);
    }
    if (normalizeChannelLengthModulationPolicy(component.analysis?.channelLengthModulation) === 'ignore') {
      assumptions.push(`${component.refdes} has an explicit per-device override: channel-length modulation is ignored, so r_o is omitted.`);
      approximations.push(`Per-device approximation: ${component.refdes} output resistance r_o is ignored.`);
    } else if (normalizeChannelLengthModulationPolicy(component.analysis?.channelLengthModulation) === 'finite' && textbook.flags.ignoreChannelLengthModulation) {
      assumptions.push(`${component.refdes} has an explicit per-device override: finite r_o is retained despite the form-wide channel-length modulation approximation.`);
    }
    assumptions.push(ignoreRo
      ? `${component.refdes} is modeled with channel-length modulation ignored; g_m and g_{mb} effects are omitted because its controlling terminals are AC-grounded.`
      : `${component.refdes} is modeled by r_{o${component.refdes.replace(/^[A-Za-z]+/, '')}} with g_m and g_{mb} effects omitted because its controlling terminals are AC-grounded.`);
    approximations.push(ignoreRo
      ? `Textbook approximation: ${component.refdes} output resistance r_o is ignored; capacitances and dependent-source effects are omitted.`
      : `Small-signal approximation: ${component.refdes} is reduced to its output resistance r_o; capacitances and dependent-source effects are omitted.`);
  }

  // An ideal independent current source has zero small-signal conductance and
  // therefore contributes no edge.  This is useful for source-loaded stages,
  // but an all-current-source path is correctly reported as unresolved.
  for (const component of circuit.components.values()) {
    if (component.type !== 'current_source') continue;
    const a = circuit.netOfTerminal({ comp: component.refdes, term: 'a' });
    const b = circuit.netOfTerminal({ comp: component.refdes, term: 'b' });
    if (a && b && (a.id === target.id || b.id === target.id)) {
      dependencies.push(component.refdes);
      assumptions.push(`${component.refdes} is treated as an ideal independent current source, so it is an open circuit in the small-signal model.`);
      approximations.push(`Small-signal approximation: independent current source ${component.refdes} has infinite small-signal impedance.`);
    }
  }
  const relevantNodeIds = new Set(connectedEdges(edges, target.id).flatMap((edge) => [edge.a, edge.b]));
  const unsupportedPathDevice = deferredUnsupported.find((device) =>
    device.netIds.some((id) => id === target.id || referenceIds.has(id) || relevantNodeIds.has(nodeForNet({ id }))));
  if (unsupportedPathDevice) {
    const report = unsupported(target, reference,
      `${unsupportedPathDevice.refdes} (${unsupportedPathDevice.type}) touches the analyzed path and has no symbolic small-signal model yet`,
      [...dependencies, unsupportedPathDevice.refdes]);
    return unsupportedOutputReport(report);
  }
  if (!edges.length) {
    const report = unsupported(target, reference, 'no supported passive or small-signal MOS path connects the requested nets', dependencies);
    return unsupportedOutputReport(report, approximations.length
      ? approximations
      : ['No numerical values are evaluated; this is a symbolic topology result only.'], true);
  }
  const relevantEdges = connectedEdges(edges, target.id);
  const reduced = reduceNetwork(relevantEdges, target.id, referenceNode);
  if (!reduced.ok) {
    const unresolved = [...new Set(relevantEdges.flatMap((edge) => edge.sources || []))];
    const report = unsupported(target, reference, 'topology is outside the currently supported series/parallel symbolic reduction', unresolved);
    return unsupportedOutputReport(report, approximations.length ? approximations : report.approximations, true);
  }
  if (!approximations.length) approximations.push('Ideal passive approximation: each resistor is represented by a symbolic resistance; parasitic elements are omitted.');
  const expression = reduced.expression;
  const approximationSelected = analysisApproximationSelected(circuit, options);
  const equation = `${resultLabel} ${approximationSelected ? '\\approx' : '='} ${expressionText(expression)}`;
  let exactEquation = equation;
  if (approximationSelected) {
    const exact = analyzeOutputImpedance(circuit, targetName, exactAnalysisOptions(options));
    if (exact.ok && exact.equation) exactEquation = exact.equation;
  }
  return {
    ok: true,
    query: 'output-impedance',
    target: { netId: target.id, name: netLabel(target) },
    reference: {
      netId: reference.id,
      name: referenceResult.global || acGroundResult.nets.length || zeroedInput ? 'AC_GROUND' : netLabel(reference),
      inferred: !!referenceResult.inferred || !!zeroedInput,
      ...(referenceResult.global || acGroundResult.nets.length || zeroedInput ? { netIds: [...referenceIds].sort() } : {}),
      ...(acGroundResult.values.length ? { acGrounds: acGroundResult.values } : {}),
    },
    ...(zeroedInput ? { input: { netId: zeroedInput.id, name: netLabel(zeroedInput), zeroed: true, inferred: inputWasInferred } } : {}),
    equation,
    exactEquation,
    expression,
    dependencies: [...expressionDependencies(expression)].sort(),
    assumptions,
    approximations,
    smallSignalModel: systematicModel,
    smallSignalNetlist: systematic.netlist,
    nodeEquations: systematic.equations || [],
    equationCount: systematic.equationCount || (systematic.equations || []).length,
    nodeUnknowns: systematic.unknowns || [],
    unknownCount: systematic.unknownCount || (systematic.unknowns || []).length,
    systematicEquation: systematic.ok ? equation : null,
    systematicRawEquation: systematic.ok ? systematic.equation : null,
    systematicExactEquation: systematic.ok ? (systematic.exactEquation || systematic.equation) : null,
    systematicError: systematic.ok ? null : systematic.error,
  };
}

export { expressionText };
