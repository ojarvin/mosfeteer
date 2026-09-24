/**
 * Beats: an ordered list of view states over one drawing, so a figure can be
 * built up (or its switch phases shown) step by step. The contract is in
 * docs/beats.md.
 *
 * A beat stores only what changes at it, relative to the beat before; the
 * first beat is relative to the drawing itself:
 *
 *   show / dim / hide  object ids: component refdes, free and net label ids
 *   switches     { refdes: 'open' | 'closed' }
 *   highlights   { netGroupKey: color | null }
 *
 * An object nobody mentions is shown in every beat, so an edit to the
 * drawing shows up everywhere without touching the beats. An object whose
 * first change is a `show` is hidden before it. A dimmed object stays in
 * place, faint. Wires, owned labels, and junction dots are never listed: they
 * follow what they connect or belong to.
 *
 * Every edit decodes the per-beat states of an object (its "track"), changes
 * the track, and encodes it back. Inserting, deleting, or moving a beat
 * therefore never changes how any other beat looks.
 */

import { getSymbol } from './components/index.js';
import { INTERFACE_PIN_TYPES, REFERENCE_MARKER_TYPES, isReferenceMarkerGlobalName } from './model.js';
import { steinerBranches } from './router.js';

export const SWITCH_TYPES = Object.freeze({ open: 'switch_open', closed: 'switch_closed' });
const SWITCH_STATE_OF_TYPE = { switch_open: 'open', switch_closed: 'closed' };

/** 'open' or 'closed' for a switch component, otherwise null. */
export function switchState(component) {
  return SWITCH_STATE_OF_TYPE[component?.type] || null;
}

// ----- stored form ------------------------------------------------------

/** An object's look in one beat, and the list each look is stored in. */
export const PRESENCES = Object.freeze(['show', 'dim', 'hide']);

function emptyBeat(id, name = '') {
  return { id, name, show: [], dim: [], hide: [], switches: {}, highlights: {} };
}

const listed = (beat, id) => PRESENCES.find((presence) => beat[presence].includes(id)) || null;
const mentionedIds = (beats) => new Set(beats.flatMap((beat) => PRESENCES.flatMap((presence) => beat[presence])));

/** Beats read from a document. Anything malformed is dropped, never guessed. */
export function beatsFromJSON(data) {
  if (!Array.isArray(data)) return [];
  const seen = new Set();
  const beats = [];
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue;
    let id = typeof entry.id === 'string' && entry.id ? entry.id : '';
    if (!id || seen.has(id)) id = nextBeatId({ beats: [...beats, { id }] });
    seen.add(id);
    const beat = emptyBeat(id, typeof entry.name === 'string' ? entry.name : '');
    const ids = (list) => [...new Set((Array.isArray(list) ? list : []).filter((value) => typeof value === 'string' && value))];
    beat.show = ids(entry.show);
    beat.dim = ids(entry.dim).filter((value) => !beat.show.includes(value));
    beat.hide = ids(entry.hide).filter((value) => !beat.show.includes(value) && !beat.dim.includes(value));
    for (const [ref, state] of Object.entries(entry.switches || {})) {
      if (state === 'open' || state === 'closed') beat.switches[ref] = state;
    }
    for (const [key, color] of Object.entries(entry.highlights || {})) {
      if (color === null || typeof color === 'string') beat.highlights[key] = color;
    }
    beats.push(beat);
  }
  return beats;
}

/** Beats as saved. References to deleted objects are left out; empty fields
 * are omitted so an untouched beat is just its id and name. */
export function beatsToJSON(circuit) {
  const live = (id) => beatObjectKind(circuit, id) !== null;
  return (circuit.beats || []).map((beat) => {
    const out = { id: beat.id, name: beat.name || '' };
    for (const presence of PRESENCES) {
      const ids = beat[presence].filter(live);
      if (ids.length) out[presence] = ids;
    }
    const switches = Object.entries(beat.switches).filter(([ref]) => switchState(circuit.components.get(ref)));
    const highlights = Object.entries(beat.highlights);
    if (switches.length) out.switches = Object.fromEntries(switches);
    if (highlights.length) out.highlights = Object.fromEntries(highlights);
    return out;
  });
}

export function nextBeatId(circuit) {
  const used = new Set((circuit.beats || []).map((beat) => beat.id));
  let n = 1;
  while (used.has(`b${n}`)) n += 1;
  return `b${n}`;
}

/** Display name of a beat: its number, and its name when it has one. */
export function beatTitle(circuit, index) {
  const beat = circuit.beats?.[index];
  if (!beat) return '';
  return beat.name ? `${index + 1} · ${beat.name}` : `Beat ${index + 1}`;
}

// ----- what a beat can list -------------------------------------------------

/** 'component' or 'label' when `id` can be shown or hidden by a beat, else
 * null. Junction dots, owned labels, and captions of annotation shapes
 * follow their owners instead. */
export function beatObjectKind(circuit, id) {
  const component = circuit.components.get(id);
  if (component) return component.type === 'solder' ? null : 'component';
  const label = circuit.labels.get(id);
  if (label && !label.owner && !label.parent) return 'label';
  return null;
}

