import { GRID, onGrid } from '../grid.js';

/**
 * Symbol definition factory. Enforces the contract:
 *  - every terminal position is on the GRID (multiple of 40)
 *  - the bounding box corners/extents are on the GRID (unless the symbol has
 *    no terminals — pure annotations like solder may use a dot-sized bbox)
 *  - terminal names are unique
 * The terminal list may be empty for pure annotations (e.g. solder dots).
 * Symbol body graphics may use arbitrary coordinates.
 */
export function defineSymbol(def) {
  validateSymbol(def);
  return Object.freeze({ ...def, terminals: Object.freeze(def.terminals.map(Object.freeze)) });
}

export function validateSymbol(def) {
  const terms = def.terminals;
  if (!Array.isArray(terms)) {
    throw new Error(`symbol "${def.type}" must define a terminals array`);
  }
  const names = new Set();
  for (const t of terms) {
    if (!t.name || names.has(t.name)) {
      throw new Error(`symbol "${def.type}": terminal names must be unique, got "${t.name}"`);
    }
    names.add(t.name);
    if (!Number.isInteger(t.x / GRID) || !Number.isInteger(t.y / GRID)) {
      throw new Error(
        `symbol "${def.type}": terminal "${t.name}" at (${t.x},${t.y}) is NOT on the ${GRID}-unit grid`
      );
    }
  }
  // Pure annotations (no terminals, e.g. solder dots) are placed directly on a
  // grid point and never routed through, so their bbox may be the drawn size
  // rather than an aligned grid cell.
  if (terms.length > 0) {
    const r = def.bbox;
    for (const [k, v] of Object.entries(r)) {
      if (!Number.isInteger(v / GRID)) {
        throw new Error(`symbol "${def.type}": bounding box ${k}=${v} is NOT on the ${GRID}-unit grid`);
      }
    }
  }
}
