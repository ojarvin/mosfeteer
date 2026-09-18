/** Leaf helpers and vocabulary shared across the small-signal analysis modules. */

/** First value that is neither undefined nor null. */
export function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

/** Safe own-property test for plain option/record objects. */
export const OWN = Object.prototype.hasOwnProperty;

/** Component types modeled as MOS devices. */
export const MOS_TYPES = new Set(['nmos', 'pmos', 'nmosb', 'pmosb']);

/** Primitive kinds that are plain two-terminal passives. */
export const PASSIVE_KINDS = new Set(['resistor', 'capacitor', 'inductor', 'conductance', 'admittance']);
