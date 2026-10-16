/**
 * Loop gain of a circuit as a return ratio (Bode, Rosenstark): break the
 * loop at its active element -- an opamp, or a transistor's g_m -- by
 * driving the element's output from a unit test source, every independent
 * source at zero (the input shorted), and read what returns to the
 * element's control:
 *
 *   opamp:      v_out = A v_d -> a test voltage at its output gives v_d;
 *               beta = -v_d / v_t (the feedback factor), T = A beta.
 *   transistor: i_d = g_m v_gs -> a test current in its place gives v_gs;
 *               T = -g_m v_gs / i_t.
 *
 * Exact, in the analysis's own model, with no loading to approximate. An
 * ideal opamp's T is infinite: its feedback factor stands in, T = A beta.
 */

import { buildMNA } from './mna.js';
import { solveMNA } from './solve.js';
import { AC_GROUND } from './context.js';

/** The parts a circuit's loop can be broken at: opamps and transistors. */
export const LOOP_ELEMENT_TYPES = new Set(['opamp', 'opamp_diff', 'opamp_diff_cmfb', 'nmos', 'pmos', 'nmosb', 'pmosb']);

/**
 * `pipeline` a built exact pipeline (no Miller splitting: it removes the
 * feedback being measured), `element` a refdes. Returns `{ ok, kind:
 * 'opamp' | 'transistor', model, loop (T, or null when infinite), beta
 * (an opamp's feedback factor) }` or a failure.
 */
export function returnRatio(pipeline, element, ops) {
  const primitives = pipeline.selectedMna || [];
  const opamp = primitives.find((p) => p.kind === 'opamp' && p.metadata?.component === element);
  const gm = primitives.find((p) => p.kind === 'vccs' && p.id === `${element}.gm`);
  const target = opamp || gm;
  if (!target) return { ok: false, code: 'not-in-loop', error: `${element} is not in the analysed circuit: pick an opamp or a transistor on the signal path` };
  // The element's output from a unit test source; the input's source at zero.
  const test = opamp
    ? { kind: 'voltage-source', id: '@loop-test', terminals: target.terminals, value: ops.one }
    : { kind: 'current-source', id: '@loop-test', terminals: target.terminals, value: ops.one };
  const input = { ...pipeline.excitations.input, value: ops.zero };
  const elements = [...primitives.filter((p) => p !== target), input, test];
  let solution;
  let system;
  try {
    system = buildMNA(elements, { ops, ground: AC_GROUND, grounds: [...pipeline.context.acGroundIds] });
    solution = solveMNA(system, { ops });
  } catch (error) {
    return { ok: false, code: 'loop-solve', error: `the loop broken at ${element} does not solve: ${error.message}` };
  }
  if (!solution.ok) {
    // A node left with no conduction once the element's own branch is gone.
    if (/singular|pivot/i.test(solution.error || '')) {
      return { ok: false, code: 'loop-floating', error: `breaking the loop at ${element} leaves a node with no path to AC ground (its only conduction was ${element} itself): break it at another device, or keep r_o finite` };
    }
    return { ok: false, code: 'loop-solve', error: solution.error || 'the broken loop does not solve' };
  }
  const voltage = (node) => {
    if (node === undefined || node === null || node === AC_GROUND || pipeline.context.acGroundIds.has(node)) return ops.zero;
    const index = solution.variables.indexOf(`V(${node})`);
    return index < 0 ? ops.zero : solution.columns[0][index];
  };
  const control = ops.sub(voltage(target.control.a), voltage(target.control.b));
  if (opamp) {
    const beta = ops.neg(control);
    const model = target.metadata?.opampModel || 'ideal';
    // The MNA value is the inverse gain: T = A beta = beta / (1/A).
    const loop = model === 'ideal' ? null : ops.div(beta, target.value);
    return { ok: true, kind: 'opamp', model, loop, beta };
  }
  return { ok: true, kind: 'transistor', model: null, loop: ops.neg(ops.mul(target.value, control)), beta: null };
}

/**
 * The closed-loop voltage gain split at the element the loop is broken at
 * (Middlebrook's general feedback theorem, the asymptotic gain model):
 *
 *   A_v = A_v_inf T / (1 + T) + A_v0 / (1 + T)
 *
 * with T the return ratio at the same element (returnRatio). A_v_inf, the
 * ideal gain, is A_v with the element's gain infinite: its control held at
 * zero, its output whatever that takes (a nullor). A_v0, the direct
 * feedthrough, is A_v with its gain zero: a transistor's g_m gone, an
 * opamp's output at zero. Both are exact in the same model as T, and the
 * identity holds exactly. Returns `{ ok, ideal, direct, gain }` (`gain` the
 * closed loop in this model, to check the identity against), or a failure;
 * an ideal opamp has nothing to split (its T is infinite, A_v = A_v_inf).
 */
export function feedbackParts(pipeline, element, ops) {
  const primitives = pipeline.selectedMna || [];
  const opamp = primitives.find((p) => p.kind === 'opamp' && p.metadata?.component === element);
  const gm = primitives.find((p) => p.kind === 'vccs' && p.id === `${element}.gm`);
  const target = opamp || gm;
  if (!target) return { ok: false, error: `${element} is not in the analysed circuit` };
  if (opamp && ops.isZero(opamp.value)) return { ok: false, error: 'an ideal opamp\'s loop gain is infinite: A_v is its ideal gain' };
  const input = { ...pipeline.excitations.input, value: ops.one };
  const others = primitives.filter((p) => p !== target);
  const nullor = { kind: 'opamp', id: `${target.id}@ideal`, terminals: target.terminals, control: target.control, value: ops.zero };
  const dead = opamp ? [{ kind: 'voltage-source', id: `${target.id}@dead`, terminals: target.terminals, value: ops.zero }] : [];
  const gainOf = (elements, what) => {
    const system = buildMNA([...elements, input], { ops, ground: AC_GROUND, grounds: [...pipeline.context.acGroundIds] });
    const solution = solveMNA(system, { ops });
    if (!solution.ok) throw new Error(`${what} does not solve: ${solution.error || 'singular'}`);
    const index = solution.variables.indexOf(`V(${pipeline.context.output.node})`);
    return index < 0 ? ops.zero : solution.columns[0][index];
  };
  try {
    return {
      ok: true,
      ideal: gainOf([...others, nullor], `the gain with ${element}'s control nulled`),
      direct: gainOf([...others, ...dead], `the gain with ${element}'s gain at zero`),
      gain: gainOf(primitives, 'the closed loop'),
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
