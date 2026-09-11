import { isReferenceMarker, referenceMarkerInfo, referenceMarkerName } from '../model.js';

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

function expressionText(expr, parentKind = null) {
  if (!expr) return '';
  if (expr.kind === 'symbol') return expr.name;
  const join = expr.kind === 'parallel' ? ' \\|\\| ' : ' + ';
  const body = expr.terms.map((term) => expressionText(term, expr.kind)).join(join);
  // Keep parallel groups visually textbook-like: the renderer turns the
  // escaped `\\|\\|` operator into two scalable vertical bars, while the
  // delimiters grow with fractions/scripts inside the group.
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

function findReferenceNet(circuit, requested) {
  const globalNets = new Map();
  for (const component of circuit.components.values()) {
    if (!isReferenceMarker(component) || referenceMarkerName(component)) continue;
    const info = referenceMarkerInfo(component.type);
    const net = circuit.netOfTerminal({ comp: component.refdes, term: info.terminal });
    if (net) globalNets.set(net.id, net);
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
  if (value.kind === 'number') return value.value === 0 ? { kind: 'inv', value } : sxNumber(1 / value.value);
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
    const index = remaining.findIndex((term) => JSON.stringify(term) === JSON.stringify(b));
    if (index >= 0) {
      remaining.splice(index, 1);
      return sxMul(...remaining);
    }
  }
  return sxMul(a, sxInv(b));
}

function sxKey(value) {
  return JSON.stringify(value);
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
    if (inner?.kind === 'number' && inner.value !== 0) return sxNumber(1 / inner.value);
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
      else kept.push(term);
    }
    if (numeric === 0) return sxNumber(0);
    // Move a leading sign into an additive factor so identities such as
    // `-(1/r_o + g_m) r_o = 1 + g_m r_o` can be recognized below.
    if (numeric === -1) {
      const addIndex = kept.findIndex((term) => term.kind === 'add');
      if (addIndex >= 0) {
        kept[addIndex] = simplifySx(sxNeg(kept[addIndex]));
        numeric = 1;
      }
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
      const opposite = term.kind === 'neg' ? term.value : { kind: 'neg', value: term };
      const match = kept.findIndex((candidate, candidateIndex) => candidateIndex !== index && sxKey(candidate) === sxKey(opposite));
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

/** Cancel a common symbolic factor through products and sums.  Gaussian
 * elimination often produces `(g_m V_in + g_ds V_in)/V_in`; retaining that
 * literal ratio makes a valid common-gate gain look wrong to a reader.  Only
 * cancel when every additive branch contains the factor, so this remains a
 * conservative algebraic simplification rather than a numerical assumption.
 */
function sxCancelFactor(value, factor) {
  if (!value || !factor) return null;
  const same = JSON.stringify(value) === JSON.stringify(factor);
  if (same) return sxNumber(1);
  if (value.kind === 'neg') {
    const reduced = sxCancelFactor(value.value, factor);
    return reduced ? sxNeg(reduced) : null;
  }
  if (value.kind === 'mul') {
    const direct = value.terms.findIndex((term) => JSON.stringify(term) === JSON.stringify(factor));
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
function sxIsZero(value) { return !value || (value.kind === 'number' && value.value === 0); }
function sxDependencies(value, out = new Set()) {
  if (!value) return out;
  if (value.source) out.add(value.source);
  for (const child of value.terms || []) sxDependencies(child, out);
  if (value.value && typeof value.value === 'object') sxDependencies(value.value, out);
  return out;
}
function sxText(value, parent = null) {
  if (!value) return '0';
  if (value.kind === 'number') return String(value.value);
  if (value.kind === 'symbol') return value.name;
  if (value.kind === 'neg') {
    const body = sxText(value.value, 'neg');
    return `-${value.value.kind === 'add' ? `\\left(${body}\\right)` : body}`;
  }
  if (value.kind === 'inv') {
    const parallelTerms = reciprocalParallelTerms(value.value);
    if (parallelTerms) {
      const body = parallelTerms.map((term) => sxText(term, 'parallel')).join(' \\|\\| ');
      return parent && parent !== 'parallel' ? `\\left(${body}\\right)` : body;
    }
    return `\\frac{1}{${sxText(value.value)}}`;
  }
  if (value.kind === 'mul') {
    // Keep polarity readable in textbook form: `-g_{m1}`, never the noisy
    // intermediate `-1 \\, g_{m1}` that can appear after elimination.
    const negativeOne = value.terms.findIndex((term) => term.kind === 'number' && term.value === -1);
    if (negativeOne >= 0) {
      const rest = value.terms.filter((_, index) => index !== negativeOne);
      if (rest.length) return `-${sxText(sxMul(...rest), parent)}`;
    }
    const body = value.terms.map((term) => {
      const text = sxText(term, 'mul');
      return term.kind === 'add' || term.kind === 'neg' ? `\\left(${text}\\right)` : text;
    }).join(' \\, ');
    return parent === 'add' ? `\\left(${body}\\right)` : body;
  }
  if (value.kind === 'add') return value.terms.map((term) => {
    if (term.kind === 'neg') return `- ${sxText(term.value, 'add')}`;
    return sxText(term, 'add');
  }).join(' + ');
  return '';
}

function nodeLabel(circuit, nodeId, targetId, referenceIds, inputId = null) {
  if (nodeId === '@AC_GROUND' || referenceIds.has(nodeId)) return '0';
  if (nodeId === targetId) return 'V_{out}';
  if (inputId && nodeId === inputId) return 'V_{in}';
  return netLabel(circuit.nets.get(nodeId)) || nodeId;
}

function systemRefdes(refdes, prefix, fallback = prefix) {
  return indexedName(refdes, prefix) || `${fallback}_{${String(refdes)}}`;
}

function systemMosName(refdes, kind) {
  const index = String(refdes).match(/[0-9]+$/)?.[0] || String(refdes);
  if (kind === 'ro') return `r_{o${index}}`;
  if (kind === 'gmb') return `g_{mb${index}}`;
  return `g_{m${index}}`;
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
  return {
    ignoreChannelLengthModulation: !!options.ignoreChannelLengthModulation || has('ignore-channel-length-modulation', 'ignore-clm', 'ro-infinity', 'neglect-ro'),
    ignoreBodyEffect: !!options.ignoreBodyEffect || has('ignore-body-effect', 'ignore-gmb', 'gmb-zero'),
    gmroLarge: !!options.gmroLarge || !!options.assumeGmRoLarge || has('gmro-large', 'gmro>>1', 'gm-ro-large', 'large-gmro'),
  };
}

function textbookApproximationNotes(options = {}) {
  const flags = normalizeAnalysisApproximations(options);
  const assumptions = [];
  const approximations = [];
  if (flags.ignoreChannelLengthModulation) {
    assumptions.push('Channel-length modulation is ignored, so each MOS output resistance r_o is treated as infinite.');
    approximations.push('Textbook approximation: r_o \u2192 \u221e (MOS output conductance g_o = 0).');
  }
  if (flags.ignoreBodyEffect) {
    assumptions.push('Body effect is ignored, so g_{mb} is set to zero for the small-signal model.');
    approximations.push('Textbook approximation: g_{mb} = 0.');
  }
  if (flags.gmroLarge) {
    assumptions.push('The strong intrinsic-gain condition g_m r_o \u226b 1 is assumed wherever a lower-order term is discarded.');
    approximations.push('Textbook approximation: g_m r_o \\gg 1.');
  }
  return { flags, assumptions, approximations };
}

function hasTextbookApproximation(options = {}) {
  const flags = normalizeAnalysisApproximations(options);
  return flags.ignoreChannelLengthModulation || flags.ignoreBodyEffect || flags.gmroLarge;
}

function exactAnalysisOptions(options = {}) {
  return {
    ...options,
    approximations: [],
    ignoreChannelLengthModulation: false,
    ignoreBodyEffect: false,
    gmroLarge: false,
    assumeGmRoLarge: false,
  };
}

function isRoSymbol(value) {
  return value?.kind === 'symbol' && /^r_\{o/.test(value.name || '');
}

function isGmSymbol(value) {
  return value?.kind === 'symbol' && /^g_\{m/.test(value.name || '');
}

function gmRoProduct(value) {
  if (value?.kind !== 'mul') return null;
  const ros = value.terms.filter((term) => isRoSymbol(term));
  const gm = value.terms.find((term) => isGmSymbol(term));
  return ros.length && gm ? { ros, gm } : null;
}

/** Keep only the dominant term in familiar `1 + g_m r_o` / cascode sums. */
function applyGmRoApproximation(value) {
  if (!value) return value;
  if (value.kind === 'neg') return sxNeg(applyGmRoApproximation(value.value));
  if (value.kind === 'inv') return { kind: 'inv', value: applyGmRoApproximation(value.value) };
  if (value.kind === 'mul') return simplifySx({ kind: 'mul', terms: value.terms.map((term) => applyGmRoApproximation(term)) });
  if (value.kind !== 'add') return value;
  const terms = value.terms.map((term) => applyGmRoApproximation(term));
  const dominant = terms.filter((term) => gmRoProduct(term));
  if (!dominant.length) return simplifySx({ kind: 'add', terms });
  const dominantRos = new Set(dominant.flatMap((term) => {
    const pair = gmRoProduct(term);
    return pair ? pair.ros.map((ro) => ro.name) : [];
  }));
  const kept = terms.filter((term) => {
    if (term.kind === 'number' && term.value === 1) return false;
    if (isRoSymbol(term) && dominantRos.has(term.name)) return false;
    return true;
  });
  return simplifySx(kept.length ? { kind: 'add', terms: kept } : sxNumber(0));
}

function applyAnalysisApproximations(value, options = {}) {
  const simplified = simplifySx(value);
  return normalizeAnalysisApproximations(options).gmroLarge
    ? simplifySx(applyGmRoApproximation(simplified))
    : simplified;
}

function equationOperator(exact, simplified, options = {}) {
  return !hasTextbookApproximation(options) && sxKey(exact) === sxKey(simplified) ? '=' : '\\approx';
}

function systemTerminalNet(circuit, component, term) {
  return circuit.netOfTerminal({ comp: component.refdes, term });
}

function buildSystematicModel(circuit, { target, referenceIds, options = {} }) {
  const overrides = circuitModelOverrides(circuit, options.models);
  const textbook = textbookApproximationNotes(options);
  const elements = [];
  const nodes = new Set(['@AC_GROUND', target.id]);
  const assumptions = [...textbook.assumptions];
  const approximations = [...textbook.approximations];
  const unsupportedDevices = [];
  const openCircuits = [];
  const addNode = (net) => {
    if (net) nodes.add(referenceIds.has(net.id) ? '@AC_GROUND' : net.id);
    return net ? (referenceIds.has(net.id) ? '@AC_GROUND' : net.id) : null;
  };
  const addBranch = (kind, component, a, b, value, extra = {}) => {
    const na = addNode(a);
    const nb = addNode(b);
    if (!na || !nb || na === nb) return;
    elements.push({ kind, component: component.refdes, a: na, b: nb, value, ...extra });
  };

  for (const component of circuit.components.values()) {
    const type = component.type;
    if (type === 'resistor' || type === 'variable_resistor') {
      addBranch('resistor', component, systemTerminalNet(circuit, component, 'a'), systemTerminalNet(circuit, component, 'b'), sxSymbol(systemRefdes(component.refdes, 'R'), component.refdes));
      continue;
    }
    if (type === 'capacitor' || type === 'variable_capacitor') {
      const capacitance = sxMul(sxSymbol('s'), sxSymbol(systemCapName(component.refdes), component.refdes));
      addBranch('capacitor', component, systemTerminalNet(circuit, component, 'a'), systemTerminalNet(circuit, component, 'b'), sxInv(capacitance));
      assumptions.push(`${component.refdes} is represented by the small-signal impedance \\frac{1}{s ${systemCapName(component.refdes)}}.`);
      approximations.push(`Small-signal approximation: ${component.refdes} is treated as an ideal capacitor in the frequency domain.`);
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
      const b = addNode(bulk) || '@AC_GROUND';
      const polarity = type.startsWith('pmos') ? -1 : 1;
      if (!textbook.flags.ignoreChannelLengthModulation) {
        addBranch('output-resistance', component, drain, source, sxSymbol(systemMosName(component.refdes, 'ro'), component.refdes));
      }
      elements.push({ kind: 'vccs', component: component.refdes, a: d, b: s, controlPlus: g, controlMinus: s, value: sxSymbol(systemMosName(component.refdes, 'gm'), component.refdes), polarity });
      if (!textbook.flags.ignoreBodyEffect && bulk && b !== s) {
        elements.push({ kind: 'vccs', component: component.refdes, a: d, b: s, controlPlus: b, controlMinus: s, value: sxSymbol(systemMosName(component.refdes, 'gmb'), component.refdes), polarity });
      }
      if (!hasBulk || !bulk) {
        assumptions.push(`${component.refdes} bulk is unused and is assumed tied to ${polarity > 0 ? 'GND' : 'VDD'}; in the small-signal model this is an AC-ground assumption.`);
      }
      const deviceTerms = [!textbook.flags.ignoreChannelLengthModulation ? 'r_o' : null, 'g_m', !textbook.flags.ignoreBodyEffect && bulk && b !== s ? 'g_{mb}' : null].filter(Boolean);
      assumptions.push(`${component.refdes} is represented by ${deviceTerms.join(', ')} in the small-signal model.`);
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
  return { elements, nodes: [...nodes].sort(), assumptions, approximations, unsupportedDevices, openCircuits };
}

/** Render the stamped symbolic primitives in a compact SPICE-like form.  The
 * netlist is descriptive only: it is not fed to a numerical simulator. */
export function formatSmallSignalNetlist(circuit, model, { referenceIds = new Set() } = {}) {
  const references = referenceIds instanceof Set ? referenceIds : new Set(referenceIds || []);
  const nodeName = (node) => node === '@AC_GROUND' || references.has(node)
    ? '0'
    : netLabel(circuit.nets.get(node)) || node;
  const lines = ['* Small-signal equivalent (symbolic; no numerical values)'];
  for (const open of model?.openCircuits || []) lines.push(`* OPEN ${open.component}: ${open.reason}`);
  for (const element of model?.elements || []) {
    const a = nodeName(element.a);
    const b = nodeName(element.b);
    if (element.kind === 'vccs') {
      const controlPlus = nodeName(element.controlPlus);
      const controlMinus = nodeName(element.controlMinus);
      const value = sxText(element.polarity === -1 ? sxNeg(element.value) : element.value);
      lines.push(`G_${element.component} ${a} ${b} ${controlPlus} ${controlMinus} ${value}`);
    } else if (element.kind === 'resistor' || element.kind === 'output-resistance' || element.kind === 'triode-resistance') {
      lines.push(`R_${element.component} ${a} ${b} ${sxText(element.value)}`);
    } else if (element.kind === 'capacitor') {
      lines.push(`C_${element.component} ${a} ${b} ${sxText(element.value)}`);
    }
  }
  for (const device of model?.unsupportedDevices || []) {
    lines.push(`* UNSUPPORTED ${device.refdes}: ${device.reason || 'no small-signal model'}`);
  }
  if (lines.length === 1) lines.push('* (no small-signal primitives were stamped)');
  return lines.join('\n');
}

function systemRows(model, { testTarget = null, inputNode = null }) {
  const unknowns = [...model.nodes].filter((node) => node !== '@AC_GROUND' && node !== inputNode).sort();
  const rows = new Map(unknowns.map((node) => [node, { node, coefficients: new Map(), rhs: sxNumber(0) }]));
  const addCoefficient = (rowNode, columnNode, value) => {
    if (!rows.has(rowNode) || columnNode === '@AC_GROUND') return;
    if (columnNode === inputNode) {
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
    if (element.kind === 'resistor' || element.kind === 'output-resistance' || element.kind === 'triode-resistance' || element.kind === 'capacitor') stampConductance(element.a, element.b, sxInv(element.value));
    else if (element.kind === 'vccs') stampVccs(element);
  }
  if (testTarget && rows.has(testTarget)) addRhs(testTarget, sxSymbol('I_{test}'));
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
  const starts = new Set([context.target.id]);
  if (context.input) starts.add(context.input.id);
  for (const id of [...starts]) if (context.referenceIds.has(id)) { starts.delete(id); starts.add('@AC_GROUND'); }
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
    (device.netIds || []).some((id) => reachable.has(context.referenceIds.has(id) ? '@AC_GROUND' : id)));
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
  return { ok: true, values: new Map(matrix.map((row) => [row.node, row.rhs])) };
}

function systematicImpedanceResult(circuit, model, context, label = 'Z_{out}', options = {}) {
  const netlist = formatSmallSignalNetlist(circuit, model, { referenceIds: context.referenceIds });
  const unsupportedDevice = modelPathDevice(model, context);
  if (unsupportedDevice) return { ok: false, error: `${unsupportedDevice.refdes} (${unsupportedDevice.type}) touches the analyzed path and has no symbolic small-signal model yet`, equations: [], unknowns: [], model, netlist };
  const system = systemRows(model, { testTarget: context.target.id === '@AC_GROUND' ? null : context.target.id });
  // For Zin the selected target is the driven input node, so label it V_in in
  // the exposed KCL equations rather than misreporting it as V_out.
  const equationTargetId = label === 'Z_{in}' ? null : context.target.id;
  const equationInputId = label === 'Z_{in}' ? context.target.id : context.inputId;
  const equations = ['V_{AC} = 0', ...[...system.rows.values()].map((row) => renderSystemEquation(row, circuit, equationTargetId, context.referenceIds, equationInputId))];
  if (!system.unknowns.length) return { ok: false, error: 'node-equation system has no unknown node voltage', equations, equationCount: equations.length, unknowns: [], unknownCount: 0, model, netlist };
  const testRow = system.rows.get(context.target.id);
  if (testRow && [...testRow.coefficients.values()].every((coefficient) => sxIsZero(coefficient))) {
    const expression = sxSymbol('\\infty');
    return {
      ok: true,
      equation: `${label} = \\infty`,
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
  const outputNode = context.target.id;
  const outputVoltage = solved.values.get(outputNode);
  if (!outputVoltage) return { ok: false, error: 'target node was not solvable in the node-equation system', equations, equationCount: equations.length, unknowns: system.unknowns, unknownCount: system.unknowns.length, model, netlist };
  const exactImpedance = simplifySx(sxDiv(outputVoltage, sxSymbol('I_{test}')));
  const impedance = applyAnalysisApproximations(exactImpedance, options);
  return {
    ok: true,
    equation: `${label} ${equationOperator(exactImpedance, impedance, options)} ${sxText(impedance)}`,
    exactEquation: `${label} = ${sxText(exactImpedance)}`,
    expression: impedance,
    equations,
    equationCount: equations.length,
    unknowns: system.unknowns.map((node) => nodeLabel(circuit, node, equationTargetId, context.referenceIds, equationInputId)),
    unknownCount: system.unknowns.length,
    solution: Object.fromEntries([...solved.values].map(([node, value]) => [nodeLabel(circuit, node, equationTargetId, context.referenceIds, equationInputId), sxText(value)])),
    model,
    netlist,
  };
}

function systematicOutputResult(circuit, model, context, options = {}) {
  return systematicImpedanceResult(circuit, model, context, 'Z_{out}', options);
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
  const textbook = textbookApproximationNotes(options);
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
    const bulk = component.def.terminals.some((term) => term.name === 'b')
      ? circuit.netOfTerminal({ comp: component.refdes, term: 'b' })
      : null;
    const gmb = !textbook.flags.ignoreBodyEffect && bulk && bulk.id !== source.id && context.referenceIds.has(bulk.id)
      ? sxSymbol(systemMosName(component.refdes, 'gmb'), component.refdes)
      : null;
    const effectiveGm = gmb ? sxAdd(gm, gmb) : gm;
    const expression = output.expression;
    const terms = expression?.kind === 'parallel' ? expression.terms : [expression];
    if (textbook.flags.ignoreChannelLengthModulation) {
      const compact = sxInv(effectiveGm);
      return {
        expression: compact,
        exactExpression: compact,
        assumptions: [
          `${component.refdes} is recognized as a common-gate device: its source is the selected input node and its gate is AC-grounded.`,
          'With channel-length modulation ignored, the common-gate input reduces to the inverse transconductance.',
        ],
      };
    }
    const roIndex = terms.findIndex((term) => term?.kind === 'symbol' && term.name === ro.name);
    if (roIndex < 0 || terms.length < 2) continue;
    const loadTerms = terms.filter((_, index) => index !== roIndex);
    const load = loadTerms.length === 1 ? loadTerms[0] : parallel(...loadTerms);
    const exactCompact = sxDiv(sxAdd(ro, load), sxAdd(sxNumber(1), sxMul(effectiveGm, ro)));
    const compact = textbook.flags.gmroLarge
      ? sxDiv(sxAdd(ro, load), sxMul(effectiveGm, ro))
      : exactCompact;
    return {
      expression: applyAnalysisApproximations(compact, options),
      exactExpression: applyAnalysisApproximations(exactCompact, { ...options, gmroLarge: false, assumeGmRoLarge: false, approximations: [] }),
      assumptions: [
        `${component.refdes} is recognized as a common-gate device: its source is the selected input node and its gate is AC-grounded.`,
        `The common-gate input impedance is reduced with the finite drain load and r_o retained symbolically.`,
      ],
    };
  }
  return null;
}

function systematicTransferResult(circuit, model, context, options = {}) {
  const netlist = formatSmallSignalNetlist(circuit, model, { referenceIds: context.referenceIds });
  const unsupportedDevice = modelPathDevice(model, context);
  if (unsupportedDevice) return { ok: false, error: `${unsupportedDevice.refdes} (${unsupportedDevice.type}) touches the analyzed path and has no symbolic small-signal model yet`, equations: [], unknowns: [], model, netlist };
  const system = systemRows(model, { inputNode: context.input.id });
  const equations = ['V_{AC} = 0', 'V_{in} = V_{in}', ...[...system.rows.values()].map((row) => renderSystemEquation(row, circuit, context.target.id, context.referenceIds, context.input.id))];
  if (context.target.id === context.input.id) {
    return {
      ok: true,
      equation: 'A_v = 1',
      expression: sxNumber(1),
      equations: [...equations, 'V_{out} = V_{in}'],
      unknowns: system.unknowns.map((node) => nodeLabel(circuit, node, context.target.id, context.referenceIds, context.input.id)),
      model,
      netlist,
    };
  }
  if (!system.unknowns.length) return { ok: false, error: 'node-equation system has no internal unknown node voltage', equations, equationCount: equations.length, unknowns: [], unknownCount: 0, model, netlist };
  const solved = solveSystem(system.rows, system.unknowns);
  if (!solved.ok) return { ok: false, error: solved.error, equations, equationCount: equations.length, unknowns: system.unknowns, unknownCount: system.unknowns.length, model, netlist };
  const outputVoltage = solved.values.get(context.target.id);
  if (!outputVoltage) return { ok: false, error: 'output node was not solvable in the node-equation system', equations, equationCount: equations.length, unknowns: system.unknowns, unknownCount: system.unknowns.length, model, netlist };
  const exactGain = simplifySx(sxDiv(outputVoltage, sxSymbol('V_{in}')));
  const gain = applyAnalysisApproximations(exactGain, options);
  return {
    ok: true,
    equation: `A_v ${equationOperator(exactGain, gain, options)} ${sxText(gain)}`,
    exactEquation: `A_v = ${sxText(exactGain)}`,
    expression: gain,
    equations,
    equationCount: equations.length,
    unknowns: system.unknowns.map((node) => nodeLabel(circuit, node, context.target.id, context.referenceIds, context.input.id)),
    unknownCount: system.unknowns.length,
    solution: Object.fromEntries([...solved.values].map(([node, value]) => [nodeLabel(circuit, node, context.target.id, context.referenceIds, context.input.id), sxText(value)])),
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
  const model = buildSystematicModel(circuit, { ...context, options });
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
  const model = buildSystematicModel(circuit, { ...context, options });
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
    };
  }
  const exactReport = hasTextbookApproximation(options)
    ? analyzeTransferFunction(circuit, outputName, exactAnalysisOptions(options))
    : null;
  return {
    ok: true,
    query: 'voltage-transfer',
    target: { netId: context.target.id, name: netLabel(context.target) },
    input: { netId: inputResult.net.id, name: netLabel(inputResult.net) },
    reference: { netId: context.reference.id, name: context.referenceResult.global || context.acGroundResult.nets.length ? 'AC_GROUND' : netLabel(context.reference), netIds: [...context.referenceIds].sort() },
    equation: solved.equation,
    exactEquation: exactReport?.ok ? exactReport.equation : (solved.exactEquation || solved.equation),
    expression: solved.expression,
    equations: solved.equations,
    equationCount: solved.equationCount,
    unknowns: solved.unknowns,
    unknownCount: solved.unknownCount,
    solution: solved.solution,
    smallSignalModel: model,
    smallSignalNetlist: solved.netlist,
    assumptions: [...contextAssumptions(options), ...model.assumptions],
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
  const model = buildSystematicModel(circuit, { ...context, options });
  const systematic = systematicImpedanceResult(circuit, model, { ...context }, 'Z_{in}', options);
  const commonGate = commonGateInputReduction(circuit, context, model, options);
  if (commonGate?.expression && systematic.ok) {
    systematic.expression = commonGate.expression;
    systematic.equation = `Z_{in} ${equationOperator(commonGate.exactExpression || commonGate.expression, commonGate.expression, options)} ${sxText(commonGate.expression)}`;
    systematic.exactEquation = `Z_{in} = ${sxText(commonGate.exactExpression || commonGate.expression)}`;
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
  const exactReport = hasTextbookApproximation(options)
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

  const textbook = textbookApproximationNotes(options);
  const edges = [];
  const dependencies = [];
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
  const overrides = circuitModelOverrides(circuit, options.models);
  const deferredUnsupported = [];
  const systematicModel = buildSystematicModel(circuit, { target, referenceIds, options });
  const systematic = systematicOutputResult(circuit, systematicModel, { target, referenceIds }, options);
  const withSystematic = (report) => {
    report.smallSignalModel = systematicModel;
    report.smallSignalNetlist = systematic.netlist;
    report.nodeEquations = systematic.equations || [];
    report.equationCount = systematic.equationCount || report.nodeEquations.length;
    report.nodeUnknowns = systematic.unknowns || [];
    report.unknownCount = systematic.unknownCount || report.nodeUnknowns.length;
    report.systematicEquation = null;
    report.systematicRawEquation = systematic.ok ? systematic.equation : null;
    report.systematicExactEquation = systematic.ok ? (systematic.exactEquation || systematic.equation) : null;
    report.systematicError = systematic.ok ? null : systematic.error;
    if (zeroedInput) {
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

  for (const component of circuit.components.values()) {
    const type = component.type;
    const isResistor = type === 'resistor' || type === 'variable_resistor';
    if (isResistor) {
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
      return genericOutputReport(unsupported(target, reference,
        `${component.refdes} has source degeneration; gm/source-feedback effects are not yet symbolically reduced`,
        dependencies));
    }
    if (!textbook.flags.ignoreChannelLengthModulation) {
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
    assumptions.push(textbook.flags.ignoreChannelLengthModulation
      ? `${component.refdes} is modeled with channel-length modulation ignored; g_m and g_{mb} effects are omitted because its controlling terminals are AC-grounded.`
      : `${component.refdes} is modeled by r_{o${component.refdes.replace(/^[A-Za-z]+/, '')}} with g_m and g_{mb} effects omitted because its controlling terminals are AC-grounded.`);
    approximations.push(textbook.flags.ignoreChannelLengthModulation
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
    report.assumptions = assumptions;
    report.approximations = approximations;
    report.smallSignalModel = systematicModel;
    report.smallSignalNetlist = systematic.netlist;
    report.nodeEquations = systematic.equations || [];
    report.equationCount = systematic.equationCount || report.nodeEquations.length;
    report.nodeUnknowns = systematic.unknowns || [];
    report.unknownCount = systematic.unknownCount || report.nodeUnknowns.length;
    report.systematicEquation = null;
    report.systematicRawEquation = systematic.ok ? systematic.equation : null;
    report.systematicExactEquation = systematic.ok ? (systematic.exactEquation || systematic.equation) : null;
    report.systematicError = systematic.ok ? null : systematic.error;
    return report;
  }
  if (!edges.length) {
    const report = unsupported(target, reference, 'no supported passive or small-signal MOS path connects the requested nets', dependencies);
    report.assumptions = assumptions;
    report.approximations = approximations.length
      ? approximations
      : ['No numerical values are evaluated; this is a symbolic topology result only.'];
    report.smallSignalModel = systematicModel;
    report.smallSignalNetlist = systematic.netlist;
    report.nodeEquations = systematic.equations || [];
    report.equationCount = systematic.equationCount || report.nodeEquations.length;
    report.nodeUnknowns = systematic.unknowns || [];
    report.unknownCount = systematic.unknownCount || report.nodeUnknowns.length;
    report.systematicEquation = null;
    report.systematicRawEquation = systematic.ok ? systematic.equation : null;
    report.systematicExactEquation = systematic.ok ? (systematic.exactEquation || systematic.equation) : null;
    report.systematicError = systematic.ok ? null : systematic.error;
    return genericOutputReport(report);
  }
  const relevantEdges = connectedEdges(edges, target.id);
  const reduced = reduceNetwork(relevantEdges, target.id, referenceNode);
  if (!reduced.ok) {
    const unresolved = [...new Set(relevantEdges.flatMap((edge) => edge.sources || []))];
    const report = unsupported(target, reference, 'topology is outside the currently supported series/parallel symbolic reduction', unresolved);
    report.assumptions = assumptions;
    report.approximations = approximations.length ? approximations : report.approximations;
    report.smallSignalModel = systematicModel;
    report.smallSignalNetlist = systematic.netlist;
    report.nodeEquations = systematic.equations || [];
    report.equationCount = systematic.equationCount || report.nodeEquations.length;
    report.nodeUnknowns = systematic.unknowns || [];
    report.unknownCount = systematic.unknownCount || report.nodeUnknowns.length;
    report.systematicEquation = null;
    report.systematicRawEquation = systematic.ok ? systematic.equation : null;
    report.systematicExactEquation = systematic.ok ? (systematic.exactEquation || systematic.equation) : null;
    report.systematicError = systematic.ok ? null : systematic.error;
    return genericOutputReport(report);
  }
  if (!approximations.length) approximations.push('Ideal passive approximation: each resistor is represented by a symbolic resistance; parasitic elements are omitted.');
  const expression = reduced.expression;
  const approximationSelected = textbook.flags.ignoreChannelLengthModulation || textbook.flags.ignoreBodyEffect || textbook.flags.gmroLarge;
  const equation = `Z_{out} ${approximationSelected ? '\\approx' : '='} ${expressionText(expression)}`;
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
