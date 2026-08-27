import { resistor } from './resistor.js';
import { capacitor } from './capacitor.js';
import { inductor } from './inductor.js';
import { diode } from './diode.js';
import { nmos } from './nmos.js';
import { pmos } from './pmos.js';
import { npn } from './npn.js';
import { pnp } from './pnp.js';
import { ground } from './ground.js';
import { supply } from './supply.js';
import { portInput, portOutput, portInputOutput } from './port.js';
import { solder } from './solder.js';

/** All registered symbol definitions, keyed by type name. */
export const symbolTypes = {
  resistor,
  capacitor,
  inductor,
  diode,
  nmos,
  pmos,
  npn,
  pnp,
  ground,
  supply,
  input: portInput,
  output: portOutput,
  inputoutput: portInputOutput,
  solder,
};

/** Ordered list of type names (for palettes / docs). */
export const symbolTypeNames = Object.keys(symbolTypes);

/** Look up a symbol definition by type; throws on unknown type. */
export function getSymbol(type) {
  const def = symbolTypes[type];
  if (!def) {
    throw new Error(`unknown component type "${type}"; known: ${symbolTypeNames.join(', ')}`);
  }
  return def;
}