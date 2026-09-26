/**
 * A rail marker on a pin in one step: a ground or supply one cell out along
 * the pin's escape direction, wired to it. A pin facing the way the marker
 * hangs (a source down to ground) gets a straight one-cell lead; a sideways pin
 * (a gate) gets that lead plus one cell turning toward the rail; a pin facing
 * against it (a drain up to ground) steps out one cell and two cells aside,
 * away from its part's body, so the marker never hangs over its own lead.
 */

import { GRID } from './grid.js';
import { referenceMarkerInfo } from './model.js';

/** Which way each rail's symbol hangs from its pin. */
const HANG = { ground: { x: 0, y: 1 }, supply: { x: 0, y: -1 } };

export const PIN_RAIL_TYPES = Object.freeze(Object.keys(HANG));

/** The world point the marker's pin lands on for terminal `ref` ({comp, term}). */
export function pinRailPoint(circuit, ref, type) {
  const hang = HANG[type];
  if (!hang) throw new Error(`a pin rail is ${PIN_RAIL_TYPES.join(' or ')}`);
  const component = circuit.getComponent(ref.comp);
  const def = component.terminalDefs.find((terminal) => terminal.name === ref.term);
  if (!def) throw new Error(`${ref.comp} has no terminal "${ref.term}"`);
  const pin = component.terminalWorld(ref.term);
  const dir = circuit._pinDir(component, def, pin.x, pin.y);
  const out = { x: pin.x + dir.x * GRID, y: pin.y + dir.y * GRID };
  const along = dir.x * hang.x + dir.y * hang.y;
  if (along > 0) return out;
  // A marker's own pin is reached against its hang, so a sideways lead turns
  // one cell toward the rail at its end.
  if (along === 0) return { x: out.x + hang.x * GRID, y: out.y + hang.y * GRID };
  // Against the hang: step aside, away from the body's centre (right by default).
  const box = component.bboxWorld();
  const side = { x: -dir.y, y: dir.x };
  const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const towardBody = (centre.x - pin.x) * side.x + (centre.y - pin.y) * side.y;
  const sign = towardBody > 0 ? -1 : 1;
  return { x: out.x + sign * side.x * 2 * GRID, y: out.y + sign * side.y * 2 * GRID };
}

/**
 * Add a `type` rail marker wired to terminal `ref`. The terminal must be
 * unconnected. Returns the marker; throws, leaving the circuit unchanged, when
 * the lead cannot be routed.
 */
export function addPinRail(circuit, ref, type) {
  if (circuit.netOfTerminal(ref)) throw new Error(`${ref.comp}.${ref.term} is already wired`);
  const point = pinRailPoint(circuit, ref, type);
  const marker = circuit.addComponent(type, { x: point.x, y: point.y });
  try {
    circuit.connect(`${ref.comp}.${ref.term}`, `${marker.refdes}.${referenceMarkerInfo(type).terminal}`);
  } catch (err) {
    circuit.removeComponent(marker.refdes);
    throw err;
  }
  return marker;
}
