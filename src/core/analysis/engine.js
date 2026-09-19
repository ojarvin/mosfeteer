import { MOS_TYPES, firstDefined } from './shared.js';
import { applyApproximations } from './approximation.js';
import { cancelCommonPolynomialFactor } from './polynomial-gcd.js';
import { createRationalOps } from './algebra-ops.js';
import { symbolProvenance } from './provenance.js';
import { buildExactAnalysisPipeline } from './pipeline.js';
import { presentDiagnostics } from './diagnostics.js';
import { describeSmallSignalNetlist } from './netlist.js';
import { analyzeResponse } from './response.js';
import { approximateTopology, buildTopologyIdentities } from './topology.js';
import { compactRational } from './compact.js';
import {
  formatExpression,
  infinity,
  integer,
  rational,
  rationalFunction,
  substituteRational,
} from './rational.js';
import {
  equivalenceTable,
  provenParallel,
  provenProduct,
  provenQuotient,
  provenSum,
  renderQuantityEquation,
  renderRootEquation,
} from './present.js';

const DEFAULTS = Object.freeze({
  ignoreBodyEffect: true,
  gmroLarge: true,
  ignoreChannelLengthModulation: false,
  dominantPoleApproximation: false,
});

function lookup(values, key) {
  if (!values || key == null) return undefined;
  if (typeof values.get === 'function') return values.get(key);
  return Object.hasOwn(values, key) ? values[key] : undefined;
}

