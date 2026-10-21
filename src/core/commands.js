import { analyzeSignalFlow, complexText } from './analysis/signal-flow.js';
import { Circuit, canonicalNetName, normalizeTags, parseTermRef, transformComponentWorld } from './model.js';
import { captureComponentTerminalPositions, captureNetTerminalPositions, componentTerminalMoves, rerouteTouchedNets, setPartValue } from './part-moves.js';
import { TRANSFER_FUNCTION_ROLE, isTransferFunction } from './transfer-function.js';
import { getSymbol, symbolTypeNames } from './components/index.js';
import { GRID, onGrid, snap, ceilGrid } from './grid.js';
import { applyTransform, fmt, rectsOverlap } from './geometry.js';
import { balancedCrossCoupling, gateBodyCrossingAllowed, segThroughInterior, smartRoute } from './router.js';
import { crossNetOverlaps } from './wiring.js';
import { plainTexText, svgString } from './render.js';
import { hiddenSupplyBarLabels } from './supply-bars.js';
import { MOS_SIZE_TYPES, formatMosSize, parseMosSize } from './mos-size.js';
import { VALUE_TYPES, replacedNameLabels } from './part-value.js';
import { analyzeSmallSignal } from './analysis/index.js';
import { placeSmallSignalModel, smallSignalSchematic } from './analysis/model-schematic.js';
import { joinLineAnnotations } from './line-join.js';
import { addBeat, beatTitle, mergeBeats, moveBeat, phaseBeats, removeBeat, renameBeat, resolveBeat, setPresenceFrom, setSwitchFrom } from './beats.js';
import { addTimingDiagram, existingTimingDiagram, timingBeatBands, timingPhaseNamed, timingPhases, timingStates } from './timing-diagram.js';
import { addTerminalStubs } from './stubs.js';
import { addBoxAround } from './wrap-box.js';
import { addPartsTable, partsTableParts } from './parts-table.js';
import { RENUMBER_ORDERS, renumberParts } from './renumber.js';
import { swapCandidates, swapComponentType } from './swap.js';
import { PIN_RAIL_TYPES, addPinRail } from './pin-rails.js';
import { fixAllIssues, tidySelection } from './tidy.js';
import { findInLabels, replaceInLabels } from './label-search.js';
import { normalizeNotes } from './notes.js';

/** Materialize a net's route with the pin-escaped outside bends: two-terminal
  *  nets route via smartRoute; larger nets get the balanced T-junction; nets
 *  with mid-wire junctions are walked through every anchor in order.
 *  Delegates to the model's fresh-layout path so 3+ terminal nets get the
 *  multi-branch T-junction geometry (steinerBranches), not a single polyline. */
function routeNet(circuit, net) {
  if (circuit.rerouteNet(net, 'refresh') === false) throw new Error('unable to route wire safely');
}

/** Reroute every net touching `refs` (part-moves.js rerouteTouchedNets),
 *  refusing the edit when one cannot follow. */
function rerouteNetsFor(circuit, refs, moved, options = {}) {
  if (rerouteTouchedNets(circuit, refs, moved, options) !== null) throw new Error('unable to route wire safely');
}

/** Outward direction from a component body toward a world terminal pin
 *  (Circuit#_pinDir, by the pin at that point). */
function pinDir(c, wx, wy) {
  const t = c.terminalDefs.find((term) => {
    const p = applyTransform(c.transform, term.x, term.y);
    return p.x === wx && p.y === wy;
  });
  return c.circuit._pinDir(c, t || {}, wx, wy);
}

const FLAG_ARITY = {
  at: 2,
  zero: 1,
  const: 1,
  rot: 1,
  value: 1,
  label: 1,
  name: 1,
  reference: 1,
  'device-region': 1,
  'ac-ground': 1,
  'ignore-channel-length-modulation': 0,
  'ignore-body-effect': 0,
  'gmro-large': 0,
  'dominant-pole': 0,
  input: 1,
  output: 1,
  net: 1,
  file: 1,
  align: 1,
  'right-edge': 1,
  mirrorX: 0,
  mirrorY: 0,
  json: 0,
  explain: 0,
  grid: 0,
  after: 1,
  beat: 1,
  case: 0,
  regex: 0,
  text: 1,
  order: 1,
  slot: 1,
  height: 1,
  hold: 1,
  linear: 1,
  beats: 0,
  gaps: 1,
  'no-gaps': 0,
  fall: 1,
  rise: 1,
  order: 1,
  place: 0,
  replace: 0,
  add: 1,
  rm: 1,
  arrow: 1,
  mark: 1,
  span: 1,
  break: 1,
  clear: 1,
};

/** Split a command line into array honoring double-quoted strings. */
export function splitArgs(line) {
  const m = String(line).match(/"[^"]*"|\S+/g);
  return m ? m.map((s) => (s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s)) : [];
}

/** Parse args into {pos, flags} given known flag arities. */
export function parseArgs(args) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const arity = FLAG_ARITY[key];
      if (arity === undefined) throw new Error(`unknown flag --${key}`);
      flags[key] = arity === 0 ? true : [];
      for (let k = 0; k < arity; k++) {
        if (i + 1 >= args.length) throw new Error(`--${key} expects ${arity} value(s)`);
        flags[key].push(args[++i]);
      }
    } else {
      pos.push(a);
    }
  }
  return { pos, flags };
}

function pp(x, y) {
  return `(${fmt(x)},${fmt(y)})`;
}

function termInfo(circuit, comp, term) {
  const c = circuit.components.get(comp);
  if (!c) return `${comp}.${term}??`;
  const p = c.terminalWorld(term);
  return `${comp}.${term}${pp(p.x, p.y)}`;
}

const ISSUE_HINTS = {
  'unconnected-terminal': 'Connect this terminal with Wire/connect, or deliberately remove the unused component.',
  'component-overlap': 'Move one component at least one grid cell clear of the other component body.',
  'label-component-overlap': 'Move the label into open space; keep its anchor attached if it is an electrical net label.',
  'label-overlap': 'Separate the labels or adjust their alignment so their text does not overlap.',
  'wire-through-body': 'Reroute the net around the component body; only a shared MOS gate bus may use the documented exception.',
  'managed-diagonal': 'Redraw this net with F3 set to orthogonal; keep diagonal geometry for deliberately drawn diagonals.',
  'grid-violation': 'Move or edit the object onto the 40-unit grid.',
  'cross-net-overlap': 'Choose one physical net and move the other collinear span; crossings may cross transversely but must not overlap.',
  'malformed-net-label': 'Retarget the label to a drawable point on a named physical net, or convert it to a free annotation.',
};

function routeExplanation(circuit, refs) {
  if (refs.length !== 2) throw new Error('usage: explain connect REF.TERM REF.TERM');
  const endpoints = refs.map((ref) => circuit.resolveTerm(ref));
  const points = endpoints.map(({ comp, term }) => circuit.getComponent(comp).terminalWorld(term));
  const existing = circuit.netOfTerminal(endpoints[0]);
  const env = circuit._netEnv(existing?.id || null);
  const path = smartRoute(points[0], points[1], env);
  const segments = path ? path.slice(1).map((point, i) => ({ from: path[i], to: point })) : [];
  const length = segments.reduce((sum, segment) => sum + Math.abs(segment.to.x - segment.from.x) + Math.abs(segment.to.y - segment.from.y), 0);
  const turns = path ? Math.max(0, path.length - 2) : null;
  const first = segments[0];
  const last = segments.at(-1);
  const pinEscape = {
    source: first ? { x: Math.sign(first.to.x - first.from.x), y: Math.sign(first.to.y - first.from.y) } : null,
    target: last ? { x: Math.sign(last.from.x - last.to.x), y: Math.sign(last.from.y - last.to.y) } : null,
  };
  const result = {
    source: refs[0],
    target: refs[1],
    points,
    path,
    length,
    turns,
    pinEscape,
    existingNetId: existing?.id || null,
    routeable: !!path,
    reason: path
      ? `Found a ${length}-unit route with ${turns} bend${turns === 1 ? '' : 's'}; the first and last legs leave the pins before entering open routing space.`
      : 'No safe route was found. The router rejected candidates that cross component bodies, violate pin direction, or overlap another net.',
  };
  return result;
}

function diagnosticExplanation(report) {
  const byKind = new Map();
  for (const issue of report.issues || []) {
    if (!byKind.has(issue.kind)) byKind.set(issue.kind, []);
    byKind.get(issue.kind).push(issue);
  }
  const groups = [...byKind].map(([kind, issues]) => ({
    kind,
    count: issues.length,
    hint: ISSUE_HINTS[kind] || 'Inspect the referenced objects and make the smallest safe edit.',
    issues: issues.map(({ kind: ignored, severity: ignoredSeverity, ...issue }) => issue),
  }));
  return {
    ok: report.ok,
    summary: report.ok ? 'No design-check issues were found.' : `${report.issues.length} design-check issue${report.issues.length === 1 ? '' : 's'} need attention.`,
    groups,
  };
}