/** The object a beat lists for a selected id: an owned label stands for its
 * component and a shape's caption for its shape. */
export function beatTargetId(circuit, id) {
  const label = circuit.components.has(id) ? null : circuit.labels.get(id);
  if (label?.owner) return circuit.components.has(label.owner) ? label.owner : null;
  if (label?.parent) return beatTargetId(circuit, label.parent);
  return beatObjectKind(circuit, id) ? id : null;
}

// ----- tracks -----------------------------------------------------------------

/** Per-beat presence ('show' | 'dim' | 'hide') of one object. */
export function visibilityTrack(beats, id) {
  const first = beats.map((beat) => listed(beat, id)).find(Boolean);
  let presence = first === 'show' ? 'hide' : 'show';
  return beats.map((beat) => {
    presence = listed(beat, id) || presence;
    return presence;
  });
}

function writeVisibilityTrack(beats, id, track) {
  for (const beat of beats) for (const presence of PRESENCES) beat[presence] = beat[presence].filter((value) => value !== id);
  // Hidden before its first appearance: a leading `show` says so on its own.
  const firstSeen = track.findIndex((presence) => presence !== 'hide');
  let presence = firstSeen > 0 && track[firstSeen] === 'show' ? 'hide' : 'show';
  track.forEach((value, index) => {
    if (value === presence) return;
    beats[index][value].push(id);
    presence = value;
  });
}

/** Per-beat value of one keyed field (switches, highlights) over `base`. */
function valueTrack(beats, field, key, base) {
  let value = base;
  return beats.map((beat) => {
    if (Object.hasOwn(beat[field], key)) value = beat[field][key];
    return value;
  });
}

function writeValueTrack(beats, field, key, track, base) {
  let value = base;
  track.forEach((next, index) => {
    delete beats[index][field][key];
    if (next === value) return;
    beats[index][field][key] = next;
    value = next;
  });
}

const switchBase = (circuit, ref) => switchState(circuit.components.get(ref)) || 'open';
const highlightBase = (circuit, key) => circuit.netHighlights.get(key) || null;

/** Change a track at `index` and at the following beats that looked the same,
 * so a change carries forward until the next beat that differs. */
function carryForward(track, index, value) {
  const old = track[index];
  for (let i = index; i < track.length && track[i] === old; i += 1) track[i] = value;
}

/** Apply a structural edit to every track, then store the result. */
function editAllTracks(circuit, edit) {
  const beats = circuit.beats;
  const ids = mentionedIds(beats);
  const refs = new Set(beats.flatMap((beat) => Object.keys(beat.switches)));
  const keys = new Set(beats.flatMap((beat) => Object.keys(beat.highlights)));
  const tracks = [
    ...[...ids].map((id) => ({ kind: 'visible', key: id, track: visibilityTrack(beats, id), base: 'show' })),
    ...[...refs].map((ref) => ({ kind: 'switches', key: ref, track: valueTrack(beats, 'switches', ref, switchBase(circuit, ref)), base: switchBase(circuit, ref) })),
    ...[...keys].map((key) => ({ kind: 'highlights', key, track: valueTrack(beats, 'highlights', key, highlightBase(circuit, key)), base: highlightBase(circuit, key) })),
  ];
  edit(tracks);
  for (const beat of beats) {
    for (const presence of PRESENCES) beat[presence] = [];
    beat.switches = {};
    beat.highlights = {};
  }
  for (const { kind, key, track, base } of tracks) {
    if (kind === 'visible') writeVisibilityTrack(beats, key, track);
    else writeValueTrack(beats, kind, key, track, base);
  }
}

function checkIndex(circuit, index) {
  if (!Number.isInteger(index) || index < 0 || index >= circuit.beats.length) {
    throw new Error(`no beat ${Number.isInteger(index) ? index + 1 : index}`);
  }
}

// ----- editing the list ---------------------------------------------------------

/** Insert a beat at `index` (default: the end) that looks like the beat
 * before it -- or like the first beat when inserted at the front. */
export function addBeat(circuit, { index = circuit.beats.length, name = '' } = {}) {
  if (!Number.isInteger(index) || index < 0 || index > circuit.beats.length) throw new Error(`cannot insert a beat at ${index + 1}`);
  const beat = emptyBeat(nextBeatId(circuit), String(name || '').trim());
  editAllTracks(circuit, (tracks) => {
    circuit.beats.splice(index, 0, beat);
    for (const entry of tracks) {
      const copied = entry.track.length ? entry.track[Math.max(0, index - 1)] : entry.base;
      entry.track.splice(index, 0, copied);
    }
  });
  return index;
}

/** Remove one beat; every other beat keeps its look. */
export function removeBeat(circuit, index) {
  checkIndex(circuit, index);
  editAllTracks(circuit, (tracks) => {
    circuit.beats.splice(index, 1);
    for (const entry of tracks) entry.track.splice(index, 1);
  });
}

