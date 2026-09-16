import { AC_GROUND, resolveAnalysisContext } from './context.js';
import { convertCircuitToPrimitives } from './devices.js';
import { coupledSubgraph, splitAtNode } from './graph.js';
import { buildMNA, numberOps, validateMnaOps } from './mna.js';
import {
  add as addExpression,
  keyOf,
  multiply as multiplyExpression,
  negate as negateExpression,
  power as powerExpression,
  rationalFunction,
} from './rational.js';
import { applyMillerApproximation } from './miller.js';
import { provenParallel } from './present.js';
import { reduceNetwork } from './reduce.js';
import { solveMNA } from './solve.js';
import { createRationalOps } from './algebra-ops.js';
import { compactRational } from './compact.js';
import { solveByTopology } from './topological-solve.js';

const INPUT_SOURCE = '@analysis-input';
const OUTPUT_SOURCE = '@analysis-output';

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function lookupValue(values, key) {
  if (!values || key == null) return undefined;
  if (typeof values.get === 'function') return values.get(key);
  return typeof values === 'object' && Object.hasOwn(values, key) ? values[key] : undefined;
}

function scalar(value, ops) {
  if (value === 0) return ops.zero;
  if (value === 1) return ops.one;
  return value;
}

export function resolveValue(value, primitive, options, ops) {
  const resolver = Object.hasOwn(options, 'valueOf') ? options.valueOf : options.resolveValue;
  if (typeof resolver === 'function') {
    return scalar(resolver(value, primitive), ops);
  }
  const values = options.values || options.parameters || options.params;
  const key = primitive.parameter || value;
  const resolved = lookupValue(values, key);
  return scalar(resolved === undefined ? value : resolved, ops);
}

function primitiveTerminals(primitive) {
  const terminals = primitive.terminals || {};
  const control = primitive.control || {};
  return {
    a: terminals.a,
    b: terminals.b,
    controlPlus: control.a,
    controlMinus: control.b,
  };
}

function expressionFactors(value) {
  if (value?.kind === 'multiply') return value.factors.flatMap(expressionFactors);
  if (value?.kind === 'power' && value.exponent !== 0) return [[value.base, value.exponent]];
  return [[value, 1]];
}

function commonMonomialFactors(value) {
  const terms = value?.kind === 'add' ? value.terms : [value];
  if (!terms.length) return new Map();
  let common = null;
  for (const term of terms) {
    const factors = new Map();
    for (const [base, exponent] of expressionFactors(term)) {
      if (base?.kind === 'number') continue;
      const key = keyOf(base);
      factors.set(key, { base, exponent: (factors.get(key)?.exponent || 0) + exponent });
    }
    if (common === null) {
      common = factors;
      continue;
    }
    for (const [key, entry] of common) {
      const exponent = factors.get(key)?.exponent || 0;
      if (exponent <= 0) common.delete(key);
      else entry.exponent = Math.min(entry.exponent, exponent);
    }
  }
  return common || new Map();
}

function removeMonomialFactors(value, removed) {
  const terms = value?.kind === 'add' ? value.terms : [value];
  const rebuilt = terms.map((term) => {
    const factors = [];
    for (const [base, exponent] of expressionFactors(term)) {
      const remaining = base?.kind === 'number' ? exponent : exponent - (removed.get(keyOf(base))?.exponent || 0);
      if (remaining) factors.push(base?.kind === 'number' ? base : powerExpression(base, remaining));
    }
    return multiplyExpression(factors);
  });
  return rebuilt.length === 1 ? rebuilt[0] : addExpression(rebuilt);
}

function allNegative(value) {
  const terms = value?.kind === 'add' ? value.terms : [value];
  return terms.length > 0 && terms.every((term) => {
    if (term?.kind === 'number') return term.numerator < 0n;
    return term?.kind === 'multiply' && term.factors[0]?.kind === 'number' && term.factors[0].numerator < 0n;
  });
}

