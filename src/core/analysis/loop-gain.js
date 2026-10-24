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
 *
 * Or the loop is broken where the drawing says (`resolveLoopBreak`): at a
 * terminal lifted off its net, at a net whose inputs are lifted off it, or
 * between two nets when the loop is not drawn closed. Then a test voltage
 * drives the lifted side (the drive net), every input at zero, and T =
 * -v(return)/v(drive).
 */

import { buildMNA } from './mna.js';
import { solveMNA } from './solve.js';
import { AC_GROUND } from './context.js';
import { Circuit, canonicalNetName } from '../model.js';

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
  if (!target) return { ok: false, code: 'not-in-loop', error: `${element} is not in the analyzed circuit: pick an opamp or a transistor on the signal path` };
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
  if (!target) return { ok: false, error: `${element} is not in the analyzed circuit` };
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

// ----- breaking the loop where the drawing says ----------------------------------

const MOS_TYPES = new Set(['nmos', 'pmos', 'nmosb', 'pmosb']);
const AMPLIFIER_TYPES = new Set(['opamp', 'opamp_diff', 'opamp_diff_cmfb', 'gm', 'gm_cmfb']);
/** The amplifiers a loop is broken at as a whole: T = A beta. */
const ELEMENT_TYPES = new Set(['opamp', 'opamp_diff', 'opamp_diff_cmfb']);

/** Whether `terminal` of `component` draws no current: a MOS gate (without
 *  its gate capacitances), an amplifier's input. */
function drawsNoCurrent(component, terminal, parasitics) {
  if (MOS_TYPES.has(component.type)) {
    if (terminal !== 'g') return false;
    const own = component.analysis?.parasitics;
    return own === 'omit' || (own !== 'include' && !parasitics);
  }
  return AMPLIFIER_TYPES.has(component.type) && (terminal === 'ip' || terminal === 'im');
}

/** The physical nets `name` is: by id, or every net of that name (a
 *  virtual connection is one node). */
function netsNamed(circuit, name) {
  const byId = circuit.nets.get(name);
  if (byId) return [byId];
  const key = canonicalNetName(name);
  return key ? [...circuit.nets.values()].filter((net) => canonicalNetName(net.name) === key) : [];
}

/** The parts on the design's output net (and every net of its name): the
 *  loads the Bode sketch's values make ten units. A broken loop is solved
 *  to its return net, but its loads are still the design's. */
export function outputParts(circuit, output) {
  return new Set((output ? netsNamed(circuit, output) : []).flatMap((net) => net.terminals.map((t) => t.comp)));
}

/** How a break point is written: `U1`, `M2.g`, `V_{out}`, `V_{fb} to V_{inn}`. */
export const LOOP_BREAK_HINT = 'an opamp (U1), a terminal (M2.g), the net that closes the loop (V_{out}), or two nets when it is not drawn closed (V_{fb} to V_{inn})';

/**
 * Where to break the loop, from what the user wrote (LOOP_BREAK_HINT):
 *
 * - an opamp: `{ ok, kind: 'element', element }` (returnRatio);
 * - a terminal: lifted off its net onto a drive net of its own; the net
 *   it was on is the return;
 * - a net: the inputs it feeds (MOS gates, amplifier inputs; every net of
 *   its name) lifted onto the drive net; it is the return;
 * - two nets, `return to drive` (the loop not drawn): as they are.
 *
 * A break is `{ ok, kind: 'break', circuit, drive, ret, label, loading }`:
 * the circuit to solve (a copy when something was lifted), the drive and
 * return nets' ids, and the parts on the drive side that draw current
 * (their loading of the return side is not in T). A failure says why.
 */