/** Evaluation report used to judge whether the diagram "looks good". */
export function evaluate(circuit) {
  const comps = [...circuit.components.values()];
  const annotated = (c) => c.type === 'solder'; // pure annotation: no electrical body
  const terminals = [];
  const dangling = [];
  const issues = [];
  const terminalRefsByPoint = new Map();
  const addIssue = (kind, message, details = {}) => {
    issues.push({ kind, severity: 'error', message, hint: ISSUE_HINTS[kind] || 'Inspect the referenced objects and make the smallest safe edit.', ...details });
  };
  const pointCopy = (p) => ({ x: p.x, y: p.y });
  const refsAt = (p) => terminalRefsByPoint.get(`${p.x},${p.y}`) || [];

  let violations = [];
  for (const c of comps) {
    for (const t of c.terminalDefs) {
      const w = c.terminalWorld(t.name);
      const net = circuit.netOfTerminal({ comp: c.refdes, term: t.name });
      const ref = `${c.refdes}.${t.name}`;
      const point = pointCopy(w);
      const pointKey = `${w.x},${w.y}`;
      if (!terminalRefsByPoint.has(pointKey)) terminalRefsByPoint.set(pointKey, []);
      terminalRefsByPoint.get(pointKey).push(ref);
      if (!onGrid(w.x) || !onGrid(w.y)) {
        const message = `${ref}@(${w.x},${w.y}) off-grid`;
        violations.push(message);
        addIssue('grid-violation', message, { refs: [ref], points: [point], location: 'terminal' });
      }
      terminals.push({ ref: `${c.refdes}.${t.name}`, x: w.x, y: w.y, net: net ? net.id : null });
      // Symbols such as schematic blocks and signal-flow operators can expose
      // optional pins. Their bodies still participate in overlap/body checks.
      if (!net && !c.def.allowFloatingTerminals) {
        const message = `${ref}@(${w.x},${w.y})`;
        dangling.push(message);
        addIssue('unconnected-terminal', `unconnected terminal ${message}`, {
          refs: [ref],
          points: [point],
        });
      }
    }
  }
  for (const c of comps) {
    if (!onGrid(c.transform.x) || !onGrid(c.transform.y)) {
      const point = { x: c.transform.x, y: c.transform.y };
      const message = `${c.refdes} origin off-grid`;
      violations.push(message);
      addIssue('grid-violation', message, { refs: [c.refdes], points: [point], location: 'origin' });
    }
  }
  const overlaps = [];
  for (let i = 0; i < comps.length; i++) {
    for (let j = i + 1; j < comps.length; j++) {
      if (annotated(comps[i]) || annotated(comps[j])) continue;
      const a = comps[i].bboxWorld();
      const b = comps[j].bboxWorld();
      if (rectsOverlap(a, b)) {
        const refs = [comps[i].refdes, comps[j].refdes];
        const message = refs.join('/');
        overlaps.push(message);
        addIssue('component-overlap', `overlapping bboxes ${message}`, {
          refs,
          points: [
            { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) },
            { x: Math.min(a.x + a.w, b.x + b.w), y: Math.min(a.y + a.h, b.y + b.h) },
          ],
        });
      }
    }
  }
  // A joined supply bar shows one of its supplies' labels; the hidden ones
  // are not drawn, so they cannot overlap anything.
  // A size label standing in for a name hides it the same way.
  const barHidden = hiddenSupplyBarLabels(circuit);
  for (const id of replacedNameLabels(circuit)) barHidden.add(id);
  const labels = [...circuit.labels.values()].filter((label) => !['arrow', 'box', 'line'].includes(label.kind) && !barHidden.has(label.id));
  const labelComponentOverlaps = [];
  const labelOverlaps = [];
  const netLabelIssues = [];
  for (const label of labels) {
    if (!label.netId) continue;
    const net = circuit.nets.get(label.netId);
    const malformed = (message) => {
      const issue = { labelId: label.id, netId: label.netId, message };
      netLabelIssues.push(issue);
      addIssue('malformed-net-label', message, {
        refs: [label.id],
        labelId: label.id,
        netId: label.netId,
      });
    };
    if (!net) { malformed(`net label ${label.id} targets missing net ${label.netId}`); continue; }
    if (label.owner) malformed(`net label ${label.id} also has owner ${label.owner}`);
    if (!canonicalNetName(net.name)) malformed(`net label ${label.id} targets unnamed net ${net.id}`);
    else if (!circuit._netLabelAnchorOnPath(net, label.anchorWorld()) && !circuit.netLabelFits(label)) {
      malformed(`net label ${label.id} does not touch drawable net ${net.id}`);
    }
  }
  const overlapPoints = (a, b) => [
    { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) },
    { x: Math.min(a.x + a.w, b.x + b.w), y: Math.min(a.y + a.h, b.y + b.h) },
  ];
  // Overlaps are what the reader sees: a label's text against a part's
  // strokes and shapes, or another label's text. Grid-rounded label boxes are placement
  // aids and routinely overlap without anything touching.
  for (const label of labels) {
    const labelBox = label.inkRect();
    for (const comp of comps) {
      if (annotated(comp)) continue;
      // A transfer function's equation is drawn inside its own box.
      if (label.role === TRANSFER_FUNCTION_ROLE && label.owner === comp.refdes) continue;
      if (!comp.inkTouches(labelBox)) continue;
      const compBox = comp.inkRectWorld();
      const message = `label ${label.id} overlaps ${comp.refdes}(${comp.type})`;
      labelComponentOverlaps.push(message);
      addIssue('label-component-overlap', message, {
        refs: [label.id, comp.refdes],
        points: overlapPoints(labelBox, compBox),
        labelId: label.id,
        componentRef: comp.refdes,
      });
    }
  }
  for (let i = 0; i < labels.length; i++) {
    const a = labels[i];
    const aBox = a.inkRect();
    for (let j = i + 1; j < labels.length; j++) {
      const b = labels[j];
      const bBox = b.inkRect();
      if (!rectsOverlap(aBox, bBox)) continue;
      const refs = [a.id, b.id];
      const message = `labels ${refs.join('/')} overlap`;
      labelOverlaps.push(message);
      addIssue('label-overlap', message, {
        refs,
        points: overlapPoints(aBox, bBox),
        labelIds: refs,
      });
    }
  }
  // `Net.paths()` normalizes managed geometry for rendering.  Evaluation must
  // also inspect explicitly stored paths as-is, otherwise malformed persisted
  // managed geometry (notably a diagonal route) would be silently repaired and
  // reported as clean.
  const evaluationPaths = (net) => {
    if (net.branches?.length) return net.branches;
    if (net.route?.length >= 2) return [net.route];
    return net.paths();
  };
  const nets = [];
  for (const net of circuit.nets.values()) {
    nets.push({ id: net.id, name: net.name, n: net.terminals.length, length: net.length() });
  }
  const gatePassagesForNet = (net) => {
    const passages = [];
    for (const comp of comps) {
      const gate = comp.terminalDefs.find((t) => t.direction === 'gate');
      if (!gate) continue;
      const gateNet = circuit.netOfTerminal({ comp: comp.refdes, term: gate.name });
      if (gateNet?.id !== net.id) continue;
      const point = comp.terminalWorld(gate.name);
      passages.push({ rect: comp.bboxWorld(), point, dir: pinDir(comp, point.x, point.y) });
    }
    return passages.length >= 2 ? passages : [];
  };
  // Wires running through the strict interior of a component's bounding box.
  // A shared MOS gate bus is the intentional exception: it may enter the body
  // on a gate axis when at least two MOS gates belong to that same physical net.
  const boxViolations = [];
  const diagonalViolations = [];
  for (const net of circuit.nets.values()) {
    const gateEnv = { gatePassages: gatePassagesForNet(net) };
    for (const pts of evaluationPaths(net)) {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        if (a.x !== b.x && a.y !== b.y && !net.allowDiagonal) {
          const message = `net ${net.id} diagonal (${a.x},${a.y})-(${b.x},${b.y})`;
          const refs = [...new Set([...refsAt(a), ...refsAt(b)])];
          diagonalViolations.push(message);
          addIssue('managed-diagonal', message, {
            refs,
            points: [pointCopy(a), pointCopy(b)],
            netId: net.id,
          });
        }
        for (const comp of comps) {
          // A part drawn under the wires lets them cross it.
          if (annotated(comp) || comp.behindWires) continue;
          const compBox = comp.bboxWorld();
          if (segThroughInterior(a, b, compBox) &&
              !gateBodyCrossingAllowed(a, b, compBox, gateEnv)) {
            const message = `net ${net.id} seg (${a.x},${a.y})-(${b.x},${b.y}) through ${comp.refdes}(${comp.type}) bbox`;
            boxViolations.push(message);
            addIssue('wire-through-body', message, {
              refs: [...new Set([comp.refdes, ...refsAt(a), ...refsAt(b)])],
              points: [pointCopy(a), pointCopy(b)],
              netId: net.id,
            });
          }
        }
      }
    }
  }
  const crossOverlaps = crossNetOverlaps([...circuit.nets.values()].map((net) => ({
    id: net.id,
    paths: evaluationPaths(net),
  })));
  for (const overlap of crossOverlaps) {
    const message = `nets ${overlap.key} and ${overlap.otherKey} overlap (${overlap.x0},${overlap.y0})-(${overlap.x1},${overlap.y1})`;
    addIssue('cross-net-overlap', message, {
      refs: [],
      points: [{ x: overlap.x0, y: overlap.y0 }, { x: overlap.x1, y: overlap.y1 }],
      netIds: [overlap.key.split(':')[0], overlap.otherKey.split(':')[0]],
      segments: [overlap.key, overlap.otherKey],
    });
  }
  const ok = issues.length === 0;
  return {
    components: comps.map((c) => c.refdes),
    terminalCount: terminals.length,
    unconnectedTerminals: dangling,
    nets,
    overlappingBBoxes: overlaps,
    wireThroughBBoxes: boxViolations,
    diagonalWireSegments: diagonalViolations,
    gridViolations: violations,
    labelComponentOverlaps,
    labelOverlaps,
    netLabelIssues,
    logicalNetGroups: circuit.logicalNetGroups().map((group) => ({
      name: group.name,
      netIds: group.netIds.slice(),
      terminalCount: group.terminals.length,
      labelIds: group.labels.map((label) => label.id),
    })),
    crossNetOverlaps: crossOverlaps,
    netNameWarnings: (circuit.netNameWarnings || []).map((warning) => ({
      netId: warning.netId,
      names: warning.names.slice(),
      message: warning.message,
    })),
    issues,
    ok,
    bounds: circuit.bounds(),
  };
}

