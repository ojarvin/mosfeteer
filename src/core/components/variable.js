import { defineSymbol } from './defineSymbol.js';
import { resistor } from './resistor.js';
import { capacitor } from './capacitor.js';
import { inductor } from './inductor.js';

/**
 * Variable (adjustable) passive components: the base body (loaded from the
 * plain resistor/capacitor/inductor definitions) with a diagonal adjustment
 * arrow (shaft + filled head) crossing it. The arrow is shifted right (+80)
 * so it sits over the 160-wide body instead of off to its left.
 */
const ADJUST = [
  { kind: 'path', d: 'M 32 48 L 116 -36', style: 'symbol' },
  { kind: 'polygon', points: [{ x: 128, y: -48 }, { x: 104, y: -40 }, { x: 120, y: -24 }], fill: 'foreground' },
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