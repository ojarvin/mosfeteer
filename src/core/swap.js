/**
 * Swapping a placed part for another type in place: nmos for pmos, a resistor
 * for a capacitor, a DFF for its reset variant. The part keeps its position,
 * transform, style, and (unless it still carries an automatic name of the old
 * type's prefix) its name. Each terminal keeps its wiring when the new type has
 * a terminal of the same role; the rest detach. Wires follow only the pins
 * that moved, so a swap between same-footprint types leaves the drawing as is.
 */

import { getSymbol, symbolTypeNames } from './components/index.js';
import { SYMBOL_CATEGORY_RULES } from './components/categories.js';
import { ComponentInstance, MOS_ANALYSIS_TYPES, REFERENCE_MARKER_TYPES, isReferenceMarker, isReferenceMarkerGlobalName, referenceMarkerInfo, referenceMarkerName } from './model.js';
import { switchState } from './beats.js';

const BJT_TYPES = new Set(['npn', 'pnp']);
const UNSWAPPABLE = new Set(['solder', 'block']);

// Terminals that play the same role under different names.
const MOS_TO_BJT = { g: 'b', d: 'c', s: 'e' };
const BJT_TO_MOS = { b: 'g', c: 'd', e: 's' };

// The usual reason to swap: the complementary part comes first.
const PARTNERS = new Map([
  ['nmos', 'pmos'], ['nmosb', 'pmosb'], ['npn', 'pnp'], ['ground', 'supply'],
  ['input', 'output'], ['switch_open', 'switch_closed'], ['adc', 'dac'],
  ['current_source', 'voltage_source'], ['vccs', 'vcvs'], ['resistor', 'capacitor'],
  ['inverter', 'buffer'], ['tristate_inverter', 'tristate_buffer'],
  ['signal_sum', 'signal_multiply'], ['opamp', 'opamp_diff'],
  ...['and', 'or', 'xor'].flatMap((gate) => [2, 3].map((n) => [`${gate}${n}_gate`, `n${gate}${n}_gate`])),
].flatMap(([a, b]) => [[a, b], [b, a]]));

function categoryOf(type) {
  return SYMBOL_CATEGORY_RULES.find(([, rule]) => rule.test(type))?.[0] || 'Other';
}

/** Old terminal name -> new terminal name, for every terminal that survives. */
export function swapTerminalMap(fromType, toType) {
  const from = getSymbol(fromType).terminals.map((t) => t.name);
  const to = new Set(getSymbol(toType).terminals.map((t) => t.name));
  let roles = null;
  if (MOS_ANALYSIS_TYPES.has(fromType) && BJT_TYPES.has(toType)) roles = MOS_TO_BJT;
  else if (BJT_TYPES.has(fromType) && MOS_ANALYSIS_TYPES.has(toType)) roles = BJT_TO_MOS;
  else if (REFERENCE_MARKER_TYPES.includes(fromType) && REFERENCE_MARKER_TYPES.includes(toType)) {
    roles = { [referenceMarkerInfo(fromType).terminal]: referenceMarkerInfo(toType).terminal };
  }
  const map = new Map();
  for (const name of from) {
    const target = roles ? roles[name] : name;
    if (target && to.has(target)) map.set(name, target);
  }
  return map;
}

/**
 * The types a part of `type` can become, best first: its own category ahead
 * of others, then the types whose surviving pins stay where they are. A type
 * from another category qualifies only when every pin carries over and none
 * is added (a resistor can become a switch, not a ground).
 */
export function swapCandidates(type) {
  if (UNSWAPPABLE.has(type)) return [];
  const category = categoryOf(type);
  const fromDef = getSymbol(type);
  const scored = [];
  for (const [order, candidate] of symbolTypeNames.entries()) {
    if (candidate === type || UNSWAPPABLE.has(candidate)) continue;
    const map = swapTerminalMap(type, candidate);
    if (!map.size) continue;
    const toDef = getSymbol(candidate);
    const sameCategory = categoryOf(candidate) === category;
    const complete = map.size === fromDef.terminals.length && map.size === toDef.terminals.length;
    // Across categories only a whole multi-pin footprint carries over: a
    // resistor can become a switch, but a port never becomes a rail.
    if (!sameCategory && !(complete && map.size > 1)) continue;
    let staying = 0;
    for (const [oldName, newName] of map) {
      const a = fromDef.terminals.find((t) => t.name === oldName);
      const b = toDef.terminals.find((t) => t.name === newName);
      if (a.x === b.x && a.y === b.y) staying++;
    }
    scored.push({ candidate, order, score: (PARTNERS.get(type) === candidate ? 10000 : 0) + (sameCategory ? 1000 : 0) + (complete ? 100 : 0) + staying * 10 + map.size });
  }
  return scored.sort((a, b) => b.score - a.score || a.order - b.order).map(({ candidate }) => candidate);
}

/** Whether `refdes` is the automatic `<prefix><n>` name its type gave it. */
function automaticName(refdes, prefix) {
  return !!prefix && new RegExp(`^${prefix}\\d+$`).test(refdes);
}

function prefixOf(def, type) {
  return def.refPrefix || type.toUpperCase();
}

const samePoint = (a, b) => a.x === b.x && a.y === b.y;

/**
 * Turn component `refdes` into a `type`. Returns the (possibly renamed)
 * component. Throws, leaving the circuit unchanged, when the type is unknown,
 * not a swap for this part, or a moved pin cannot be rerouted.
 */