export function commandHelp() {
  return [
    'Commands',
    '  help | version',
    '  clear                          - start an empty circuit',
    '  add <type> [refdes] [--at X Y] [--rot D] [--mirrorX] [--mirrorY] [--value V]',
    '                                  types: ' + symbolTypeNames.join(' '),
    '  move <refdes> <X> <Y>          - move (snapped to 40-grid)',
    '  rotate <refdes> [deg=90]       - rotate by multiples of 90',
    '  mirror <refdes> <x|y>          - flip along an axis',
    '  value <refdes> [V] [--label beside|replace|hide] - a passive\'s or source\'s value (10k, 1.5n), drawn with its unit only when --label shows it:',
    '                                   beside below the name (C_1 = 1.5 nF), replace in its place, hide (the default) not at all;',
    '  value <refdes> <V>             - set value/label text; a transfer function (tf_s, tf_z) takes tf([num], [den]), [num], [den],',
    '                                   or a gain (k): in s highest power first, in z ascending powers of z^-1 (tf([1 -1], [1]) is 1 - z^-1;',
    '                                   tf([1], [1 -1], \'Variable\', \'z\') for descending powers of z)',
    '  link <refdes> [DESIGN]         - link a part to another design of the workspace (show it, or dive in, from the editor); unlink <refdes>',
    '  waveform <refdes> [sine|pulse|noise|none] - draw a voltage source with a sine, a pulse, or noise in its circle (drawing only)',
    '  drawing-only <refdes>[,refdes...] [on|off] - drawn and checked, but read by no analysis (a placed small-signal model)',
    '  size <refdes>[,refdes...] [W/L] [xM] [replace|beside|hide] - a transistor\'s size and its label, W/L = M·W/L (2u/400n x4; bare numbers are μm);',
    '                                   replace puts the label in place of the name label, beside under it, hide draws none (a parts table shows it);',
    '                                   size <refdes> off removes the size; no size prints it; a comma list sets several parts at once',
    '  partstable [refdes ...] [--at X Y] - put a parts table on the drawing: W, L, m of the transistors, values of passives and sources,',
    '                                   drawn from the parts (it follows their sizes); no names lists every sized or valued part; right of the drawing by default',
    '  rename <refdes> <new>          - rename a component',
    '  renumber [--order ALONG-THEN] [refdes ...] - renumber automatically named parts (M1, R2): along each row/column, then row by row; ALONG and THEN are right|left|up|down, crosswise (default right-down, reading order; up-right: each column bottom up, columns left to right); listed parts trade only their own numbers',
    '  rm <refdes>                    - remove a component',
    '  supplybar on|off <refdes> ...  - join supply bars with aligned same-rail neighbors (visual only)',
    '  supplybar name <NAME|-> <refdes> ... - name every supply of a bar at once (- clears)',
    '  connect REF.TERM REF.TERM ... [--name N] [--explain]  (alias wire)',
    '  cross A1 A2 B1 B2             - two protected diagonal cross-coupled routes',
    '  disconnect REF.TERM            - detach one terminal from its net',
    '  swap <refdes> [type]           - change a part\'s type in place, keeping its wiring (no type: list the choices)',
    '  tag [list] | tag add|rm|set NAME ... - the document\'s tags, for finding it in the Atlas (#NAME searches them)',
    '  notes | notes set TEXT | notes append TEXT | notes clear - the design\'s notes (Markdown, $math$, @M1 or @V_{out} mention',
    '                                   a part or net, [[design]] links another design); append adds TEXT as a new line',
    '  tidy <refdes> ...              - re-lay the parts\' nets fresh and move their crowded labels clear',
    '  fix                            - apply every safe Design Check repair (reroute, snap to grid, move label)',
    '  rail REF.TERM ground|supply|vcm - a ground, supply, or VCM wired one cell out from an unconnected pin',
    '  box ID... [--text TEXT]        - a dashed box annotation one cell around parts, nets, and labels (with the parts\' and nets\' own labels)',
    '  stubs <refdes> ...             - a labeled wire stub (net1, net2, ...) on every unconnected terminal; stubs that would short are skipped',
    '  find TEXT [--case] [--regex]   - list every label (nets, parts, switch phases, rails, annotations), block caption, and unlabeled net name containing TEXT;',
    '                                   without markup TEXT looks through it (M1 finds M_{1}); --regex matches the text as written',
    '  replace FIND WITH [--case] [--regex] - replace FIND in all of them, through each one\'s own rename; all or nothing ("" for WITH deletes; $1 with --regex)',
    '  nets                           - list nets with terminals and length',
    '  net <id> add|drop|name|label|bitcount|rm|segment-rm ... - manage a net',
    '  net <id> bitcount on|off       - show a bus net\'s bit count beside its slashes',
    '                                   net N1 add R1.a ; net N1 drop R2.b ;',
    '                                   net N1 name OUT ; net N1 rm',
    '  netlabel add NET [ID] NAME X Y  - place a label on a physical net',
    '  netlabel rename|retarget|rm ... - edit/remove a net label',
    '  netlabel convert LABEL NET    - convert an annotation to a net label',
    '  netlabel detach LABEL [TEXT]  - convert a net label to an annotation',
    '  netlabel list [NET]             - list net labels',
    '  annotation (label/annotate) add [ID] TEXT X Y [--align ALIGN --right-edge X] - place a free annotation',
    '  annotation rename|move|align|rm ... - edit/remove an annotation label',
    '  annotation join ID ID ...      - join line annotations that meet end to end or share a stretch into one line',
    '  annotation vertex-rm ID N      - remove vertex N (from 0) of a line or arrow',
    '  list                           - list components',
    '  state                          - full JSON state',
    '  bounds                         - drawing extents',
    '  eval                           - quality report (connectivity, overlaps, routing, labels, grid)',
    '  analyze <input-impedance|output-impedance|transfer-function|transimpedance|transconductance|current-gain> NET [options]',
    '  analyze model NET [options]    - place the small-signal model, its output at NET, below the drawing as drawing-only parts',
    '  analyze signal-flow --output NET --input PORT,... [--zero PORT,...] [--const PORT=VALUE,...]',
    '                                 - transfer functions of a block diagram (tf_s/tf_z blocks, sum and multiply junctions):',
    '                                   one per input port to the output; the other sources are zero or constant',
    '    --input NET --output NET --reference NET --ac-ground NET,...',
    '    --device-region REF=triode,... --ignore-body-effect --gmro-large',
    '    --ignore-channel-length-modulation --dominant-pole',
    '  explain eval                   - grouped diagnostics with plain-language repair hints',
    '  explain connect REF.TERM REF.TERM - dry-run route with path, bends, and pin escapes',
    '  switch REF|PHASE open|closed   - draw a switch, and all of its phase, open or closed',
    '  value <switch> PHASE           - set the phase (control signal) a switch shows as its label',
    '  beat list                      - list beats (presentation steps; see docs/beats.md)',
    '  beat add [NAME] [--after N]    - add a beat that looks like the one before it',
    '  beat rm|rename|move N ...      - beat rm N ; beat rename N NAME ; beat move N TO',
    '  beat merge N M ...             - merge beats into one at the first: most visible look, switches closed in any, first highlight',
    '  beat show|dim|hide N ID ...    - show, dim, or hide parts and labels from beat N on',
    '  beat switch N REF|PHASE open|closed - set a switch (its whole phase) from beat N on',
    '  beat phases [--after N|--replace] - add a beat per state of the timing diagram (phases high together close together),',
    '                                   or without one a beat per switch phase: what works shown, the rest dimmed',
    '  timing [ROW=WAVE ...] [--add NAME,...] [--rm NAME,...] [--slot N] [--beats] [--gaps auto|none|A:B,...] [--fall|--rise ROW=N,...] [--order A,B,...] [--place]',
    '                                  rows are the switch phases plus signals of the diagram\'s own (--add CLK; --rm removes one); a diagram needs no switches',
    '                                 - set the design\'s timing and draw it (or redraw it in place), a wave per switch phase; WAVE is',
    '                                   one character per slot: 1 high, 0 low. PHASE is its name (φ1,',
    '                                   $\\varphi_1$), row number, or ~PHASE for its complement. Unset rows keep their wave,',
    '                                   a complement is its phase inverted, else one slot per beat, else low; --beats',
    '                                   retakes them from the beats. Waves repeat past both ends; --slot N is a slot\'s',
    '                                   width in cells. --gaps sets which phases never overlap (a one-cell gap where one',
    '                                   falls as the other rises): none (a new diagram\'s), auto (any two never high together), or pairs.',
    '                                   --fall / --rise move a phase\'s falling / rising edges N cells (negative earlier);',
    '                                   --order φ2,φ1 sets the rows\' order; a drawn diagram stays where it stands,',
    '                                   --place puts it again where the drawing has room for it.',
    '                                   An analog signal (a supply ramp): WAVE as values from -1 to 1, one per slot start, with',
    '                                   commas (VDD=0,.5,1,1): joined straight, or held through each slot with --hold VDD (--linear',
    '                                   joins them again); below zero, the row is drawn about a dashed zero line. --height ROW=4,...',
    '                                   sets rows\' heights (2, 4, 6 ... cells). Its points take arrows, marks and spans as edges do;',
    '                                   a mark on a point between 0 and full is a threshold, dashed at its level.',
    '                                   On the edges (ROW:N, the row\'s edge at the start of slot N; N = slots+1 is the one',
    '                                   after the last): --arrow CLK:2>Q:2,... draws a curved arrow from an edge to the',
    '                                   transition it causes ("CLK:2>Q:2=TEXT;..." labels it); --mark ROW:N,... a dashed line through every row; --span',
    '                                   "A:N>B:M=TEXT;..." dashed lines at two edges and an arrow between them below the',
    '                                   waves, TEXT under it. --break N,... leaves time out of slot N: two S curves through',
    '                                   every row (N:rows, through each row). --clear arrows,marks,spans,breaks (or all) takes them away first.',
    '                                   They follow their edges as the waves change; one whose edge has gone waits for it',
    '  svg [file] [--grid] [--beat N] - export SVG (default data/preview.svg), optionally one beat',
    '  save <file> | load <file>      - JSON snapshot I/O',
    'Flags: --json prints machine-readable result. All coordinates are 40-grid.',
  ].join('\n');
}

export function runCommand(circuit, line, io) {
  // The notes take the rest of the line as written: Markdown and TeX keep
  // their quotes, backslashes, and double dashes.
  const notes = String(line).match(/^\s*notes?\s+(set|append)(?:\s([\s\S]*))?$/i);
  if (notes) return notesCommand(circuit, notes[1].toLowerCase(), notes[2] ?? '');
  const { pos, flags } = parseArgs(splitArgs(line));
  const cmd = pos.shift() || 'help';
  return dispatch(circuit, cmd, pos, flags, io);
}

/** `notes set TEXT` replaces the design's notes; `notes append TEXT` adds
 *  TEXT as a line after them (an empty one for a paragraph break). One pair
 *  of quotes around the whole of TEXT is taken off. */
function notesCommand(circuit, action, raw) {
  const quoted = raw.trim().match(/^"([\s\S]*)"$/);
  const text = quoted ? quoted[1] : raw.trim();
  const before = circuit.notes;
  const next = action === 'set' ? text : before ? `${before.replace(/\n+$/, '')}\n${text}` : text;
  circuit.notes = normalizeNotes(next);
  const lines = circuit.notes ? circuit.notes.split('\n').length : 0;
  return { text: circuit.notes ? `notes: ${lines} line${lines === 1 ? '' : 's'}` : '(no notes)', json: { notes: circuit.notes }, mutated: circuit.notes !== before };
}

