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

/**
 * The parts a build started at `startIds` reveals, step by step, as
 * [{ refs, name }]:
 *
 * 1. The signal path: the start, then everything one connection further
 *    out, where a connection leaves a part through a drain, source, output,
 *    or passive terminal -- never back out of a gate. A drain still reaches
 *    the next stage's gate; a gate does not reach its bias generator.
 * 2. The bias: one step per gate (or base, or input) line that shown parts
 *    hang from, bringing what drives it -- the parts conducting on it and
 *    the stacks in series with them.
 * 3. Anything still unreached, together.
 *
 * Nets join by name, as they do electrically, but supply and ground rails
 * (nets with a rail marker, or named VDD, VSS, GND, or VCM) join nothing: through them everything would be one step away. Pins and
 * rail markers are not listed; growBeats shows them with their net's parts.
 */
export function growOrder(circuit, startIds) {
  const parts = [...circuit.components.values()].filter((c) => c.type !== 'solder' && !isAttachment(c));
  const railGroups = new Set();
  for (const net of circuit.nets.values()) {
    const rail = net.terminals.some(({ comp }) => isMarker(circuit.components.get(comp)))
      || (net.name && REFERENCE_MARKER_TYPES.some((type) => isReferenceMarkerGlobalName(type, net.name)));
    if (rail) railGroups.add(circuit.netGroupKey(net));
  }
  // group key -> [{ ref, control }] for every part terminal on it
  const members = new Map();
  const groupsOf = new Map(parts.map((c) => [c.refdes, []]));
  for (const net of circuit.nets.values()) {
    const key = circuit.netGroupKey(net);
    if (railGroups.has(key)) continue;
    for (const { comp, term } of net.terminals) {
      if (!groupsOf.has(comp)) continue;
      const direction = circuit.components.get(comp).terminalDefs.find((t) => t.name === term)?.direction;
      const control = CONTROL_TERMINALS.has(direction);
      groupsOf.get(comp).push({ key, control });
      if (!members.has(key)) members.set(key, new Map());
      // A part is conducting on a net if any of its terminals there is.
      members.get(key).set(comp, (members.get(key).get(comp) ?? true) && control);
    }
  }
  // A pin as a start stands for the parts on its net.
  const starts = startIds.flatMap((id) => {
    const component = circuit.components.get(id);
    if (!INTERFACE_PIN_TYPES.has(component?.type)) return [beatTargetId(circuit, id)];
    return [...circuit.nets.values()].filter((net) => net.terminals.some(({ comp }) => comp === id))
      .flatMap((net) => [...(members.get(circuit.netGroupKey(net))?.keys() || [])]);
  });
  const start = [...new Set(starts.filter((ref) => groupsOf.has(ref)))];
  if (!start.length) throw new Error('grow from a part or a pin (not a rail marker or junction dot)');
  const seen = new Set(start);
  const steps = [{ refs: start.sort(), name: '' }];
  // Unseen parts one connection out from `frontier`, leaving through a
  // conducting terminal; `stackOnly` also enters only through one.
  const outward = (frontier, stackOnly = false) => {
    const next = new Set();
    for (const ref of frontier) {
      for (const { key, control } of groupsOf.get(ref)) {
        if (control) continue;
        for (const [other, onlyControl] of members.get(key)) {
          if (!seen.has(other) && !(stackOnly && onlyControl)) next.add(other);
        }
      }
    }
    for (const ref of next) seen.add(ref);
    return [...next];
  };
  for (let frontier = start; frontier.length;) {
    frontier = outward(frontier);
    if (frontier.length) steps.push({ refs: frontier.sort(), name: '' });
  }
  // Bias: one step per control line that shown parts hang from, in the
  // order they were reached, with what drives it: the parts conducting on it
  // and the stacks in series with them. Their own control lines follow later.
  for (let step = 0; step < steps.length; step += 1) {
    const controls = [...new Set(steps[step].refs.flatMap((ref) => groupsOf.get(ref).filter(({ control }) => control).map(({ key }) => key)))].sort();
    for (const key of controls) {
      const reached = [...members.get(key)].filter(([ref, onlyControl]) => !onlyControl && !seen.has(ref)).map(([ref]) => ref);
      for (const ref of reached) seen.add(ref);
      for (let frontier = reached; frontier.length;) {
        frontier = outward(frontier, true);
        reached.push(...frontier);
      }
      // Named lines name their beat; an unnamed one is known by its net id.
      const name = [...circuit.nets.values()].find((net) => circuit.netGroupKey(net) === key)?.name;
      if (reached.length) steps.push({ refs: [...new Set(reached)].sort(), name: name ? `Bias ${name}` : 'Bias' });
    }
  }
  const rest = parts.map((c) => c.refdes).filter((ref) => !seen.has(ref)).sort();
  if (rest.length) steps.push({ refs: rest, name: '' });
  return steps;
}

/**
 * Insert one beat per growOrder step at `index`, each showing the parts
 * reached so far. A pin or rail marker appears with the first part on its wire, and
 * equation labels wait for the last beat. Anything else keeps its look.
 * Returns the number of beats added.
 */
export function growBeats(circuit, startIds, { index = circuit.beats.length } = {}) {
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
