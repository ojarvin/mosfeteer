/**
 * Beats: an ordered list of view states over one drawing, so a figure can be
 * built up (or its switch phases shown) step by step. The contract is in
 * docs/beats.md.
 *
 * A beat stores only what changes at it, relative to the beat before; the
 * first beat is relative to the drawing itself:
 *
 *   show / hide  object ids: component refdes, free and net label ids
 *   switches     { refdes: 'open' | 'closed' }
 *   highlights   { netGroupKey: color | null }
 *
 * An object nobody mentions is visible in every beat, so an edit to the
 * drawing shows up everywhere without touching the beats. An object whose
 * first change is a `show` is hidden before it. Wires, owned labels, and
 * junction dots are never listed: they follow what they connect or belong to.
 *
 * Every edit decodes the per-beat states of an object (its "track"), changes
 * the track, and encodes it back. Inserting, deleting, or moving a beat
 * therefore never changes how any other beat looks.
 */

import { getSymbol } from './components/index.js';
import { steinerBranches } from './router.js';

export const SWITCH_TYPES = Object.freeze({ open: 'switch_open', closed: 'switch_closed' });
const SWITCH_STATE_OF_TYPE = { switch_open: 'open', switch_closed: 'closed' };

/** 'open' or 'closed' for a switch component, otherwise null. */
export function switchState(component) {
  return SWITCH_STATE_OF_TYPE[component?.type] || null;
}

// ----- stored form ------------------------------------------------------

function emptyBeat(id, name = '') {
  return { id, name, show: [], hide: [], switches: {}, highlights: {} };
}

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
    beat.hide = ids(entry.hide).filter((value) => !beat.show.includes(value));
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
    const show = beat.show.filter(live);
    const hide = beat.hide.filter(live);
    const switches = Object.entries(beat.switches).filter(([ref]) => switchState(circuit.components.get(ref)));
    const highlights = Object.entries(beat.highlights);
    if (show.length) out.show = show;
    if (hide.length) out.hide = hide;
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

/** Per-beat visibility of one object. */
export function visibilityTrack(beats, id) {
  const first = beats.find((beat) => beat.show.includes(id) || beat.hide.includes(id));
  let visible = !first?.show.includes(id);
  return beats.map((beat) => {
    if (beat.show.includes(id)) visible = true;
    else if (beat.hide.includes(id)) visible = false;
    return visible;
  });
}