/** Move a beat to a new position; every beat keeps its look. */
export function moveBeat(circuit, from, to) {
  checkIndex(circuit, from);
  checkIndex(circuit, to);
  if (from === to) return;
  editAllTracks(circuit, (tracks) => {
    circuit.beats.splice(to, 0, circuit.beats.splice(from, 1)[0]);
    for (const entry of tracks) entry.track.splice(to, 0, entry.track.splice(from, 1)[0]);
  });
}

export function renameBeat(circuit, index, name) {
  checkIndex(circuit, index);
  circuit.beats[index].name = String(name || '').trim();
}

// ----- editing what a beat shows ------------------------------------------------

function targetIds(circuit, ids) {
  const out = [];
  for (const id of ids) {
    const target = beatTargetId(circuit, id);
    if (!target) throw new Error(`"${id}" cannot be shown or hidden by a beat`);
    if (!out.includes(target)) out.push(target);
  }
  return out;
}

function checkPresence(presence) {
  if (!PRESENCES.includes(presence)) throw new Error(`an object is shown, dimmed, or hidden, not "${presence}"`);
}

/** 'show', 'dim', or 'hide' for a listable object in beat `index`. */
export function presenceAt(circuit, id, index) {
  return visibilityTrack(circuit.beats, id)[index] ?? 'show';
}

/** Show, dim, or hide objects from beat `index` on, until the next beat
 * where they already looked different. Returns the listed ids. */
export function setPresenceFrom(circuit, index, ids, presence) {
  checkIndex(circuit, index);
  checkPresence(presence);
  const targets = targetIds(circuit, ids);
  for (const id of targets) {
    const track = visibilityTrack(circuit.beats, id);
    carryForward(track, index, presence);
    writeVisibilityTrack(circuit.beats, id, track);
  }
  return targets;
}

/** Show, dim, or hide objects in beat `index` alone. */
export function setPresenceAt(circuit, index, ids, presence) {
  checkIndex(circuit, index);
  checkPresence(presence);
  const targets = targetIds(circuit, ids);
  for (const id of targets) {
    const track = visibilityTrack(circuit.beats, id);
    track[index] = presence;
    writeVisibilityTrack(circuit.beats, id, track);
  }
  return targets;
}

/** New objects drawn while a beat is shown appear from that beat on. */
export function introduceAt(circuit, index, ids) {
  checkIndex(circuit, index);
  const mentioned = mentionedIds(circuit.beats);
  for (const id of ids) {
    if (!beatObjectKind(circuit, id) || mentioned.has(id)) continue;
    writeVisibilityTrack(circuit.beats, id, circuit.beats.map((_, i) => (i >= index ? 'show' : 'hide')));
  }
}

/** Beats (0-based) in which an object is on the page, dimmed or not. */
export function visibleBeats(circuit, id) {
  const target = beatTargetId(circuit, id);
  if (!target) return [];
  return visibilityTrack(circuit.beats, target).flatMap((presence, index) => (presence === 'hide' ? [] : [index]));
}

export function switchStateAt(circuit, ref, index) {
  const base = switchBase(circuit, ref);
  return valueTrack(circuit.beats, 'switches', ref, base)[index] ?? base;
}

/** Set a switch open or closed from beat `index` on. */
export function setSwitchFrom(circuit, index, ref, state) {
  checkIndex(circuit, index);
  if (!switchState(circuit.components.get(ref))) throw new Error(`"${ref}" is not a switch`);
  if (state !== 'open' && state !== 'closed') throw new Error('a switch is open or closed');
  const base = switchBase(circuit, ref);
  const track = valueTrack(circuit.beats, 'switches', ref, base);
  carryForward(track, index, state);
  writeValueTrack(circuit.beats, 'switches', ref, track, base);
}

/** Highlight colors in beat `index`, keyed by net group. */
export function highlightsAt(circuit, index) {
  const colors = new Map(circuit.netHighlights);
  for (const beat of circuit.beats.slice(0, index + 1)) {
    for (const [key, color] of Object.entries(beat.highlights)) {
      if (color) colors.set(key, color);
      else colors.delete(key);
    }
  }
  return colors;
}

/** Set a net group's highlight (null clears it) from beat `index` on. */
export function setHighlightFrom(circuit, index, key, color) {
  checkIndex(circuit, index);
  const base = highlightBase(circuit, key);
  const track = valueTrack(circuit.beats, 'highlights', key, base);
  carryForward(track, index, color || null);
  writeValueTrack(circuit.beats, 'highlights', key, track, base);
}

/** The beat version of Circuit#cycleNetHighlight: advance the net's group to
 * the next color unused in that beat, from that beat on. */
export function cycleBeatHighlight(circuit, index, net, colors) {
  const key = circuit.netGroupKey(net);
  const live = new Set([...circuit.nets.values()].map((other) => circuit.netGroupKey(other)));
  const current = highlightsAt(circuit, index);
  const taken = new Set([...current].filter(([other]) => other !== key && live.has(other)).map(([, color]) => color));
  const now = current.get(key);
  const from = now ? colors.indexOf(now) + 1 : 0;
  const next = colors.slice(from).find((color) => !taken.has(color)) || null;
  if (!now && !next) throw new Error('every highlight color is already in use');
  setHighlightFrom(circuit, index, key, next);
  return next;
}

