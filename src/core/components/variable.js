import { defineSymbol } from './defineSymbol.js';
import { resistor } from './resistor.js';
import { capacitor } from './capacitor.js';
import { inductor } from './inductor.js';

/**
 * Variable (adjustable) passive components: the base body (loaded from the
 * plain resistor/capacitor/inductor definitions) with a diagonal adjustment
 * arrow (shaft + filled head) crossing it. The body origin is centered, so the
 * adjustment arrow is expressed in the same centered local coordinates.
 */
const ADJUST = [
  { kind: 'path', d: 'M -48 48 L 36 -36', style: 'symbol' },
  { kind: 'polygon', points: [{ x: 48, y: -48 }, { x: 24, y: -40 }, { x: 40, y: -24 }], fill: 'foreground' },
];

/** Build a variable symbol from a base passive definition plus the arrow. */
function compose(base, type, description) {
  return defineSymbol({
    ...base,
    type,
    description,
    graphics: [...base.graphics.map((g) => ({ ...g })), ...ADJUST],
  });
}

export const variable_resistor = compose(resistor, 'variable_resistor', 'Variable Resistor');
export const variable_capacitor = compose(capacitor, 'variable_capacitor', 'Variable Capacitor');
export const variable_inductor = compose(inductor, 'variable_inductor', 'Variable Inductor');
