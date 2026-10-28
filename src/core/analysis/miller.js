/**
 * Miller approximation, applied as a pre-solve modeling transform.
 *
 * A feedback network (any series/parallel combination of R/L/C — most
 * commonly a single `C_gd`) bridging a gain device's gate and drain makes
 * the exact solve's symbolic determinant blow up, because it couples the
 * input and output sides directly. A circuit designer instead collapses the
 * bridge to one equivalent impedance `Z_fb`, finds the stage's own
 * (resistive) gain `A_v` across it with the bridge open, and replaces it
 * with two decoupled shunt impedances: `Z_fb/(1-A_v)` at the gate and
 * `Z_fb/(1-1/A_v)` at the drain. This module finds that bridge from the
 * primitive graph and performs exactly that substitution before anything
 * reaches `buildMNA`, provided the bridge opens at DC. Conducting feedback
 * remains in MNA to preserve DC loading and feedthrough.
 */
import { AC_GROUND } from './context.js';
import { isReduciblePassive, reduceTwoTerminalNetwork } from './reduce.js';
import { buildMNA } from './mna.js';
import { coupledSubgraph } from './graph.js';
import { solveMNA } from './solve.js';
import { resolveValue, toMnaPrimitives } from './pipeline.js';
import { compactRational } from './compact.js';
import { integer, substituteRational } from './rational.js';

function findGmBranches(primitives) {
  return primitives.filter((primitive) => primitive.kind === 'vccs' && String(primitive.id || '').endsWith('.gm'));
}

/** Passive-only primitives reachable from `gate` without crossing ground or reaching past `drain`. */
function collectBridgeCandidates(primitives, gate, drain) {
  const visited = new Set([gate]);
  const queue = [gate];
  const collected = [];
  let foundDrain = false;
  while (queue.length) {
    const node = queue.shift();
    for (const primitive of primitives) {
      if (!isReduciblePassive(primitive)) continue;
      const { a, b } = primitive.terminals;
      if (a !== node && b !== node) continue;
      const other = a === node ? b : a;
      if (other === AC_GROUND) continue;
      if (collected.includes(primitive)) continue;
      collected.push(primitive);
      if (other === drain) {
        foundDrain = true;
        continue;
      }
      if (!visited.has(other)) {
        visited.add(other);
        queue.push(other);
      }
    }
  }
  if (!foundDrain) return null;
  // Only what lies between gate and drain: a branch that leads off to a
  // dead end (a gate's series input resistor, its other end the input) is
  // no part of the bridge.
  let bridge = collected;
  for (let pruned = true; pruned;) {
    pruned = false;
    const degree = new Map();
    for (const { terminals: { a, b } } of bridge) for (const node of [a, b]) degree.set(node, (degree.get(node) || 0) + 1);
    const deadEnd = (node) => node !== gate && node !== drain && degree.get(node) === 1;
    const kept = bridge.filter(({ terminals: { a, b } }) => !deadEnd(a) && !deadEnd(b));
    if (kept.length < bridge.length) { bridge = kept; pruned = true; }
  }
  return bridge.length ? bridge : null;
}

/** Every internal node of `bridge` must be touched only by primitives inside it. */
function bridgeIsPrivate(bridge, allPrimitives, gate, drain) {
  const internalNodes = new Set();
  for (const primitive of bridge) {
    for (const node of [primitive.terminals.a, primitive.terminals.b]) {
      if (node !== gate && node !== drain && node !== AC_GROUND) internalNodes.add(node);
    }
  }
  for (const primitive of allPrimitives) {
    if (bridge.includes(primitive)) continue;
    const touches = [primitive.terminals?.a, primitive.terminals?.b, primitive.control?.a, primitive.control?.b];
    if (touches.some((node) => internalNodes.has(node))) return false;
  }
  return true;
}

function resolvedCopy(primitive, options, ops) {
  return { ...primitive, value: resolveValue(primitive.value, primitive, options, ops) };
}

