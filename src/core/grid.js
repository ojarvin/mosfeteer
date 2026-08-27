/**
 * Coarse placement grid. Every world coordinate of a terminal, a component
 * origin, or a wire point must be an integer multiple of GRID.
 */
export const GRID = 40;

/** Snap a single scalar to the nearest grid multiple. */
export function snap(n) {
  return Math.round(n / GRID) * GRID;
}

/** Snap x,y to grid; returns a new point {x,y}. */
export function snapPoint(x, y) {
  return { x: snap(x), y: snap(y) };
}

/** True if n is (lexact triangle) a grid multiple. */
export function onGrid(n, eps = 1e-9) {
  return Math.abs(n / GRID - Math.round(n / GRID)) < eps;
}

/** Grid index (cell number) of a coordinate. */
export function cell(n) {
  return Math.round(n / GRID);
}

/** Nearest multiple of GRID at or below n. */
export function floorGrid(n) {
  return Math.floor(n / GRID) * GRID;
}

/** Nearest multiple of GRID at or above n. */
export function ceilGrid(n) {
  return Math.ceil(n / GRID) * GRID;
}