export function resolveLoopBreak(circuit, text, { parasitics = false } = {}) {
  const label = String(text ?? '').trim();
  const fail = (error) => ({ ok: false, error });
  if (!label) return fail(`say where to break the loop: ${LOOP_BREAK_HINT}`);
  const pair = label.match(/^(.+?)(?:\s*(?:->|→)\s*|\s+to\s+)(.+)$/);
  if (pair) {
    const [ret, drive] = [pair[1], pair[2]].map((name) => netsNamed(circuit, name.trim()));
    if (!ret.length) return fail(`no net named ${pair[1].trim()}`);
    if (!drive.length) return fail(`no net named ${pair[2].trim()}`);
    if (ret.some((net) => drive.includes(net))) return fail(`${pair[1].trim()} and ${pair[2].trim()} are one net: name the net once to break the loop there`);
    const loading = [];
    for (const net of drive) {
      for (const t of net.terminals) {
        const component = circuit.components.get(t.comp);
        // An input port there is where the loop's open input is driven
        // from: the test source takes its place, so it loads nothing.
        if (component && component.type !== 'input' && !drawsNoCurrent(component, t.term, parasitics)) loading.push(`${t.comp}.${t.term}`);
      }
    }
    // Nothing else drives it (gates and amplifier inputs only): the loop's
    // open input, held at AC ground in the open-loop analysis.
    return { ok: true, kind: 'break', circuit, drive: drive[0].id, ret: ret[0].id, label, loading, openInput: loading.length ? null : pair[2].trim() };
  }
  const component = circuit.components.get(label);
  if (component && ELEMENT_TYPES.has(component.type)) return { ok: true, kind: 'element', element: label };
  if (component && MOS_TYPES.has(component.type)) return fail(`${label} is a transistor: break the loop at one of its terminals, such as ${label}.g`);
  const dot = label.match(/^([^.\s]+)\.([A-Za-z0-9_]+)$/);
  const terminalPart = dot && circuit.components.get(dot[1]);
  if (terminalPart) {
    if (!terminalPart.def?.terminals?.some((t) => t.name === dot[2])) return fail(`${dot[1]} has no terminal ${dot[2]}`);
    const net = circuit.netOfTerminal({ comp: dot[1], term: dot[2] });
    if (!net) return fail(`${label} is not connected`);
    // Its net and every net of the same name: one node.
    const group = net.name ? netsNamed(circuit, net.name) : [net];
    return lift(circuit, group, [{ comp: dot[1], term: dot[2] }], label, parasitics);
  }
  const nets = netsNamed(circuit, label);
  if (!nets.length) return fail(component ? `${label} is a part: break the loop at ${LOOP_BREAK_HINT}` : `nothing named ${label}: break the loop at ${LOOP_BREAK_HINT}`);
  const lifted = [];
  for (const net of nets) {
    for (const t of net.terminals) {
      const part = circuit.components.get(t.comp);
      if (part && drawsNoCurrent(part, t.term, false)) lifted.push({ comp: t.comp, term: t.term });
    }
  }
  if (!lifted.length) {
    const first = nets.flatMap((net) => net.terminals)[0];
    return fail(`${label} feeds no gate or amplifier input to break at: name the terminal to break at${first ? `, such as ${first.comp}.${first.term}` : ''}`);
  }
  return lift(circuit, nets, lifted, label, parasitics);
}

/** `circuit` with `lifted` terminals moved off `nets` onto a drive net of
 *  their own. */
function lift(circuit, nets, lifted, label, parasitics) {
  const data = circuit.toJSON();
  const key = (t) => `${t.comp}.${t.term}`;
  const moved = new Set(lifted.map(key));
  const from = new Set(nets.map((net) => net.id));
  const ids = new Set(data.nets.map((net) => net.id));
  let drive = 'N_loop';
  for (let i = 2; ids.has(drive); i += 1) drive = `N_loop${i}`;
  data.nets = data.nets.map((net) => (from.has(net.id) ? { ...net, terminals: net.terminals.filter((t) => !moved.has(key(t))) } : net));
  data.nets.push({ id: drive, name: '', terminals: lifted.map((t) => ({ comp: t.comp, term: t.term })), route: [], junctions: [], branches: null });
  const ret = data.nets.find((net) => from.has(net.id) && net.terminals.length);
  if (!ret) return { ok: false, error: `${label} is the only connection of its net: nothing comes back to it` };
  const loading = lifted.filter((t) => !drawsNoCurrent(circuit.components.get(t.comp), t.term, parasitics)).map(key);
  return { ok: true, kind: 'break', circuit: Circuit.fromJSON(data), drive, ret: ret.id, label, loading };
}