function dispatch(circuit, cmd, pos, flags, io) {
  const json = flags.json;
  const result = (text, data, mutated = false) => ({ text, json: data, mutated });

  // ---------- meta / state ----------
  if (cmd === 'help') return result(commandHelp(), null);
  if (cmd === 'version') return result('Mosfeteer 0.1.0 (grid = 40)', null);
  if (cmd === 'clear') {
    circuit.components.clear();
    circuit.nets.clear();
    circuit.labels.clear();
    circuit.netNameWarnings = [];
    return result('cleared', null, true);
  }
  if (cmd === 'list') {
    const rows = [];
    for (const c of circuit.components.values()) {
      const terms = c.worldTerminals().map((t) => `${t.name}=${pp(t.x, t.y)}`).join(' ');
      rows.push(`${c.refdes.padEnd(8)} ${c.type.padEnd(12)} at ${pp(c.transform.x, c.transform.y)} rot=${c.transform.rotation} mX=${c.transform.mirrorX ? 1 : 0} mY=${c.transform.mirrorY ? 1 : 0}  ${terms}`);
    }
    return result(rows.join('\n') || '(no components)', null);
  }
  if (cmd === 'nets') return netList(circuit, result);
  if (cmd === 'state') return result(JSON.stringify(circuit.toJSON(), null, 2), circuit.toJSON());
  if (cmd === 'bounds') {
    const b = circuit.bounds();
    return result(`bounds ${pp(b.x, b.y)} .. ${pp(b.x + b.w, b.y + b.h)} (${fmt(b.w)} x ${fmt(b.h)})`, b, false);
  }
  if (cmd === 'eval') {
    const rep = evaluate(circuit);
    const lines = [
      `components: ${rep.components.length}`,
      `terminals:  ${rep.terminalCount}, unconnected: ${rep.unconnectedTerminals.length}`,
    ];
    if (rep.unconnectedTerminals.length) lines.push(`  dangling: ${rep.unconnectedTerminals.join(', ')}`);
    lines.push(`nets: ${rep.nets.length}`);
    for (const n of rep.nets) lines.push(`  ${n.id} ${n.name ? `"${n.name}" ` : ''}n=${n.n} len=${n.length}`);
    if (rep.overlappingBBoxes.length) lines.push(`overlapping bboxes: ${rep.overlappingBBoxes.join(', ')}`);
    if (rep.wireThroughBBoxes.length) lines.push(`wires through bboxes: ${rep.wireThroughBBoxes.join(', ')}`);
    if (rep.diagonalWireSegments.length) lines.push(`managed diagonal wires: ${rep.diagonalWireSegments.join(', ')}`);
    if (rep.gridViolations.length) lines.push(`GRID VIOLATIONS: ${rep.gridViolations.join(', ')}`);
    if (rep.labelComponentOverlaps.length) lines.push(`label-component overlaps: ${rep.labelComponentOverlaps.join(', ')}`);
    if (rep.labelOverlaps.length) lines.push(`label overlaps: ${rep.labelOverlaps.join(', ')}`);
    if (rep.crossNetOverlaps.length) lines.push(`cross-net overlaps: ${rep.crossNetOverlaps.map((x) => `${x.key}/${x.otherKey}`).join(', ')}`);
    if (rep.netNameWarnings.length) lines.push(`net name conflicts: ${rep.netNameWarnings.map((x) => x.message).join('; ')}`);
    if (rep.ok) {
      lines.push('no dangling terminals, no bbox overlaps, all on grid');
    }
    return result(lines.join('\n'), rep, false);
  }
  if ((cmd === 'analyze' || cmd === 'analysis') && ['signal-flow', 'signalflow', 'sfg'].includes(pos[0])) {
    const list = (values) => (values || []).flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean);
    const output = flags.output?.[0] || pos[1];
    const sources = {};
    for (const ref of list(flags.input)) sources[ref] = 'input';
    for (const ref of list(flags.zero)) sources[ref] = 'zero';
    for (const entry of list(flags.const)) {
      const match = entry.match(/^([^=]+)=(.+)$/);
      if (!match) throw new Error('--const expects PORT=VALUE');
      sources[match[1].trim()] = { constant: match[2].trim() };
    }
    if (!output || !Object.values(sources).includes('input')) {
      throw new Error('usage: analyze signal-flow --output NET --input PORT,... [--zero PORT,...] [--const PORT=VALUE,...]');
    }
    const report = analyzeSignalFlow(circuit, { output, sources });
    if (!report.ok) throw new Error(report.error);
    const lines = report.entries.flatMap((entry) => [
      entry.equation,
      ...(entry.zeros?.length ? [`  zeros: ${entry.zeros.map(complexText).join(', ')}`] : []),
      ...(entry.poles?.length ? [`  poles: ${entry.poles.map(complexText).join(', ')}`] : []),
    ]);
    return result(lines.join('\n'), { variable: report.variable, output: report.output, entries: report.entries.map(({ value, ...entry }) => entry) });
  }
  if (cmd === 'analyze' || cmd === 'analysis') {
    const subject = pos.shift();
    const quantity = {
      'input-impedance': 'input', rin: 'input', zin: 'input',
      'output-impedance': 'output', rout: 'output', zout: 'output',
      'transfer-function': 'transfer', transfer: 'transfer', gain: 'transfer',
      transimpedance: 'transimpedance', zm: 'transimpedance',
      transconductance: 'transconductance', gm: 'transconductance',
      'current-gain': 'currentGain', ai: 'currentGain',
      model: 'model',
    }[subject];
    const transferFunction = { transimpedance: 'Zm', transconductance: 'Gm', currentGain: 'Ai' }[quantity];
    const usage = 'usage: analyze <model|input-impedance|output-impedance|transfer-function|transimpedance|transconductance|current-gain> NET [--input NET] [--output NET] [--reference NET] [--ac-ground NET,...] [--device-region REF=triode,...] [--ignore-channel-length-modulation] [--ignore-body-effect] [--gmro-large] [--dominant-pole]';
    if (!quantity) throw new Error(usage);
    const target = pos.shift();
    if (!target || pos.length) throw new Error(usage);
    const list = (values) => (values || []).flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean);
    const deviceRegions = {};
    for (const entry of list(flags['device-region'])) {
      const match = entry.match(/^([^:=\s]+)\s*[:=]\s*([^:=\s]+)$/);
      if (!match || match[2].toLowerCase() !== 'triode') {
        throw new Error('--device-region expects REF=triode');
      }
      deviceRegions[match[1]] = { region: 'triode' };
    }
    const analysisOptions = {
      input: quantity === 'input' ? target : flags.input?.[0],
      output: quantity === 'input' ? flags.output?.[0] : target,
      ...(flags.reference ? { reference: flags.reference[0] } : {}),
      ...(flags['ac-ground'] ? { acGrounds: list(flags['ac-ground']) } : {}),
      ...(Object.keys(deviceRegions).length ? { deviceRegions } : {}),
      ...(flags['ignore-channel-length-modulation'] ? { neglectChannelLengthModulation: true } : {}),
      ...(flags['ignore-body-effect'] ? { neglectBodyEffect: true } : {}),
      ...(flags['gmro-large'] ? { highIntrinsicGain: true } : {}),
      ...(flags['dominant-pole'] ? { dominantPole: true } : {}),
      ...(transferFunction ? { transferFunctions: [transferFunction] } : {}),
    };
    const combined = analyzeSmallSignal(circuit, analysisOptions);
    if (quantity === 'model') {
      if (!combined.ok) throw new Error(combined.diagnostics?.errors?.[0]?.detail || combined.error || 'the small-signal analysis failed');
      const model = smallSignalSchematic(combined, { circuit, ports: false });
      if (!model.ok) throw new Error(model.error);
      const added = placeSmallSignalModel(circuit, model);
      return result(`placed the small-signal model below the drawing: ${added.components.join(', ')}`, added, true);
    }
    const report = combined.reports[quantity];
    const lines = [report.ok ? report.equation : `unsupported: ${report.error}`];
    const dc = quantity === 'input' ? combined.dcInputImpedance
      : quantity === 'output' ? combined.dcOutputImpedance : report.dcValue;
    if (report.frequencyResponse?.hasFrequency && dc?.equation) lines.push(`DC: ${dc.equation}`);
    if (quantity !== 'input' && quantity !== 'output') {
      for (const root of report.frequencyResponse?.poles || []) lines.push(`pole: ${root.equation}`);
      for (const root of report.frequencyResponse?.zeros || []) lines.push(`zero: ${root.equation}`);
    }
    if (report.ok) {
      if (combined.input) lines.push(`input: ${combined.input.name || combined.input.netId}`);
      if (combined.output) lines.push(`output: ${combined.output.name || combined.output.netId}`);
    }
    if (Number.isFinite(report.equationCount)) lines.push(`node system: ${report.equationCount} equations, ${report.unknownCount} unknowns`);
    if (report.smallSignalNetlist) lines.push(`small-signal netlist:\n${report.smallSignalNetlist}`);
    for (const assumption of report.assumptions || []) lines.push(`assumption: ${assumption}`);
    for (const approximation of report.approximations || []) lines.push(`approximation: ${approximation}`);
    return result(lines.join('\n'), report, false);
  }
  if (cmd === 'explain' || cmd === 'diagnose') {
    const subject = pos.shift() || 'eval';
    if (subject === 'eval' || subject === 'check') {
      const explanation = diagnosticExplanation(evaluate(circuit));
      const lines = [explanation.summary];
      for (const group of explanation.groups) {
        lines.push(`${group.kind} (${group.count}): ${group.hint}`);
        for (const issue of group.issues) lines.push(`  ${issue.message}`);
      }
      return result(lines.join('\n'), explanation, false);
    }
    if (subject === 'connect' || subject === 'route') {
      const explanation = routeExplanation(circuit, pos);
      const lines = [explanation.reason, `  ${explanation.source} -> ${explanation.target}`];
      if (explanation.path) lines.push(`  path: ${explanation.path.map((point) => pp(point.x, point.y)).join(' -> ')}`);
      return result(lines.join('\n'), explanation, false);
    }
    throw new Error('usage: explain eval | explain connect REF.TERM REF.TERM');
  }
  // ---------- components ----------
  if (cmd === 'add') {
    const type = pos[0];
    const def = getSymbol(type);
    let refdes = pos[1];
    let x;
    let y;
    if (flags.at) {
      x = Number(flags.at[0]);
      y = Number(flags.at[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('--at expects numeric X Y');
    } else {
      const b = circuit.bounds();
      x = b.w > 0 || b.h > 0 ? ceilGrid(b.x + b.w) + GRID : 0;
      y = b.w > 0 || b.h > 0 ? snap(b.y) : 0;
    }
    const c = circuit.addComponent(type, {
      refdes,
      x,
      y,
      rotation: flags.rot ? Number(flags.rot[0]) : 0,
      // Omit the mirror flags when not given so the symbol's own defaults apply
      // (e.g. output ports default to mirrorX, pmos to mirrorY).
      mirrorX: flags.mirrorX ? true : undefined,
      mirrorY: flags.mirrorY ? true : undefined,
      value: flags.value ? flags.value[0] : undefined,
    });
    const terms = c.worldTerminals().map((t) => `${t.name}=${pp(t.x, t.y)}`);
    const m = `${c.transform.mirrorX ? 'X' : ''}${c.transform.mirrorY ? 'Y' : ''}`;
    const text = `added ${c.refdes} (${type}) at ${pp(c.transform.x, c.transform.y)} rot=${c.transform.rotation}${m ? ` mir(${m})` : ''}; terminals ${terms.join(' ')}`;
    return result(text, { refdes: c.refdes, type, at: { x: c.transform.x, y: c.transform.y }, rotation: c.transform.rotation, mirrorX: c.transform.mirrorX, mirrorY: c.transform.mirrorY, terminals: c.worldTerminals() }, true);
  }
  if (cmd === 'move') {
    const c = circuit.getComponent(pos[0]);
    const ox = c.transform.x;
    const oy = c.transform.y;
    circuit.moveComponent(c.refdes, Number(pos[1]), Number(pos[2]));
    const moved = new Map([[c.refdes, { dx: c.transform.x - ox, dy: c.transform.y - oy }]]);
    rerouteNetsFor(circuit, [c.refdes], moved);
    // Touching pins connect at the committed position (a pin that lands exactly
    // on another component's pin joins its net); re-route any merged net.
    if (circuit.connectCoincident(c.refdes) > 0) {
      const touched = new Set();
      for (const id of [...circuit.nets.keys()]) {
        if (circuit.nets.get(id).terminals.some((t) => t.comp === c.refdes)) touched.add(id);
      }
      for (const id of touched) routeNet(circuit, circuit.nets.get(id));
    }
    // A moved component can land a wire leg on top of a same-net wire; reduce
    // the touched nets so overlapped runs merge instead of hiding beneath.
    for (const id of [...circuit.nets.keys()]) {
      const net = circuit.nets.get(id);
      if (net && net.terminals.some((t) => t.comp === c.refdes)) circuit._reduceNet(net);
    }
    // Re-attach wire pieces that landed back on common endpoints after a
    // detached move; this also restores any junction solder markers.
    circuit.reconnectCoincidentNets();
    return result(`moved ${c.refdes} to ${pp(c.transform.x, c.transform.y)}`, { refdes: c.refdes, x: c.transform.x, y: c.transform.y }, true);
  }
  if (cmd === 'rotate') {
    const c = circuit.getComponent(pos[0]);
    const deg = pos[1] !== undefined ? Number(pos[1]) : 90;
    const beforeComponents = captureComponentTerminalPositions(circuit, [c.refdes]);
    const beforeTerminals = captureNetTerminalPositions(circuit, [c.refdes]);
    circuit.setTransform(c.refdes, { rotation: c.transform.rotation + deg });
    rerouteNetsFor(circuit, [c.refdes], null, { fresh: true, beforeTerminals, terminalMoves: componentTerminalMoves(circuit, [c.refdes], beforeComponents) });
    circuit.reconnectCoincidentNets();
    return result(`rotated ${c.refdes} to ${c.transform.rotation}°`, { refdes: c.refdes, rotation: c.transform.rotation }, true);
  }
  if (cmd === 'mirror') {
    const c = circuit.getComponent(pos[0]);
    const axis = (pos[1] || 'x').toLowerCase();
    if (axis !== 'x' && axis !== 'y') throw new Error('mirror axis must be x or y');
    const beforeComponents = captureComponentTerminalPositions(circuit, [c.refdes]);
    const beforeTerminals = captureNetTerminalPositions(circuit, [c.refdes]);
    const operation = axis === 'x' ? 'mirrorX' : 'mirrorY';
    const next = transformComponentWorld(
      c.transform,
      { x: c.transform.x, y: c.transform.y },
      operation,
    );
    circuit.setTransform(c.refdes, {
      rotation: next.rotation,
      mirrorX: next.mirrorX,
      mirrorY: next.mirrorY,
    });
    rerouteNetsFor(circuit, [c.refdes], null, { fresh: true, beforeTerminals, terminalMoves: componentTerminalMoves(circuit, [c.refdes], beforeComponents) });
    circuit.reconnectCoincidentNets();
    circuit.syncJunctionSolders();
    return result(`mirrored ${c.refdes} along ${axis}`, { refdes: c.refdes, axis }, true);
  }
  if (cmd === 'value' || cmd === 'setvalue') {
    const c = circuit.getComponent(pos[0]);
    // A transfer function's definition may span words: tf([1], [1 2 1]).
    const v = isTransferFunction(c) ? pos.slice(1).join(' ') : pos[1];
    const mode = flags.label?.[0];
    if (mode !== undefined) {
      if (!VALUE_TYPES.has(c.type)) throw new Error(`${c.refdes} is a ${c.type}; only passives and sources show a value label`);
      if (!['beside', 'replace', 'hide'].includes(mode)) throw new Error('--label is beside (below the name), replace (in its place), or hide');
    }
    if (v !== undefined) setPartValue(circuit, c.refdes, v);
    else if (mode === undefined) throw new Error('usage: value <refdes> <V> [--label beside|replace|hide]');
    if (mode !== undefined) circuit.setValueLabel(c.refdes, mode);
    const shown = c.valueLabel ? ` (label ${c.valueLabel})` : '';
    return result(`${c.refdes} value = "${c.value}"${shown}`, { refdes: c.refdes, value: c.value, valueLabel: c.valueLabel }, true);
  }
  if (cmd === 'link' || cmd === 'unlink') {
    if (!pos[0]) throw new Error('usage: link <refdes> <design> ; unlink <refdes>');
    const c = circuit.getComponent(pos[0]);
    const name = cmd === 'unlink' ? null : pos.slice(1).join(' ');
    if (cmd === 'link' && !name) return result(c.link ? `${c.refdes} links to ${c.link}` : `${c.refdes} links to no design`, { refdes: c.refdes, link: c.link });
    circuit.setLink(c.refdes, name);
    return result(c.link ? `${c.refdes} links to ${c.link}` : `${c.refdes} unlinked`, { refdes: c.refdes, link: c.link }, true);
  }
  if (cmd === 'drawing-only') {
    if (!pos[0] || (pos[1] && !['on', 'off'].includes(pos[1]))) throw new Error('usage: drawing-only <refdes>[,refdes...] [on|off]');
    // Every part is found before any is changed.
    const parts = pos[0].split(',').filter(Boolean).map((ref) => circuit.getComponent(ref));
    const state = (c) => `${c.refdes} is ${c.drawingOnly ? 'drawing only' : 'analyzed'}`;
    if (!pos[1]) return result(parts.map(state).join('\n'), parts.map((c) => ({ refdes: c.refdes, drawingOnly: c.drawingOnly })));
    for (const c of parts) c.drawingOnly = pos[1] === 'on';
    return result(parts.map(state).join('\n'), parts.map((c) => ({ refdes: c.refdes, drawingOnly: c.drawingOnly })), true);
  }
  if (cmd === 'waveform') {
    if (!pos[0]) throw new Error('usage: waveform <refdes> [sine|pulse|noise|none]');
    const c = circuit.getComponent(pos[0]);
    if (!pos[1]) return result(`${c.refdes} shows ${c.waveform || 'no waveform'}`, { refdes: c.refdes, waveform: c.waveform });
    circuit.setWaveform(c.refdes, pos[1]);
    return result(`${c.refdes} shows ${c.waveform || 'no waveform'}`, { refdes: c.refdes, waveform: c.waveform }, true);
  }
  if (cmd === 'size') {
    if (!pos[0]) throw new Error('usage: size <refdes>[,refdes...] [W/L] [xM] [replace|beside|hide] ; size <refdes> off');
    // Every part is checked, and the size read, before any is changed.
    const parts = pos[0].split(',').filter(Boolean).map((ref) => circuit.getComponent(ref));
    const words = pos.slice(1);
    const mode = String(words.at(-1) || '').toLowerCase();
    const modes = { replace: { replacesName: true, hidden: false }, beside: { replacesName: false, hidden: false }, hide: { hidden: true } };
    const placement = modes[mode];
    if (placement) words.pop();
    const spec = words.join(' ');
    const off = spec.toLowerCase() === 'off';
    if (spec && !off) parseMosSize(spec);
    for (const c of parts) {
      if (!MOS_SIZE_TYPES.has(c.type)) throw new Error(`${c.refdes} is not a transistor; only MOS parts take a size`);
      if (!spec && placement && !c.size) throw new Error(`${c.refdes} has no size to place; give one, e.g. size ${c.refdes} 2u/400n`);
    }
    const describe = (c) => (c.size
      ? `${c.refdes} size ${formatMosSize(c.size)}${c.size.hidden ? ' (no label)' : c.size.replacesName ? ' (in place of its name)' : ''}`
      : `${c.refdes} has no size`);
    const report = () => result(parts.map(describe).join('\n'), parts.length === 1
      ? { refdes: parts[0].refdes, size: parts[0].size }
      : parts.map((c) => ({ refdes: c.refdes, size: c.size })), !!(spec || placement));
    if (!spec && !placement) return report();
    for (const c of parts) {
      if (off) circuit.setComponentSize(c.refdes, null);
      else circuit.setComponentSize(c.refdes, spec || c.size, placement || {});
    }
    return report();
  }
  if (cmd === 'partstable') {
    const parts = pos.flatMap((word) => word.split(',')).filter((word) => word && word.toLowerCase() !== 'all');
    const at = flags.at ? { x: Number(flags.at[0]), y: Number(flags.at[1]) } : null;
    if (at && !(Number.isFinite(at.x) && Number.isFinite(at.y))) throw new Error('usage: partstable [refdes ...] [--at X Y]');
    const box = addPartsTable(circuit, { parts, at });
    const listed = partsTableParts(circuit, box.table).map((c) => c.refdes);
    return result(`parts table ${box.id} at ${pp(box.anchor.x, box.anchor.y)}: ${listed.join(', ') || 'no sized parts yet'}`, { id: box.id, parts: listed }, true);
  }
  if (cmd === 'supplybar' && String(pos[0] || '').toLowerCase() === 'name') {
    if (pos.length < 3) throw new Error('usage: supplybar name <NAME|-> <refdes> [refdes...]');
    const name = pos[1] === '-' ? '' : pos[1];
    const refs = pos.slice(2).map((ref) => circuit.getComponent(ref).refdes);
    circuit.nameSupplyBar(refs, name);
    return result(`supply bar ${refs.join(', ')} ${name ? `named ${name}` : 'unnamed'}`, { refdes: refs, name }, true);
  }
  if (cmd === 'supplybar') {
    const mode = String(pos[0] || '').toLowerCase();
    if (!['on', 'off'].includes(mode) || pos.length < 2) throw new Error('usage: supplybar on|off <refdes> [refdes...]');
    // Validate every name first so a bad one leaves the circuit untouched.
    const refs = pos.slice(1).map((ref) => circuit.getComponent(ref));
    const other = refs.find((c) => c.type !== 'supply');
    if (other) throw new Error(`component ${other.refdes} is not a supply; only supply bars join`);
    for (const c of refs) circuit.setSupplyBarJoin(c.refdes, mode === 'on');
    const names = refs.map((c) => c.refdes);
    return result(`supply bar ${mode === 'on' ? 'joined' : 'split'}: ${names.join(', ')}`, { refdes: names, joinBar: mode === 'on' }, true);
  }
  if (cmd === 'rename') {
    const c = circuit.getComponent(pos[0]);
    const newName = pos[1];
    circuit.renameComponent(c.refdes, newName);
    return result(`renamed ${pos[0]} -> ${newName}`, { from: pos[0], to: newName }, true);
  }
  if (cmd === 'rm' || cmd === 'remove') {
    const c = circuit.getComponent(pos[0]);
    circuit.removeComponent(c.refdes);
    return result(`removed ${pos[0]}`, { removed: pos[0] }, true);
  }

  // ---------- connectivity ----------
  if (cmd === 'connect' || cmd === 'wire') {
    if (pos.length < 2) throw new Error('usage: connect REF.TERM REF.TERM [...]');
    const explanation = flags.explain ? routeExplanation(circuit, pos.slice(0, 2)) : null;
    const net = circuit.connect(...pos);
    if (flags.name && flags.name[0]) circuit.renameNet(net, flags.name[0]);
    const terms = net.terminals.map((t) => termInfo(circuit, t.comp, t.term));
    return result(`net ${net.id}${net.name ? ` "${net.name}"` : ''}: ${terms.join('  ')}; len=${net.length()}${explanation ? `; ${explanation.reason}` : ''}`, { netId: net.id, name: net.name, terminals: net.terminals.map((t) => ({ ...t })), length: net.length(), ...(explanation ? { explanation } : {}) }, true);
  }
  if (cmd === 'cross') {
    if (pos.length !== 4) throw new Error('usage: cross A1 A2 B1 B2');
    const refs = pos.map((ref) => circuit.resolveTerm(ref));
    const points = refs.map((ref) => circuit.getComponent(ref.comp).terminalWorld(ref.term));
    let paths;
    try {
      paths = balancedCrossCoupling([points[0], points[1]], [points[2], points[3]]);
    } catch (err) {
      throw new Error(`invalid cross-coupling endpoints: ${err.message}`);
    }
    const pairNets = [
      [circuit.netOfTerminal(refs[0]), circuit.netOfTerminal(refs[1])],
      [circuit.netOfTerminal(refs[2]), circuit.netOfTerminal(refs[3])],
    ];
    const existing = pairNets.flat();
    if (existing.some(Boolean)) {
      const samePath = (net, path, start, end) => {
        if (!net || net.terminals.length !== 2) return false;
        const members = net.terminals.map((t) => `${t.comp}.${t.term}`);
        if (!members.includes(`${start.comp}.${start.term}`) || !members.includes(`${end.comp}.${end.term}`)) return false;
        const drawn = net.paths();
        if (drawn.length !== 1 || drawn[0].length !== path.length) return false;
        const same = (points) => points.every((p, i) => p.x === path[i].x && p.y === path[i].y);
        return same(drawn[0]) || same([...drawn[0]].reverse());
      };
      const idempotent = pairNets[0][0] && pairNets[0][0] === pairNets[0][1] &&
        pairNets[1][0] && pairNets[1][0] === pairNets[1][1] && pairNets[0][0] !== pairNets[1][0] &&
        samePath(pairNets[0][0], paths[0], refs[0], refs[1]) &&
        samePath(pairNets[1][0], paths[1], refs[2], refs[3]);
      if (!idempotent) throw new Error('cross-coupling endpoints already belong to a net');
      return result(`cross ${pos.join(' ')} already exists (${pairNets[0][0].id}, ${pairNets[1][0].id})`, {
        nets: [pairNets[0][0].toJSON(), pairNets[1][0].toJSON()],
      }, false);
    }
    const nets = [
      circuit.wireDirectTo(refs[0], refs[1], paths[0].slice(1, -1)),
      circuit.wireDirectTo(refs[2], refs[3], paths[1].slice(1, -1)),
    ];
    return result(`cross ${pos.join(' ')}: diagonal nets ${nets[0].id}, ${nets[1].id}`, {
      nets: nets.map((net) => net.toJSON()),
    }, true);
  }
  if (cmd === 'disconnect') {
    const net = circuit.disconnect(pos[0]);
    return result(`disconnected ${pos[0]} (net ${net.id})`, { terminal: pos[0], netId: net.id }, true);
  }
  if (cmd === 'netlabel' || cmd === 'net-label' || cmd === 'net_label' || cmd === 'nlabel' || cmd === 'wirelabel' || cmd === 'wire-label') {
    return netLabelCommand(circuit, pos, result);
  }
  if (cmd === 'annotation' || cmd === 'annotate' || cmd === 'label') {
    return annotationCommand(circuit, pos, result, flags);
  }
  if (cmd === 'net') return netCommand(circuit, pos, result);
  if (cmd === 'swap') {
    if (pos.length !== 2) {
      const c = pos[0] && circuit.components.get(pos[0]);
      if (c) return result(`${c.refdes} (${c.type}) can become: ${swapCandidates(c.type).join(' ') || 'nothing'}`, swapCandidates(c.type));
      throw new Error('usage: swap <refdes> <type>');
    }
    const from = circuit.getComponent(pos[0]).type;
    const c = swapComponentType(circuit, pos[0], pos[1]);
    return result(`${pos[0]} (${from}) is now ${c.refdes} (${c.type})`, { refdes: c.refdes, type: c.type }, true);
  }
  if (cmd === 'notes' || cmd === 'note') {
    if (!pos.length) return result(circuit.notes || '(no notes)', { notes: circuit.notes });
    if (pos.length === 1 && pos[0] === 'clear') {
      const changed = !!circuit.notes;
      circuit.notes = '';
      return result('(no notes)', { notes: '' }, changed);
    }
    throw new Error('usage: notes | notes set TEXT | notes append TEXT | notes clear');
  }
  if (cmd === 'tag' || cmd === 'tags') {
    const [action, ...names] = pos;
    if (!action || action === 'list') return result(circuit.tags.length ? circuit.tags.map((tag) => `#${tag}`).join(' ') : '(no tags)', [...circuit.tags]);
    if (!['add', 'rm', 'set'].includes(action) || (action !== 'set' && !names.length)) throw new Error('usage: tag [list] | tag add NAME ... | tag rm NAME ... | tag set NAME ...');
    const before = circuit.tags.join('\n');
    const drop = new Set(normalizeTags(names).map((tag) => tag.toLowerCase()));
    circuit.tags = action === 'set' ? normalizeTags(names)
      : action === 'add' ? normalizeTags([...circuit.tags, ...names])
        : circuit.tags.filter((tag) => !drop.has(tag.toLowerCase()));
    const text = circuit.tags.length ? circuit.tags.map((tag) => `#${tag}`).join(' ') : '(no tags)';
    return result(text, [...circuit.tags], circuit.tags.join('\n') !== before);
  }
  if (cmd === 'tidy') {
    if (!pos.length) throw new Error('usage: tidy <refdes> ...');
    for (const refdes of pos) circuit.getComponent(refdes);
    const { rerouted, moved } = tidySelection(circuit, { refs: pos });
    return result(`rerouted ${rerouted.length} net${rerouted.length === 1 ? '' : 's'}, moved ${moved.length} label${moved.length === 1 ? '' : 's'}`, { rerouted, moved }, rerouted.length + moved.length > 0);
  }
  if (cmd === 'fix') {
    const fixed = fixAllIssues(circuit, evaluate);
    const left = evaluate(circuit).issues.length;
    return result(`fixed ${fixed} issue${fixed === 1 ? '' : 's'}; ${left} left for a decision`, { fixed, left }, fixed > 0);
  }
  if (cmd === 'rail') {
    const ref = pos[0] && parseTermRef(pos[0]);
    const type = { gnd: 'ground', vss: 'ground', vdd: 'supply' }[String(pos[1]).toLowerCase()] || pos[1];
    if (!ref || !PIN_RAIL_TYPES.includes(type)) throw new Error('usage: rail REF.TERM ground|supply|vcm');
    const marker = addPinRail(circuit, { comp: ref.comp, term: ref.term }, type);
    return result(`${marker.refdes} (${type}) on ${ref.comp}.${ref.term}`, { refdes: marker.refdes }, true);
  }
  if (cmd === 'stubs' || cmd === 'stub') {
    if (!pos.length) throw new Error('usage: stubs <refdes> ...');
    const { stubs, skipped } = addTerminalStubs(circuit, pos);
    const added = stubs.map((stub) => `${stub.ref} ${stub.name}`).join(', ');
    const message = `${stubs.length} stub${stubs.length === 1 ? '' : 's'}${added ? `: ${added}` : ''}${skipped.length ? `; skipped (would short) ${skipped.join(', ')}` : ''}`;
    return result(message, { stubs, skipped }, stubs.length > 0);
  }
  if (cmd === 'renumber') {
    const order = flags.order?.[0] || 'right-down';
    for (const ref of pos) circuit.getComponent(ref);
    const renames = renumberParts(circuit, { order, refs: pos.length ? pos : null });
    const step = RENUMBER_ORDERS[order];
    const text = renames.length
      ? `renumbered ${step.text}: ${renames.map(({ from, to }) => `${from}->${to}`).join(', ')}`
      : `already numbered ${step.text}`;
    return result(text, { renames }, renames.length > 0);
  }
  if (cmd === 'box') {
    if (!pos.length) throw new Error('usage: box ID... [--text TEXT]');
    const selection = { refs: [], labelIds: [], netIds: [] };
    for (const id of pos) {
      if (circuit.components.has(id)) selection.refs.push(id);
      else if (circuit.nets.has(id)) selection.netIds.push(id);
      else if (circuit.labels.has(id)) selection.labelIds.push(id);
      else throw new Error(`"${id}" is not a part, net, or label`);
    }
    const box = addBoxAround(circuit, selection, { text: flags.text?.[0] || '' });
    return result(`box ${box.id} from ${pp(box.anchor.x, box.anchor.y)} to ${pp(box.end.x, box.end.y)}`, { id: box.id }, true);
  }
  if (cmd === 'find') {
    if (pos.length !== 1) throw new Error('usage: find TEXT [--case] [--regex]  (quote TEXT with spaces)');
    const found = findInLabels(circuit, pos[0], { matchCase: !!flags.case, regex: !!flags.regex });
    const rows = found.map((entry) => `${entry.key} ${entry.role} "${entry.text}"`);
    return result(rows.join('\n') || `no text contains "${pos[0]}"`, found.map(({ key, role, text, count }) => ({ key, role, text, count })));
  }
  if (cmd === 'replace') {
    if (pos.length !== 2) throw new Error('usage: replace FIND WITH [--case] [--regex]  (quote text with spaces)');
    const { changed, joins } = replaceInLabels(circuit, pos[0], pos[1], { matchCase: !!flags.case, regex: !!flags.regex });
    const rows = changed.map((entry) => `${entry.role} "${entry.from}" -> "${entry.to}"`);
    const joined = joins.length ? `\nnets now joined by name: ${joins.join(', ')}` : '';
    return result(`replaced ${changed.length} text${changed.length === 1 ? '' : 's'}${rows.length ? `:\n${rows.join('\n')}` : ''}${joined}`, { changed, joins }, changed.length > 0);
  }
  if (cmd === 'beat' || cmd === 'beats') return beatCommand(circuit, pos, flags, result);
  if (cmd === 'timing') {
    const bits = {};
    for (const arg of pos) {
      const at = arg.lastIndexOf('=');
      if (at <= 0) throw new Error(`usage: timing [PHASE=WAVE ...] [--slot N] [--beats] [--gaps auto|none|A:B,...]; "${arg}" is not PHASE=WAVE`);
      bits[arg.slice(0, at)] = arg.slice(at + 1);
    }
    const slot = flags.slot ? Number(flags.slot[0]) : null;
    if (flags.slot && !(slot >= 1)) throw new Error('--slot is a width in cells, at least 1');
    // --gaps auto | none | φ1:φ2,φ2:φ3 (the pairs kept from overlapping).
    const gapText = flags['no-gaps'] ? 'none' : flags.gaps ? String(flags.gaps[0]).trim() : null;
    const gaps = gapText === null ? null : gapText === 'auto' || gapText === 'none' ? gapText
      : gapText.split(',').filter(Boolean).map((pair) => {
        const names = pair.split(':');
        if (names.length !== 2 || !names[0] || !names[1]) throw new Error(`--gaps takes auto, none, or pairs such as φ1:φ2,φ2:φ3, not "${pair}"`);
        return names;
      });
    // --fall PHASE=N,... / --rise PHASE=N,...: edges moved N cells (negative earlier).
    const shifts = {};
    for (const edge of ['fall', 'rise']) {
      if (!flags[edge]) continue;
      for (const item of String(flags[edge][0]).split(',').filter(Boolean)) {
        const at = item.lastIndexOf('=');
        const cells = Number(item.slice(at + 1));
        if (at <= 0 || !Number.isInteger(cells)) throw new Error(`--${edge} takes PHASE=N (whole cells, negative earlier), not "${item}"`);
        const name = item.slice(0, at);
        shifts[name] = { ...(shifts[name] || {}), [edge]: cells };
      }
    }
    // --add NAME,... / --rm NAME,...: the diagram's own signals (rows not
    // tied to switches).
    const list = (flag) => (flags[flag] ? String(flags[flag][0]).split(',').map((name) => name.trim()).filter(Boolean) : []);
    const signalsAdded = list('add');
    const signalsRemoved = list('rm');
    const current = existingTimingDiagram(circuit);
    for (const [name, shift] of Object.entries(shifts)) {
      // An edge not named keeps its shift.
      const key = timingPhaseNamed(timingPhases(circuit, { add: signalsAdded }), name)?.key;
      const kept = key ? current?.shifts.get(key) : null;
      shifts[name] = { fall: shift.fall ?? kept?.fall ?? 0, rise: shift.rise ?? kept?.rise ?? 0 };
    }
    const order = flags.order ? String(flags.order[0]).split(',').map((name) => name.trim()).filter(Boolean) : null;
    // Arrows, marks and spans on the edges: ROW:N is the row's edge at the
    // start of slot N.
    const phases = timingPhases(circuit, { add: signalsAdded });
    const edge = (text, flag) => {
      const at = text.lastIndexOf(':');
      const slotNumber = Number(text.slice(at + 1));
      if (at <= 0 || !Number.isInteger(slotNumber) || slotNumber < 1) throw new Error(`--${flag} takes edges as ROW:N (the row's edge at the start of slot N), not "${text}"`);
      const phase = timingPhaseNamed(phases, text.slice(0, at).trim());
      if (!phase) throw new Error(`no row "${text.slice(0, at).trim()}"; rows: ${phases.map((p, i) => `${i + 1} ${plainTexText(p.source)}`).join(', ')}`);
      return { row: phase.key, at: slotNumber - 1 };
    };
    const ends = (text, flag) => {
      const parts = text.split('>');
      if (parts.length !== 2) throw new Error(`--${flag} runs from one edge to another, as CLK:2>Q:2, not "${text}"`);
      return { from: edge(parts[0].trim(), flag), to: edge(parts[1].trim(), flag) };
    };
    const clearText = flags.clear ? String(flags.clear[0]).split(',').map((kind) => kind.trim()).filter(Boolean) : [];
    for (const kind of clearText) if (!['arrows', 'marks', 'spans', 'breaks', 'all'].includes(kind)) throw new Error(`--clear takes arrows, marks, spans, breaks or all, not "${kind}"`);
    const cleared = (kind) => clearText.includes(kind) || clearText.includes('all');
    // A break: N (slot N, through every row) or N:rows (through each row).
    const cut = (text) => {
      const [slotText, how, ...rest] = text.split(':').map((part) => part.trim());
      const slotNumber = Number(slotText);
      if (!Number.isInteger(slotNumber) || slotNumber < 1 || rest.length || (how !== undefined && how !== 'rows')) throw new Error(`--break takes slots as N (through every row) or N:rows (through each row), not "${text}"`);
      return { at: slotNumber - 1, ...(how ? { rows: true } : {}) };
    };
    const need = [];
    const notes = {};
    // An arrow's or a span's text follows `=`; with text, items part at `;`.
    const withText = (flag) => (text) => {
      const at = text.indexOf('=');
      return { ...ends(at < 0 ? text : text.slice(0, at), flag), text: at < 0 ? '' : text.slice(at + 1).trim() };
    };
    for (const [kind, flag, separator, parse] of [
      ['arrows', 'arrow', /=|;/.test(String(flags.arrow?.[0] ?? '')) ? ';' : ',', withText('arrow')],
      ['marks', 'mark', ',', (text) => edge(text, 'mark')],
      ['spans', 'span', ';', withText('span')],
      ['breaks', 'break', ',', cut],
    ]) {
      const added = flags[flag] ? String(flags[flag][0]).split(separator).map((item) => item.trim()).filter(Boolean).map(parse) : [];
      need.push(...added.map((item) => ({ kind: flag, item })));
      if (added.length || cleared(kind)) notes[kind] = [...(cleared(kind) ? [] : current?.[kind] || []), ...added];
    }
    // --height ROW=N,...: rows' heights in cells; --hold / --linear ROW,...: analog rows' shape.
    const heights = {};
    for (const item of flags.height ? String(flags.height[0]).split(',').filter(Boolean) : []) {
      const at = item.lastIndexOf('=');
      if (at <= 0) throw new Error(`--height takes ROW=N (cells), not "${item}"`);
      heights[item.slice(0, at)] = item.slice(at + 1);
    }
    const hold = Object.fromEntries([...list('hold').map((name) => [name, true]), ...list('linear').map((name) => [name, false])]);
    const rows = addTimingDiagram(circuit, { bits, fromBeats: !!flags.beats, slot, gaps, shifts, order, place: !!flags.place, add: signalsAdded, remove: signalsRemoved, ...notes, need, heights, hold });
    if (!rows.length) return result('removed the timing diagram: it had no rows left', [], true);
    const wave = (row) => (row.values ? `${row.values.join(',')}${row.hold ? ' (held)' : ''}` : row.from === 'complement' ? '(inverted)' : row.bits || '(low)');
    const moved = (row) => [row.shift.fall ? ` fall ${row.shift.fall > 0 ? '+' : ''}${row.shift.fall}` : '', row.shift.rise ? ` rise ${row.shift.rise > 0 ? '+' : ''}${row.shift.rise}` : ''].join('');
    const drawn = existingTimingDiagram(circuit);
    const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const extras = [[drawn.arrows.length, 'arrow'], [drawn.marks.length, 'mark'], [drawn.spans.length, 'span'], [drawn.breaks.length, 'break']].filter(([n]) => n).map(([n, word]) => count(n, word));
    const waiting = drawn.missing.length ? `; ${count(drawn.missing.length, 'annotation')} wait${drawn.missing.length === 1 ? 's' : ''} for an edge that has gone` : '';
    return result(`drew a timing diagram: ${rows.map((row) => `${plainTexText(row.phase)} ${wave(row)}${moved(row)}`).join(', ')}${extras.length ? `; ${extras.join(', ')}` : ''}${waiting}`, rows, true);
  }
  if (cmd === 'switch') {
    const [ref, state] = pos;
    if (!ref || !state) throw new Error('usage: switch REF|PHASE open|closed');
    const group = circuit.setSwitchState(ref, state);
    return result(`${group.map((c) => c.refdes).join(' ')} drawn ${state}`, null, true);
  }

  // ---------- files / render ----------
  if (cmd === 'svg' || cmd === 'export') {
    const file = flags.file ? flags.file[0] : pos[0] || 'data/preview.svg';
    const beat = flags.beat ? resolveBeat(circuit, beatIndex(circuit, flags.beat[0])) : null;
    const svg = svgString(circuit, { grid: !!flags.grid, terminals: false, junctions: false, background: true, ...(beat ? { beat: { view: beat, timing: timingBeatBands(circuit, beat.index) } } : {}) });
    if (io) {
      io.writeTextFile(file, svg);
      return result(`wrote ${file} (${svg.length} bytes)`, null);
    }
    return result('(no file I/O) SVG below; use --json for the string', { svg });
  }
  if (cmd === 'save') {
    const file = flags.file ? flags.file[0] : pos[0];
    if (!file) throw new Error('usage: save <file>');
    if (!io) return result('save requires CLI (file I/O)', null);
    io.writeTextFile(file, JSON.stringify(circuit.toJSON(), null, 2));
    return result(`saved state to ${file}`, null);
  }
  if (cmd === 'load') {
    const file = flags.file ? flags.file[0] : pos[0];
    if (!file) throw new Error('usage: load <file>');
    if (!io) return result('load requires CLI (file I/O)', null);
    const data = JSON.parse(io.readTextFile(file));
    const fresh = Circuit.fromJSON(data);
    circuit.components = fresh.components;
    circuit.nets = fresh.nets;
    circuit.labels = fresh.labels;
    return result(`loaded state from ${file}`, fresh.toJSON(), true);
  }

  throw new Error(`unknown command "${cmd}" (try: help)`);
}

function netList(circuit, result) {
  const rows = [];
  for (const net of circuit.nets.values()) {
    const terms = net.terminals.map((t) => termInfo(circuit, t.comp, t.term)).join(' ');
    const labels = circuit.netLabels(net).map((label) => label.id).join(',');
    rows.push(`${net.id}${net.name ? ` "${net.name}"` : ''} n=${net.terminals.length} len=${net.length()}${labels ? ` labels=${labels}` : ''}  [${terms}]`);
  }
  return result(rows.join('\n') || '(no nets)', null);
}

function netLabelCommand(circuit, pos, result) {
  const op = pos[0];
  if (op === 'list') {
    const labels = pos[1] ? circuit.netLabels(pos[1]) : [...circuit.labels.values()].filter((label) => label.isNetLabel());
    const rows = labels.map((label) => `${label.id} net=${label.netId} name="${label.text}" at ${pp(label.anchorWorld().x, label.anchorWorld().y)}`);
    return result(rows.join('\n') || '(no net labels)', labels.map((label) => label.toJSON()));
  }
  if (op === 'add') {
    const netId = pos[1];
    if (!netId) throw new Error('usage: netlabel add NET [ID] NAME X Y');
    const tail = pos.slice(2);
    let x = 0;
    let y = 0;
    if (tail.length < 3 || !Number.isFinite(Number(tail.at(-2))) || !Number.isFinite(Number(tail.at(-1)))) {
      throw new Error('usage: netlabel add NET [ID] NAME X Y');
    }
    if (tail.length >= 2 && Number.isFinite(Number(tail.at(-2))) && Number.isFinite(Number(tail.at(-1)))) {
      x = Number(tail.at(-2));
      y = Number(tail.at(-1));
      tail.splice(-2);
    }
    if (tail.length === 0) throw new Error('usage: netlabel add NET [ID] NAME X Y');
    const id = tail.length > 1 ? tail.shift() : undefined;
    const name = tail.join(' ');
    const label = circuit.addNetLabel(netId, { id, text: name, x, y });
    return result(`added net label ${label.id} to ${label.netId} (${label.text})`, label.toJSON(), true);
  }
  if (op === 'rename') {
    const label = circuit._resolveNetLabel(pos[1]);
    const name = pos.slice(2).join(' ');
    if (!name) throw new Error('usage: netlabel rename LABEL NAME');
    circuit.renameNetLabel(label, name);
    return result(`renamed net ${label.netId} to "${label.text}"`, label.toJSON(), true);
  }
  if (op === 'retarget') {
    if (!pos[1] || !pos[2]) throw new Error('usage: netlabel retarget LABEL NET');
    const label = circuit.retargetNetLabel(pos[1], pos[2]);
    return result(`retargeted net label ${label.id} to ${label.netId}`, label.toJSON(), true);
  }
  if (op === 'convert') {
    if (!pos[1] || !pos[2]) throw new Error('usage: netlabel convert LABEL NET');
    const label = circuit.convertLabelToNet(pos[1], pos[2]);
    return result(`converted ${label.id} to net label ${label.netId}`, label.toJSON(), true);
  }
  if (op === 'detach') {
    if (!pos[1]) throw new Error('usage: netlabel detach LABEL [TEXT]');
    const label = circuit.convertNetLabelToAnnotation(pos[1], pos.slice(2).join(' ') || null);
    return result(`converted ${label.id} to an annotation`, label.toJSON(), true);
  }
  if (op === 'rm' || op === 'remove') {
    const label = circuit._resolveNetLabel(pos[1]);
    circuit.removeLabel(label);
    return result(`removed net label ${label.id}`, null, true);
  }
  throw new Error('usage: netlabel add|rename|retarget|convert|detach|rm|list ...');
}

function annotationCommand(circuit, pos, result, flags = {}) {
  const op = pos[0];
  if (op === 'list') {
    const labels = [...circuit.labels.values()].filter((label) => !label.owner && !label.isNetLabel());
    const rows = labels.map((label) => `${label.id} text="${label.text}" at ${pp(label.anchorWorld().x, label.anchorWorld().y)}`);
    return result(rows.join('\n') || '(no annotations)', labels.map((label) => label.toJSON()));
  }
  if (op === 'join') {
    const line = joinLineAnnotations(circuit, pos.slice(1));
    return result(`joined into line ${line.id} with ${line.points.length} points`, line.toJSON(), true);
  }
  if (op === 'add') {
    const tail = pos.slice(1);
    if (tail.length < 3 || !Number.isFinite(Number(tail.at(-2))) || !Number.isFinite(Number(tail.at(-1)))) {
      throw new Error('usage: annotation add [ID] TEXT X Y');
    }
    const x = Number(tail.at(-2));
    const y = Number(tail.at(-1));
    tail.splice(-2);
    const id = tail.length > 1 ? tail.shift() : undefined;
    const align = flags.align?.[0];
    if (align !== undefined && !['left', 'center', 'right'].includes(align)) throw new Error('annotation alignment must be left, center, or right');
    const rightEdge = flags['right-edge'] === undefined ? null : Number(flags['right-edge'][0]);
    if (rightEdge !== null && !Number.isFinite(rightEdge)) throw new Error('--right-edge expects a numeric X');
    const label = circuit.addLabel({ id, text: tail.join(' '), x, y, ...(align ? { align } : {}) });
    if (rightEdge !== null) {
      if (label.align !== 'right') throw new Error('--right-edge requires --align right');
      label.moveTo(rightEdge - label.bbox().w / 2, label.anchor.y);
    }
    return result(`added annotation ${label.id}`, label.toJSON(), true);
  }
  if (op === 'rename') {
    const label = circuit.labels.get(pos[1]);
    if (!label || label.owner || label.isNetLabel()) throw new Error(`unknown annotation "${pos[1]}"`);
    const text = pos.slice(2).join(' ');
    if (!text) throw new Error('usage: annotation rename LABEL TEXT');
    label.setText(text);
    return result(`renamed annotation ${label.id}`, label.toJSON(), true);
  }
  if (op === 'move') {
    const label = circuit.labels.get(pos[1]);
    const x = Number(pos[2]);
    const y = Number(pos[3]);
    if (!label || label.owner || label.isNetLabel() || !Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('usage: annotation move LABEL X Y');
    }
    label.moveTo(x, y);
    return result(`moved annotation ${label.id}`, label.toJSON(), true);
  }
  if (op === 'align') {
    const label = circuit.labels.get(pos[1]);
    const align = pos[2];
    if (!label || label.owner || label.isNetLabel() || !['left', 'center', 'right'].includes(align)) {
      throw new Error('usage: annotation align LABEL left|center|right');
    }
    label.setAlign(align);
    return result(`aligned annotation ${label.id} ${align}`, label.toJSON(), true);
  }
  if (op === 'rm' || op === 'remove') {
    const label = circuit.labels.get(pos[1]);
    if (!label || label.owner || label.isNetLabel()) throw new Error(`unknown annotation "${pos[1]}"`);
    circuit.removeLabel(label);
    return result(`removed annotation ${label.id}`, null, true);
  }
  if (op === 'vertex-rm') {
    const label = circuit.labels.get(pos[1]);
    if (!label || !['arrow', 'line'].includes(label.kind)) throw new Error(`unknown line or arrow "${pos[1]}"`);
    const index = Number(pos[2]);
    if (!Number.isInteger(index)) throw new Error('usage: annotation vertex-rm ID N');
    if (!label.removeVertex(index)) throw new Error(`cannot remove vertex ${index} of ${label.id}: a line keeps two distinct points and an arrow two cells of length`);
    return result(`removed vertex ${index} of ${label.id}`, label.toJSON(), true);
  }
  throw new Error('usage: annotation add|rename|move|align|rm|vertex-rm|list ...');
}

/** A 1-based beat number from a command, as a 0-based index. */
function beatIndex(circuit, value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > circuit.beats.length) {
    throw new Error(circuit.beats.length ? `no beat ${value}; beats are 1..${circuit.beats.length}` : 'there are no beats; add one with: beat add');
  }
  return n - 1;
}

