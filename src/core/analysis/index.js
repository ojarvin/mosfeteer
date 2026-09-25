import { analyzeSmallSignalV2 } from './engine.js';
import { adaptCombinedReport } from './report-adapter.js';

const PASSTHROUGH_OPTIONS = Object.freeze([
  'input', 'output', 'ports', 'reference', 'acGrounds', 'deviceRegions',
  'values', 'parameters', 'params', 's', 'variable', 'ops', 'maxOperations',
  'budget', 'valueOf', 'resolveValue',
  'topologicalSolve', 'topologicalPresentation', 'transferFunctions',
]);

function engineOptions(options) {
  const supported = {};
  for (const key of PASSTHROUGH_OPTIONS) {
    if (options[key] !== undefined) supported[key] = options[key];
  }
  return {
    ...supported,
    ...(options.neglectBodyEffect === undefined ? {} : { ignoreBodyEffect: options.neglectBodyEffect }),
    ...(options.highIntrinsicGain === undefined ? {} : { gmroLarge: options.highIntrinsicGain }),
    ...(options.neglectChannelLengthModulation === undefined
      ? {}
      : { ignoreChannelLengthModulation: options.neglectChannelLengthModulation }),
    ...(options.dominantPole === undefined ? {} : { dominantPoleApproximation: options.dominantPole }),
  };
}

function triodeRegions(value) {
  const entries = value instanceof Map ? [...value.entries()]
    : Array.isArray(value) ? value.map((entry) => String(entry).split('='))
      : value && typeof value === 'object' ? Object.entries(value) : [];
  return Object.fromEntries(entries.flatMap(([refdes, model]) => {
    const region = typeof model === 'object' ? model.region ?? model.model : model;
    return String(region).toLowerCase() === 'triode' ? [[refdes, { region: 'triode' }]] : [];
  }));
}

function compatibilityOptions(options) {
  return {
    ...options,
    deviceRegions: options.deviceRegions ?? triodeRegions(options.models),
    neglectBodyEffect: options.neglectBodyEffect ?? options.ignoreBodyEffect,
    highIntrinsicGain: options.highIntrinsicGain ?? options.gmroLarge,
    neglectChannelLengthModulation: options.neglectChannelLengthModulation
      ?? options.ignoreChannelLengthModulation,
    dominantPole: options.dominantPole ?? options.dominantPoleApproximation,
  };
}

/** Run one exact symbolic solve and expose the stable combined report shape. */
export function analyzeSmallSignal(circuit, options = {}) {
  return adaptCombinedReport(analyzeSmallSignalV2(circuit, engineOptions(options)));
}

function quantityReport(combined, key) {
  const report = combined.reports[key];
  return {
    ...report,
    dcGain: combined.dcGain,
    dcInputImpedance: combined.dcInputImpedance,
    dcOutputImpedance: combined.dcOutputImpedance,
  };
}

/** Compatibility wrapper for callers that display only input impedance. */
export function analyzeInputImpedance(circuit, input, options = {}) {
  return quantityReport(analyzeSmallSignal(circuit, compatibilityOptions({ ...options, input })), 'input');
}

/** Compatibility wrapper for callers that display only output impedance. */
export function analyzeOutputImpedance(circuit, output, options = {}) {
  return quantityReport(analyzeSmallSignal(circuit, compatibilityOptions({ ...options, output })), 'output');
}

/** Compatibility wrapper for callers that display only voltage transfer. */
export function analyzeTransferFunction(circuit, output, options = {}) {
  return quantityReport(analyzeSmallSignal(circuit, compatibilityOptions({ ...options, output })), 'transfer');
}

/** Return true when an expression retains the Laplace variable. */
export function expressionHasFrequency(value, seen = new Set()) {
  if (value == null || typeof value !== 'object') {
    return typeof value === 'string' && /(?:^|[^A-Za-z])s(?:[^A-Za-z]|$)/.test(value);
  }
  if (seen.has(value)) return false;
  seen.add(value);
  if (value.kind === 'symbol') return value.name === 's';
  return [
    value.expression,
    value.numerator,
    value.denominator,
    value.base,
    ...(value.terms || []),
    ...(value.factors || []),
  ].some((child) => expressionHasFrequency(child, seen));
}
