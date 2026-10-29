// The tutorials: a five-transistor OTA drawn step by step (the first
// drawing), a switched-capacitor integrator's clock, beats and analysis, and
// a first-order delta-sigma modulator's signal-flow analysis. The last two
// start from a drawing of their own and assume the basics. Each is optional
// and self-contained. A step is checked from the drawing's structure (which
// parts exist, which pins share a net), never from exact coordinates, or --
// where it is about a window -- from what the editor shows (`ui`), so any
// sensible layout completes it; the marked spots are only suggestions.
// Everything here is pure; the editor draws the card and targets.

import { Circuit, INTERFACE_PIN_TYPES } from '../core/model.js';
import { runCommand } from '../core/commands.js';
import { samePhase, switchGroupKey, switchPhase } from '../core/beats.js';
import { drawnTimingDiagram, existingTimingDiagram, timingPairs, timingRowSources, timingStates } from '../core/timing-diagram.js';

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
function tutorialRoles(circuit) {
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
    text: 'Press **i**, type **nmos**, and click the marked spot at the bottom. Press **?** any time to see all keys.',
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
    text: 'Press **l** and click a wire to place a net label, then type a name, for example **X** for the mirror node.',
    done: (circuit) => [...circuit.labels.values()].some((label) => label.netId),
  },
  {
    id: 'highlight',
    title: 'Probe a net',
    text: 'Press **9** and click a wire: the whole net lights up in a color. Click again to cycle colors; **8** clears them.',
    done: (circuit) => circuit.netHighlights.size > 0,
  },
]);

// ----- a switched-capacitor integrator: clock, beats, analysis ---------------

/** The stray-insensitive integrator, drawn but not yet clocked: no phases
 *  on its switches. S1 and S3 sample V_IN onto C_S, S2 and S4 dump it into
 *  the virtual ground. */
function scIntegratorDrawing() {
  const circuit = new Circuit();
  for (const line of [
    'add input VIN --at -1240 0', 'add switch_open S1 --at -1040 0', 'add capacitor CS --at -640 0',
    'add switch_open S4 --at -240 0', 'add opamp U1 --at 200 40 --mirrorY', 'add output VOUT --at 640 40',
    'add switch_open S2 --at -840 160 --rot 90', 'add ground G1 --at -840 320',
    'add switch_open S3 --at -440 160 --rot 90', 'add ground G2 --at -440 320',
    'add ground G3 --at -40 160', 'add capacitor CF --at 200 -160',
    'connect VIN.p S1.a', 'connect S1.b CS.a', 'connect S2.a CS.a', 'connect S2.b G1.gnd',
    'connect CS.b S4.a', 'connect S3.a CS.b', 'connect S3.b G2.gnd', 'connect S4.b U1.im',
    'connect U1.ip G3.gnd', 'connect CF.a U1.im', 'connect CF.b U1.o', 'connect U1.o VOUT.p',
  ]) runCommand(circuit, line);
  return circuit.toJSON();
}

/** The integrator's two phases as drawn: S1 and S3's, and S2 and S4's --
 *  each pair on one phase, the two different. Null until then. */
function scPhases(circuit) {
  const key = (refdes) => {
    const component = circuit.components.get(refdes);
    return component && switchPhase(component) ? switchGroupKey(component) : null;
  };
  const [a, b, c, d] = ['S1', 'S3', 'S2', 'S4'].map(key);
  return a && b && c && d && a === b && c === d && a !== c ? { sample: a, transfer: c } : null;
}

/** Whether the timing diagram keeps phases `a` and `b` (keys) apart with a
 *  gap. */
function keptApart(circuit, a, b) {
  const rows = timingRowSources(circuit);
  const [x, y] = [a, b].map((key) => rows.findIndex((row) => samePhase(row.key, key)));
  return timingPairs(rows, existingTimingDiagram(circuit).gaps).some((pair) => pair.includes(x) && pair.includes(y));
}