function normalizeSymbolicQuery(value, ops) {
  if (value?.kind !== 'rational' || value.budgetExceeded === true) return value;
  const numeratorFactors = commonMonomialFactors(value.numerator);
  const denominatorFactors = commonMonomialFactors(value.denominator);
  const common = new Map();
  for (const [key, entry] of numeratorFactors) {
    const denominator = denominatorFactors.get(key);
    if (denominator) common.set(key, { base: entry.base, exponent: Math.min(entry.exponent, denominator.exponent) });
  }
  let numerator = common.size ? removeMonomialFactors(value.numerator, common) : value.numerator;
  let denominator = common.size ? removeMonomialFactors(value.denominator, common) : value.denominator;
  const constant = (denominator.kind === 'add' ? denominator.terms : [denominator]).find((term) => term.kind === 'number');
  if (allNegative(denominator) || constant?.numerator < 0n) {
    numerator = negateExpression(numerator);
    denominator = denominator.kind === 'add' ? addExpression(denominator.terms.map(negateExpression)) : negateExpression(denominator);
  }
  if (!common.size && numerator === value.numerator && denominator === value.denominator) return value;
  return rationalFunction(numerator, denominator, { variable: value.variable, budget: ops.budget });
}

function queryDivide(numerator, denominator, ops) {
  if (ops.isZero(denominator)) {
    return typeof ops.symbol === 'function' ? ops.symbol('\\infty') : ops.div(numerator, denominator);
  }
  return normalizeSymbolicQuery(ops.div(numerator, denominator), ops);
}

function budgetFailure(ops, stage) {
  const budget = ops.budget;
  if (!budget?.exceeded) return null;
  return {
    ok: false,
    code: 'operation-budget',
    phase: stage,
    error: `symbolic operation budget exhausted during ${stage}`,
    budget: { used: budget.used, limit: budget.limit },
  };
}

/**
 * Expose canonical descriptors in the flat shape used by legacy report and
 * numeric-oracle boundaries.
 */
export function adaptPrimitiveDescriptor(primitive, options = {}) {
  if (!primitive || typeof primitive !== 'object') throw new TypeError('primitive is required');
  const ops = validateMnaOps(options.ops || numberOps());
  const terminals = primitiveTerminals(primitive);
  const value = resolveValue(primitive.value, primitive, options, ops);
  const s = scalar(firstDefined(options.s, options.sValue, options.frequency, ops.one), ops);
  const base = { ...primitive };
  if (!base.component && primitive.metadata?.component) base.component = primitive.metadata.component;
  if (!base.parameter && typeof primitive.value === 'string') base.parameter = primitive.value;
  if (!base.controlExpression && primitive.metadata?.controlExpression) {
    base.controlExpression = primitive.metadata.controlExpression;
  }
  delete base.terminals;
  if (primitive.kind === 'vccs') {
    return {
      ...base,
      kind: 'vccs',
      outPlus: terminals.a,
      outMinus: terminals.b,
      controlPlus: terminals.controlPlus,
      controlMinus: terminals.controlMinus,
      gm: value,
      value,
    };
  }
  if (primitive.kind === 'voltage-source') {
    return {
      ...base,
      kind: 'voltage-source',
      a: terminals.a,
      b: terminals.b,
      voltage: value,
      value,
    };
  }
  if (primitive.kind === 'current-source') {
    return {
      ...base,
      kind: 'current-source',
      a: terminals.a,
      b: terminals.b,
      current: value,
      value,
    };
  }
  if (primitive.kind === 'inductor') {
    const inductance = value;
    return {
      ...base,
      kind: 'inductor',
      a: terminals.a,
      b: terminals.b,
      inductance,
      impedance: ops.mul(s, inductance),
      value: inductance,
    };
  }
  if (primitive.kind === 'capacitor') {
    const capacitance = value;
    return {
      ...base,
      kind: 'capacitor',
      a: terminals.a,
      b: terminals.b,
      capacitance,
      admittance: ops.mul(s, capacitance),
      value: capacitance,
    };
  }
  if (primitive.kind === 'resistor' || primitive.kind === 'conductance'
      || primitive.kind === 'admittance' || primitive.kind === 'impedance') {
    return {
      ...base,
      kind: primitive.kind,
      a: terminals.a,
      b: terminals.b,
      value,
      ...(primitive.kind === 'resistor' ? { resistance: value } : { admittance: value }),
    };
  }
  return { ...base, a: terminals.a, b: terminals.b, value };
}

