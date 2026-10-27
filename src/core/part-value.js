/**
 * A part's value -- a resistance, a capacitance, a source's level -- read
 * with its unit (`valueText`: 8p is 8 pF, 1M is 1 MΩ), and the label that
 * may show it on the drawing. The label is an owned math label
 * (`PART_VALUE_ROLE`), a projection of the value as a transistor's size
 * label is of its size (mos-size.js): `8 pF`, below the name (`beside`) or
 * in its place (`replace`). With neither
 * (`ComponentInstance#valueLabel` null, the default) the value draws
 * nothing; a parts table (parts-table.js) shows it.
 */

import { sizeReplacedNameLabels } from './mos-size.js';

export const PART_VALUE_ROLE = 'part-value';
/** How a value label stands: below the name, or in its place. */
export const VALUE_LABEL_MODES = new Set(['beside', 'replace']);

/** Parts with a value read in a unit: passives and sources. */
export const VALUE_TYPES = new Set([
  'resistor', 'capacitor', 'inductor', 'impedance',
  'variable_resistor', 'variable_capacitor', 'variable_inductor',
  'current_source', 'voltage_source',
]);

/** Between a number and its unit, as TeX's \, sets it. */
export const THIN_SPACE = ' ';

/** The unit each valued part's value is in. */
const UNITS = {
  resistor: 'Ω', variable_resistor: 'Ω', impedance: 'Ω',
  capacitor: 'F', variable_capacitor: 'F',
  inductor: 'H', variable_inductor: 'H',
  current_source: 'A', voltage_source: 'V',
};

// A value's SI prefix as typed, as the calculator reads it (M and meg are
// mega, m milli, u micro), as it is shown.
const PREFIX_SHOWN = { a: 'a', f: 'f', p: 'p', n: 'n', u: 'µ', 'µ': 'µ', 'μ': 'µ', m: 'm', '': '', k: 'k', K: 'k', meg: 'M', M: 'M', G: 'G', T: 'T' };
const VALUE = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(meg|Meg|MEG|[afpnuµμmkKMGT]?)\s*(?:Ω|ohms?|F|H|A|V)?$/i;

/** A value as the table shows it: the number as typed, then its unit, 8p
 *  as 8 pF, 1.5n as 1.5 nF, 1M as 1 MΩ. Anything that is not a number
 *  (R_L, g_m) is shown as typed. */
export function valueText(value, type) {
  const text = String(value ?? '').trim();
  const unit = UNITS[type];
  const match = unit && text.match(VALUE);
  if (!match) return text;
  const prefix = PREFIX_SHOWN[match[2]] ?? PREFIX_SHOWN[match[2].toLowerCase()];
  if (prefix === undefined) return text;
  return `${match[1]}${THIN_SPACE}${prefix}${unit}`;
}

/** A value's number (8p is 8e-12, 1M and 1meg are 1e6), or NaN for one
 *  that is not a number (R_L). */
export function valueNumber(value) {
  const match = String(value ?? '').trim().match(VALUE);
  if (!match) return NaN;
  const exponent = VALUE_EXPONENT[match[2]] ?? VALUE_EXPONENT[match[2].toLowerCase()];
  return exponent === undefined ? NaN : Number(`${match[1]}e${exponent}`);
}

const VALUE_EXPONENT = { a: -18, f: -15, p: -12, n: -9, u: -6, 'µ': -6, 'μ': -6, m: -3, '': 0, k: 3, K: 3, meg: 6, M: 6, G: 9, T: 12 };

/** The unit a part's value is in (Ω, F, H, A, V), or null. */
export function valueUnit(type) {
  return UNITS[type] || null;
}

/** A value as TeX: a number and its unit upright, `\mathrm{8\,pF}`; a
 *  value that is not a number (R_{L}) as it is. */
export function valueTex(value, type) {
  const text = valueText(value, type);
  const [number, unit] = text.split(THIN_SPACE);
  return unit !== undefined ? `\\mathrm{${number}\\,${unit}}` : text;
}

/** The value label's TeX: the value alone, below the name or in its
 *  place. */
export function valueLabelTex(component) {
  return `$${valueTex(component.value, component.type)}$`;
}

/** Name labels a size or value label stands in for, so nothing draws or
 *  picks them. */
export function replacedNameLabels(circuit) {
  const hidden = sizeReplacedNameLabels(circuit);
  for (const component of circuit.components.values()) {
    if (component.valueLabel !== 'replace' || !String(component.value ?? '').trim()) continue;
    const name = circuit.labelOf(component.refdes);
    if (name) hidden.add(name.id);
  }
  return hidden;
}
