// The first-drawing tutorial: a five-transistor OTA drawn step by step. It is
// optional and self-contained. Each step is checked from the drawing's
// structure (which parts exist, which pins share a net), never from exact
// coordinates, so any sensible layout completes it; the marked spots are only
// suggestions. Everything here is pure; the editor draws the card and targets.

import { INTERFACE_PIN_TYPES } from '../core/model.js';

const NMOS = new Set(['nmos', 'nmosb']);
const PMOS = new Set(['pmos', 'pmosb']);

// Suggested spots, as a textbook 5T OTA: the tail at the bottom, the input
// pair above it with gates facing out, and the mirror loads on top with gates
// facing each other, each row eight cells from the next.
export const TUTORIAL_TARGETS = Object.freeze({
  tail: [{ type: 'nmos', x: 0, y: 320, mirrorX: false, caption: 'NMOS (tail)' }],
  pair: [
    { type: 'nmos', x: -240, y: 0, mirrorX: false, caption: 'NMOS' },
    { type: 'nmos', x: 240, y: 0, mirrorX: true, caption: 'NMOS, mirrored' },
  ],
  loads: [
    { type: 'pmos', x: -240, y: -320, mirrorX: true, caption: 'PMOS, mirrored' },
    { type: 'pmos', x: 240, y: -320, mirrorX: false, caption: 'PMOS' },
  ],
});

function netId(circuit, comp, term) {
  if (!comp) return null;
  try { return circuit.netOfTerminal({ comp: comp.refdes, term })?.id || null; } catch { return null; }
}

function netHas(circuit, id, predicate) {
  const net = id && circuit.nets.get(id);
  return !!net && net.terminals.some((terminal) => predicate(circuit.components.get(terminal.comp)));
}

/** The OTA's roles as found in the drawing: which parts are the tail, the
 *  input pair, and the loads. Missing roles are null. */
export function tutorialRoles(circuit) {
  const parts = [...circuit.components.values()];
  const nmos = parts.filter((c) => NMOS.has(c.type));
  const pmos = parts.filter((c) => PMOS.has(c.type));
  const byX = (a, b) => a.transform.x - b.transform.x;
  // The input pair: two NMOS on one row with a third NMOS below them.
  let pair = null;
  let tail = null;
  for (const a of nmos) {
    for (const b of nmos) {
      if (a === b || a.transform.y !== b.transform.y || a.transform.x >= b.transform.x) continue;
      const below = nmos.filter((c) => c !== a && c !== b && c.transform.y > a.transform.y)
        .sort((c, d) => Math.abs(c.transform.x - (a.transform.x + b.transform.x) / 2)
          - Math.abs(d.transform.x - (a.transform.x + b.transform.x) / 2))[0];
      if (below && !pair) {
        pair = [a, b];
        tail = below;
      }
    }
  }
  // The loads: two PMOS on one row above the pair, gates facing each other.
  let loads = null;
  for (const a of pmos) {
    for (const b of pmos) {
      if (a === b || a.transform.y !== b.transform.y || a.transform.x >= b.transform.x) continue;
      if (pair && a.transform.y >= pair[0].transform.y) continue;
      const inward = a.terminalWorld('g').x > a.transform.x && b.terminalWorld('g').x < b.transform.x;
      if (inward && !loads) loads = [a, b].sort(byX);
    }
  }
  return { tail, pair, loads, nmos, pmos };
}

const SUPPLY = (c) => c?.type === 'supply';
const GROUND = (c) => c?.type === 'ground';
const PORT = (c) => INTERFACE_PIN_TYPES.has(c?.type);

