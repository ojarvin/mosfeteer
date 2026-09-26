/**
 * Small-signal noise: thermal and flicker spectral densities referred to the
 * output and to the input.
 *
 * Every selected noise generator is an independent current source between the
 * terminals of its own element, and gets its own RHS column in the one MNA
 * solve (`pipeline.js`). A column has the input test source at 0 V and the
 * output open, so its output voltage is the generator's transimpedance
 * `H_k(s)` to the output. Uncorrelated generators add in power:
 *
 *   v_{n,out}^2 = sum_k |H_k|^2 S_k,   v_{n,in}^2 = sum_k |H_k / A_v|^2 S_k
 *
 * `H_k` and `A_v` share the system determinant, so the input-referred ratio
 * has the circuit's poles cancelled -- which is why it reads like a textbook.
 * Thermal and flicker noise of one MOS device are both drain currents, so one
 * column serves both; only the weight `S_k` differs. The densities are written
 * as a common prefix (`4kT` or `1/f`) times a sum of one term per generator,
 * and are taken at low frequency: the DC limit of each transfer.
 */
import { MOS_TYPES } from './shared.js';

export const NOISE_KINDS = Object.freeze(['thermal', 'flicker']);

const RESISTOR_TYPES = new Set(['resistor', 'variable_resistor']);

/**
 * The normalized noise request, or null when noise is not requested. `true`
 * asks for every generator; an object may name `sources` (refdes list, null
 * for all), turn `thermal` or `flicker` off, and set `output: false` to
 * report only the input-referred densities.
 */
export function noiseRequest(value) {
  if (!value) return null;
  const object = value === true ? {} : value;
  if (typeof object !== 'object') return null;
  const sources = Array.isArray(object.sources) || object.sources instanceof Set
    ? [...new Set([...object.sources].map(String))]
    : null;
  const thermal = object.thermal !== false;
  const flicker = object.flicker !== false;
  if (!thermal && !flicker) return null;
  return { sources, thermal, flicker, output: object.output !== false };
}

/** Components that can carry a noise generator, in drawing order. */
export function noiseCandidates(circuit) {
  return [...circuit.components.values()]
    .filter((component) => MOS_TYPES.has(component.type) || RESISTOR_TYPES.has(component.type))
    .map((component) => component.refdes);
}

function deviceSuffix(refdes) {
  return String(refdes).replace(/^M(?=[A-Za-z0-9_])/, '').replace(/[^A-Za-z0-9]/g, '_');
}

/**
 * One generator per noisy primitive of a selected component: a saturated
 * MOS device's channel (beside its `g_m` source), a triode channel `r_{ds}`,
 * or a resistor. Weights leave out the `4kT` and `1/f` prefixes. The extra
 * symbols a weight introduces are listed as provenance primitives so the
 * GUI can trace `W_{1}` back to `M1` like any other parameter.
 */
export function buildNoiseSources(primitives, request, resolve, ops) {
  if (!request || typeof ops.symbol !== 'function') return [];
  const wanted = request.sources ? new Set(request.sources) : null;
  const sources = [];
  for (const primitive of primitives) {
    const component = primitive.metadata?.component;
    if (!component || (wanted && !wanted.has(component))) continue;
    const role = String(primitive.id).slice(String(primitive.id).lastIndexOf('.') + 1);
    const mosChannel = primitive.kind === 'vccs' && role === 'gm' && primitive.metadata?.device === 'mos';
    const conductor = primitive.kind === 'resistor' && (role === 'resistor' || role === 'rds');
    if (!mosChannel && !conductor) continue;
    const value = resolve(primitive);
    const symbols = [];
    let thermal = null;
    let flicker = null;
    if (mosChannel) {
      const suffix = deviceSuffix(component);
      const channel = primitive.metadata.channel === 'p' ? 'p' : 'n';
      const names = { gamma: '\\gamma', k: `K_{f,${channel}}`, cox: 'C_{ox}', w: `W_{${suffix}}`, l: `L_{${suffix}}` };
      symbols.push(names.w, names.l);
      if (request.thermal) thermal = ops.mul(ops.symbol(names.gamma), value);
      if (request.flicker) {
        flicker = ops.div(
          ops.mul(ops.mul(value, value), ops.symbol(names.k)),
          ops.mul(ops.symbol(names.cox), ops.mul(ops.symbol(names.w), ops.symbol(names.l))),
        );
      }
    } else if (request.thermal) {
      thermal = ops.div(ops.one, value);
    }
    if (!thermal && !flicker) continue;
    sources.push({
      id: `${component}.noise`,
      component,
      primitive: primitive.id,
      terminals: { a: primitive.terminals.a, b: primitive.terminals.b },
      thermal,
      flicker,
      symbols,
    });
  }
  return sources;
}