function beatList(circuit) {
  return circuit.beats.map((beat, index) => {
    const parts = [beatTitle(circuit, index).padEnd(18)];
    for (const presence of ['show', 'dim', 'hide']) if (beat[presence].length) parts.push(`${presence} ${beat[presence].join(' ')}`);
    const switches = Object.entries(beat.switches);
    if (switches.length) parts.push(`switches ${switches.map(([ref, state]) => `${ref}=${state}`).join(' ')}`);
    const highlights = Object.entries(beat.highlights);
    if (highlights.length) parts.push(`highlights ${highlights.map(([key, color]) => `${key.replace(/^name:/, '')}=${color || 'none'}`).join(' ')}`);
    return parts.join('  ');
  }).join('\n');
}

function beatCommand(circuit, pos, flags, result) {
  const sub = pos[0] || 'list';
  if (sub === 'list') return result(beatList(circuit) || '(no beats)', circuit.toJSON().beats || []);
  if (sub === 'add') {
    const index = flags.after ? beatIndex(circuit, flags.after[0]) + 1 : circuit.beats.length;
    addBeat(circuit, { index, name: pos.slice(1).join(' ') });
    return result(`added ${beatTitle(circuit, index)}`, { index: index + 1 }, true);
  }
  if (sub === 'rm') {
    const index = beatIndex(circuit, pos[1]);
    const title = beatTitle(circuit, index);
    removeBeat(circuit, index);
    return result(`removed ${title}`, null, true);
  }
  if (sub === 'rename') {
    const index = beatIndex(circuit, pos[1]);
    renameBeat(circuit, index, pos.slice(2).join(' '));
    return result(`renamed ${beatTitle(circuit, index)}`, null, true);
  }
  if (sub === 'move') {
    const from = beatIndex(circuit, pos[1]);
    const to = beatIndex(circuit, pos[2]);
    moveBeat(circuit, from, to);
    return result(`moved beat ${from + 1} to ${to + 1}`, null, true);
  }
  if (sub === 'merge') {
    const indices = pos.slice(1).map((n) => beatIndex(circuit, n));
    const index = mergeBeats(circuit, indices);
    return result(`merged beats ${[...new Set(indices)].sort((a, b) => a - b).map((i) => i + 1).join(', ')} into ${beatTitle(circuit, index)}`, { index: index + 1 }, true);
  }
  if (sub === 'show' || sub === 'dim' || sub === 'hide') {
    const index = beatIndex(circuit, pos[1]);
    const ids = pos.slice(2);
    if (!ids.length) throw new Error(`usage: beat ${sub} N ID ...`);
    const listed = setPresenceFrom(circuit, index, ids, sub);
    return result(`${{ show: 'shown', dim: 'dimmed', hide: 'hidden' }[sub]} from beat ${index + 1}: ${listed.join(' ')}`, null, true);
  }
  if (sub === 'phases') {
    const replace = !!flags.replace;
    if (replace && flags.after) throw new Error('beat phases: --replace and --after do not go together');
    const index = flags.after ? beatIndex(circuit, flags.after[0]) + 1 : replace ? 0 : circuit.beats.length;
    // With a timing diagram drawn, its states are the beats; else one per phase.
    const states = timingStates(circuit);
    const count = phaseBeats(circuit, { index, states, replace });
    return result(`${replace ? 'replaced the beats with' : 'added'} beats ${index + 1}..${index + count}, ${states ? 'one per state of the timing diagram' : 'one per switch phase'}`, { index: index + 1, count }, true);
  }
  if (sub === 'switch') {
    const index = beatIndex(circuit, pos[1]);
    const [ref, state] = pos.slice(2);
    if (!ref || !state) throw new Error('usage: beat switch N REF|PHASE open|closed');
    setSwitchFrom(circuit, index, ref, state);
    return result(`${ref} ${state} from beat ${index + 1}`, null, true);
  }
  throw new Error(`unknown beat command "${sub}"; try: beat list|add|rm|rename|move|merge|show|dim|hide|switch|phases`);
}

