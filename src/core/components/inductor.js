import { defineSymbol } from './defineSymbol.js';

/**
 * Inductor (Razavi style): a horizontal coil of C-curve humps between a (left)
 * and b (right).
 */
export const inductor = defineSymbol({
  type: 'inductor',
  description: 'Inductor',
  refPrefix: 'L',
  terminals: [
    { name: 'a', x: 0, y: 0, direction: 'passive', dir: { x: -1, y: 0 } },
    { name: 'b', x: 120, y: 0, direction: 'passive', dir: { x: 1, y: 0 } },
  ],
  bbox: { x: 0, y: -40, w: 120, h: 80 },
  graphics: [
    { kind: 'path', d: 'M 0 0 L 1.51 0 C 1.51 0 1.51 0 5.35 0 C 9.18 0 16.84 0 20.67 0 C 24.51 0 24.51 0 24.51 0 C 24.51 0 24.51 0 25.28 4.98 C 26.04 9.96 27.57 19.91 30.64 24.75 C 33.71 29.59 38.3 29.33 41.37 19.38 C 44.44 9.42 45.97 -10.22 43.67 -20.04 C 41.37 -29.85 35.24 -29.85 33.84 -19.91 C 32.44 -9.95 35.77 9.96 40.84 20.08 C 45.9 30.22 52.7 30.57 57.17 20.62 C 61.63 10.66 63.76 -9.6 61.77 -19.73 C 59.77 -29.85 53.63 -29.85 52.1 -19.73 C 50.57 -9.6 53.63 10.66 58.63 20.53 C 63.63 30.4 70.56 29.86 75.16 19.73 C 79.76 9.6 82.03 -10.13 80.09 -19.99 C 78.16 -29.85 72.03 -29.85 70.13 -19.99 C 68.23 -10.13 70.56 9.6 74.4 19.55 C 78.23 29.5 83.56 29.68 86.99 24.8 C 90.43 19.91 91.96 9.96 92.73 4.98 C 93.49 0 93.49 0 93.49 0 C 93.49 0 93.49 0 97.66 0 C 101.82 0 110.15 0 114.32 0 C 118.49 0 118.49 0 118.49 0 L 120 0', style: 'symbol' },
  ],
  textPos: { x: 60, y: -30, anchor: 'middle' },
  refPos: null,
  labelOffset: { x: 80, y: 80 },
  defaultValue: '',
});