// ----- growing a build from a starting point -----------------------------------

const isMarker = (component) => REFERENCE_MARKER_TYPES.includes(component?.type);
const isAttachment = (component) => isMarker(component) || INTERFACE_PIN_TYPES.has(component?.type);
// Terminals a signal enters by: it leaves a part through its other terminals.
const CONTROL_TERMINALS = new Set(['gate', 'bulk', 'base', 'input']);
// The way DC current runs through a transistor: [in, out]. Other parts
// conduct either way.
const CURRENT_FLOW = {
  nmos: ['d', 's'], nmosb: ['d', 's'], npn: ['c', 'e'],
  pmos: ['s', 'd'], pmosb: ['s', 'd'], pnp: ['e', 'c'],
};
// The shared terminal that makes two transistors a differential pair.
const PAIR_TERMINAL = { nmos: 's', nmosb: 's', pmos: 's', pmosb: 's', npn: 'e', pnp: 'e' };
const SOURCE_TYPES = new Set(['current_source', 'voltage_source']);
const MAX_BRANCH_PATHS = 20000;

/** Nets and rails as seen by growOrder: each part's terminals by net group,
 * split into conducting and control terminals, with rails left out. */
function circuitGraph(circuit) {
  const railGroups = new Set();
  for (const net of circuit.nets.values()) {
    const rail = net.terminals.some(({ comp }) => isMarker(circuit.components.get(comp)))
      || (net.name && REFERENCE_MARKER_TYPES.some((type) => isReferenceMarkerGlobalName(type, net.name)));
    if (rail) railGroups.add(circuit.netGroupKey(net));
  }
  const parts = [...circuit.components.values()].filter((c) => c.type !== 'solder' && !isAttachment(c)).map((c) => c.refdes);
  const terminals = new Map(parts.map((ref) => [ref, []])); // ref -> [{ term, key, control, rail }]
  for (const net of circuit.nets.values()) {
    const key = circuit.netGroupKey(net);
    for (const { comp, term } of net.terminals) {
      if (!terminals.has(comp)) continue;
      const direction = circuit.components.get(comp).terminalDefs.find((t) => t.name === term)?.direction;
      terminals.get(comp).push({ term, key, control: CONTROL_TERMINALS.has(direction), rail: railGroups.has(key) });
    }
  }
  const nodesOf = (ref, control) => [...new Set(terminals.get(ref).filter((t) => t.control === control && !t.rail).map((t) => t.key))];
  return { railGroups, parts, terminals, nodesOf };
}

/**
 * Split the parts into sections, the units a build reveals whole:
 *
 * - current branches: runs from one rail to another in the direction current
 *   flows (into a PMOS source, out of an NMOS source), covered greedily by the
 *   longest runs, so a stack like M7-M6-M5-M4 is one section;
 * - a differential pair joins its two branches and their tail;
 * - a passive from a rail to a node of exactly one branch joins that branch
 *   (a load capacitor, a drain resistor);
 * - everything else joins what it conducts to, away from the branches.
 */
