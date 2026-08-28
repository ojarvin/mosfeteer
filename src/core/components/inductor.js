import { defineSymbol } from './defineSymbol.js';

/**
 * Inductor (Razavi style): a horizontal coil of C-curve humps between a (left)
 * and b (right). Four squares wide (160) with the coil centered on the midpoint.
 */
export const inductor = defineSymbol({
  type: 'inductor',
  description: 'Inductor',
  refPrefix: 'L',
  terminals: [
    { name: 'a', x: 0, y: 0, direction: 'passive', dir: { x: -1, y: 0 } },
    { name: 'b', x: 160, y: 0, direction: 'passive', dir: { x: 1, y: 0 } },
  ],
  bbox: { x: 0, y: -40, w: 160, h: 80 },
  graphics: [
    { kind: 'path', d: 'M 0 0 L 21.51 0 C 21.51 0 21.51 0 25.35 0 C 29.18 0 36.84 0 40.67 0 C 44.51 0 44.51 0 44.51 0 C 44.51 0 44.51 0 45.28 4.98 C 46.04 9.96 47.57 19.91 50.64 24.75 C 53.71 29.59 58.3 29.33 61.37 19.38 C 64.44 9.42 65.97 -10.22 63.67 -20.04 C 61.37 -29.85 55.24 -29.85 53.84 -19.91 C 52.44 -9.95 55.77 9.96 60.84 20.08 C 65.9 30.22 72.7 30.57 77.17 20.62 C 81.63 10.66 83.76 -9.6 81.77 -19.73 C 79.77 -29.85 73.63 -29.85 72.1 -19.73 C 70.57 -9.6 73.63 10.66 78.63 20.53 C 83.63 30.4 90.56 29.86 95.16 19.73 C 99.76 9.6 102.03 -10.13 100.09 -19.99 C 98.16 -29.85 92.03 -29.85 90.13 -19.99 C 88.23 -10.13 90.56 9.6 94.4 19.55 C 98.23 29.5 103.56 29.68 106.99 24.8 C 110.43 19.91 111.96 9.96 112.73 4.98 C 113.49 0 113.49 0 113.49 0 C 113.49 0 113.49 0 117.66 0 C 121.82 0 130.15 0 134.32 0 C 138.49 0 138.49 0 138.49 0 L 160 0', style: 'symbol' },
  ],
  textPos: { x: 80, y: -30, anchor: 'middle' },
  refPos: null,
  labelOffset: { x: 80, y: 80 },
  defaultValue: '',
});