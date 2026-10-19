/** Leaf helpers and vocabulary shared across the small-signal analysis modules. */

/** First value that is neither undefined nor null. */
export function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

/** Normalize a scalar, array, or set into a list of meaningful values. */
export function asList(value) {
  if (value === undefined || value === null || value === '') return [];
  return value instanceof Set || Array.isArray(value) ? [...value] : [value];
}

/** Safe own-property test for plain option/record objects. */
export const OWN = Object.prototype.hasOwnProperty;

/** Component types modeled as MOS devices. */
export const MOS_TYPES = new Set(['nmos', 'pmos', 'nmosb', 'pmosb']);

/** Primitive kinds that are plain two-terminal passives. */
export const PASSIVE_KINDS = new Set(['resistor', 'capacitor', 'inductor', 'conductance', 'admittance']);

/** The pin pairs a chopper shorts: every analysis takes it as two straight
 *  wires, in to out on each side. */
export const CHOPPER_SHORTS = [['ip', 'op'], ['im', 'om']];

/** The nets each chopper joins, as [net, net] pairs (net objects), for the
 *  pairs whose pins are both wired. */
export function chopperShortedNets(circuit) {
  const pairs = [];
  for (const component of circuit.components.values()) {
    if (component.type !== 'chopper') continue;
    for (const [a, b] of CHOPPER_SHORTS) {
      const left = circuit.netOfTerminal({ comp: component.refdes, term: a });
      const right = circuit.netOfTerminal({ comp: component.refdes, term: b });
      if (left && right && left !== right) pairs.push([left, right]);
    }
  }
  return pairs;
}
