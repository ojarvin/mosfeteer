/**
 * Renumbering automatically named parts (M1, R3, U2: the symbol's refdes
 * prefix and a number) so the numbers grow across the drawing in one
 * diagonal direction. Parts named by hand keep their names, as do ports
 * (their names are net names) and rail markers. Each prefix is numbered on
 * its own; nmos and pmos share `M`, so they share one sequence.
 */

import { INTERFACE_PIN_TYPES, isReferenceMarker } from './model.js';

/** The directions numbers can grow in: the unit step on screen (y down). */
export const RENUMBER_DIRECTIONS = Object.freeze({
  se: Object.freeze({ x: 1, y: 1, arrow: '↘', text: 'from the top left' }),
  sw: Object.freeze({ x: -1, y: 1, arrow: '↙', text: 'from the top right' }),
  ne: Object.freeze({ x: 1, y: -1, arrow: '↗', text: 'from the bottom left' }),
  nw: Object.freeze({ x: -1, y: -1, arrow: '↖', text: 'from the bottom right' }),
});

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The number in an automatic name, or null for a part named otherwise. */
function autoNumber(component) {
  const prefix = component.def?.refPrefix;
  if (!prefix || INTERFACE_PIN_TYPES.has(component.type) || isReferenceMarker(component)) return null;
  const match = component.refdes.match(new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`));
  return match ? Number(match[1]) : null;
}

/**
 * The renames that number `refs` (default: every automatically named part)
 * along `direction` (RENUMBER_DIRECTIONS key), as [{ from, to }] for the
 * parts whose name changes. A part's place is its body's centre, taken
 * along the diagonal first, then down (or up) the rows. All parts of a
 * prefix are numbered 1, 2, ...; a chosen subset reuses the numbers it
 * holds, so the rest keep theirs.
 */
export function renumberPlan(circuit, { direction = 'se', refs = null } = {}) {
  const step = RENUMBER_DIRECTIONS[direction];
  if (!step) throw new Error(`unknown direction "${direction}" (use ${Object.keys(RENUMBER_DIRECTIONS).join(', ')})`);
  const chosen = refs ? new Set(refs) : null;
  const groups = new Map();
  for (const component of circuit.components.values()) {
    if (chosen && !chosen.has(component.refdes)) continue;
    const number = autoNumber(component);
    if (number === null) continue;
    const prefix = component.def.refPrefix;
    if (!groups.has(prefix)) groups.set(prefix, []);
    const box = component.bboxWorld();
    groups.get(prefix).push({ component, number, x: box.x + box.w / 2, y: box.y + box.h / 2 });
  }
  const renames = [];
  for (const [prefix, parts] of groups) {
    const numbers = chosen ? parts.map((part) => part.number).sort((a, b) => a - b) : parts.map((_, index) => index + 1);
    const along = (part) => step.x * part.x + step.y * part.y;
    parts.sort((a, b) => along(a) - along(b) || step.y * (a.y - b.y) || step.x * (a.x - b.x));
    parts.forEach((part, index) => {
      const to = `${prefix}${numbers[index]}`;
      if (to !== part.component.refdes) renames.push({ from: part.component.refdes, to });
    });
  }
  return renames;
}

/** Apply renumberPlan; returns the renames made. Names are swapped through
 *  temporary ones, so two parts can trade numbers. */
export function renumberParts(circuit, options = {}) {
  const renames = renumberPlan(circuit, options);
  const taken = (name) => circuit.components.has(name) || circuit.labels.has(name);
  // Refuse before renaming anything: a target held by something that keeps
  // its name.
  const freed = new Set(renames.map(({ from }) => from));
  const blocked = renames.find(({ to }) => taken(to) && !freed.has(to));
  if (blocked) throw new Error(`cannot renumber ${blocked.from} to ${blocked.to}: the name is in use`);
  let counter = 0;
  const temporary = () => {
    let name;
    do name = `RENUMBER${counter++}x`; while (taken(name));
    return name;
  };
  const staged = renames.map(({ from, to }) => {
    const via = temporary();
    circuit.renameComponent(from, via);
    return { via, to };
  });
  for (const { via, to } of staged) circuit.renameComponent(via, to);
  return renames;
}