function growSections(circuit, graph) {
  const { railGroups, parts, terminals } = graph;
  const type = (ref) => circuit.components.get(ref).type;
  const active = (ref) => CURRENT_FLOW[type(ref)] || SOURCE_TYPES.has(type(ref));
  const nodeOf = (ref, term) => terminals.get(ref).find((t) => t.term === term)?.key;
  const conducting = (ref) => terminals.get(ref).filter((t) => !t.control);
  // Where current can go from `key` through `ref`.
  const through = (ref, key) => {
    const flow = CURRENT_FLOW[type(ref)];
    if (flow) return nodeOf(ref, flow[0]) === key && nodeOf(ref, flow[1]) ? [nodeOf(ref, flow[1])] : [];
    const ends = conducting(ref).map((t) => t.key);
    return ends.length === 2 && ends.includes(key) ? ends.filter((end) => end !== key) : [];
  };
  const twoTerminal = parts.filter((ref) => CURRENT_FLOW[type(ref)] || conducting(ref).length === 2);
  const paths = [];
  const walk = (key, from, used, path) => {
    if (paths.length > MAX_BRANCH_PATHS) return;
    if (railGroups.has(key) && key !== from && path.length) {
      if (path.some(active)) paths.push(path.slice());
      return;
    }
    for (const ref of twoTerminal) {
      if (used.has(ref)) continue;
      for (const next of through(ref, key)) {
        if (next === from) continue;
        used.add(ref);
        path.push(ref);
        walk(next, from, used, path);
        path.pop();
        used.delete(ref);
      }
    }
  };
  for (const rail of railGroups) walk(rail, rail, new Set(), []);

  const sectionOf = new Map();
  const sections = [];
  const place = (refs) => {
    const section = new Set(refs);
    for (const ref of refs) sectionOf.set(ref, section);
    sections.push(section);
    return section;
  };
  // Longest runs of new active parts first; runs that add only passives are
  // not branches of their own.
  const fresh = (path) => path.filter((ref) => !sectionOf.has(ref));
  for (;;) {
    let best = null;
    let bestScore = 0;
    for (const path of paths) {
      const refs = fresh(path);
      const score = refs.filter(active).length * 100 - refs.length;
      if (refs.some(active) && score > bestScore) { best = refs; bestScore = score; }
    }
    if (!best) break;
    place(best);
  }
  const merge = (a, b) => {
    if (a === b) return;
    for (const ref of b) { a.add(ref); sectionOf.set(ref, a); }
    sections.splice(sections.indexOf(b), 1);
  };
  for (const a of parts) {
    for (const b of parts) {
      if (a >= b || !sectionOf.has(a) || !sectionOf.has(b) || type(a) !== type(b) || !PAIR_TERMINAL[type(a)]) continue;
      const shared = nodeOf(a, PAIR_TERMINAL[type(a)]);
      if (shared && !railGroups.has(shared) && shared === nodeOf(b, PAIR_TERMINAL[type(b)])) merge(sectionOf.get(a), sectionOf.get(b));
    }
  }
  const branchNodes = new Map(); // node -> sections conducting on it
  for (const section of sections) {
    for (const ref of section) {
      for (const { key, rail } of conducting(ref)) {
        if (rail) continue;
        if (!branchNodes.has(key)) branchNodes.set(key, new Set());
        branchNodes.get(key).add(section);
      }
    }
  }
  const leftover = parts.filter((ref) => !sectionOf.has(ref));
  for (const ref of leftover) {
    const ends = conducting(ref);
    const inner = ends.filter((t) => !t.rail).map((t) => t.key);
    const owners = inner.length === 1 ? branchNodes.get(inner[0]) : null;
    if (!active(ref) && ends.length === 2 && owners?.size === 1) {
      const [section] = owners;
      section.add(ref);
      sectionOf.set(ref, section);
    }
  }
  // The rest: whatever conducts together away from the branches.
  for (const ref of parts) {
    if (sectionOf.has(ref)) continue;
    const section = place([ref]);
    const queue = [ref];
    while (queue.length) {
      const current = queue.pop();
      for (const { key, rail } of conducting(current)) {
        if (rail || branchNodes.has(key)) continue;
        for (const other of parts) {
          if (sectionOf.has(other) || !conducting(other).some((t) => t.key === key)) continue;
          section.add(other);
          sectionOf.set(other, section);
          queue.push(other);
        }
      }
    }
  }
  return sections.map((section) => [...section].sort());
}

/**
 * The parts a build reveals, beat by beat, as [{ refs, name }]:
 *
 * 1. Stages, from the input to the output. Stage 1 is the section the input
 *    pins drive (or the sections of the given parts); each next stage is the
 *    sections on the nodes the previous stage drives. Parallel sections at
 *    the same depth, such as both halves of a folded cascode, share a stage.
 * 2. Feedback: a section that would drive an earlier stage's gate or join
 *    an earlier stage's node is held back and gets a beat of its own, whole.
 * 3. Bias: one beat per control line the shown parts hang from, in the order
 *    they appeared, with the sections that drive it.
 * 4. Anything else, together.
 *
 * Sections are growSections' current branches. Nets join by name, as they do
 * electrically, but supply and ground rails (a rail marker, or a net named
 * VDD, VSS, GND, or VCM) join nothing. Pins and rail markers are not listed;
 * growBeats shows them with the parts on their wire.
 */