/** Symbol-to-component primitives for the names a noise weight adds. */
export function noiseProvenancePrimitives(sources = []) {
  return sources.flatMap((source) => source.symbols.map((name) => ({
    id: `${source.component}.noise`,
    kind: 'noise',
    value: name,
    metadata: { component: source.component },
  })));
}

// Voltage noise densities in V^2/Hz, named S as a power spectral density.
const LABELS = Object.freeze({
  input: { thermal: 'S_{v,in,th}', flicker: 'S_{v,in,1/f}' },
  output: { thermal: 'S_{v,out,th}', flicker: 'S_{v,out,1/f}' },
});

export const NOISE_PREFIXES = Object.freeze({ thermal: '4kT', flicker: '\\frac{1}{f}' });

const TITLES = Object.freeze({
  input: { thermal: 'Input-referred thermal noise', flicker: 'Input-referred flicker noise' },
  output: { thermal: 'Output thermal noise', flicker: 'Output flicker noise' },
});

/** The referrals a request reports: input-referred always, output on request. */
function referralsOf(request) {
  return request.output === false ? ['input'] : ['input', 'output'];
}

/**
 * Low-frequency noise rows from the solved noise columns. `transfer` is the
 * exact `A_v(s)`; `helpers` supplies the engine's DC limit, approximation, and
 * compaction so the terms follow the same presentation rules as every other
 * row. A generator whose transfer has no finite DC limit (an AC-coupled
 * path) is listed in `unreferred` rather than guessed.
 */
export function buildNoiseReport(queries, transfer, request, helpers) {
  const { ops, dcLimit, approximate, compact } = helpers;
  const columns = queries || [];
  const gain = dcLimit(transfer);
  const assumptions = [];
  const unreferred = [];
  const silent = [];
  const perReferral = { input: [], output: [] };
  for (const column of columns) {
    const { source } = column;
    const output = column.outputVoltage;
    if (!output || ops.isZero(output)) {
      silent.push(source.component);
      continue;
    }
    const referrals = { output: dcLimit(output) };
    referrals.input = gain && !ops.isZero(gain) ? dcLimit(ops.div(output, transfer)) : null;
    for (const referral of referralsOf(request)) {
      const exact = referrals[referral];
      if (!exact) {
        unreferred.push({ component: source.component, referral });
        continue;
      }
      const approximation = approximate(exact);
      assumptions.push(...approximation.assumptions);
      const squared = (value) => compact(ops.mul(value, value));
      perReferral[referral].push({ source, exact: squared(exact), selected: squared(approximation.selected) });
    }
  }
  const rows = [];
  for (const referral of referralsOf(request)) {
    for (const kind of NOISE_KINDS) {
      if (!request[kind]) continue;
      const terms = perReferral[referral]
        .filter(({ source }) => source[kind])
        .map(({ source, exact, selected }) => ({
          component: source.component,
          exactExpression: compact(ops.mul(exact, source[kind])),
          expression: compact(ops.mul(selected, source[kind])),
        }))
        .filter(({ expression }) => !ops.isZero(expression));
      if (!terms.length) continue;
      rows.push({
        key: `${referral}-${kind}`,
        referral,
        kind,
        title: TITLES[referral][kind],
        label: LABELS[referral][kind],
        prefix: NOISE_PREFIXES[kind],
        terms,
      });
    }
  }
  return {
    request,
    sources: columns.map(({ source }) => source.component),
    silent: [...new Set(silent)],
    unreferred,
    assumptions: [...new Set(assumptions)],
    rows,
  };
}
