import { defineSymbol } from './defineSymbol.js';

export const portInput = defineSymbol({
    type: 'input',
    description: 'Input Port',
    // Keep the voltage nature of an interface explicit in the default name.
    // The owned label renderer presents VI1 as V_{I1}.
    refPrefix: 'VI',
    terminals: [{ name: 'p', x: 0, y: 0, direction: 'port' }],
    bbox: { x: -80, y: -40, w: 80, h: 80 },
    graphics: [
      { kind: 'path', d: 'M 0 0 L -20 0', style: 'symbol' },
      { kind: 'path', d: 'M -20 0 L -40 -20 L -80 -20 L -80 20 L -40 20 L -20 0', style: 'symbol' },
    ],
    textPos: null,
    refPos: null,
    labelOffset: { x: -120, y: 0 },
    defaultValue: '',
  });

export const portOutput = defineSymbol({
    type: 'output',
    description: 'Output Port',
    refPrefix: 'VO',
    defaultMirrorX: true,
    terminals: [{ name: 'p', x: 0, y: 0, direction: 'port' }],
    bbox: { x: -80, y: -40, w: 80, h: 80 },
    graphics: [
      { kind: 'path', d: 'M 0 0 L -20 0', style: 'symbol' },
      { kind: 'path', d: 'M -20 0 L -20 -20 L -60 -20 L -80 0 L -60 20 L -20 20 L -20 0', style: 'symbol' },
    ],
    textPos: null,
    refPos: null,
    labelOffset: { x: -120, y: 0 },
    defaultValue: '',
  });

export const portInputOutput = defineSymbol({
    type: 'inputoutput',
    description: 'Input/Output Port',
    refPrefix: 'VIO',
    terminals: [{ name: 'p', x: 0, y: 0, direction: 'port' }],
    bbox: { x: -80, y: -40, w: 80, h: 80 },
    graphics: [
      { kind: 'path', d: 'M 0 0 L -20 0', style: 'symbol' },
      { kind: 'path', d: 'M -20 0 L -40 -20 L -60 -20 L -80 0 L -60 20 L -40 20 L -20 0', style: 'symbol' },
    ],
    textPos: null,
    refPos: null,
    labelOffset: { x: -120, y: 0 },
    defaultValue: '',
  });


/**
 * Textbook terminal markers: a small circle (open or filled) on a lead,
 * used as a generic node/pin stub (no label box).
 */
const marker = (type, description, filled) =>
  defineSymbol({
    type,
    description,
    refPrefix: '',
    terminals: [{ name: 'p', x: 0, y: 0, direction: 'port' }],
    bbox: { x: -80, y: -40, w: 80, h: 80 },
    graphics: [
      filled
        ? { kind: 'dot', cx: -68.35, cy: 0, r: 9.92 }
        : { kind: 'circle', cx: -68.35, cy: 0, r: 9.92, style: 'symbol' },
      { kind: 'path', d: 'M 0 0 L -58.4 0', style: 'symbol' },
    ],
    textPos: null,
    refPos: null,
    defaultValue: '',
  });

export const port = marker('port', 'Port (terminal)', false);
export const port_filled = marker('port_filled', 'Port (filled terminal)', true);
