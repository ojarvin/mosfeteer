/**
 * A rail marker on a pin in one step: a ground, supply, or VCM one cell out
 * along the pin's escape direction, wired to it by a straight lead, and
 * turned to hang that way too -- a ground on a drain points up, off the top
 * of the transistor, as one on a source points down. The same rule turns a
 * marker placed onto a pin, and one swapped for another kind.
 */

import { GRID } from './grid.js';
import { applyTransform } from './geometry.js';
import { referenceMarkerInfo } from './model.js';

/** Which way each rail's symbol hangs from its pin, unturned. */
const HANG = { ground: { x: 0, y: 1 }, supply: { x: 0, y: -1 }, vcm: { x: 0, y: 1 } };

export const PIN_RAIL_TYPES = Object.freeze(Object.keys(HANG));

/** The rotation that turns a `type` marker to hang along `dir` (unit, axis
 *  aligned); 0 when it cannot. */
export function railRotation(type, dir) {
  const hang = HANG[type];
  if (!hang || !dir) return 0;
  for (const rotation of [0, 90, 180, 270]) {
    const turned = applyTransform({ x: 0, y: 0, rotation }, hang.x, hang.y);
    if (turned.x === Math.sign(dir.x) && turned.y === Math.sign(dir.y)) return rotation;
  }
  return 0;
}

/** The way a placed rail marker hangs in the drawing, or null. */
export function railHang(component) {
  const hang = HANG[component?.type];
  if (!hang) return null;
  const t = component.transform;
  return applyTransform({ x: 0, y: 0, rotation: t.rotation, mirrorX: t.mirrorX, mirrorY: t.mirrorY }, hang.x, hang.y);
}

/** Where terminal `ref` ({comp, term}) leads out: its point and direction. */
export function pinEscape(circuit, ref) {
  const component = circuit.getComponent(ref.comp);
  const def = component.terminalDefs.find((terminal) => terminal.name === ref.term);
  if (!def) throw new Error(`${ref.comp} has no terminal "${ref.term}"`);
  const pin = component.terminalWorld(ref.term);
  return { pin, dir: circuit._pinDir(component, def, pin.x, pin.y) };
}

/** The world point the marker's pin lands on for terminal `ref`: one cell out. */
export function pinRailPoint(circuit, ref, type) {
  if (!HANG[type]) throw new Error(`a pin rail is ${PIN_RAIL_TYPES.join(' or ')}`);
  const { pin, dir } = pinEscape(circuit, ref);
  return { x: pin.x + dir.x * GRID, y: pin.y + dir.y * GRID };
}

/**
 * Add a `type` rail marker wired to terminal `ref`, hanging the way the pin
 * leads out. The terminal must be unconnected. Returns the marker; throws,
 * leaving the circuit unchanged, when the lead cannot be routed.
 */
export function addPinRail(circuit, ref, type) {
  if (circuit.netOfTerminal(ref)) throw new Error(`${ref.comp}.${ref.term} is already wired`);
  const point = pinRailPoint(circuit, ref, type);
  const { dir } = pinEscape(circuit, ref);
  const marker = circuit.addComponent(type, { x: point.x, y: point.y, rotation: railRotation(type, dir), mirrorX: false, mirrorY: false });
  try {
    circuit.connect(`${ref.comp}.${ref.term}`, `${marker.refdes}.${referenceMarkerInfo(type).terminal}`);
  } catch (err) {
    circuit.removeComponent(marker.refdes);
    throw err;
  }
  return marker;
}
