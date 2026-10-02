/**
 * Renumbering automatically named parts (M1, R3, U2: the symbol's refdes
 * prefix and a number) so the numbers follow the drawing in a chosen order:
 * along each row (or column), then row by row. Parts named by hand keep their names, as do ports
 * (their names are net names) and rail markers. Each prefix is numbered on
 * its own; nmos and pmos share `M`, so they share one sequence.
 */

import { GRID } from './grid.js';
import { INTERFACE_PIN_TYPES, isReferenceMarker } from './model.js';

const AXES = Object.freeze({
  right: Object.freeze({ axis: 'x', sign: 1, arrow: '→', text: 'left to right' }),
  left: Object.freeze({ axis: 'x', sign: -1, arrow: '←', text: 'right to left' }),
  down: Object.freeze({ axis: 'y', sign: 1, arrow: '↓', text: 'top to bottom' }),
  up: Object.freeze({ axis: 'y', sign: -1, arrow: '↑', text: 'bottom to top' }),
});

/** The orders numbers can grow in, `<along>-<then>`: along a row or column
 *  first, then row by row (column by column). `right-down` is reading
 *  order; `up-right` numbers each column bottom to top, columns left to
 *  right. */
export const RENUMBER_ORDERS = Object.freeze(Object.fromEntries(
  Object.entries(AXES).flatMap(([along, a]) => Object.entries(AXES)
    .filter(([, b]) => b.axis !== a.axis)
    .map(([then, b]) => [`${along}-${then}`, Object.freeze({ along: a, then: b, arrow: `${a.arrow}${b.arrow}`, text: `${a.text}, then ${b.text}` })])),
));

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The number in an automatic name, or null for a part named otherwise. */
function autoNumber(component) {
  const prefix = component.def?.refPrefix;
  if (!prefix || INTERFACE_PIN_TYPES.has(component.type) || isReferenceMarker(component)) return null;
  const match = component.refdes.match(new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`));
  return match ? Number(match[1]) : null;
}

// Parts whose centres differ by less than this across the rows stand in one
// row (or column): a resistor and a transistor beside it are not exactly level.
const SAME_LINE = 2 * GRID;

/**
 * The renames that number `refs` (default: every automatically named part)
 * in `order` (RENUMBER_ORDERS key), as [{ from, to }] for the parts whose
 * name changes. A part's place is its body's centre. Parts are gathered
 * into rows (or columns) across `then`, nearly level ones together; the
 * rows are taken in `then` order and each is numbered along `along`. All
 * parts of a prefix are numbered 1, 2, ...; a chosen subset reuses the
 * numbers it holds, so the rest keep theirs.
 */
export function renumberPlan(circuit, { order = 'right-down', refs = null } = {}) {
  const step = RENUMBER_ORDERS[order];
  if (!step) throw new Error(`unknown order "${order}" (use ${Object.keys(RENUMBER_ORDERS).join(', ')})`);
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
  const { along, then } = step;
  const renames = [];
  for (const [prefix, parts] of groups) {
    const numbers = chosen ? parts.map((part) => part.number).sort((a, b) => a - b) : parts.map((_, index) => index + 1);
    // Rows across `then`: a new one wherever the next part is clearly further on.
    const across = (part) => then.sign * part[then.axis];
    parts.sort((a, b) => across(a) - across(b));
    const lines = [];
    for (const part of parts) {
      const line = lines.at(-1);
      if (line && across(part) - across(line[0]) < SAME_LINE) line.push(part);
      else lines.push([part]);
    }
    const ordered = lines.flatMap((line) => line.sort((a, b) => along.sign * (a[along.axis] - b[along.axis]) || across(a) - across(b)));
    ordered.forEach((part, index) => {
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