export function swapComponentType(circuit, refdes, type) {
  const component = circuit.getComponent(refdes);
  const fromType = component.type;
  if (fromType === type) return component;
  if (!symbolTypeNames.includes(type)) throw new Error(`unknown type "${type}"`);
  if (UNSWAPPABLE.has(fromType) || UNSWAPPABLE.has(type)) throw new Error(`a ${fromType} cannot become a ${type}`);
  const map = swapTerminalMap(fromType, type);
  if (!map.size) throw new Error(`${component.refdes} (${fromType}) shares no terminal with ${type}`);
  // A switch's position belongs to its whole phase.
  if (switchState(component) && /^switch_/.test(type)) {
    circuit.setSwitchState(component.refdes, type === 'switch_closed' ? 'closed' : 'open');
    return component;
  }

  const fromDef = component.def;
  const toDef = getSymbol(type);
  const saved = {
    type: component.type,
    def: component.def,
    value: component.value,
    analysis: component.analysis,
    negativeInputs: component.negativeInputs,
    joinBar: component.joinBar,
    topology: circuit._snapshotNetTopology(),
  };
  const rollback = () => {
    Object.assign(component, {
      type: saved.type, def: saved.def, value: saved.value, analysis: saved.analysis,
      negativeInputs: saved.negativeInputs, joinBar: saved.joinBar,
    });
    circuit._restoreNetTopology(saved.topology);
    circuit.invalidateRoutingCache();
  };

  const before = new Map(component.worldTerminals().map((t) => [t.name, { x: t.x, y: t.y }]));
  const markerName = referenceMarkerName(component);
  circuit.invalidateRoutingCache();
  try {
    // Detach the pins that do not carry over, then rename the rest in place.
    const detached = new Set();
    const touched = new Set();
    for (const net of [...circuit.nets.values()]) {
      const mine = net.terminals.filter((t) => t.comp === component.refdes);
      if (!mine.length) continue;
      touched.add(net);
      for (const terminal of mine) {
        if (map.has(terminal.term)) continue;
        circuit.disconnect({ comp: component.refdes, term: terminal.term });
        detached.add(net);
      }
    }
    for (const net of circuit.nets.values()) {
      for (const terminal of net.terminals) {
        if (terminal.comp === component.refdes) terminal.term = map.get(terminal.term);
      }
      if (net.routingMode !== 'fixed') continue;
      for (const path of net.fixedPaths) {
        for (const end of [path.start, path.end]) {
          if (end?.comp === component.refdes && map.has(end.term)) end.term = map.get(end.term);
        }
      }
    }

    const fresh = new ComponentInstance(circuit, type, { refdes: component.refdes });
    component.type = type;
    component.def = toDef;
    if (component.value === fromDef.defaultValue) component.value = toDef.defaultValue;
    const sameFamily = (MOS_ANALYSIS_TYPES.has(fromType) && MOS_ANALYSIS_TYPES.has(type)) || categoryOf(fromType) === categoryOf(type);
    if (!sameFamily) component.analysis = fresh.analysis;
    const inputs = new Set(toDef.terminals.filter((t) => t.signalRole === 'input').map((t) => t.name));
    component.negativeInputs = new Set([...component.negativeInputs].filter((name) => inputs.has(name)));
    component.joinBar = type === 'supply' && component.joinBar;

    // The owned label follows the new symbol's label slot unless it was moved.
    const label = circuit.labelOf(component.refdes);
    if (label && fromDef.labelOffset && toDef.labelOffset && label.offset && samePoint(label.offset, fromDef.labelOffset)) {
      label.offset = { ...toDef.labelOffset };
      label.clearRenderedTextBounds();
    }

    // Reroute only nets whose pins moved; a net that lost a pin re-settles.
    const moves = new Map();
    for (const terminal of component.worldTerminals()) {
      const oldName = [...map].find(([, next]) => next === terminal.name)?.[0];
      const was = oldName && before.get(oldName);
      if (was && !samePoint(was, terminal)) moves.set(terminal.name, { before: was, after: { x: terminal.x, y: terminal.y } });
    }
    const moved = new Map([[component.refdes, { dx: 0, dy: 0, terminals: moves }]]);
    for (const net of touched) {
      if (!circuit.nets.has(net.id)) continue;
      const pinMoved = net.terminals.some((t) => t.comp === component.refdes && moves.has(t.term));
      if (!pinMoved && !detached.has(net)) continue;
      if (circuit.rerouteNet(net, pinMoved ? moved : null) === false) {
        throw new Error(`unable to reroute ${net.name || net.id} for the ${type}`);
      }
    }

    // An unnamed rail marker named its net after its own rail.
    if (isReferenceMarker(component) && !markerName) {
      const terminal = referenceMarkerInfo(type).terminal;
      const net = circuit.netOfTerminal({ comp: component.refdes, term: terminal });
      if (net && isReferenceMarkerGlobalName(fromType, net.name) && !circuit._isAutoReferenceName(net, net.name)) {
        net.name = '';
        circuit._syncReferenceMarkerNetName(net);
      }
    }
    circuit.connectCoincident(component.refdes);
    circuit._syncSignalInputLabels(component);
    circuit.syncJunctionSolders();
  } catch (err) {
    rollback();
    throw err;
  }

  // Last, so nothing above has to undo it: an automatic name follows the new
  // type's prefix (R3 becomes C1), a chosen one stays.
  const fromPrefix = prefixOf(fromDef, fromType);
  const toPrefix = prefixOf(toDef, type);
  if (fromPrefix !== toPrefix && automaticName(component.refdes, fromPrefix)) {
    circuit.renameComponent(component.refdes, circuit.nextRefdes(toPrefix, { reserveLabels: !!toDef.labelOffset }));
  }
  circuit._ensureComponentInstanceLabel(component);
  circuit.invalidateRoutingCache();
  return component;
}