const SC_STEPS = Object.freeze([
  {
    id: 'phases',
    title: 'Give the switches their phases',
    text: 'S1 and S3 sample V_IN onto C_S; S2 and S4 dump it into the virtual ground. Select S1 and S3, right-click one, and choose **Phase → New phase…**: type **$\\varphi_1$**. Then put S2 and S4 on **$\\varphi_2$** the same way (a phase in use is listed in the menu).',
    done: (circuit) => !!scPhases(circuit),
  },
  {
    id: 'clock',
    title: 'Draw the clock',
    text: 'Press **Shift+K** for the timing editor, a row per phase. Make φ1 high in the first slot and φ2 in the second: click a slot to flip it. Then under **Non-overlap** tick φ1 against φ2, and press **Annotate**: the clock goes under the drawing, a one-cell gap between the phases, as a non-overlapping clock has.',
    done: (circuit) => {
      const phases = scPhases(circuit);
      const states = phases && timingStates(circuit);
      return !!states && states.some((state) => state.closed.has(phases.sample)) && states.some((state) => state.closed.has(phases.transfer))
        && !states.some((state) => state.closed.has(phases.sample) && state.closed.has(phases.transfer))
        && keptApart(circuit, phases.sample, phases.transfer) && !!drawnTimingDiagram(circuit);
    },
  },
  {
    id: 'span',
    title: 'Mark the non-overlap',
    text: 'Click the bar where φ1 falls (between its slots), press **s**, then click where φ2 rises: a span between the two edges. Type **$t_{nov}$** into its field in the editor\'s list.',
    done: (circuit) => (drawnTimingDiagram(circuit)?.spans.length || 0) > 0,
  },
  {
    id: 'beats',
    title: 'Make the beats',
    text: 'Press **Make beats** in the timing editor: one beat per state of the clock, each closing the switches whose phase is high.',
    done: (circuit) => (circuit.beats?.length || 0) >= 2,
  },
  {
    id: 'step',
    title: 'Step through the clock',
    text: 'Close the timing editor (**Shift+K**) and step through the beats with **Alt+→**: open switches are drawn open, and what they cut off dims.',
    done: (circuit, roles, ui) => (ui.activeBeat ?? -1) >= 1,
  },
  {
    id: 'derive',
    title: 'Find H(z)',
    text: 'Press **Shift+S**: the analysis window opens in its **Switched-cap** mode, the clock\'s states listed. Press **Derive** for the exact H(z), by charge from phase to phase.',
    done: (circuit, roles, ui) => !!ui.scEquation,
  },
  {
    id: 'finite-gain',
    title: 'Give the op-amp a finite gain',
    text: 'Right-click the op-amp: **Small-signal attributes → Opamp model → Finite gain A**, and **Derive** again. A appears in H(z): the integrator leaks, its pole inside the unit circle.',
    done: (circuit, roles, ui) => circuit.components.get('U1')?.analysis?.model === 'finite-gain' && /A/.test(ui.scEquation || ''),
  },
]);

// ----- a first-order delta-sigma modulator: signal-flow analysis ------------

/** The modulator's parts, its forward path and feedback not yet wired: the
 *  input into a sum, a gain a, a delaying integrator z^-1 / (1 - z^-1),
 *  and a quantizer to the output. The sum's inputs are all positive: making
 *  the feedback negative is a step. */
function sdmDrawing() {
  const circuit = new Circuit();
  for (const line of [
    'add input U --at -1200 0', 'add signal_sum S1 --at -800 0', 'add gain K1 --at -400 0 --value a',
    'add tf_z H1 --at 0 0 --value "tf([0 1], [1 -1])"', 'add quantizer QZ1 --at 400 0', 'add output V --at 800 0',
    'connect U.p S1.w', 'connect QZ1.out V.p',
  ]) runCommand(circuit, line);
  return circuit.toJSON();
}

const SDM_STEPS = Object.freeze([
  {
    id: 'forward',
    title: 'Wire the forward path',
    text: 'Wire the sum\'s output into the gain **a**, the gain into the integrator H(z), and the integrator into the quantizer: drag from a pin, or press **w**.',
    done: (circuit) => {
      const net = (ref, term) => (circuit.components.get(ref) ? netId(circuit, circuit.components.get(ref), term) : null);
      const joined = (a, b) => !!a && a === b;
      return joined(net('S1', 'e'), net('K1', 'in')) && joined(net('K1', 'out'), net('H1', 'in')) && joined(net('H1', 'out'), net('QZ1', 'in'));
    },
  },
  {
    id: 'feedback',
    title: 'Close the loop, negatively',
    text: 'Wire the output back into the sum\'s south (lower) input. A sum adds its inputs, so the feedback must be made negative: right-click the sum, **Input polarity → s input → Negative** makes it so, and a − appears beside it.',
    done: (circuit) => {
      const quantizer = circuit.components.get('QZ1');
      const sum = circuit.components.get('S1');
      const out = quantizer && netId(circuit, quantizer, 'out');
      return !!out && out === (sum && netId(circuit, sum, 's')) && !!sum.negativeInputs?.has('s');
    },
  },
  {
    id: 'derive',
    title: 'Find the STF and the NTF',
    text: 'Press **Shift+S**: the analysis window opens in its **Signal flow** mode. Press **Derive**: from one solve, the signal transfer function from U and the noise transfer function from the quantizer\'s error, **E_QZ1**.',
    done: (circuit, roles, ui) => (ui.signalFlowResults || 0) >= 2,
  },
  {
    id: 'coefficient',
    title: 'Move a coefficient',
    text: 'Under **Coefficients**, drag **a**\'s slider: the poles move and the plots follow, the equations staying symbolic. At a = 1 the NTF is 1 − z⁻¹.',
    done: (circuit) => {
      const value = circuit.analysisValues?.coefficients?.a;
      return Number.isFinite(value) && value !== 1;
    },
  },
  {
    id: 'time',
    title: 'Watch it in time',
    text: 'In the Plots window (**Shift+W**), open the **Time** tab: a sine through the modulator, and the quantizer\'s output toggling around it.',
    done: (circuit, roles, ui) => ui.plotsTab === 'Time',
  },
  {
    id: 'annotate',
    title: 'Put the graph on the drawing',
    text: 'Back on **Magnitude**, press **Annotate**: the responses go under the drawing, named in their colors.',
    done: (circuit) => [...circuit.labels.values()].some((label) => label.plot?.kind === 'response'),
  },
]);