function netCommand(circuit, pos, result) {
  const sub = pos[0];
  if (!sub) return netList(circuit, result);
  if (sub === 'list') return netList(circuit, result);
  const net = circuit.nets.get(sub);
  if (!net) throw new Error(`unknown net "${sub}"`);
  const op = pos[1];
  if (op === 'add') {
    circuit.connectTo(net.id, pos[2]);
    routeNet(circuit, net);
    return result(`added ${pos[2]} to net ${net.id}`, net.toJSON(), true);
  }
  if (op === 'drop') {
    for (let i = 0; i < net.terminals.length; i++) {
      const t = net.terminals[i];
      if (`${t.comp}.${t.term}` === pos[2]) {
        net.terminals.splice(i, 1);
        if (net.terminals.length === 0) circuit.removeNet(net);
        else if (net.terminals.length > 1) routeNet(circuit, net);
        circuit.syncJunctionSolders();
        const remaining = circuit.nets.get(net.id);
        return result(`dropped ${pos[2]} from net ${net.id}`, remaining?.toJSON() || null, true);
      }
    }
    throw new Error(`terminal ${pos[2]} not in net ${net.id}`);
  }
  if (op === 'name') {
    circuit.renameNet(net, pos.slice(2).join(' '));
    return result(`net ${net.id} name = "${net.name}"`, net.toJSON(), true);
  }
  if (op === 'bitcount') {
    if (!['on', 'off'].includes(pos[2])) throw new Error('usage: net <id> bitcount on|off');
    const shown = circuit.setBusCountShown(net, pos[2] === 'on');
    return result(`net ${net.id} bit count ${shown ? 'shown' : 'hidden'}`, net.toJSON(), true);
  }
  if (op === 'label') return netLabelCommand(circuit, [pos[2], net.id, ...pos.slice(3)], result);
  if (op === 'segment-rm') {
    const branch = Number(pos[2]);
    const segment = Number(pos[3]);
    if (!Number.isInteger(branch) || !Number.isInteger(segment)) throw new Error('usage: net <id> segment-rm BRANCH SEG');
    circuit.deleteWireSegment(net.id, branch, segment);
    const remaining = circuit.nets.get(net.id);
    return result(`deleted segment ${branch}:${segment} from net ${net.id}`, remaining?.toJSON() || null, true);
  }
  if (op === 'rm') {
    circuit.removeNet(net);
    return result(`removed net ${net.id}`, null, true);
  }
  throw new Error('usage: net <id> add|drop|name|label|bitcount|rm|segment-rm');
}
