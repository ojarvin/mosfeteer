import { defineSymbol } from './defineSymbol.js';

/**
 * Inductor (textbook style): a horizontal coil of C-curve humps between a (left)
 * and b (right). Four squares wide (160) with the coil centered on the midpoint.
 */
export const inductor = defineSymbol({
  type: 'inductor',
  description: 'Inductor',
  refPrefix: 'L',
  terminals: [
    { name: 'a', x: -80, y: 0, direction: 'passive', dir: { x: -1, y: 0 } },
    { name: 'b', x: 80, y: 0, direction: 'passive', dir: { x: 1, y: 0 } },
  ],
  bbox: { x: -80, y: -40, w: 160, h: 80 },
  graphics: [
    { kind: 'path', d: 'M -80 0 L -58.49 0 C -58.49 0 -58.49 0 -54.65 0 C -50.82 0 -43.16 0 -39.33 0 C -35.49 0 -35.49 0 -35.49 0 C -35.49 0 -35.49 0 -34.72 4.98 C -33.96 9.96 -32.43 19.91 -29.36 24.75 C -26.29 29.59 -21.7 29.33 -18.63 19.38 C -15.56 9.42 -14.03 -10.22 -16.33 -20.04 C -18.63 -29.85 -24.76 -29.85 -26.16 -19.91 C -27.56 -9.95 -24.23 9.96 -19.16 20.08 C -14.1 30.22 -7.3 30.57 -2.83 20.62 C 1.63 10.66 3.76 -9.6 1.77 -19.73 C -0.23 -29.85 -6.37 -29.85 -7.9 -19.73 C -9.43 -9.6 -6.37 10.66 -1.37 20.53 C 3.63 30.4 10.56 29.86 15.16 19.73 C 19.76 9.6 22.03 -10.13 20.09 -19.99 C 18.16 -29.85 12.03 -29.85 10.13 -19.99 C 8.23 -10.13 10.56 9.6 14.4 19.55 C 18.23 29.5 23.56 29.68 26.99 24.8 C 30.43 19.91 31.96 9.96 32.73 4.98 C 33.49 0 33.49 0 33.49 0 C 33.49 0 33.49 0 37.66 0 C 41.82 0 50.15 0 54.32 0 C 58.49 0 58.49 0 58.49 0 L 80 0', style: 'symbol' },
  ],
  textPos: { x: 0, y: -30, anchor: 'middle' },
  refPos: null,
  labelOffset: { x: 0, y: -80 },
  defaultValue: '',
});