export function growOrder(circuit, startIds = []) {
  const graph = circuitGraph(circuit);
  const sections = growSections(circuit, graph).map((refs) => ({
    refs,
    signal: [...new Set(refs.flatMap((ref) => graph.nodesOf(ref, false)))],
    control: [...new Set(refs.flatMap((ref) => graph.nodesOf(ref, true)))],
  }));
  const sectionOf = new Map(sections.flatMap((section) => section.refs.map((ref) => [ref, section])));
  const netKeysOf = (id) => [...circuit.nets.values()]
    .filter((net) => net.terminals.some(({ comp }) => comp === id))
    .map((net) => circuit.netGroupKey(net));
  const depth = new Map(); // signal node -> stage that drives it (0: an input)
  const controlStage = new Map(); // control node -> first stage hanging from it
  let first;
  if (startIds.length) {
    const pins = startIds.filter((id) => INTERFACE_PIN_TYPES.has(circuit.components.get(id)?.type));
    for (const key of pins.flatMap(netKeysOf)) depth.set(key, 0);
    first = new Set(startIds.map((id) => sectionOf.get(beatTargetId(circuit, id))).filter(Boolean));
  } else {
    const inputs = [...circuit.components.values()].filter((c) => c.type === 'input').map((c) => c.refdes);
    for (const key of inputs.flatMap(netKeysOf)) depth.set(key, 0);
    first = new Set();
  }
  for (const section of sections) {
    if ([...section.signal, ...section.control].some((key) => depth.get(key) === 0)) first.add(section);
  }
  if (!first.size) throw new Error(startIds.length ? 'grow from a part or a pin (not a rail marker or junction dot)' : 'there are no input pins to grow from; pick a part to start at');

  const placed = new Set();
  const steps = [];
  const feedback = [];
  const show = (group, name) => {
    for (const section of group) placed.add(section);
    steps.push({ refs: group.flatMap((section) => section.refs).sort(), name });
  };
  const enter = (group, stage) => {
    for (const section of group) {
      for (const key of section.signal) if (!depth.has(key)) depth.set(key, stage);
      for (const key of section.control) if (!controlStage.has(key)) controlStage.set(key, stage);
    }
  };
  // Feedback reaches back: it joins a node of an earlier stage, or drives
  // (conducts onto) the gate line of one. Bias lines are driven by parts no
  // signal node reaches, so they never come up here.
  const reachesBack = (section, stage) => section.signal.some((key) => depth.get(key) < stage - 1 || controlStage.get(key) < stage);
  // Passive parts are judged once the stage's transistors hold their nodes,
  // so a capacitor from one stage's output to the next is feedback.
  const spansStages = (section) => {
    const depths = section.signal.filter((key) => depth.has(key)).map((key) => depth.get(key));
    return depths.length > 1 && Math.min(...depths) < Math.max(...depths);
  };
  const isPassive = (section) => !section.refs.some((ref) => {
    const type = circuit.components.get(ref).type;
    return CURRENT_FLOW[type] || SOURCE_TYPES.has(type);
  });
  let stage = 1;
  let group = [...first];
  enter(group, stage);
  while (group.length) {
    show(group, `Stage ${stage}`);
    stage += 1;
    const frontier = new Set([...depth].filter(([, d]) => d === stage - 1).map(([key]) => key));
    const reached = sections.filter((section) => !placed.has(section) && !feedback.includes(section)
      && [...section.signal, ...section.control].some((key) => frontier.has(key)));
    const active = reached.filter((section) => !isPassive(section));
    feedback.push(...active.filter((section) => reachesBack(section, stage)));
    group = active.filter((section) => !reachesBack(section, stage));
    enter(group, stage);
    for (const section of reached.filter(isPassive)) {
      if (reachesBack(section, stage) || spansStages(section)) feedback.push(section);
      else group.push(section);
    }
    enter(group, stage);
  }
  for (const section of feedback) show([section], 'Feedback');
  // Bias lines in the order the shown parts hang from them.
  for (let i = 0; i < steps.length; i += 1) {
    const shown = sections.filter((section) => section.refs.some((ref) => steps[i].refs.includes(ref)));
    for (const key of [...new Set(shown.flatMap((section) => section.control))].sort()) {
      const drivers = sections.filter((section) => !placed.has(section) && section.signal.includes(key));
      if (!drivers.length) continue;
      const name = [...circuit.nets.values()].find((net) => circuit.netGroupKey(net) === key)?.name;
      show(drivers, name ? `Bias ${name}` : 'Bias');
    }
  }
  const rest = sections.filter((section) => !placed.has(section));
  if (rest.length) show(rest, '');
  return steps;
}

/**
 * Insert one beat per growOrder step at `index`, each showing the parts
 * reached so far. A pin or rail marker appears with the first part on its wire, and
 * equation labels wait for the last beat. Anything else keeps its look.
 * Returns the number of beats added.
 */
export function growBeats(circuit, startIds = [], { index = circuit.beats.length } = {}) {
  const steps = growOrder(circuit, startIds);
  const stepOf = new Map(steps.flatMap(({ refs }, step) => refs.map((ref) => [ref, step])));
  const last = steps.length - 1;
  // A pin or rail marker shows with the first part on its own wire; a rail's
  // name would tie every marker on it to the first part anywhere.
  for (const marker of [...circuit.components.values()].filter(isAttachment)) {
    const partSteps = [...circuit.nets.values()]
      .filter((net) => net.terminals.some(({ comp }) => comp === marker.refdes))
      .flatMap((net) => net.terminals.map(({ comp }) => stepOf.get(comp)))
      .filter((step) => step !== undefined);
    stepOf.set(marker.refdes, partSteps.length ? Math.min(...partSteps) : last);
  }
  for (const label of circuit.labels.values()) {
    if (label.math && beatObjectKind(circuit, label.id) === 'label') stepOf.set(label.id, last);
  }
  steps.forEach(({ name }, step) => addBeat(circuit, { index: index + step, name }));
  for (const [id, first] of stepOf) {
    for (let step = 0; step < steps.length; step += 1) {
      setPresenceAt(circuit, index + step, [id], step >= first ? 'show' : 'hide');
    }
  }
  return steps.length;
}

// ----- model maintenance -----------------------------------------------------

/** A renamed component keeps its place in every beat. */
export function renameBeatObject(circuit, from, to) {
  for (const beat of circuit.beats || []) {
    for (const presence of PRESENCES) beat[presence] = beat[presence].map((id) => (id === from ? to : id));
    if (Object.hasOwn(beat.switches, from)) {
      beat.switches[to] = beat.switches[from];
      delete beat.switches[from];
    }
  }
}