function writeVisibilityTrack(beats, id, track) {
  for (const beat of beats) {
    beat.show = beat.show.filter((value) => value !== id);
    beat.hide = beat.hide.filter((value) => value !== id);
  }
  const firstVisible = track.indexOf(true);
  if (firstVisible === -1) {
    if (beats.length) beats[0].hide.push(id);
    return;
  }
  // Hidden before its first appearance: a leading `show` says so on its own.
  let visible = firstVisible === 0;
  track.forEach((value, index) => {
    if (value === visible) return;
    (value ? beats[index].show : beats[index].hide).push(id);
    visible = value;
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
  const ids = new Set(beats.flatMap((beat) => [...beat.show, ...beat.hide]));
  const refs = new Set(beats.flatMap((beat) => Object.keys(beat.switches)));
  const keys = new Set(beats.flatMap((beat) => Object.keys(beat.highlights)));
  const tracks = [
    ...[...ids].map((id) => ({ kind: 'visible', key: id, track: visibilityTrack(beats, id), base: true })),
    ...[...refs].map((ref) => ({ kind: 'switches', key: ref, track: valueTrack(beats, 'switches', ref, switchBase(circuit, ref)), base: switchBase(circuit, ref) })),
    ...[...keys].map((key) => ({ kind: 'highlights', key, track: valueTrack(beats, 'highlights', key, highlightBase(circuit, key)), base: highlightBase(circuit, key) })),
  ];
  edit(tracks);
  for (const beat of beats) {
    beat.show = [];
    beat.hide = [];
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

export function visibleAt(circuit, id, index) {
  return visibilityTrack(circuit.beats, id)[index] ?? true;
}

/** Show or hide objects from beat `index` on, until the next beat where they
 * already looked different. Returns the listed ids. */
export function setVisibleFrom(circuit, index, ids, visible) {
  checkIndex(circuit, index);
  const targets = targetIds(circuit, ids);
  for (const id of targets) {
    const track = visibilityTrack(circuit.beats, id);
    carryForward(track, index, !!visible);
    writeVisibilityTrack(circuit.beats, id, track);
  }
  return targets;
}

/** Show or hide objects in beat `index` alone. */
export function setVisibleAt(circuit, index, ids, visible) {
  checkIndex(circuit, index);
  const targets = targetIds(circuit, ids);
  for (const id of targets) {
    const track = visibilityTrack(circuit.beats, id);
    track[index] = !!visible;
    writeVisibilityTrack(circuit.beats, id, track);
  }
  return targets;
}

/** New objects drawn while a beat is shown appear from that beat on. */
export function introduceAt(circuit, index, ids) {
  checkIndex(circuit, index);
  for (const id of ids) {
    if (!beatObjectKind(circuit, id) || circuit.beats.some((beat) => beat.show.includes(id) || beat.hide.includes(id))) continue;
    writeVisibilityTrack(circuit.beats, id, circuit.beats.map((_, i) => i >= index));
  }
}

/** Beats (0-based) in which an object is visible. */
export function visibleBeats(circuit, id) {
  const target = beatTargetId(circuit, id);
  if (!target) return [];
  return visibilityTrack(circuit.beats, target).flatMap((visible, index) => (visible ? [index] : []));
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

// ----- model maintenance -----------------------------------------------------

/** A renamed component keeps its place in every beat. */
export function renameBeatObject(circuit, from, to) {
  for (const beat of circuit.beats || []) {
    beat.show = beat.show.map((id) => (id === from ? to : id));
    beat.hide = beat.hide.map((id) => (id === from ? to : id));
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

/** The wire needed to join the anchors: every dangling end that is not an
 * anchor is trimmed back, so a lone anchor keeps no wire at all. */
function joiningEdges(edges, anchors) {
  const alive = new Set(edges.map((_, i) => i));
  const at = new Map();
  edges.forEach((edge, i) => {
    for (const key of [pointKey(edge.a), pointKey(edge.b)]) {
      if (!at.has(key)) at.set(key, new Set());
      at.get(key).add(i);
    }
  });
  const queue = [...at.keys()].filter((key) => at.get(key).size === 1 && !anchors.has(key));
  while (queue.length) {
    const key = queue.pop();
    const touching = at.get(key);
    if (touching.size !== 1 || anchors.has(key)) continue;
    const [i] = touching;
    alive.delete(i);
    const edge = edges[i];
    for (const end of [pointKey(edge.a), pointKey(edge.b)]) {
      at.get(end).delete(i);
      if (end !== key && at.get(end).size === 1 && !anchors.has(end)) queue.push(end);
    }
  }
  return edges.filter((_, i) => alive.has(i));
}

/**
 * What beat `index` shows. Returns null when there is no such beat.
 *
 *   hiddenRefs / hiddenLabels  objects left out (or faded in the editor)
 *   switchTypes                refdes -> symbol type drawn in this beat
 *   highlights                 net group key -> color
 *   wires                      net id -> 'all' | 'none' | visible pieces
 *                              [{ a, b, branch, segment }]
 */
export function resolveBeat(circuit, index) {
  const beats = circuit.beats || [];
  if (!Number.isInteger(index) || index < 0 || index >= beats.length) return null;
  const mentioned = new Set(beats.flatMap((beat) => [...beat.show, ...beat.hide]));
  const listedVisible = (id) => !mentioned.has(id) || visibilityTrack(beats, id)[index];

  const hiddenRefs = new Set();
  for (const component of circuit.components.values()) {
    if (component.type !== 'solder' && !listedVisible(component.refdes)) hiddenRefs.add(component.refdes);
  }
  const terminalVisible = (net) => net.terminals.some(({ comp }) => circuit.components.has(comp) && !hiddenRefs.has(comp));

  const hiddenLabels = new Set();
  const labelHidden = (label) => {
    if (label.owner) return hiddenRefs.has(label.owner);
    if (label.parent && circuit.labels.has(label.parent)) return labelHidden(circuit.labels.get(label.parent));
    if (mentioned.has(label.id)) return !listedVisible(label.id);
    // An unlisted net label stays while anything it names is on show.
    if (label.netId) {
      const net = circuit.nets.get(label.netId);
      return !!net && net.terminals.length > 0 && !terminalVisible(net);
    }
    return false;
  };
  for (const label of circuit.labels.values()) if (labelHidden(label)) hiddenLabels.add(label.id);

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
  const visibleArms = new Map();
  const allArms = new Map();
  const countArm = (arms, key) => arms.set(key, (arms.get(key) || 0) + 1);
  for (const net of circuit.nets.values()) {
    const terminals = net.terminals
      .map(({ comp, term }) => ({ comp, point: circuit.components.get(comp)?.terminalWorld(term) }))
      .filter(({ point }) => point);
    const labels = [...circuit.labels.values()].filter((label) => label.netId === net.id);
    const anchors = [
      ...terminals.filter(({ comp }) => !hiddenRefs.has(comp)).map(({ point }) => point),
      ...labels.filter((label) => !hiddenLabels.has(label.id)).map((label) => label.anchorWorld()),
    ];
    const cuts = [...terminals.map(({ point }) => point), ...labels.map((label) => label.anchorWorld()), ...solderPoints];
    const edges = cutSegments(drawnNetPaths(net), cuts);
    const kept = joiningEdges(edges, new Set(anchors.map(pointKey)));
    wires.set(net.id, kept.length === edges.length ? 'all' : kept.length ? kept : 'none');
    for (const edge of edges) for (const p of [edge.a, edge.b]) countArm(allArms, pointKey(p));
    for (const edge of kept) for (const p of [edge.a, edge.b]) countArm(visibleArms, pointKey(p));
    for (const { comp, point } of terminals) {
      countArm(allArms, pointKey(point));
      if (!hiddenRefs.has(comp)) countArm(visibleArms, pointKey(point));
    }
  }
  // A junction dot marks three or more arms; it goes when the beat leaves fewer.
  for (const solder of solders) {
    const key = pointKey(solder.transform);
    const arms = visibleArms.get(key) || 0;
    if (arms < 3 && arms < (allArms.get(key) || 0)) hiddenRefs.add(solder.refdes);
  }

  const highlights = highlightsAt(circuit, index);
  return {
    index,
    hiddenRefs,
    hiddenLabels,
    switchTypes,
    highlights,
    wires,
    netHighlight: (net) => highlights.get(circuit.netGroupKey(net)) || null,
    /** Symbol definition drawn for a component in this beat. */
    defOf: (component) => (switchTypes.has(component.refdes) ? getSymbol(switchTypes.get(component.refdes)) : component.def),
  };
}