export const TUTORIAL_STEPS = Object.freeze([
  {
    id: 'tail',
    title: 'Place the tail transistor',
    text: 'Press **i**, type **nmos**, and click the marked spot at the bottom. Press **?** any time to see every key.',
    targets: 'tail',
    done: (circuit, roles) => roles.nmos.length >= 1,
  },
  {
    id: 'pair',
    title: 'Place the input pair',
    text: 'Place two more NMOS on one row above the tail. Hold **Alt** while placing to drop a mirrored twin: move away from the axis and click once for both.',
    targets: 'pair',
    done: (circuit, roles) => !!roles.pair,
  },
  {
    id: 'loads',
    title: 'Place the PMOS loads',
    text: 'Place two PMOS on one row at the top, with their gates facing each other. Alt symmetry works here too; otherwise **Shift+R** mirrors a part.',
    targets: 'loads',
    done: (circuit, roles) => !!roles.loads,
  },
  {
    id: 'tail-wire',
    title: 'Wire the tail',
    text: 'Press **w** and connect both pair sources to the tail drain. Hold **Alt** while wiring and the cursor snaps to the nearest pin.',
    done: (circuit, { pair, tail }) => {
      const net = netId(circuit, tail, 'd');
      return !!net && netId(circuit, pair?.[0], 's') === net && netId(circuit, pair?.[1], 's') === net;
    },
  },
  {
    id: 'load-wires',
    title: 'Wire the loads',
    text: 'Connect each pair drain to the PMOS drain above it. You can also just drag from a pin to start a wire.',
    done: (circuit, { pair, loads }) => {
      const left = netId(circuit, pair?.[0], 'd');
      const right = netId(circuit, pair?.[1], 'd');
      return !!left && !!right && left !== right
        && left === netId(circuit, loads?.[0], 'd') && right === netId(circuit, loads?.[1], 'd');
    },
  },
  {
    id: 'mirror',
    title: 'Make the current mirror',
    text: 'Tie the two PMOS gates together, and to the left PMOS drain.',
    done: (circuit, { loads }) => {
      const gates = netId(circuit, loads?.[0], 'g');
      return !!gates && gates === netId(circuit, loads?.[1], 'g')
        && [netId(circuit, loads[0], 'd'), netId(circuit, loads[1], 'd')].includes(gates);
    },
  },
  {
    id: 'rails',
    title: 'Add the supply and ground',
    text: 'Insert a **supply** on the PMOS sources and a **ground** under the tail source, and wire them up.',
    done: (circuit, { loads, tail }) => !!loads
      && loads.every((load) => netHas(circuit, netId(circuit, load, 's'), SUPPLY))
      && netHas(circuit, netId(circuit, tail, 's'), GROUND),
  },
  {
    id: 'pins',
    title: 'Add the pins',
    text: 'Insert **port**, **input**, or **output** pins on both input gates, the tail gate (the bias), and the output: the right-hand drain.',
    done: (circuit, { pair, tail, loads }) => {
      if (!pair || !tail || !loads) return false;
      const gates = netId(circuit, loads[0], 'g');
      const output = [netId(circuit, loads[0], 'd'), netId(circuit, loads[1], 'd')].find((id) => id && id !== gates);
      return [netId(circuit, pair[0], 'g'), netId(circuit, pair[1], 'g'), netId(circuit, tail, 'g'), output]
        .every((id) => netHas(circuit, id, PORT));
    },
  },
  {
    id: 'label',
    title: 'Name a net',
    text: 'Press **L** and click a wire to place a net label, then type a name, for example **X** for the mirror node.',
    done: (circuit) => [...circuit.labels.values()].some((label) => label.netId),
  },
  {
    id: 'highlight',
    title: 'Probe a net',
    text: 'Press **9** and click a wire: the whole net lights up in a color. Click again to cycle colors; **8** clears them.',
    done: (circuit) => circuit.netHighlights.size > 0,
  },
]);

/** Progress through the tutorial for the current drawing. Steps can finish in
 *  any order; `current` is the first one neither done nor skipped. */
export function tutorialProgress(circuit, skipped = new Set()) {
  const roles = tutorialRoles(circuit);
  const steps = TUTORIAL_STEPS.map((step) => {
    let done = false;
    try { done = !!step.done(circuit, roles); } catch { done = false; }
    return { id: step.id, done, skipped: !done && skipped.has(step.id) };
  });
  const current = steps.find((step) => !step.done && !step.skipped) || null;
  return {
    steps,
    current: current ? TUTORIAL_STEPS.find((step) => step.id === current.id) : null,
    doneCount: steps.filter((step) => step.done).length,
    finished: !current,
  };
}

/** The suggested spots still open for a step: a spot counts as taken once a
 *  part of the same kind stands on it. */
export function openTutorialTargets(circuit, step) {
  const targets = TUTORIAL_TARGETS[step?.targets] || [];
  const parts = [...circuit.components.values()];
  return targets.filter((target) => !parts.some((c) => c.type.startsWith(target.type)
    && c.transform.x === target.x && c.transform.y === target.y));
}

/** Split **bold** markup into text runs, for building the card safely. */
export function tutorialRuns(text) {
  return String(text).split(/(\*\*[^*]+\*\*)/).filter(Boolean)
    .map((part) => (part.startsWith('**') ? { key: true, text: part.slice(2, -2) } : { key: false, text: part }));
}
