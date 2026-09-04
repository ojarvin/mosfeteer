import { defineSymbol } from './defineSymbol.js';

const TERMINALS = [
  { name: 'g', x: -120, y: 0, direction: 'gate', dir: { x: -1, y: 0 } },
  { name: 'd', x: 0, y: -80, direction: 'drain', dir: { x: 0, y: -1 } },
  { name: 's', x: 0, y: 80, direction: 'source', dir: { x: 0, y: 1 } },
];
const BULK = { name: 'b', x: 0, y: 0, direction: 'bulk', dir: { x: 1, y: 0 } };
const BBOX = { x: -120, y: -80, w: 120, h: 160 };

function mosGraphics(sourceArrow, bulk) {
  const graphics = [
    { kind: 'path', d: 'M -120 0 L -76.88 0', style: 'symbol' },
    { kind: 'polygon', points: [{ x: -87.21, y: -38.37 }, { x: -75.58, y: -38.37 }, { x: -75.58, y: 38.37 }, { x: -87.21, y: 38.37 }], fill: 'foreground' },
    { kind: 'polygon', points: [{ x: -66.28, y: -50 }, { x: -54.64, y: -50 }, { x: -54.64, y: 50 }, { x: -66.28, y: 50 }], fill: 'foreground' },
    { kind: 'path', d: 'M -56.98 -27.91 L 0 -27.91 L 0 -80', style: 'symbol' },
    { kind: 'path', d: 'M -54.65 27.91 L 0 27.91 L 0 80', style: 'symbol' },
    sourceArrow,
  ];
  if (bulk) graphics.push({ kind: 'path', d: 'M -54.65 0 L 0 0', style: 'symbol' });
  return graphics;
}

/** Build one of the four MOS symbols without sharing mutable definition data. */
export function createMos(type, { pmos = false, bulk = false } = {}) {
  return defineSymbol({
    type,
    description: bulk ? `${pmos ? 'PMOS' : 'NMOS'} transistor with bulk` : `${pmos ? 'PMOS' : 'NMOS'} Transistor`,
    refPrefix: 'M',
    terminals: [...TERMINALS, ...(bulk ? [BULK] : [])].map((terminal) => ({
      ...terminal,
      dir: { ...terminal.dir },
    })),
    bbox: { ...BBOX },
    graphics: mosGraphics(
      pmos
        ? { kind: 'polygon', points: [{ x: -54.65, y: 27.91 }, { x: -17.44, y: 11.63 }, { x: -17.44, y: 44.19 }], fill: 'foreground' }
        : { kind: 'polygon', points: [{ x: 0, y: 27.91 }, { x: -34.88, y: 11.63 }, { x: -34.88, y: 44.19 }], fill: 'foreground' },
      bulk,
    ),
    textPos: { x: -26, y: -30, anchor: 'middle' },
    refPos: null,
    labelOffset: bulk ? { x: 40, y: -40 } : { x: 40, y: 0 },
    ...(pmos ? { defaultMirrorY: true } : {}),
    defaultValue: '',
  });
}
