import { GRID, cell } from './grid.js';

/**
 * Coarse ASCII preview of the schematic layout: one character per 40-unit
 * cell. Used by the agent for a quick eyeball without rendering an image.
 *  . empty cell
 *  # inside a component bounding box
 *  R C L D M Q G V P  type initial of the component's leftmost cell
 *  o terminal position (overrides)
 *  + wire passes through this cell (net route, overrides)
 *  @ junction (multi-terminal net terminal)
 *  refdes is printed in the first header line
 */
export function renderAscii(circuit) {
  const b = circuit.bounds(0);
  if (b.w <= 0 && b.h <= 0) return '(empty)';
  const x0 = cell(b.x);
  const y0 = cell(b.y);
  const cols = Math.max(1, cell(b.x + b.w) - x0 + 1);
  const rows = Math.max(1, cell(b.y + b.h) - y0 + 1);
  const grid = Array.from({ length: rows }, () => Array(cols).fill('.'));

  const put = (cx, cy, ch) => {
    const r = cy - y0;
    const c = cx - x0;
    if (r < 0 || c < 0 || r >= rows || c >= cols) return;
    grid[r][c] = ch;
  };

  const initials = {
    resistor: 'R', capacitor: 'C', inductor: 'L', diode: 'D',
    nmos: 'M', pmos: 'M', npn: 'Q', pnp: 'Q',
    ground: 'G', supply: 'S', input: 'P', output: 'P', inputoutput: 'P',
  };

  const header = [];
  for (const c of circuit.components.values()) {
    const r = c.bboxWorld();
    const c0 = cell(r.x);
    const c1 = cell(r.x + r.w);
    const r0 = cell(r.y);
    const r1 = cell(r.y + r.h);
    const ch = initials[c.type] || '?';
    for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) put(cc, rr, '#');
    header.push(`${c.refdes}:${c.type}@(${c.transform.x},${c.transform.y})`);
  }

  // Wires: over-print the routing polyline, then terminals on top.
  for (const net of circuit.nets.values()) {
    const pts = net.points();
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const steps = Math.max(1, Math.round((Math.abs(b.x - a.x) + Math.abs(b.y - a.y)) / GRID));
      for (let s = 0; s <= steps; s++) {
        const fx = GRID * (a.x / GRID + (b.x - a.x) / GRID / steps * s);
        const fy = GRID * (a.y / GRID + (b.y - a.y) / GRID / steps * s);
        put(cell(fx), cell(fy), '+');
      }
    }
  }

  for (const c of circuit.components.values()) {
    for (const { x, y } of c.worldTerminals()) put(cell(x), cell(y), 'o');
  }
  for (const net of circuit.nets.values()) {
    if (net.terminals.length < 3) continue;
    for (const { comp, term } of net.terminals) {
      const c = circuit.components.get(comp);
      if (!c) continue;
      const p = c.terminalWorld(term);
      put(cell(p.x), cell(p.y), '@');
    }
  }

  const line = grid.map((row) => row.join('')).join('\n');
  return `${header.join(' | ')}\n${line}`;
}