/** Local DC (s=0) voltage gain from `gate` to `drain` with the bridge removed. */
function localGain(primitives, bridge, gate, drain, context, options, ops) {
  const withoutBridge = primitives.filter((primitive) => !bridge.includes(primitive));
  const coupled = coupledSubgraph(withoutBridge, [gate, drain], {
    acGroundIds: context.acGroundIds,
    nodeAliases: context.nodeAliases,
  });
  if (coupled.diagnostics.length) return null;
  // The gate is held by the test source: what hangs off it alone (a series
  // input resistor) cannot change the gain, and is left out so the gain
  // carries none of its symbols. Kept: what the drain side reaches without
  // passing the gate, and the transconductances it reads.
  const reached = new Set([drain]);
  for (let grew = true; grew;) {
    grew = false;
    for (const primitive of coupled.primitives) {
      const { a, b } = primitive.terminals || {};
      for (const [from, to] of [[a, b], [b, a]]) {
        if (reached.has(from) && to !== gate && to !== AC_GROUND && to !== undefined && !reached.has(to)) { reached.add(to); grew = true; }
      }
    }
  }
  const drainSide = coupled.primitives.filter((primitive) => [primitive.terminals?.a, primitive.terminals?.b].some((node) => reached.has(node)));
  const resolved = drainSide.map((primitive) => resolvedCopy(primitive, options, ops));
  let mnaPrimitives;
  try {
    mnaPrimitives = toMnaPrimitives(resolved, { ...options, s: ops.zero }, ops);
  } catch {
    return null;
  }
  const testId = '@miller-gain-test';
  const excitation = {
    kind: 'voltage-source', id: testId, name: testId,
    terminals: { a: gate, b: AC_GROUND }, value: ops.one,
  };
  let system;
  let solution;
  try {
    system = buildMNA([...mnaPrimitives, excitation], { ops, ground: AC_GROUND, grounds: [...context.acGroundIds] });
    const outputRow = system.unknowns.indexOf(`V(${drain})`);
    system.B = system.B.map((row, index) => [row[0], index === outputRow ? ops.one : ops.zero]);
    solution = solveMNA(system, { ops });
  } catch {
    return null;
  }
  if (!solution.ok) return null;
  const index = solution.variables.indexOf(`V(${drain})`);
  if (index < 0) return null;
  try {
    const gain = compactRational(solution.columns[0][index], ops);
    const outputImpedance = compactRational(solution.columns[1][index], ops);
    if (ops.isZero(gain) || ops.isZero(outputImpedance)) return null;
    const loadOperands = resolved.flatMap((primitive) => {
      const { a, b } = primitive.terminals;
      const grounded = (node) => node === AC_GROUND || node === gate;
      if (!((a === drain && grounded(b)) || (b === drain && grounded(a)))) return [];
      if (primitive.kind === 'resistor') return [primitive.value];
      if ((primitive.kind === 'conductance' || primitive.kind === 'admittance') && !ops.isZero(primitive.value)) return [ops.div(ops.one, primitive.value)];
      return [];
    });
    return { gain, outputImpedance, transadmittance: compactRational(ops.div(gain, outputImpedance), ops), loadOperands };
  } catch { return null; }
}

/** Whether `value` mentions the symbol `name`. */
function mentions(value, name) {
  if (!value || typeof value !== 'object') return false;
  if (value.kind === 'symbol') return value.name === name;
  return ['terms', 'factors'].some((key) => (value[key] || []).some((item) => mentions(item, name)))
    || ['base', 'numerator', 'denominator'].some((key) => mentions(value[key], name));
}

/**
 * One Miller shunt to AC ground. A shunt that is a capacitance (its
 * admittance over s leaves no s) enters the solve as `s C_{M1,in}`, the
 * symbol the model figure names it by, with its value kept beside it
 * (`metadata.millerCapacitance`): the equations then read in the figure's
 * terms, and substituting the value back gives the same result exactly,
 * since the shunt is linear in it. Any other shunt keeps its admittance.
 */