export function adaptPrimitiveDescriptors(primitives = [], options = {}) {
  return primitives.map((primitive) => adaptPrimitiveDescriptor(primitive, options));
}

function graphDescriptor(primitive) {
  if (primitive.kind !== 'voltage-source') return primitive;
  // A zero-valued independent voltage source is an AC short. graph.js keeps
  // voltage-source elements as boundaries, so expose the short only to the
  // relevance walk; the original descriptor remains in the MNA system.
  return { ...primitive, kind: 'resistor' };
}

/** Build the strict MNA view from the strict device primitive schema. */
function toMnaPrimitive(primitive, options, ops) {
  const value = resolveValue(primitive.value, primitive, options, ops);
  const terminals = primitive.terminals;
  if (terminals?.a === undefined || terminals?.b === undefined) {
    throw new TypeError(`${primitive.id} must have terminals.a and terminals.b`);
  }
  const s = options.s ?? ops.one;
  if (primitive.kind === 'capacitor') {
    return { ...primitive, kind: 'capacitor', id: primitive.id, terminals, value: ops.mul(s, value) };
  }
  if (primitive.kind === 'inductor') {
    return { ...primitive, kind: 'inductor', id: primitive.id, terminals, value: ops.mul(s, value) };
  }
  if (primitive.kind === 'vccs') {
    if (primitive.control?.a === undefined || primitive.control?.b === undefined) {
      throw new TypeError(`${primitive.id} must have control.a and control.b`);
    }
    return { ...primitive, kind: 'vccs', id: primitive.id, terminals, value, control: primitive.control };
  }
  return { ...primitive, kind: primitive.kind, id: primitive.id, terminals, value };
}

function toMnaPrimitives(primitives, options, ops) {
  return primitives.map((primitive) => toMnaPrimitive(primitive, options, ops));
}

export { toMnaPrimitive, toMnaPrimitives };

