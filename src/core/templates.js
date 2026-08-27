import { Circuit } from './model.js';

/**
 * Default demo circuit: a 5V rail feeding a resistor divider to ground, with
 * an output port tapped off the divider node. Intentionally shows:
 *  - coincident (shared-point) terminals  R2.b == ground
 *  - a rotated two-terminal part           R2 (vertical)
 *  - a multi-terminal net/junction         the "out" node (3 terminals)
 *  - a separate supply-to-component wire
 * Layout is chosen so no bounding boxes overlap and everything is on-grid.
 */
export function demoCircuit() {
  const c = new Circuit();
  const vcc = c.addComponent('supply', { x: 400, y: 0, value: '5V' });
  const r1 = c.addComponent('resistor', { x: 560, y: 0, value: '1k' });
  const r2 = c.addComponent('resistor', { x: 720, y: 0, rotation: 90, value: '2k' });
  const gnd = c.addComponent('ground', { x: 720, y: 120 });
  const out = c.addComponent('output', { x: 680, y: -80, value: 'OUT' });

  const nVcc = c.connect(`${vcc.refdes}.p`, `${r1.refdes}.a`);
  nVcc.name = 'vcc';

  const nOut = c.connect(`${r1.refdes}.b`, `${out.refdes}.p`, `${r2.refdes}.a`);
  nOut.name = 'out';

  const nGnd = c.connect(`${r2.refdes}.b`, `${gnd.refdes}.gnd`);
  nGnd.name = 'gnd';

  return c;
}