function millerShunt(id, node, admittance, metadata, ops) {
  const shunt = { kind: 'admittance', id, terminals: { a: node, b: AC_GROUND }, value: admittance, metadata };
  let capacitance;
  try { capacitance = compactRational(ops.div(admittance, ops.s()), ops); }
  catch { return shunt; }
  if (ops.isZero(capacitance) || mentions(capacitance, ops.variable || 's')) return shunt;
  const name = `C_{${metadata.component || 'M'},${metadata.millerSide === 'output' ? 'out' : 'in'}}`;
  return {
    ...shunt,
    value: ops.mul(ops.s(), ops.symbol(name)),
    metadata: { ...metadata, millerSymbol: name, millerCapacitance: capacitance },
  };
}

/**
 * Detect and substitute every gate/drain Miller bridge in `primitives`.
 * Returns `{ primitives, applied, retained }`: a (possibly unchanged) primitive list
 * and the list of `{ device, gate, drain }` bridges actually replaced.
 * Never throws — any device whose bridge doesn't cleanly reduce, or whose
 * local gain can't be solved, is left with its exact primitives untouched.
 */
export function applyMillerApproximation(primitives, context, options, ops) {
  if (typeof ops.s !== 'function') return { primitives, applied: [], retained: [] };
  let current = primitives;
  const applied = [];
  const retained = [];
  const visitedBridges = new Set();
  for (const branch of findGmBranches(primitives)) {
    const gate = branch.control.a;
    const drain = branch.terminals.a;
    const device = branch.metadata?.component;
    const bridge = collectBridgeCandidates(current, gate, drain);
    if (!bridge || !bridge.length) continue;
    if (!bridgeIsPrivate(bridge, current, gate, drain)) continue;
    const bridgeKey = bridge.map((primitive) => primitive.id).sort().join('|');
    if (visitedBridges.has(bridgeKey)) continue;
    visitedBridges.add(bridgeKey);

    const resolvedBridge = bridge.map((primitive) => resolvedCopy(primitive, options, ops));
    const reduced = reduceTwoTerminalNetwork(resolvedBridge, gate, drain, ops);
    if (!reduced.ok) continue;

    const local = localGain(current, bridge, gate, drain, context, options, ops);
    if (local === null) continue;
    const { gain } = local;
    const feedbackComponents = [...new Set(bridge.map((primitive) => primitive.metadata?.component || primitive.id))];
    // The bridge's own element kinds: a drawing of the model needs them to
    // know that a capacitive bridge becomes a Miller capacitance.
    const feedbackKinds = [...new Set(bridge.map((primitive) => String(primitive.kind || '').toLowerCase()))];
    // A bridge-open DC gain is appropriate only when the bridge actually
    // opens at DC. Conducting feedback changes that gain and carries direct
    // feedthrough; retain it in MNA instead of silently assuming weak loading.
    let opensAtDC = false;
    try {
      const dc = substituteRational(ops.div(ops.one, reduced.impedance), new Map([[ops.variable || 's', integer(0)]]));
      opensAtDC = ops.isZero(dc);
    } catch { /* a short or singular DC bridge is retained */ }
    if (!opensAtDC) {
      retained.push({ device, gate, drain, ...local, feedbackComponents, feedbackImpedance: reduced.impedance });
      continue;
    }
    let gateAdmittance;
    let drainAdmittance;
    try {
      gateAdmittance = ops.div(ops.sub(ops.one, gain), reduced.impedance);
      drainAdmittance = ops.div(ops.sub(ops.one, ops.div(ops.one, gain)), reduced.impedance);
    } catch {
      continue;
    }
    if (ops.isZero(gateAdmittance) && ops.isZero(drainAdmittance)) continue;

    const withoutBridge = current.filter((primitive) => !bridge.includes(primitive));
    const metadata = { component: device, millerBridge: true, feedbackComponents, feedbackKinds, gate, drain, gain, feedbackImpedance: reduced.impedance };
    const gateShunt = millerShunt(`${device}.miller-gate`, gate, gateAdmittance, { ...metadata, millerSide: 'input' }, ops);
    const drainShunt = millerShunt(`${device}.miller-drain`, drain, drainAdmittance, { ...metadata, millerSide: 'output' }, ops);
    current = [...withoutBridge, gateShunt, drainShunt];
    applied.push({ device, gate, drain, ...local, feedbackComponents, feedbackImpedance: reduced.impedance });
  }
  return { primitives: current, applied, retained };
}
