/**
 * The built-in drawings `arrange` offers when no design draws a topology:
 * the common cells drawn as the style guide has them. They are drawings
 * like any other, searched after the workspace's own, so a cell the user
 * has drawn once is offered their way first.
 */

import { Circuit } from './model.js';
import { runCommand } from './commands.js';

const p = (x, y) => ({ x, y });

/** Each cell: its name, the commands that draw it, and `{ cell, wires }`:
 *  the parts that make the cell (what is looked for in a larger selection;
 *  rails and a tail source go with it when there), and wires drawn as given
 *  where the router would draw them otherwise (a net named by a pin on it).
 *  Rails stand one cell out from their pins, as g and v place them. */
const CELLS = [
  ['NMOS current mirror', [
    'add nmos M1 --at 0 0 --mirrorX', 'add nmos M2 --at 400 0',
    'add ground --at 0 120', 'add ground --at 400 120',
    'connect M1.g M2.g', 'connect M1.d M1.g',
    'connect M1.s GROUND1.gnd', 'connect M2.s GROUND2.gnd',
  ], { cell: ['M1', 'M2'] }],
  ['PMOS current mirror', [
    'add pmos M1 --at 0 0 --mirrorX', 'add pmos M2 --at 400 0',
    'add supply --at 0 -120', 'add supply --at 400 -120',
    'connect M1.g M2.g', 'connect M1.d M1.g',
    'connect M1.s SUPPLY1.p', 'connect M2.s SUPPLY2.p',
  ], { cell: ['M1', 'M2'] }],
  ['NMOS differential pair', [
    'add nmos M1 --at 0 0', 'add nmos M2 --at 400 0 --mirrorX',
    'add current_source I1 --at 200 280', 'add ground --at 200 400',
    'connect M1.s M2.s I1.a', 'connect I1.b GROUND1.gnd',
  ], { cell: ['M1', 'M2'] }],
  ['PMOS differential pair', [
    'add pmos M1 --at 0 0', 'add pmos M2 --at 400 0 --mirrorX',
    'add current_source I1 --at 200 -280', 'add supply --at 200 -400',
    'connect M1.s M2.s I1.b', 'connect I1.a SUPPLY1.p',
  ], { cell: ['M1', 'M2'] }],
  ['NMOS cascode', [
    'add nmos M1 --at 0 0', 'add nmos M2 --at 0 -240',
    'add ground --at 0 120',
    'connect M1.d M2.s', 'connect M1.s GROUND1.gnd',
  ], { cell: ['M1', 'M2'] }],
  ['Five-transistor OTA', [
    'add nmos M1 --at 0 0', 'add nmos M2 --at 400 0 --mirrorX',
    'add pmos M3 --at 0 -320 --mirrorX', 'add pmos M4 --at 400 -320',
    'add nmos M5 --at 200 280',
    'add supply --at 0 -440', 'add supply --at 400 -440', 'add ground --at 200 400',
    'connect M1.d M3.d', 'connect M2.d M4.d',
    'connect M3.g M4.g', 'connect M3.d M3.g',
    'connect M3.s SUPPLY1.p', 'connect M4.s SUPPLY2.p',
    'connect M1.s M2.s M5.d', 'connect M5.s GROUND1.gnd',
  ], {
    cell: ['M1', 'M2', 'M3', 'M4', 'M5'],
    wires: {
      // The diode wire as the current mirrors draw it: down from M3's drain,
      // across, and up to the gates; M1's drain joins below it.
      'M3.d': [
        [p(120, -320), p(280, -320)],
        [p(0, -240), p(0, -200), p(160, -200), p(160, -320)],
        [p(0, -80), p(0, -200)],
      ],
    },
  }],
];

let drawings = null;

/** The built-in drawings, as `arrangementCandidates` sources. */
export function builtInDrawings() {
  if (!drawings) {
    drawings = CELLS.map(([name, lines, { cell, wires = {} }]) => {
      const circuit = new Circuit();
      for (const line of lines) runCommand(circuit, line);
      for (const [pin, paths] of Object.entries(wires)) {
        const [comp, term] = pin.split('.');
        circuit._installLiteralPaths(circuit.netOfTerminal({ comp, term }), paths);
      }
      circuit.syncJunctionSolders();
      return { circuit, name, builtIn: true, cell };
    });
  }
  return drawings;
}

/** The cells looked for inside a selection (arrangementCandidates'
 *  `patterns`): `{ name, circuit, refs }`, larger cells first, then in the
 *  order above (a mirror before a pair, which a mirror also is). */
export function cellPatterns() {
  return builtInDrawings()
    .map(({ circuit, name, cell }, index) => ({ name, circuit, refs: cell, index }))
    .sort((a, b) => b.refs.length - a.refs.length || a.index - b.index);
}
