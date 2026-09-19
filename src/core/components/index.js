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
import { portInput, portOutput, portInputOutput, port } from './port.js';
import { current_source, voltage_source } from './current.js';
import { vccs } from './vccs.js';
import { opamp, opampDiff, inverter, buffer, tristateInverter, tristateBuffer, and2_gate, nand2_gate, or2_gate, nor2_gate, xor2_gate, xnor2_gate, and3_gate, nand3_gate, or3_gate, nor3_gate, xor3_gate, xnor3_gate } from './logic.js';
import { adc, dac } from './converter.js';
import { dff, dff_qb, dff_clkb, dff_clkb_qb, dff_rst, dff_rst_qb, dff_clkb_rst, dff_clkb_rst_qb, dff_rstb, dff_rstb_qb, dff_clkb_rstb, dff_clkb_rstb_qb, latch, latch_qb, latch_enb, latch_enb_qb, latch_rst, latch_rst_qb, latch_enb_rst, latch_enb_rst_qb, latch_rstb, latch_rstb_qb, latch_enb_rstb, latch_enb_rstb_qb } from './flipflop.js';
import { variable_resistor, variable_capacitor, variable_inductor } from './variable.js';
import { solder } from './solder.js';
import { switch_open, switch_closed } from './switch.js';
import { block } from './block.js';
import { mux2 } from './mux.js';

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
  current_source,
  voltage_source,
  vccs,
  opamp,
  opamp_diff: opampDiff,
  inverter,
  buffer,
  tristate_inverter: tristateInverter,
  tristate_buffer: tristateBuffer,
  mux2,
  and2_gate,
  nand2_gate,
  or2_gate,
  nor2_gate,
  xor2_gate,
  xnor2_gate,
  and3_gate,
  nand3_gate,
  or3_gate,
  nor3_gate,
  xor3_gate,
  xnor3_gate,
  adc,
  dac,
  dff,
  dff_qb,
  dff_clkb,
  dff_clkb_qb,
  dff_rst,
  dff_rst_qb,
  dff_clkb_rst,
  dff_clkb_rst_qb,
  dff_rstb,
  dff_rstb_qb,
  dff_clkb_rstb,
  dff_clkb_rstb_qb,
  latch,
  latch_qb,
  latch_enb,
  latch_enb_qb,
  latch_rst,
  latch_rst_qb,
  latch_enb_rst,
  latch_enb_rst_qb,
  latch_rstb,
  latch_rstb_qb,
  latch_enb_rstb,
  latch_enb_rstb_qb,
  variable_resistor,
  variable_capacitor,
  variable_inductor,
  solder,
  switch_open,
  switch_closed,
  block,
};

/** Ordered list of type names (for palettes / docs). */
export const symbolTypeNames = Object.keys(symbolTypes);

/** Look up a symbol definition by type; throws on unknown type. */
export function getSymbol(type) {
  const def = Object.hasOwn(symbolTypes, type) ? symbolTypes[type] : undefined;
  if (!def) {
    throw new Error(`unknown component type "${type}"; known: ${symbolTypeNames.join(', ')}`);
  }
  return def;
}