/** A net group renamed as a whole keeps its per-beat highlights. */
export function renameBeatHighlightKey(circuit, from, to) {
  for (const beat of circuit.beats || []) {
    if (!Object.hasOwn(beat.highlights, from) || Object.hasOwn(beat.highlights, to)) continue;
    beat.highlights[to] = beat.highlights[from];
    delete beat.highlights[from];
  }
}

// ----- resolving one beat for drawing -------------------------------------------

/** The polylines a net draws: the same choice the renderer makes. */
export function drawnNetPaths(net) {
  if (net.routingMode === 'fixed') return net.paths();
  if (net.branches) return net.branches;
  if (!net.route && net.terminals.length >= 3) {
    return steinerBranches(net.terminalWorlds(), { rects: [], pins: new Map(), wires: [] });
  }
  return [net.points()];
}

const pointKey = (p) => `${p.x},${p.y}`;

function strictlyInside(p, a, b) {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (Math.abs(cross) > 1e-6) return false;
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  const len = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  return dot > 1e-6 && dot < len - 1e-6;
}

/** Wire segments cut at every point that matters, keeping their origin
 * (branch index and 1-based segment index, as wireStyles key them). */
function cutSegments(paths, cuts) {
  const edges = [];
  paths.forEach((pts, branch) => {
    for (let i = 1; i < (pts?.length || 0); i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      if (a.x === b.x && a.y === b.y) continue;
      const inner = cuts.filter((p) => strictlyInside(p, a, b))
        .sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y));
      let from = a;
      for (const to of [...inner, b]) {
        edges.push({ a: from, b: to, branch, segment: i });
        from = to;
      }
    }
  });
  return edges;
}

/** Which edges meet at each point. */
function edgesAt(edges) {
  const at = new Map();
  edges.forEach((edge, i) => {
    for (const key of [pointKey(edge.a), pointKey(edge.b)]) {
      if (!at.has(key)) at.set(key, new Set());
      at.get(key).add(i);
    }
  });
  return at;
}

const otherEnd = (edge, key) => (pointKey(edge.a) === key ? pointKey(edge.b) : pointKey(edge.a));

/**
 * Indices of the wire a beat keeps for a set of shown anchors:
 *
 * 1. the wire joining the anchors -- every dangling end that is not an
 *    anchor is trimmed back, so a lone anchor keeps no wire of its own; and
 * 2. every stub the drawing leaves open-ended, whole, while it hangs from
 *    that wire or from an anchor. A stub stops at a junction and is dropped
 *    where it passes something not shown (`blocked`), such as the
 *    placeholder label it carried.
 */
function keptEdges(edges, at, anchors, freeEnds, blocked) {
  const alive = new Set(edges.map((_, i) => i));
  const degree = new Map([...at].map(([key, set]) => [key, set.size]));
  const queue = [...degree.keys()].filter((key) => degree.get(key) === 1 && !anchors.has(key));
  while (queue.length) {
    const key = queue.pop();
    if (degree.get(key) !== 1 || anchors.has(key)) continue;
    const i = [...at.get(key)].find((edge) => alive.has(edge));
    alive.delete(i);
    degree.set(key, 0);
    const end = otherEnd(edges[i], key);
    degree.set(end, degree.get(end) - 1);
    if (degree.get(end) === 1 && !anchors.has(end)) queue.push(end);
  }
  const reached = new Set(anchors);
  for (const i of alive) for (const p of [edges[i].a, edges[i].b]) reached.add(pointKey(p));
  for (const start of freeEnds) {
    if (reached.has(start) || blocked.has(start)) continue;
    const chain = [];
    let key = start;
    let previous = null;
    for (let step = 0; step <= edges.length; step += 1) {
      const next = [...at.get(key)].filter((i) => i !== previous);
      if (next.length !== 1) break;
      const [i] = next;
      chain.push(i);
      key = otherEnd(edges[i], key);
      if (reached.has(key)) {
        for (const edge of chain) alive.add(edge);
        break;
      }
      if (blocked.has(key)) break;
      previous = i;
    }
  }
  return alive;
}

/**
 * What beat `index` shows. Returns null when there is no such beat.
 *
 *   hiddenRefs / hiddenLabels  objects left out (or faded in the editor)
 *   dimRefs / dimLabels        objects drawn faint
 *   switchTypes                refdes -> symbol type drawn in this beat
 *   highlights                 net group key -> color
 *   wires                      net id -> 'all' | 'none' | { shown, dimmed }
 *                              pieces [{ a, b, branch, segment }]
 */
