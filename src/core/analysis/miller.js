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
 * reaches `buildMNA`.
 */
import { AC_GROUND } from './context.js';
import { isReduciblePassive, reduceTwoTerminalNetwork } from './reduce.js';
import { buildMNA } from './mna.js';
import { coupledSubgraph } from './graph.js';
import { solveMNA } from './solve.js';
import { resolveValue, toMnaPrimitives } from './pipeline.js';

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
  return foundDrain ? collected : null;
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
  const resolved = coupled.primitives.map((primitive) => resolvedCopy(primitive, options, ops));
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
    solution = solveMNA(system, { ops });
  } catch {
    return null;
  }
  if (!solution.ok) return null;
  const index = solution.variables.indexOf(`V(${drain})`);
  if (index < 0) return null;
  return solution.columns[0][index];
}

/**
 * Detect and substitute every gate/drain Miller bridge in `primitives`.
 * Returns `{ primitives, applied }`: a (possibly unchanged) primitive list
 * and the list of `{ device, gate, drain }` bridges actually replaced.
 * Never throws — any device whose bridge doesn't cleanly reduce, or whose
 * local gain can't be solved, is left with its exact primitives untouched.
 */
export function applyMillerApproximation(primitives, context, options, ops) {
  if (typeof ops.s !== 'function') return { primitives, applied: [] };
  let current = primitives;
  const applied = [];
  for (const branch of findGmBranches(primitives)) {
    const gate = branch.control.a;
    const drain = branch.terminals.a;
    const device = branch.metadata?.component;
    const bridge = collectBridgeCandidates(current, gate, drain);
    if (!bridge || !bridge.length) continue;
    if (!bridgeIsPrivate(bridge, current, gate, drain)) continue;

    const resolvedBridge = bridge.map((primitive) => resolvedCopy(primitive, options, ops));
    const reduced = reduceTwoTerminalNetwork(resolvedBridge, gate, drain, ops);
    if (!reduced.ok) continue;

    const gain = localGain(current, bridge, gate, drain, context, options, ops);
    if (gain === null) continue;
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
    const gateShunt = {
      kind: 'admittance', id: `${device}.miller-gate`,
      terminals: { a: gate, b: AC_GROUND }, value: gateAdmittance,
      metadata: { component: device, millerBridge: true },
    };
    const drainShunt = {
      kind: 'admittance', id: `${device}.miller-drain`,
      terminals: { a: drain, b: AC_GROUND }, value: drainAdmittance,
      metadata: { component: device, millerBridge: true },
    };
    current = [...withoutBridge, gateShunt, drainShunt];
    applied.push({ device, gate, drain });
  }
  return { primitives: current, applied };
}
