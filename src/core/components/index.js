import { resistor } from './resistor.js';
import { capacitor } from './capacitor.js';
import { inductor } from './inductor.js';
import { diode } from './diode.js';
import { nmos } from './nmos.js';
import { pmos } from './pmos.js';
import { nmosb } from './nmosb.js';
import { pmosb } from './pmosb.js';
import { npn } from './npn.js';
import { pnp } from './pnp.js';
import { ground } from './ground.js';
import { vcm } from './vcm.js';
import { supply } from './supply.js';
import { portInput, portOutput, portInputOutput, port, port_filled } from './port.js';
import { current_source, voltage_source } from './current.js';
import { opamp, opampDiff, inverter, buffer, and_gate, nand_gate, or_gate, nor_gate, xor_gate, xnor_gate } from './logic.js';
import { adc, dac } from './converter.js';
import { variable_resistor, variable_capacitor, variable_inductor } from './variable.js';
import { solder } from './solder.js';
import { switch_open, switch_closed } from './switch.js';

/** All registered symbol definitions, keyed by type name. */
export const symbolTypes = {
  resistor,
  capacitor,
  inductor,
  diode,
  nmos,
  pmos,
  nmosb,
  pmosb,
  npn,
  pnp,
  ground,
  vcm,
  supply,
  input: portInput,
  output: portOutput,
  inputoutput: portInputOutput,
  port,
  port_filled,
  current_source,
  voltage_source,
  opamp,
  opamp_diff: opampDiff,
  inverter,
  buffer,
  and_gate,
  nand_gate,
  or_gate,
  nor_gate,
  xor_gate,
  xnor_gate,
  adc,
  dac,
  variable_resistor,
  variable_capacitor,
  variable_inductor,
  solder,
  switch_open,
  switch_closed,
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
