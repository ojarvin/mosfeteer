import { defineSymbol } from './defineSymbol.js';

// A schematic block is the default footprint for a resizable abstraction node.
// Its generic terminals sit on every non-corner grid slot of the perimeter so
// ordinary schematic wires can enter from any side (including each edge
// midpoint); per-instance size is managed by ComponentInstance, while the
// shared symbol supplies the initial geometry and caption style.
export const block = defineSymbol({
  type: 'block',
  description: 'Schematic block',
  refPrefix: 'B',
  allowFloatingTerminals: true,
  terminals: [
    { name: 'T1', x: -40, y: -80, direction: 'passive', dir: { x: 0, y: -1 } },
    { name: 'T2', x: 40, y: -80, direction: 'passive', dir: { x: 0, y: -1 } },
    { name: 'T3', x: 80, y: -40, direction: 'passive', dir: { x: 1, y: 0 } },
    { name: 'T4', x: 80, y: 40, direction: 'passive', dir: { x: 1, y: 0 } },
    { name: 'T5', x: 40, y: 80, direction: 'passive', dir: { x: 0, y: 1 } },
    { name: 'T6', x: -40, y: 80, direction: 'passive', dir: { x: 0, y: 1 } },
    { name: 'T7', x: -80, y: 40, direction: 'passive', dir: { x: -1, y: 0 } },
    { name: 'T8', x: -80, y: -40, direction: 'passive', dir: { x: -1, y: 0 } },
    { name: 'T9', x: 0, y: -80, direction: 'passive', dir: { x: 0, y: -1 } },
    { name: 'T10', x: 80, y: 0, direction: 'passive', dir: { x: 1, y: 0 } },
    { name: 'T11', x: 0, y: 80, direction: 'passive', dir: { x: 0, y: 1 } },
    { name: 'T12', x: -80, y: 0, direction: 'passive', dir: { x: -1, y: 0 } },
  ],
  bbox: { x: -80, y: -80, w: 160, h: 160 },
  graphics: [
    { kind: 'rect', x: -80, y: -80, w: 160, h: 160, style: 'emph' },
  ],
  // The label is the block's editable value, centered inside the body, like a
  // block-diagram node rather than an external component reference designator.
  textPos: { x: 0, y: 0, anchor: 'middle', font: 'label' },
  refPos: null,
  labelOffset: null,
  defaultValue: 'Block',
});