/** Every tutorial, as Learn lists them. `start` is the drawing it begins
 *  from (none: a blank page); `targets` its marked spots; `roles` what its
 *  steps find in the drawing; `finish(skipped)` the card's last words. */
export const TUTORIALS = Object.freeze([
  {
    id: 'ota',
    title: 'Draw a five-transistor OTA',
    card: '5T OTA',
    name: 'tutorial-5t-ota',
    blurb: 'About five minutes, in a new document: place the transistors, wire them, add the rails and ports, and label the nets. The card marks where each part goes.',
    steps: TUTORIAL_STEPS,
    targets: TUTORIAL_TARGETS,
    roles: tutorialRoles,
    done: 'You drew a 5T OTA!',
    finish: 'Next, press **x** for a design check. Before the **Analysis** (Shift+S) can find the gain and output impedance, mark the tail node and the mirror node as AC ground: right-click each wire, then **Small-signal attributes → DC bias / AC ground**. **?** lists all keys.',
  },
  {
    id: 'switched-cap',
    title: 'Clock a switched-capacitor integrator',
    card: 'SC integrator',
    name: 'tutorial-sc-integrator',
    blurb: 'An integrator drawn for you: give its switches phases, draw the clock in the timing editor, step through it as beats, and find its H(z). Assumes the basics.',
    start: scIntegratorDrawing,
    steps: SC_STEPS,
    done: 'You clocked and analyzed an SC integrator!',
    finish: 'Tick **Noise** in the analysis window for its kT/C noise, or press **Shift+F5** to present the beats.',
  },
  {
    id: 'sdm',
    title: 'Analyze a delta-sigma modulator',
    card: 'First-order ΣΔ',
    name: 'tutorial-sdm',
    blurb: 'A first-order modulator\'s blocks placed for you: close its loop, derive the STF and NTF, move a coefficient, watch it in time, and put the graph on the drawing. Assumes the basics.',
    start: sdmDrawing,
    steps: SDM_STEPS,
    done: 'You analyzed a ΣΔ modulator!',
    finish: 'Try the **Swing** and **Loop** tabs, or add a second integrator for a second-order loop.',
  },
]);

/** A tutorial by id (the OTA when there is none such). */
export function tutorialById(id) {
  return TUTORIALS.find((tutorial) => tutorial.id === id) || TUTORIALS[0];
}

/** Progress through `tutorial` (the OTA by default) for the current drawing,
 *  `ui` what the editor shows (see onboarding.js). Steps can finish in any
 *  order; `current` is the first one neither done nor skipped. */
export function tutorialProgress(circuit, skipped = new Set(), { tutorial = TUTORIALS[0], ui = {} } = {}) {
  const roles = tutorial.roles ? tutorial.roles(circuit) : {};
  const steps = tutorial.steps.map((step) => {
    let done = false;
    try { done = !!step.done(circuit, roles, ui); } catch { done = false; }
    return { id: step.id, done, skipped: !done && skipped.has(step.id) };
  });
  const current = steps.find((step) => !step.done && !step.skipped) || null;
  return {
    steps,
    current: current ? tutorial.steps.find((step) => step.id === current.id) : null,
    doneCount: steps.filter((step) => step.done).length,
    finished: !current,
  };
}

/** The suggested spots still open for a step: a spot counts as taken once a
 *  part of the same kind stands on it. */
export function openTutorialTargets(circuit, step, tutorial = TUTORIALS[0]) {
  const targets = tutorial.targets?.[step?.targets] || [];
  const parts = [...circuit.components.values()];
  return targets.filter((target) => !parts.some((c) => c.type.startsWith(target.type)
    && c.transform.x === target.x && c.transform.y === target.y));
}

/** Split **bold** markup into text runs, for building the card safely. */
export function tutorialRuns(text) {
  return String(text).split(/(\*\*[^*]+\*\*)/).filter(Boolean)
    .map((part) => (part.startsWith('**') ? { key: true, text: part.slice(2, -2) } : { key: false, text: part }));
}
