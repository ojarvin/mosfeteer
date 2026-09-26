/**
 * How the symbols group for people: the insert menu's sections and the
 * symbol reference sheet's rows. Grouping is derived from the type name, so
 * a symbol added to the registry lands in its section without a list to
 * update; one that fits no rule still appears, under "Other".
 *
 * Browse order is analog first, digital second, with the interface ports
 * kept above both macros and the digital cells.
 */

import { symbolTypeNames } from './index.js';

export const SYMBOL_CATEGORY_RULES = [
  ['Passives', /^(variable_)?(resistor|capacitor|inductor)$|^(impedance|diode)$/],
  ['Semiconductors / actives', /^(nmos|pmos|nmosb|pmosb|npn|pnp)$/],
  ['Switches', /^switch_/],
  ['Sources & power', /^(current_source|voltage_source|vccs|vcvs|supply|ground|vcm)$/],
  ['Interfaces / ports', /^(input|output|inputoutput|port)$/],
  ['Macros', /^(opamp|opamp_diff|adc|dac)$/],
  ['Logic', /^(inverter|buffer|tristate_(inverter|buffer)|mux2|.*_gate)$/],
  ['Sequential', /^(?:dff|latch)(?:_|$)/],
  ['Blocks / shells', /^block$/],
  ['Signal flow', /^signal_(sum|multiply)$/],
];

/** Where a category's families start a new row on the symbol sheet: each
 *  rule takes its types into one row (wrapping if long), in rule order; the
 *  rest share a final row. */
export const SYMBOL_SHEET_ROWS = {
  Logic: [/^(inverter|buffer|tristate_|mux)/, /2_gate$/, /3_gate$/],
  Sequential: [/^dff(?!.*rstb)/, /^dff.*rstb/, /^latch(?!.*rstb)/, /^latch.*rstb/],
};

/** Every placeable symbol (not the solder annotation), by category:
 *  [{ title, types }] in browse order, registry order within each. */
export function symbolCategories(types = symbolTypeNames) {
  const placeable = types.filter((type) => type !== 'solder');
  const groups = SYMBOL_CATEGORY_RULES.map(([title, rule]) => ({ title, types: placeable.filter((type) => rule.test(type)) }));
  const grouped = new Set(groups.flatMap((group) => group.types));
  groups.push({ title: 'Other', types: placeable.filter((type) => !grouped.has(type)) });
  return groups.filter((group) => group.types.length);
}