function uniqueName(base, primitives) {
  const used = new Set(primitives.map((primitive) => String(
    primitive.name || primitive.branch || primitive.refdes || primitive.id || '',
  )));
  if (!used.has(base)) return base;
  for (let index = 2; ; index++) {
    const candidate = `${base}-${index}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Create the two compatible RHS excitations used by all three port queries. */
export function createTestExcitations(context, primitives = [], options = {}) {
  if (!context?.input?.node || !context?.output?.node) {
    throw new TypeError('analysis context must contain input and output nodes');
  }
  const ops = validateMnaOps(options.ops || numberOps());
  const inputName = uniqueName(INPUT_SOURCE, primitives);
  const outputName = uniqueName(OUTPUT_SOURCE, primitives);
  return {
    rhsCount: 2,
    input: {
      kind: 'voltage-source',
      name: inputName,
      id: inputName,
      terminals: { a: context.input.node, b: AC_GROUND },
      value: [ops.one, ops.zero],
    },
    output: {
      kind: 'current-source',
      name: outputName,
      id: outputName,
      // Positive current is injected into the output node for Zout.
      terminals: { a: AC_GROUND, b: context.output.node },
      value: [ops.zero, ops.one],
    },
  };
}

function solutionValue(solution, variable, column) {
  const index = solution.variables.indexOf(variable);
  return index < 0 ? undefined : solution.columns[column][index];
}

function queryValues(solution, system, context, excitations, ops) {
  const inputVoltage = solutionValue(solution, `V(${context.input.node})`, 0);
  const outputVoltage = solutionValue(solution, `V(${context.output.node})`, 0);
  const outputTestVoltage = solutionValue(solution, `V(${context.output.node})`, 1);
  const inputSourceCurrent = solutionValue(solution, `I(${excitations.input.name})`, 0);
  const zeroedInputCurrent = solutionValue(solution, `I(${excitations.input.name})`, 1);
  const inputCurrent = ops.neg(inputSourceCurrent);
  const testCurrent = ops.one;
  return {
    transfer: {
      value: queryDivide(outputVoltage, inputVoltage, ops),
      inputVoltage,
      outputVoltage,
      column: 0,
    },
    inputImpedance: {
      value: queryDivide(inputVoltage, inputCurrent, ops),
      voltage: inputVoltage,
      current: inputCurrent,
      sourceCurrent: inputSourceCurrent,
      column: 0,
    },
    outputImpedance: {
      value: queryDivide(outputTestVoltage, testCurrent, ops),
      voltage: outputTestVoltage,
      current: testCurrent,
      inputSourceCurrent: zeroedInputCurrent,
      column: 1,
    },
    unknowns: new Map(solution.variables.map((name, index) => [name, solution.columns.map((column) => column[index])])),
    systemUnknowns: [...system.unknowns],
  };
}

/**
 * When `node` is an articulation point of the coupled small-signal graph
 * (see `splitAtNode`), the impedance looking into it is provably the
 * parallel combination of each independent branch's own impedance, solved
 * on a much smaller system. `zeroedVoltageSourceNode` treats the other
 * port's zeroed *voltage* source as an AC-ground boundary in every branch;
 * a zeroed *current* source needs no replica since an absent branch already
 * behaves as the open circuit it represents. Returns `null` (never throws)
 * whenever the graph isn't separable or any sub-solve fails. Direct shunts
 * are solved alongside the branches; raw exact query values stay unchanged.
 */
function trySplitImpedance(node, { selectedMna, context, ops, zeroedVoltageSourceNode }) {
  // The imposed input voltage is ground for an output-impedance query.
  // Treat it as a boundary in the topology too; otherwise a shared gate
  // incorrectly glues independent output branches together.
  const grounds = new Set([AC_GROUND, ...context.acGroundIds, ...(zeroedVoltageSourceNode ? [zeroedVoltageSourceNode] : [])]);
  const canonical = (node) => grounds.has(node) ? AC_GROUND : context.nodeAliases.get(node) || node;
  selectedMna = selectedMna.filter((primitive) => primitive.kind !== 'vccs'
    || canonical(primitive.control.a) !== canonical(primitive.control.b));
  let split;
  try {
    split = splitAtNode(selectedMna, node, {
      acGroundIds: grounds,
      nodeAliases: context.nodeAliases,
      includeShunts: true,
    });
  } catch {
    return null;
  }
  if (!split) return null;

  const pieces = [];
  for (const component of [...split.components, ...split.shunts.map((index) => ({ primitiveIndices: [index] }))]) {
    const elements = component.primitiveIndices.map((index) => selectedMna[index]);
    const testId = uniqueName('@analysis-split-test', elements);
    const branchElements = [...elements, {
      kind: 'current-source', id: testId, name: testId,
      terminals: { a: AC_GROUND, b: node }, value: ops.one,
    }];
    let system;
    let solution;
    try {
      system = buildMNA(branchElements, { ops, ground: AC_GROUND, grounds: [...grounds] });
      solution = solveMNA(system, { ops });
    } catch {
      return null;
    }
    if (!solution.ok) return null;
    const voltage = solutionValue(solution, `V(${node})`, 0);
    if (voltage === undefined) return null;
    pieces.push(compactRational(queryDivide(voltage, ops.one, ops), ops));
  }
  if (pieces.length < 2) return null;

  let combined;
  try {
    combined = pieces.reduce((left, right) => (
      left === null ? right : queryDivide(ops.mul(left, right), ops.add(left, right), ops)
    ), null);
  } catch {
    return null;
  }
  if (!combined || combined.kind !== 'rational' || combined.budgetExceeded) return null;
  return { value: combined, equivalence: provenParallel(combined, ...pieces) };
}

/**
 * General series/parallel pre-reduction of the coupled network (`reduce.js`),
 * never eliminating the input/output query nodes. A human reduces a load or
 * feedback network to `Z1 \| Z2`/`Z1+Z2` by hand before writing KCL for
 * whatever remains; this is that same step. Numeric-only callers (no `ops.s`)
 * and `networkReduction: false` skip it; a network that doesn't reduce is
 * returned unchanged, never an error.
 */
function reduceSelectedNetwork(primitives, context, options, ops) {
  if (options.networkReduction === false || typeof ops.s !== 'function') {
    return { primitives, proofs: [] };
  }
  const resolved = primitives.map((primitive) => ({ ...primitive, value: resolveValue(primitive.value, primitive, options, ops) }));
  try {
    return reduceNetwork(resolved, [context.input.node, context.output.node], ops);
  } catch {
    return { primitives, proofs: [] };
  }
}

function failure(stage, error, details = {}) {
  return {
    ok: false,
    stage,
    error: error?.message || String(error),
    diagnostics: details.diagnostics || [],
    ...details,
  };
}

/**
 * Run the exact numeric/symbolic v2 pipeline. The returned values are raw
 * solved query values; reduction, assumptions, and presentation belong later.
 */
export function buildExactAnalysisPipeline(circuit, options = {}) {
  if (!circuit) throw new TypeError('circuit is required');
  const ops = validateMnaOps(options.ops || numberOps());
  const context = resolveAnalysisContext(circuit, options);
  if (!context.ok) return failure('context', context.error, { context, diagnostics: context.diagnostics.errors });

  const converted = convertCircuitToPrimitives(circuit, context);
  if (!converted.ok) return failure('devices', converted.diagnostics.map(({ message }) => message).join('; '), {
    context,
    conversion: converted,
    diagnostics: converted.diagnostics,
  });

  const miller = options.millerApproximation === false
    ? { primitives: converted.primitives, applied: [] }
    : applyMillerApproximation(converted.primitives, context, options, ops);
  const exactPrimitives = miller.primitives;
  let mnaPrimitives;
  try {
    mnaPrimitives = toMnaPrimitives(exactPrimitives, { ...options, s: options.s ?? ops.one }, ops);
  } catch (error) {
    return failure('mna', error, { context, conversion: converted, primitives: exactPrimitives });
  }
  const primitiveBudget = budgetFailure(ops, 'primitive conversion');
  if (primitiveBudget) return failure('budget', primitiveBudget.error, primitiveBudget);
  const graphInput = mnaPrimitives.map(graphDescriptor);
  const coupled = coupledSubgraph(graphInput, [context.input.node, context.output.node], {
    acGroundIds: context.acGroundIds,
    nodeAliases: context.nodeAliases,
  });
  if (coupled.diagnostics.length) return failure('graph', coupled.diagnostics.map(({ message }) => message).join('; '), {
    context, conversion: converted, primitives: exactPrimitives, mnaPrimitives, coupled, diagnostics: coupled.diagnostics,
  });

  const selectedExactUnreduced = coupled.primitiveIndices.map((index) => exactPrimitives[index]);
  const reduction = reduceSelectedNetwork(selectedExactUnreduced, context, options, ops);
  const selectedExact = reduction.primitives;
  let selectedMna;
  try {
    selectedMna = toMnaPrimitives(selectedExact, { ...options, s: options.s ?? ops.one }, ops);
  } catch (error) {
    return failure('mna', error, { context, conversion: converted, primitives: exactPrimitives, mnaPrimitives, coupled });
  }
  // `selected` feeds the read-only audit netlist, which must stay the full,
  // unreduced device-level model (AGENTS.md) — reduction is an internal
  // solve-path optimization only, invisible here.
  const selected = adaptPrimitiveDescriptors(selectedExactUnreduced, { ...options, ops });
  const descriptorBudget = budgetFailure(ops, 'descriptor adaptation');
  if (descriptorBudget) return failure('budget', descriptorBudget.error, descriptorBudget);
  const excitations = createTestExcitations(context, selected, { ops });
  const elements = [...selectedMna, excitations.input, excitations.output];
  const nodeOrder = coupled.nodeOrder.filter((node) => elements.some((element) => (
    element.terminals?.a === node || element.terminals?.b === node
    || element.control?.a === node || element.control?.b === node
  )));
  let system;
  try {
    system = buildMNA(elements, {
      ops,
      rhsCount: excitations.rhsCount,
      nodes: nodeOrder,
      ground: AC_GROUND,
      grounds: [...context.acGroundIds],
    });
  } catch (error) {
    return failure('mna', error, {
      context, conversion: converted, primitives: exactPrimitives, mnaPrimitives, coupled, selected, selectedExact, selectedMna, excitations,
    });
  }
  const mnaBudget = budgetFailure(ops, 'MNA construction');
  if (mnaBudget) return failure('budget', mnaBudget.error, mnaBudget);

  const solution = (options.topologicalSolve === false ? null : solveByTopology(system, excitations, context, ops, {
    splitBranches: selectedMna.some((primitive) => primitive.kind === 'vccs'),
  }))
    || solveMNA(system, { ops });
  if (solution.code === 'operation-budget' || solution.code === 'solver-work-limit' || solution.code === 'matrix-size-limit') {
    return failure('budget', solution.error, {
      ...solution,
      context, conversion: converted, primitives: exactPrimitives, mnaPrimitives, coupled, selected, selectedExact, selectedMna, excitations, system, solution,
    });
  }
  if (!solution.ok) return failure('solve', solution.error, {
    context, conversion: converted, primitives: exactPrimitives, mnaPrimitives, coupled, selected, selectedExact, selectedMna, excitations, system, solution,
  });
  const solveBudget = budgetFailure(ops, 'exact solve');
  if (solveBudget) return failure('budget', solveBudget.error, {
    context, conversion: converted, primitives: exactPrimitives, mnaPrimitives, coupled, selected, selectedExact, selectedMna, excitations, system, solution,
    ...solveBudget,
  });
  return {
    ok: true,
    context,
    conversion: converted,
    primitives: adaptPrimitiveDescriptors(exactPrimitives, { ...options, ops }),
    exactPrimitives,
    mnaPrimitives,
    millerSubstitutions: miller.applied,
    retainedFeedbackNetworks: miller.retained || [],
    networkReductionProofs: reduction.proofs,
    coupled,
    selected,
    selectedExact,
    selectedMna,
    excitations,
    system,
    solution,
    queries: refineSeparableQueries(
      queryValues(solution, system, context, excitations, ops),
      { selectedMna, context, ops },
    ),
  };
}

/**
 * Try the articulation-point split (see `trySplitImpedance`) for Zin and
 * Zout independently. Each records a proven parallel display and a compact
 * branch value without replacing the original exact query. A failed or
 * inapplicable split leaves that query alone.
 */
function refineSeparableQueries(queries, solveContext) {
  const { context } = solveContext;
  if (typeof solveContext.ops.s === 'function') solveContext = {
    ...solveContext,
    ops: createRationalOps({ variable: solveContext.ops.variable || 's', maxOperations: 12000 }),
  };
  const outputSplit = trySplitImpedance(context.output.node, {
    ...solveContext,
    zeroedVoltageSourceNode: context.input.node,
  });
  if (outputSplit) queries.outputImpedance = { ...queries.outputImpedance, branchValue: outputSplit.value,
    equivalence: provenParallel(queries.outputImpedance.value, ...outputSplit.equivalence.operands) };
  const inputSplit = trySplitImpedance(context.input.node, solveContext);
  if (inputSplit) queries.inputImpedance = { ...queries.inputImpedance, branchValue: inputSplit.value,
    equivalence: provenParallel(queries.inputImpedance.value, ...inputSplit.equivalence.operands) };
  return queries;
}