export function resolveBeat(circuit, index) {
  const beats = circuit.beats || [];
  if (!Number.isInteger(index) || index < 0 || index >= beats.length) return null;
  const mentioned = mentionedIds(beats);
  const listedPresence = (id) => (mentioned.has(id) ? visibilityTrack(beats, id)[index] : 'show');

  const presence = new Map();
  for (const component of circuit.components.values()) {
    if (component.type !== 'solder') presence.set(component.refdes, listedPresence(component.refdes));
  }
  const refPresence = (ref) => presence.get(ref) || 'show';
  // The strongest look among a net's parts: shown beats dimmed beats hidden.
  const netPresence = (net) => {
    const looks = net.terminals.filter(({ comp }) => circuit.components.has(comp)).map(({ comp }) => refPresence(comp));
    if (!looks.length || looks.includes('show')) return 'show';
    return looks.includes('dim') ? 'dim' : 'hide';
  };
  const labelPresence = (label) => {
    if (label.owner) return refPresence(label.owner);
    if (label.parent && circuit.labels.has(label.parent)) return labelPresence(circuit.labels.get(label.parent));
    if (mentioned.has(label.id)) return listedPresence(label.id);
    // An unlisted net label goes with what it names.
    if (label.netId && circuit.nets.has(label.netId)) return netPresence(circuit.nets.get(label.netId));
    return 'show';
  };
  const hiddenLabels = new Set();
  const dimLabels = new Set();
  for (const label of circuit.labels.values()) {
    const look = labelPresence(label);
    if (look === 'hide') hiddenLabels.add(label.id);
    else if (look === 'dim') dimLabels.add(label.id);
  }
  const hiddenRefs = new Set([...presence].filter(([, look]) => look === 'hide').map(([ref]) => ref));
  const dimRefs = new Set([...presence].filter(([, look]) => look === 'dim').map(([ref]) => ref));

  const switchTypes = new Map();
  for (const ref of new Set(beats.flatMap((beat) => Object.keys(beat.switches)))) {
    const component = circuit.components.get(ref);
    if (!switchState(component)) continue;
    const type = SWITCH_TYPES[switchStateAt(circuit, ref, index)];
    if (type !== component.type) switchTypes.set(ref, type);
  }

  const solders = [...circuit.components.values()].filter((c) => c.type === 'solder');
  const solderPoints = solders.map((c) => ({ x: c.transform.x, y: c.transform.y }));
  const wires = new Map();
  // Arms at each point: in the drawing, on the page (shown or dimmed), shown.
  const arms = { all: new Map(), page: new Map(), shown: new Map() };
  const countArm = (map, key) => map.set(key, (map.get(key) || 0) + 1);
  for (const net of circuit.nets.values()) {
    const terminals = net.terminals
      .map(({ comp, term }) => ({ look: refPresence(comp), point: circuit.components.get(comp)?.terminalWorld(term) }))
      .filter(({ point }) => point);
    const labels = [...circuit.labels.values()]
      .filter((label) => label.netId === net.id)
      .map((label) => ({ look: labelPresence(label), point: label.anchorWorld() }));
    const marks = [...terminals, ...labels];
    const edges = cutSegments(drawnNetPaths(net), [...marks.map(({ point }) => point), ...solderPoints]);
    const at = edgesAt(edges);
    const terminalKeys = new Set(terminals.map(({ point }) => pointKey(point)));
    const freeEnds = [...at.keys()].filter((key) => at.get(key).size === 1 && !terminalKeys.has(key));
    const keysWhere = (test) => new Set(marks.filter(({ look }) => test(look)).map(({ point }) => pointKey(point)));
    const onPage = keptEdges(edges, at, keysWhere((look) => look !== 'hide'), freeEnds, keysWhere((look) => look === 'hide'));
    const shown = keptEdges(edges, at, keysWhere((look) => look === 'show'), freeEnds, keysWhere((look) => look !== 'show'));
    const pieces = (set) => edges.filter((_, i) => set.has(i));
    wires.set(net.id, shown.size === edges.length ? 'all'
      : onPage.size === 0 ? 'none'
        : { shown: pieces(shown), dimmed: edges.filter((_, i) => onPage.has(i) && !shown.has(i)) });
    edges.forEach((edge, i) => {
      for (const p of [edge.a, edge.b]) {
        countArm(arms.all, pointKey(p));
        if (onPage.has(i)) countArm(arms.page, pointKey(p));
        if (shown.has(i)) countArm(arms.shown, pointKey(p));
      }
    });
    for (const { look, point } of terminals) {
      countArm(arms.all, pointKey(point));
      if (look !== 'hide') countArm(arms.page, pointKey(point));
      if (look === 'show') countArm(arms.shown, pointKey(point));
    }
  }
  // A junction dot marks three or more arms; it goes (or dims) with fewer.
  for (const solder of solders) {
    const key = pointKey(solder.transform);
    const all = arms.all.get(key) || 0;
    const fewer = (map) => (map.get(key) || 0) < 3 && (map.get(key) || 0) < all;
    if (fewer(arms.page)) hiddenRefs.add(solder.refdes);
    else if (fewer(arms.shown)) dimRefs.add(solder.refdes);
  }

  const highlights = highlightsAt(circuit, index);
  return {
    index,
    hiddenRefs,
    hiddenLabels,
    dimRefs,
    dimLabels,
    switchTypes,
    highlights,
    wires,
    netHighlight: (net) => highlights.get(circuit.netGroupKey(net)) || null,
    /** Symbol definition drawn for a component in this beat. */
    defOf: (component) => (switchTypes.has(component.refdes) ? getSymbol(switchTypes.get(component.refdes)) : component.def),
  };
}
