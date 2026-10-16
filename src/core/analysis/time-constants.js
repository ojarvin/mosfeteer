/**
 * A circuit's natural-frequency polynomial as time constants (Middlebrook's
 * extra element theorem, n times over; Vorpérian's fast analytical
 * techniques):
 *
 *   D(s) = 1 + b1 s + b2 s^2 + ...
 *   b1 = sum_i tau_i,            tau_i = C_i R_i      (every other C open)
 *   b2 = sum_{i<j} tau_i tau_j^i, tau_j^i = C_j R_j^i (C_i shorted, the rest open)
 *
 * R_i is the resistance C_i sees with the input at zero, found as a
 * driving-point solve with a unit test current in C_i's place. Each term
 * belongs to one capacitor, so the sum says which sets the pole: the
 * dominant pole is near -1/b1, and a second one well apart near -b1/b2.
 * Exact in the model it is given: D is the denominator of every response
 * of the circuit before any cancellation, normalized to D(0) = 1.
 *
 * Only capacitors may carry s: an inductor, a one-pole opamp, or a Miller
 * shunt is refused rather than left out of the sum.
 */

import { buildMNA } from './mna.js';
import { solveMNA } from './solve.js';
import { AC_GROUND } from './context.js';

/** Pairs past this many capacitors are not solved: b2 needs one solve per pair. */
export const MAX_PAIR_CAPACITORS = 6;

/**
 * `pipeline` a built exact pipeline (unsolved is fine), `s` the frequency
 * symbol it was built with. Returns `{ ok, capacitors: [{ id, component,
 * capacitance, resistance }], dropped (those with a zero time constant),
 * b1, pairs: [{ i, j, resistance }] | null, b2, pairsOmitted }` or
 * `{ ok: false, error }`. `pairsOmitted`: too many capacitors for b2.
 */
export function poleTimeConstants(pipeline, ops, s, { pairs: wantPairs = true } = {}) {
  const primitives = pipeline.selectedMna || [];
  const reactive = primitives.find((p) => p.kind === 'inductor' || p.kind === 'admittance' || p.kind === 'impedance'
    || (p.kind === 'opamp' && p.metadata?.opampModel === 'gbw'));
  if (reactive) return { ok: false, error: `${reactive.metadata?.component || reactive.id} carries s of its own: time constants are for capacitors alone` };
  const grounded = (node) => node === undefined || node === null || node === AC_GROUND || pipeline.context.acGroundIds.has(node);
  // A capacitor from AC ground to AC ground does nothing.
  const capacitors = primitives.filter((p) => p.kind === 'capacitor' && !(grounded(p.terminals.a) && grounded(p.terminals.b)));
  if (!capacitors.length) return { ok: false, error: 'no capacitor: the response has no poles' };
  const others = primitives.filter((p) => p.kind !== 'capacitor');
  const input = { ...pipeline.excitations.input, value: ops.zero };
  const resistance = (index, shorted = []) => {
    const cap = capacitors[index];
    const shorts = shorted.map((k) => ({ kind: 'voltage-source', id: `@tc-short-${k}`, terminals: capacitors[k].terminals, value: ops.zero }));
    // Into C's a terminal, out of its b.
    const test = { kind: 'current-source', id: '@tc-test', terminals: { a: cap.terminals.b, b: cap.terminals.a }, value: ops.one };
    let solution;
    try {
      const system = buildMNA([...others, input, ...shorts, test], { ops, ground: AC_GROUND, grounds: [...pipeline.context.acGroundIds] });
      solution = solveMNA(system, { ops });
    } catch {
      return null;
    }
    if (!solution.ok) return null;
    const voltage = (node) => {
      if (grounded(node)) return ops.zero;
      const at = solution.variables.indexOf(`V(${node})`);
      return at < 0 ? ops.zero : solution.columns[0][at];
    };
    return ops.sub(voltage(cap.terminals.a), voltage(cap.terminals.b));
  };
  const named = capacitors.map((cap, index) => ({
    id: cap.id,
    component: cap.metadata?.component || cap.id,
    capacitance: ops.div(cap.value, s),
    resistance: resistance(index),
  }));
  const open = named.find((cap) => !cap.resistance);
  if (open) return { ok: false, error: `${open.component} sees no resistance with the other capacitors open: a pole at the origin, or a node it alone holds` };
  // A capacitor across a source (a gate driven straight from the input)
  // sees no resistance: its time constant is zero, and it adds nothing to
  // any coefficient. Shorting it again would only short the source.
  const live = named.map((cap, index) => ({ cap, index })).filter(({ cap }) => !ops.isZero(cap.resistance));
  if (!live.length) return { ok: false, error: 'every capacitor sits across a source: the response has no poles' };
  const tau = (cap, r = cap.resistance) => ops.mul(cap.capacitance, r);
  const capacitorsLeft = live.map(({ cap }) => cap);
  const dropped = named.filter((cap) => !capacitorsLeft.includes(cap));
  const b1 = capacitorsLeft.reduce((sum, cap) => ops.add(sum, tau(cap)), ops.zero);
  const result = { ok: true, capacitors: capacitorsLeft, dropped, b1, pairs: null, b2: null };
  if (!wantPairs || live.length < 2) return result;
  if (live.length > MAX_PAIR_CAPACITORS) return { ...result, pairsOmitted: true };
  const pairs = [];
  for (let i = 0; i < live.length; i += 1) {
    for (let j = i + 1; j < live.length; j += 1) {
      const r = resistance(live[j].index, [live[i].index]);
      if (!r) return result;
      pairs.push({ i, j, resistance: r });
    }
  }
  const b2 = pairs.reduce((sum, { i, j, resistance: r }) => ops.add(sum, ops.mul(tau(capacitorsLeft[i]), tau(capacitorsLeft[j], r))), ops.zero);
  return { ...result, pairs, b2 };
}