function decimalValue(value) {
  if (typeof value === 'bigint') return integer(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return integer(value);
  const text = String(value).trim();
  if (/^[+-]?\d+$/.test(text)) return integer(BigInt(text));
  const match = text.match(/^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) return null;
  const sign = match[1] === '-' ? -1n : 1n;
  const whole = match[2];
  const fraction = match[3] || '';
  const exponent = Number(match[4] || 0);
  let numerator = BigInt(`${whole}${fraction}`) * sign;
  const scale = fraction.length - exponent;
  if (scale <= 0) return integer(numerator * 10n ** BigInt(-scale));
  return rational(numerator, 10n ** BigInt(scale));
}

function mapObject(values) {
  if (!values) return {};
  if (values instanceof Map) return Object.fromEntries(values);
  return { ...values };
}

function modelRegions(options) {
  const explicit = firstDefined(
    options.deviceRegions,
    options.modelOverrides,
    options.models,
  );
  if (explicit !== undefined) return explicit;
  const source = firstDefined(options.devices, options.deviceOverrides);
  if (!source || typeof source === 'string') return source;
  const entries = (source instanceof Map ? [...source.entries()] : Object.entries(source))
    .filter(([, value]) => typeof value === 'string'
      || (value && typeof value === 'object' && (value.model !== undefined || value.region !== undefined)));
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function symbolicValue(value, primitive, options, ops) {
  if (value?.kind) return value;
  const supplied = lookup(options.values || options.parameters || options.params, primitive?.parameter || value);
  const resolved = supplied === undefined ? value : supplied;
  if (resolved === undefined || resolved === null || resolved === '') return ops.zero;
  if (typeof resolved === 'string') {
    const exact = decimalValue(resolved);
    return exact || ops.symbol(resolved);
  }
  const exact = decimalValue(resolved);
  if (exact) return exact;
  return ops.symbol(String(resolved));
}

function normaliseOptions(options, circuit, symbolic, ops) {
  const assumptions = options.assumptions && typeof options.assumptions === 'object'
    ? options.assumptions
    : {};
  const body = firstDefined(
    options.ignoreBodyEffect,
    options.neglectBodyEffect,
    options.gmb0,
    assumptions.ignoreBodyEffect,
    assumptions.neglectBodyEffect,
    assumptions.gmb0,
    DEFAULTS.ignoreBodyEffect,
  );
  const intrinsic = firstDefined(
    options.gmroLarge,
    options.highIntrinsicGain,
    assumptions.gmroLarge,
    assumptions.highIntrinsicGain,
    DEFAULTS.gmroLarge,
  );
  const output = firstDefined(
    options.ignoreChannelLengthModulation,
    options.neglectChannelLengthModulation,
    options.roInfinity,
    assumptions.ignoreChannelLengthModulation,
    assumptions.neglectChannelLengthModulation,
    assumptions.roInfinity,
    DEFAULTS.ignoreChannelLengthModulation,
  );
  const dominantPole = firstDefined(
    options.dominantPoleApproximation,
    options.dominantPole,
    assumptions.dominantPoleApproximation,
    assumptions.dominantPole,
    DEFAULTS.dominantPoleApproximation,
  );

  const devices = mapObject(options.devices || options.deviceOptions || options.deviceOverrides);
  for (const component of circuit.components.values()) {
    if (!MOS_TYPES.has(component.type)) continue;
    const suffix = String(component.refdes).replace(/^M(?=[A-Za-z0-9_])/, '').replace(/[^A-Za-z0-9]/g, '_');
    // Per-device overrides may use the canonical request names
    // (neglectBodyEffect, highIntrinsicGain, neglectChannelLengthModulation);
    // resolve them here so the engine's own flags never shadow them.
    const override = devices[component.refdes] || {};
    devices[component.refdes] = {
      id: component.refdes,
      gm: `gm${suffix}`,
      gmb: `gmb${suffix}`,
      ro: `ro${suffix}`,
      highIntrinsicGain: Boolean(firstDefined(override.highIntrinsicGain, override.gmroLarge, intrinsic)),
      gmb0: Boolean(firstDefined(override.gmb0, override.ignoreBodyEffect, override.neglectBodyEffect, body)),
      roInfinity: Boolean(firstDefined(override.roInfinity, override.ignoreChannelLengthModulation, override.neglectChannelLengthModulation, output)),
      // A large gm*ro product does not license gm*RS >> 1 or an active
      // branch's impedance >> RD. Preserve those independent dependencies.
      intrinsicProduct: true,
      ...(devices[component.refdes] || {}),
    };
  }
  return {
    ...options,
    ...(!Object.hasOwn(options, 'ignoreBodyEffect') ? { ignoreBodyEffect: Boolean(body) } : {}),
    ...(!Object.hasOwn(options, 'gmroLarge') ? { gmroLarge: Boolean(intrinsic) } : {}),
    ...(!Object.hasOwn(options, 'ignoreChannelLengthModulation') ? { ignoreChannelLengthModulation: Boolean(output) } : {}),
    ...(!Object.hasOwn(options, 'dominantPoleApproximation') ? { dominantPoleApproximation: Boolean(dominantPole) } : {}),
    assumptions: { ...assumptions, gmb0: Boolean(body), gmroLarge: Boolean(intrinsic), dominantPole: Boolean(dominantPole) },
    devices,
    ...(symbolic ? { valueOf: (value, primitive) => symbolicValue(value, primitive, options, ops) } : {}),
  };
}

function makeEngineOps(options) {
  const base = options.ops || createRationalOps({
      variable: options.variable || 's',
      maxOperations: options.maxOperations,
    });
  const ops = {
    ...base,
    div: (left, right) => {
      try {
        return base.div(left, right);
      } catch (error) {
        if (base.isZero(right)) return infinity();
        throw error;
      }
    },
  };
  return { ops, symbolic: !options.ops };
}

function responseOptions(options) {
  return {
    variable: options.variable || 's',
    maxOperations: options.maxOperations,
    ...(options.budget ? { budget: options.budget } : {}),
  };
}

function renderRoot(root, kind, index, options) {
  if (!root.root?.kind) return `${kind}_{${index}}: roots of the reported polynomial`;
  return renderRootEquation(kind, index, root.root, options);
}

function combineParallel(values, ops) {
  return values.reduce((left, right) => (
    left === null ? right : ops.div(ops.mul(left, right), ops.add(left, right))
  ), null);
}

function dcLimitOf(value, variable) {
  try {
    const limit = substituteRational(value, new Map([[variable, integer(0)]]), { variable });
    return limit.kind === 'infinity' ? null : limit;
  } catch {
    return null;
  }
}

/**
 * Turn each `reduce.js` parallel-merge proof into `present.js` equivalences
 * for every form that might actually get displayed: the exact AC value (as
 * solved), the same branches reduced under whichever assumptions are
 * selected (e.g. `g_m r_o >> 1`) and recombined — the textbook default `A_v`/
 * `Z_in`/`Z_out` equation comes from one leading-term reduction of the
 * *whole* expression, which generally does not preserve this factored
 * structure, so without this the `\|` only ever showed up on the exact row
 * — and each of those at `s=0` for the DC-limit row, dropping any branch
 * that's an open circuit at DC (a capacitor) rather than trying to combine
 * an infinite impedance in parallel with the rest.
 */
function buildParallelEquivalenceProofs(networkReductionProofs, approximationOptions, ops) {
  const variable = ops.variable || 's';
  return (networkReductionProofs || []).flatMap(({ impedance, operands }) => {
    const proofs = [provenParallel(impedance, ...operands)];
    const dcOperands = operands.map((operand) => dcLimitOf(operand, variable)).filter(Boolean);
    if (dcOperands.length >= 2) {
      const dcCombined = combineParallel(dcOperands, ops);
      if (dcCombined) proofs.push(provenParallel(dcCombined, ...dcOperands));
    }
    try {
      const reducedOperands = operands.map((operand) => applyApproximations(operand, approximationOptions).selected);
      const combined = combineParallel(reducedOperands, ops);
      if (combined) proofs.push(provenParallel(combined, ...reducedOperands));
      const reducedDcOperands = reducedOperands.map((operand) => dcLimitOf(operand, variable)).filter(Boolean);
      if (reducedDcOperands.length >= 2) {
        const reducedDcCombined = combineParallel(reducedDcOperands, ops);
        if (reducedDcCombined) proofs.push(provenParallel(reducedDcCombined, ...reducedDcOperands));
      }
    } catch {
      // Leave whichever proofs already built if the reduced form fails.
    }
    return proofs;
  });
}

function buildTopologyProofs(topology, queries, approximations, approximationOptions) {
  const ops = createRationalOps({ variable: approximationOptions.variable || 's', maxOperations: 12000 });
  const proofs = [];
  const identities = [
    ...['inputImpedance', 'outputImpedance'].flatMap((key) => queries[key].equivalence ? [queries[key].equivalence] : []),
    ...topology.identities, ...(topology.selectedIdentities || []),
  ];
  const multiply = (operands) => operands.reduce((a, b) => ops.mul(a, b), ops.one);
  const addProof = (identity, equivalent, operands) => {
    if (!equivalent || operands.some((value) => !value || value.kind === 'infinity')) return;
    const product = identity.kind === 'product';
    if (product) operands = operands.filter((value) => !ops.isZero(ops.sub(value, ops.one)));
    if (operands.length < 2) return;
    // A product is worth showing factored only while the factors are the
    // shorter read: once a load has collapsed to 1/g_m, `g_m (1/g_m)` says
    // less than the 1 it multiplies out to.
    if (product && !operands.some(carriesSum)) return;
    const combined = product ? multiply(operands) : combineParallel(operands, ops);
    if (!ops.isZero(compactRational(ops.sub(combined, equivalent), ops)) || ops.budget.exceeded) return;
    const response = canonicalResponseValue(equivalent, { variable: ops.variable });
    const prove = product ? provenProduct : provenParallel;
    proofs.push(prove(response.expression, ...operands));
    const dcOperands = operands.map((value) => dcLimitOf(value, ops.variable));
    // An infinite branch drops out of a parallel DC limit. In a product,
    // zero times infinity needs a limit of the complete expression instead.
    const finite = product ? dcOperands : dcOperands.filter(Boolean);
    if (response.dc.kind === 'finite' && finite.length >= 2 && finite.every(Boolean)) {
      const dcCombined = product ? multiply(finite) : combineParallel(finite, ops);
      if (ops.isZero(ops.sub(dcCombined, response.dc.value))) proofs.push(prove(response.dc.value, ...finite));
    }
  };
  try {
    for (const identity of identities) {
      addProof(identity, identity.equivalent, identity.operands);
      const localOptions = { ...approximationOptions, budget: ops.budget, rational: { budget: ops.budget } };
      const selected = applyApproximations(identity.equivalent, localOptions).selected;
      const operands = identity.operands.map((value) => applyApproximations(value, localOptions).selected);
      addProof(identity, selected, operands);
    }
    // Bind the top-level proof to the actual selected query (including a
    // dominant-pole reduction), rather than assuming local reductions commute.
    if (topology.stages.length === 1 && !topology.selectedIdentities?.length) {
      const impedance = approximations.Zout.selected;
      if (!ops.isZero(impedance) && impedance.kind !== 'infinity') addProof(
        { kind: 'product' }, approximations.Av.selected,
        [compactRational(ops.div(approximations.Av.selected, impedance), ops), impedance],
      );
    }
  } catch {
    return [];
  }
  return ops.budget.exceeded ? [] : proofs;
}

function buildMillerEquivalenceProofs(pipeline, topology, approximations, approximationOptions) {
  const ops = createRationalOps({ variable: approximationOptions.variable || 's', maxOperations: 12000 });
  const options = { ...approximationOptions, budget: ops.budget, rational: { budget: ops.budget } };
  const proofs = [];
  const addProof = (proof, combined) => {
    if (!ops.isZero(compactRational(ops.sub(proof.equivalent, combined), ops))) return;
    proofs.push(proof);
    const response = canonicalResponseValue(compactRational(proof.equivalent, ops), { variable: ops.variable });
    proofs.push({ ...proof, equivalent: response.expression });
    const operands = proof.operands.map((value) => dcLimitOf(value, ops.variable));
    if (response.dc.value && operands.every(Boolean)) proofs.push({ ...proof, equivalent: response.dc.value, operands });
  };
  try {
    for (const stage of [...(pipeline.millerSubstitutions || []), ...(pipeline.retainedFeedbackNetworks || [])]) {
      const { gain, outputImpedance: load, transadmittance: gm, loadOperands, feedbackImpedance: feedback } = stage;
      if (loadOperands.length >= 2) addProof(provenParallel(load, ...loadOperands), combineParallel(loadOperands, ops));
      addProof(provenProduct(gain, gm, load), ops.mul(gm, load));
      const positiveGain = ops.neg(gain);
      addProof(provenProduct(positiveGain, ops.neg(gm), load), ops.mul(ops.neg(gm), load));
      const inverse = ops.div(ops.one, positiveGain);
      addProof(provenQuotient(inverse, ops.one, positiveGain), ops.div(ops.one, positiveGain));
      for (const term of [positiveGain, inverse]) {
        const factor = ops.add(ops.one, term);
        addProof(provenSum(factor, ops.one, term), ops.add(ops.one, term));
        const admittance = ops.div(factor, feedback);
        addProof(provenQuotient(admittance, factor, feedback), ops.div(factor, feedback));
        const impedance = ops.div(feedback, factor);
        addProof(provenQuotient(impedance, feedback, factor), ops.div(feedback, factor));
        const selected = applyApproximations(impedance, options).selected;
        const selectedFeedback = applyApproximations(feedback, options).selected;
        const selectedFactor = applyApproximations(factor, options).selected;
        if (!ops.isZero(ops.sub(selectedFactor, ops.one))) {
          addProof(provenQuotient(selected, selectedFeedback, selectedFactor), ops.div(selectedFeedback, selectedFactor));
        }
      }
      if (pipeline.retainedFeedbackNetworks?.includes(stage)
        && stage.gate === pipeline.context.input.node && stage.drain === pipeline.context.output.node) {
        // Resistive feedback: Zin = (Zfb + Ro)/(1 - Aopen), provided
        // the actual input query proves this identity (additional gate
        // loading or another feedback path may invalidate it).
        const numerator = ops.add(feedback, load);
        const denominator = ops.add(ops.one, positiveGain);
        const zin = pipeline.queries.inputImpedance.value;
        addProof(provenSum(numerator, feedback, load), ops.add(feedback, load));
        addProof(provenQuotient(zin, numerator, denominator), ops.div(numerator, denominator));
        const selectedZin = approximations.Zin.selected;
        const selectedNumerator = applyApproximations(numerator, options).selected;
        const selectedDenominator = applyApproximations(denominator, options).selected;
        addProof(provenQuotient(selectedZin, selectedNumerator, selectedDenominator), ops.div(selectedNumerator, selectedDenominator));
        const shortGm = topology.stages.length === 1 ? topology.stages[0].transadmittance : null;
        if (shortGm) addProof(provenSum(shortGm, gm, ops.div(ops.one, feedback)), ops.add(gm, ops.div(ops.one, feedback)));
      }
    }
  } catch { /* retain the exact identities already checked within budget */ }
  return proofs;
}

/**
 * A first-order root location with the selected post-solve assumptions
 * (for example `g_m r_o >> 1`) applied to it as a quantity of its own: the
 * root of an approximated response still carries every subdominant term.
 */
function approximatedRoot(root, approximationOptions) {
  if (!approximationOptions || root.kind !== 'root' || !root.root?.kind || root.root.kind === 'number') return root;
  try {
    const approximated = applyApproximations(root.root, { ...approximationOptions, dominantPoleApproximation: false, dominantPole: false });
    const { selected, changed } = approximated;
    if (!changed || selected.budgetExceeded) return root;
    const value = selected.denominator.kind === 'number' && selected.denominator.numerator === selected.denominator.denominator
      ? selected.numerator
      : { kind: 'rational', variable: selected.variable, numerator: selected.numerator, denominator: selected.denominator };
    return { ...root, root: value, exactRoot: root.root, assumptions: approximated.assumptions };
  } catch {
    return root;
  }
}

/** Poles, zeros, and degrees from the response with common factors cancelled. */
function withCancelledRoots(response, value, options, approximationOptions) {
  const cancelled = value?.kind === 'rational'
    ? cancelCommonPolynomialFactor(value, { variable: options.variable || 's' })
    : value;
  const reduced = cancelled === value ? response : analyzeResponse(cancelled, options);
  return {
    ...response,
    numeratorDegree: reduced.numeratorDegree,
    denominatorDegree: reduced.denominatorDegree,
    degrees: reduced.degrees,
    poles: reduced.poles.map((root) => approximatedRoot(root, approximationOptions)),
    zeros: reduced.zeros.map((root) => approximatedRoot(root, approximationOptions)),
  };
}

function displayResponse(name, exact, approximation, options, approximationOptions = null) {
  const selected = withCancelledRoots(canonicalResponseValue(approximation.selected, options), approximation.selected, options, approximationOptions);
  const exactResponse = canonicalResponseValue(exact, options);
  const argument = selected.hasFrequency ? 's' : null;
  const ac = selected.hasFrequency
    ? {
      expression: selected.expression,
      equation: renderQuantityEquation(name, argument, selected.expression, options),
      exactEquation: renderQuantityEquation(name, argument, exactResponse.expression, options),
    }
    : null;
  const dc = selected.dc.value
    ? {
      ...selected.dc,
      equation: renderQuantityEquation(name, 0, selected.dc.value, options),
    }
    : { ...selected.dc, equation: null };
  return {
    exact: exactResponse,
    approximation,
    response: selected,
    expression: selected.expression,
    ac,
    dc,
    dcLimit: selected.dc,
    poles: selected.poles,
    zeros: selected.zeros,
    equations: [ac?.equation, dc.equation].filter(Boolean),
    ...(options.equivalence ? { equivalence: options.equivalence } : {}),
    ...(options.equivalences ? { equivalences: options.equivalences } : {}),
  };
}

function canonicalResponseValue(value, options) {
  const canonical = value === Infinity || value === -Infinity
    ? infinity(value < 0 ? -1 : 1)
    : value?.kind ? value : decimalValue(value);
  if (canonical?.kind === 'infinity') {
    return {
      expression: canonical,
      numerator: canonical,
      denominator: null,
      numeratorCoefficients: null,
      denominatorCoefficients: null,
      numeratorDegree: null,
      denominatorDegree: null,
      numeratorValuation: null,
      denominatorValuation: null,
      degrees: { numerator: null, denominator: null },
      dc: { kind: 'infinite', value: canonical, order: null, coefficient: canonical },
      infinity: { kind: 'infinite', value: canonical, order: null, coefficient: canonical },
      hasFrequency: false,
      poles: [],
      zeros: [],
    };
  }
  const response = analyzeResponse(canonical ?? value, options);
  if (response.dc.kind !== 'finite' || !response.numeratorCoefficients || !response.denominatorCoefficients) return response;
  const numerator = response.numeratorCoefficients.find(({ power }) => power === 0)?.coefficient;
  const denominator = response.denominatorCoefficients.find(({ power }) => power === 0)?.coefficient;
  if (numerator === undefined || denominator === undefined) return response;
  const valueAtZero = rationalFunction(numerator, denominator, { variable: options.variable || 's' });
  return {
    ...response,
    dc: { ...response.dc, value: valueAtZero, coefficient: valueAtZero },
  };
}

function rootRows(transfer, options) {
  return [
    ...transfer.poles.map((root) => ({ ...root, equation: renderRoot(root, 'p', root.index, options) })),
    ...transfer.zeros.map((root) => ({ ...root, equation: renderRoot(root, 'z', root.index, options) })),
  ];
}

/**
 * Whether an expression carries a sum. A product is worth showing factored
 * while one of its factors is a combination -- `g_m (r_o || R_D)` reads far
 * better than the ratio it expands to -- but two monomials multiplied are
 * always shorter multiplied out: `g_{m1} (1/g_{m2})` is `g_{m1}/g_{m2}`.
 */
function carriesSum(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.kind === 'add') return true;
  if (value.kind === 'rational') return carriesSum(value.numerator) || carriesSum(value.denominator);
  if (value.kind === 'multiply') return value.factors.some(carriesSum);
  if (value.kind === 'power') return carriesSum(value.base);
  return false;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function nodeNames(circuit) {
  return new Map([...circuit.nets.values()].map((net) => [net.id, net.name || net.id]));
}

function solveFailureSource(pipeline) {
  const failure = pipeline?.solution || pipeline;
  const code = String(failure?.code || '').toLowerCase();
  const text = `${failure?.error || ''} ${pipeline?.error || ''}`.toLowerCase();
  const singular = code === 'singular'
    || code === 'inconsistent'
    || code === 'singular-system'
    || code === 'inconsistent-system'
    || text.includes('singular system')
    || text.includes('no pivot');
  if (!singular) return failure;
  return {
    code: 'singular-system',
    severity: 'error',
    stage: 'solve',
    error: failure?.error || pipeline?.error || 'small-signal solve has no unique solution',
    metadata: {
      cause: 'no-pivot',
      ...(failure?.pivotColumn === undefined ? {} : { pivotColumn: failure.pivotColumn }),
      ...(failure?.pivotRow === undefined ? {} : { pivotRow: failure.pivotRow }),
      ...(code && code !== 'singular-system' ? { originalCode: code } : {}),
    },
  };
}

function failureReport(pipeline, options, error = null) {
  const source = pipeline?.stage === 'solve'
    ? { solve: [solveFailureSource(pipeline)] }
    : pipeline
      ? { ...pipeline }
      : { error: error?.message || error || 'analysis failed' };
  const diagnostics = presentDiagnostics(source);
  return {
    ok: false,
    version: 2,
    stage: pipeline?.stage || 'analysis',
    error: pipeline?.error || error?.message || String(error || 'analysis failed'),
    context: pipeline?.context || null,
    exact: null,
    approximate: null,
    input: null,
    output: null,
    transfer: null,
    dc: null,
    poles: [],
    zeros: [],
    assumptions: [],
    details: pipeline || null,
    netlist: describeSmallSignalNetlist([], options),
    smallSignalNetlist: '',
    diagnostics,
    log: diagnostics.logText,
  };
}

/**
 * The budget is a real size limit, not a timeout: an exact symbolic solve of a
 * large reactive model grows faster than any budget worth waiting for. Say
 * what can be made smaller, because the form has no budget control.
 */
/**
 * What the three quantities are a ratio of, in the drawing's own node names.
 * The quantity symbols stay canonical -- `A_v`, `Z_{in}`, `Z_{out}` -- and this
 * says which nodes they were taken between, which is the whole answer for a
 * query like "what does the supply do to the output": nothing about a rail is
 * special, it is simply the node the input was taken at.
 */
function portSymbols(name) {
  const raw = String(name || '');
  const flat = raw.replace(/[_^]\{([^}]*)\}/g, '$1');
  // A node already named as a voltage lends its subscript to the current, so
  // the pair reads as one: V_{DD} with I_{DD}. A name written without markup
  // is given the same textbook spelling rather than one of each.
  if (/^V.+/.test(flat)) {
    const subscript = flat.slice(1);
    return { voltage: /[_^]\{/.test(raw) ? raw : `V_{${subscript}}`, current: `I_{${subscript}}` };
  }
  return { voltage: `v_{${flat}}`, current: `i_{${flat}}` };
}

export function portDefinitions(context) {
  const input = context?.input;
  const output = context?.output;
  if (!input || !output) return [];
  const from = portSymbols(input.name || input.netId);
  const to = portSymbols(output.name || output.netId);
  return [
    { quantity: 'Av', tex: `A_v = \\frac{${to.voltage}}{${from.voltage}}` },
    { quantity: 'Zin', tex: `Z_{in} = \\frac{${from.voltage}}{${from.current}}` },
    { quantity: 'Zout', tex: `Z_{out} = \\frac{${to.voltage}}{${to.current}}` },
  ];
}

function budgetFailureReport(stage, budget, options) {
  return failureReport({
    ok: false,
    stage: 'budget',
    code: 'operation-budget',
    error: `symbolic operation budget exhausted during ${stage}: this model is too large to solve exactly. `
      + 'Simplify it — fewer device capacitances, r_o → ∞ on bias devices, or analyze one stage at a time.',
    budget: { used: budget.used, limit: budget.limit },
  }, options);
}

/**
 * Run the topology-independent symbolic small-signal analysis pipeline.
 * Exact canonical responses are retained beside any selected approximation.
 */
export function analyzeSmallSignalV2(circuit, options = {}) {
  if (!circuit) throw new TypeError('circuit is required');
  const { ops, symbolic } = makeEngineOps(options);
  const normalized = normaliseOptions(options, circuit, symbolic, ops);
  const analysisOptions = { ...normalized, ...(ops.budget ? { budget: ops.budget } : {}) };
  const regions = modelRegions(options);
  const pipelineOptions = {
    ...normalized,
    ops,
    devices: regions,
    deviceRegions: regions,
    deviceAssumptions: normalized.devices,
    s: options.s === undefined
      ? (symbolic ? ops.s() : (typeof ops.s === 'function' ? ops.s() : ops.one))
      : (symbolic ? symbolicValue(options.s, {}, options, ops) : options.s),
  };
  let pipeline = buildExactAnalysisPipeline(circuit, pipelineOptions);
  let retainedOutputResistance = false;
  // Leaving r_o out can float a node driven only by current sources (an
  // inverter's output). Then fall back to the exact model and take the
  // post-solve r_o -> infinity limit, which shows how the result grows.
  if (!pipeline.ok && pipeline.stage === 'solve' && Object.values(normalized.devices || {}).some((device) => device.roInfinity)) {
    const retained = buildExactAnalysisPipeline(circuit, { ...pipelineOptions, deviceAssumptions: null });
    if (retained.ok) {
      pipeline = retained;
      retainedOutputResistance = true;
    }
  }
  if (!pipeline.ok) return failureReport(pipeline, normalized);
  if (ops.budget?.exceeded) return budgetFailureReport('exact solve', ops.budget, analysisOptions);

  const queries = pipeline.queries;
  if (ops.budget?.exceeded) return budgetFailureReport('query extraction', ops.budget, analysisOptions);
  const values = {
    Av: queries?.transfer?.value,
    Zin: queries?.inputImpedance?.value,
    Zout: queries?.outputImpedance?.value,
  };
  if (Object.values(values).some((value) => value === undefined)) return failureReport({
    ...pipeline,
    stage: 'queries',
    error: 'pipeline query results are incomplete',
    queries,
  }, normalized);

  const approximationOptions = {
    ...analysisOptions,
    parameters: analysisOptions.parameters || {},
    rational: {
      maxOperations: options.maxOperations,
      ...(ops.budget ? { budget: ops.budget } : {}),
    },
  };

  const equivalences = equivalenceTable(buildParallelEquivalenceProofs(pipeline.networkReductionProofs, approximationOptions, ops));
  const withEquivalences = (options) => ({ ...options, equivalences });

  const exact = {};
  for (const [name, value] of Object.entries(values)) {
    const cleanupOps = createRationalOps({ variable: analysisOptions.variable || 's', maxOperations: 12000 });
    const compact = compactRational(value, cleanupOps);
    exact[name] = canonicalResponseValue(cleanupOps.budget.exceeded ? value : compact, withEquivalences(responseOptions(analysisOptions)));
    if (ops.budget?.exceeded) return budgetFailureReport(`${name} response normalization`, ops.budget, analysisOptions);
  }
  if (ops.budget?.exceeded) return budgetFailureReport('response normalization', ops.budget, analysisOptions);
  const approximations = {};
  for (const [name, response] of Object.entries(exact)) {
    approximations[name] = response.expression?.kind === 'infinity'
      ? { exact: response.expression, selected: response.expression, changed: false, assumptions: [] }
      : applyApproximations(response.expression, approximationOptions);
    if (process.env.MOSFETEER_DEBUG_ENGINE) {
      const fmt = (v) => v && v.numerator ? `${formatExpression(v.numerator)} / ${formatExpression(v.denominator)}` : String(v?.kind);
      console.error('[approx]', name, fmt(response.expression), '->', fmt(approximations[name].selected), JSON.stringify(approximations[name].assumptions));
    }
    if (ops.budget?.exceeded) return budgetFailureReport(`${name} approximation`, ops.budget, analysisOptions);
  }
  const topology = buildTopologyIdentities(pipeline, analysisOptions);
  // A dominant-pole reduction acts on the whole transfer function; stage
  // factoring must not silently replace that explicitly selected reduction.
  const topologicalApproximation = analysisOptions.dominantPoleApproximation ? null
    : approximateTopology(topology, queries, approximationOptions);
  if (process.env.MOSFETEER_DEBUG_ENGINE) console.error('[topo] stages', topology.stages.length, '| approximation?', !!topologicalApproximation);
  if (topologicalApproximation) {
    for (const [name, composed, stageAssumptions] of [
      ['Av', topologicalApproximation.selected, topologicalApproximation.assumptions],
      ['Zout', topologicalApproximation.output.selected, topologicalApproximation.output.assumptions],
    ]) {
      // The stages were reduced one at a time; run the selected assumptions
      // over what they compose to as well. Without this the topological form
      // silently replaced a stronger whole-expression reduction -- a diode
      // load stayed 1/g_m2 || r_o1 || r_o2 where g_m r_o >> 1 says 1/g_m2.
      const reduced = applyApproximations(composed, approximationOptions);
      const selected = reduced.selected;
      const assumptions = unique([...stageAssumptions, ...reduced.assumptions]);
      const comparisonOps = createRationalOps({ variable: analysisOptions.variable || 's', maxOperations: 12000 });
      const changed = !comparisonOps.isZero(compactRational(comparisonOps.sub(selected, exact[name].expression), comparisonOps));
      approximations[name] = { ...approximations[name], selected, changed, assumptions: changed ? assumptions : [] };
    }
    topology.selectedIdentities = topologicalApproximation.identities;
  }
  for (const [key, proof] of equivalenceTable(buildTopologyProofs(topology, queries, approximations, approximationOptions))) {
    equivalences.set(key, proof);
  }
  for (const [key, proof] of equivalenceTable(buildMillerEquivalenceProofs(pipeline, topology, approximations, approximationOptions))) {
    equivalences.set(key, proof);
  }
  const displayed = {
    transfer: displayResponse('Av', exact.Av.expression, approximations.Av, withEquivalences(responseOptions(analysisOptions)), approximationOptions),
    input: displayResponse('Zin', exact.Zin.expression, approximations.Zin, withEquivalences({
      ...responseOptions(analysisOptions),
      ...(queries.inputImpedance.equivalence ? { equivalence: queries.inputImpedance.equivalence } : {}),
    }), approximationOptions),
    output: displayResponse('Zout', exact.Zout.expression, approximations.Zout, withEquivalences({
      ...responseOptions(analysisOptions),
      ...(queries.outputImpedance.equivalence ? { equivalence: queries.outputImpedance.equivalence } : {}),
    }), approximationOptions),
  };
  if (ops.budget?.exceeded) return budgetFailureReport('report formatting', ops.budget, analysisOptions);
  const millerAssumptions = (pipeline.millerSubstitutions || []).map(({ device }) => `Miller approximation${device ? ` (${device})` : ''}`);
  const outputResistanceAssumptions = (pipeline.omittedOutputResistances || []).map((device) => `r_o -> infinity (${device})`);
  // One global statement when the option is global: the model dropped every
  // device's body-effect branch, and four identical per-device lines say
  // nothing the single rule does not.
  const omittedBody = pipeline.omittedBodyEffect || [];
  const bodyEffectAssumptions = omittedBody.length
    ? (analysisOptions.assumptions?.gmb0 ? ['g_mb = 0'] : omittedBody.map((device) => `g_mb = 0 (${device})`))
    : [];
  const assumptions = unique([
    ...millerAssumptions,
    ...bodyEffectAssumptions,
    ...outputResistanceAssumptions,
    ...Object.values(approximations).flatMap(({ assumptions: values }) => values),
    ...Object.values(displayed).flatMap(({ poles = [], zeros = [] }) => [...poles, ...zeros])
      .flatMap((root) => root.assumptions || []),
  ]);
  const transfer = displayed.transfer.response;
  const roots = rootRows(transfer, responseOptions(analysisOptions));
  if (ops.budget?.exceeded) return budgetFailureReport('pole and zero extraction', ops.budget, analysisOptions);
  const netlist = describeSmallSignalNetlist(pipeline.selected, {
    ...normalized,
    equivalences,
    acGroundIds: pipeline.context.acGroundIds,
    nodeAliases: pipeline.context.nodeAliases,
    nodeNames: nodeNames(circuit),
  });
  const diagnostics = presentDiagnostics({
    context: pipeline.context,
    conversion: pipeline.conversion,
    graph: pipeline.coupled,
    queries,
  });
  const names = nodeNames(circuit);
  const portName = (variable) => {
    const node = variable.slice(2, -1);
    return names.get(node) || node;
  };
  const topologyLog = topology.stages.map((stage, index) => (
    `Stage ${index + 1}: ${portName(stage.from)} -> ${portName(stage.to)}; gain = signed transadmittance times loaded output impedance.`
  ));
  return {
    ok: true,
    version: 2,
    context: pipeline.context,
    input: displayed.input,
    output: displayed.output,
    transfer: displayed.transfer,
    exact,
    approximate: approximations,
    dc: {
      input: displayed.input.dcLimit,
      output: displayed.output.dcLimit,
      transfer: displayed.transfer.dcLimit,
    },
    dcLimits: {
      input: displayed.input.dcLimit,
      output: displayed.output.dcLimit,
      transfer: displayed.transfer.dcLimit,
    },
    poles: transfer.poles,
    zeros: transfer.zeros,
    roots,
    assumptions,
    portDefinitions: portDefinitions(pipeline.context),
    equations: [
      ...displayed.input.equations,
      ...displayed.output.equations,
      ...displayed.transfer.equations,
      ...roots.map(({ equation }) => equation),
    ],
    details: {
      topology,
      pipeline,
      queries,
      exact,
      approximations,
      system: pipeline.system,
      solution: pipeline.solution,
    },
    netlist,
    smallSignalNetlist: netlist.text,
    // Where each symbol in the equations above came from. The solved primitive
    // set describes the model that produced them, and the conversion set fills
    // in symbols whose own primitive left the model but whose name survived
    // into an equation — a Miller-absorbed feedback capacitor, or an r_o the
    // engine had to keep. See `provenance.js`.
    symbolProvenance: symbolProvenance(pipeline.exactPrimitives, pipeline.conversion?.primitives),
    diagnostics,
    log: [
      diagnostics.logText,
      ...(retainedOutputResistance
        ? ['r_o -> infinity: removing r_o leaves a node with no conducting path (for example an output driven only by current sources), so r_o was kept and only its large-r_o limit applied.']
        : []),
      ...topologyLog,
    ].filter(Boolean).join('\n'),
  };
}
