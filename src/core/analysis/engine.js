import { applyApproximations } from './approximation.js';
import { createRationalOps } from './algebra-ops.js';
import { buildExactAnalysisPipeline } from './pipeline.js';
import { presentDiagnostics } from './diagnostics.js';
import { describeSmallSignalNetlist } from './netlist.js';
import { analyzeResponse } from './response.js';
import {
  integer,
  rational,
  rationalFunction,
  substituteRational,
} from './rational.js';
import {
  equivalenceTable,
  provenParallel,
  renderQuantityEquation,
  renderRootEquation,
  infinity,
} from './present.js';

const MOS_TYPES = new Set(['nmos', 'pmos', 'nmosb', 'pmosb']);
const DEFAULTS = Object.freeze({
  ignoreBodyEffect: true,
  gmroLarge: true,
  ignoreChannelLengthModulation: false,
  dominantPoleApproximation: false,
});

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

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
    options.gmb0,
    assumptions.ignoreBodyEffect,
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
    options.roInfinity,
    options.assumptions?.ignoreChannelLengthModulation,
    options.assumptions?.roInfinity,
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
    devices[component.refdes] = {
      id: component.refdes,
      gm: `gm${suffix}`,
      gmb: `gmb${suffix}`,
      ro: `ro${suffix}`,
      highIntrinsicGain: Boolean(intrinsic),
      gmb0: Boolean(body),
      roInfinity: Boolean(output),
      // g_m r_o >> 1 only declares the gm*ro PRODUCT large relative to a bare
      // constant (dropping a "+1" beside it); r_o itself keeps degree 0, so a
      // finite r_o added to or paralleled with an unrelated symbol like R_D
      // is never discarded — that would silently assume r_o -> infinity,
      // a separate, off-by-default assumption. Only scaling gm/gmb here (not
      // ro) is what makes any product containing gm dominate a gm-free term.
      scaling: { symbols: { [`gm${suffix}`]: 1, [`gmb${suffix}`]: 1 } },
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
  if (root.root?.kind === 'quadratic-formula') {
    return `${kind}_{${index}}: roots of ${root.polynomial ? renderQuantityEquation('P', null, root.polynomial, options) : 'the denominator'}`;
  }
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

function displayResponse(name, exact, approximation, options) {
  const selected = canonicalResponseValue(approximation.selected, options);
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

function budgetFailureReport(stage, budget, options) {
  return failureReport({
    ok: false,
    stage: 'budget',
    code: 'operation-budget',
    error: `symbolic operation budget exhausted during ${stage}`,
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
    s: options.s === undefined
      ? (symbolic ? ops.s() : (typeof ops.s === 'function' ? ops.s() : ops.one))
      : (symbolic ? symbolicValue(options.s, {}, options, ops) : options.s),
  };
  const pipeline = buildExactAnalysisPipeline(circuit, pipelineOptions);
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
    exact[name] = canonicalResponseValue(value, withEquivalences(responseOptions(analysisOptions)));
    if (ops.budget?.exceeded) return budgetFailureReport(`${name} response normalization`, ops.budget, analysisOptions);
  }
  if (ops.budget?.exceeded) return budgetFailureReport('response normalization', ops.budget, analysisOptions);
  const approximations = {};
  for (const [name, response] of Object.entries(exact)) {
    approximations[name] = response.expression?.kind === 'infinity'
      ? { exact: response.expression, selected: response.expression, changed: false, assumptions: [] }
      : applyApproximations(response.expression, approximationOptions);
    if (ops.budget?.exceeded) return budgetFailureReport(`${name} approximation`, ops.budget, analysisOptions);
  }
  const displayed = {
    transfer: displayResponse('Av', exact.Av.expression, approximations.Av, withEquivalences(responseOptions(analysisOptions))),
    input: displayResponse('Zin', exact.Zin.expression, approximations.Zin, withEquivalences({
      ...responseOptions(analysisOptions),
      ...(queries.inputImpedance.equivalence ? { equivalence: queries.inputImpedance.equivalence } : {}),
    })),
    output: displayResponse('Zout', exact.Zout.expression, approximations.Zout, withEquivalences({
      ...responseOptions(analysisOptions),
      ...(queries.outputImpedance.equivalence ? { equivalence: queries.outputImpedance.equivalence } : {}),
    })),
  };
  if (ops.budget?.exceeded) return budgetFailureReport('report formatting', ops.budget, analysisOptions);
  const millerAssumptions = (pipeline.millerSubstitutions || []).map(({ device }) => `Miller approximation${device ? ` (${device})` : ''}`);
  const assumptions = unique([
    ...millerAssumptions,
    ...Object.values(approximations).flatMap(({ assumptions: values }) => values),
  ]);
  const transfer = displayed.transfer.response;
  const roots = rootRows(transfer, responseOptions(analysisOptions));
  if (ops.budget?.exceeded) return budgetFailureReport('pole and zero extraction', ops.budget, analysisOptions);
  const netlist = describeSmallSignalNetlist(pipeline.selected, {
    ...normalized,
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
    equations: [
      ...displayed.input.equations,
      ...displayed.output.equations,
      ...displayed.transfer.equations,
      ...roots.map(({ equation }) => equation),
    ],
    details: {
      pipeline,
      queries,
      exact,
      approximations,
      system: pipeline.system,
      solution: pipeline.solution,
    },
    netlist,
    smallSignalNetlist: netlist.text,
    diagnostics,
    log: diagnostics.logText,
  };
}

export const analyzeSmallSignal = analyzeSmallSignalV2;
