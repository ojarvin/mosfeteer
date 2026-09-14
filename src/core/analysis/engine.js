import { applyApproximations } from './approximation.js';
import { createRationalOps } from './algebra-ops.js';
import { buildExactAnalysisPipeline } from './pipeline.js';
import { presentDiagnostics } from './diagnostics.js';
import { describeSmallSignalNetlist } from './netlist.js';
import { extractSmallSignalQueries } from './queries.js';
import { analyzeResponse } from './response.js';
import {
  integer,
  rational,
  rationalFunction,
} from './rational.js';
import {
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
      go: `go${suffix}`,
      highIntrinsicGain: Boolean(intrinsic),
      gmb0: Boolean(body),
      roInfinity: Boolean(output),
      // Scale gm, gmb, and go together for a valid intrinsic-gain limit.
      // Keeping the names explicit also lets the reducer retain body effect.
      scaling: { symbols: { [`gm${suffix}`]: 1, [`gmb${suffix}`]: 1, [`go${suffix}`]: -1 } },
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

function solutionForQueries(pipeline, ops) {
  const outputBranch = `I(${pipeline.excitations.output.name})`;
  const columns = pipeline.solution.columns.map((column, index) => [
    ...column,
    index === 1 ? ops.one : ops.zero,
  ]);
  return {
    ...pipeline.solution,
    variables: [...pipeline.solution.variables, outputBranch],
    columns,
    values: columns,
    solution: columns,
    rhsCount: columns.length,
  };
}

function queryMetadata(pipeline) {
  const inputNode = `V(${pipeline.context.input.node})`;
  const outputNode = `V(${pipeline.context.output.node})`;
  return {
    inputDrive: {
      rhsColumn: 0,
      voltageUnknown: inputNode,
      currentUnknown: `I(${pipeline.excitations.input.name})`,
      currentSign: -1,
    },
    output: { voltageUnknown: outputNode },
    outputTest: {
      rhsColumn: 1,
      inputZeroed: true,
      voltageUnknown: outputNode,
      currentUnknown: `I(${pipeline.excitations.output.name})`,
      currentSign: 1,
    },
  };
}

function exactQueries(pipeline, ops) {
  const extracted = extractSmallSignalQueries(solutionForQueries(pipeline, ops), queryMetadata(pipeline), { ops });
  const direct = pipeline.queries;
  if (!extracted.ok) {
    // An ideal open input has zero drive current, so the generic ratio helper
    // intentionally rejects Zin. The pipeline's direct query still carries
    // the valid infinity result for that case.
    const directValues = {
      Av: direct.transfer?.value,
      Zin: direct.inputImpedance?.value,
      Zout: direct.outputImpedance?.value,
    };
    if (Object.values(directValues).some((value) => value === undefined)) return extracted;
    return {
      ...extracted,
      ok: true,
      values: directValues,
      direct: {
        transfer: direct.transfer?.value,
        inputImpedance: direct.inputImpedance?.value,
        outputImpedance: direct.outputImpedance?.value,
      },
      fallback: 'pipeline-direct-query',
    };
  }
  const values = {
    Av: extracted.av.value,
    Zin: extracted.zin.value,
    Zout: extracted.zout.value,
  };
  return {
    ...extracted,
    values,
    direct: {
      transfer: values.Av,
      inputImpedance: values.Zin,
      outputImpedance: values.Zout,
    },
  };
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

  const queries = exactQueries(pipeline, ops);
  if (ops.budget?.exceeded) return budgetFailureReport('query extraction', ops.budget, analysisOptions);
  if (!queries.ok) return failureReport({
    ...pipeline,
    stage: 'queries',
    error: queries.diagnostics.map(({ error, message }) => error || message).join('; '),
    queries,
  }, normalized);

  const exact = {};
  for (const [name, value] of Object.entries(queries.values)) {
    exact[name] = canonicalResponseValue(value, responseOptions(analysisOptions));
    if (ops.budget?.exceeded) return budgetFailureReport(`${name} response normalization`, ops.budget, analysisOptions);
  }
  if (ops.budget?.exceeded) return budgetFailureReport('response normalization', ops.budget, analysisOptions);
  const approximationOptions = {
    ...analysisOptions,
    parameters: analysisOptions.parameters || {},
    rational: {
      maxOperations: options.maxOperations,
      ...(ops.budget ? { budget: ops.budget } : {}),
    },
  };
  const approximations = {};
  for (const [name, response] of Object.entries(exact)) {
    approximations[name] = response.expression?.kind === 'infinity'
      ? { exact: response.expression, selected: response.expression, changed: false, assumptions: [] }
      : applyApproximations(response.expression, approximationOptions);
    if (ops.budget?.exceeded) return budgetFailureReport(`${name} approximation`, ops.budget, analysisOptions);
  }
  const displayed = {
    transfer: displayResponse('Av', exact.Av.expression, approximations.Av, responseOptions(analysisOptions)),
    input: displayResponse('Zin', exact.Zin.expression, approximations.Zin, responseOptions(analysisOptions)),
    output: displayResponse('Zout', exact.Zout.expression, approximations.Zout, responseOptions(analysisOptions)),
  };
  if (ops.budget?.exceeded) return budgetFailureReport('report formatting', ops.budget, analysisOptions);
  const assumptions = unique(Object.values(approximations).flatMap(({ assumptions: values }) => values));
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
