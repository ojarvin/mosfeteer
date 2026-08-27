import { GRID, onGrid } from '../grid.js';

/**
 * Symbol definition factory. Enforces the contract:
 *  - every terminal position is on the GRID (multiple of 40)
 *  - the bounding box corners/extents are on the GRID
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
  const r = def.bbox;
  for (const [k, v] of Object.entries(r)) {
    if (!Number.isInteger(v / GRID)) {
      throw new Error(`symbol "${def.type}": bounding box ${k}=${v} is NOT on the ${GRID}-unit grid`);
    }
  }
}