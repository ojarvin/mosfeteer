/**
 * The radial (marking) menus a right-hold opens (a right-drag before it zooms instead). Each asks
 * what is under the press and offers what fits it:
 *
 *   paper  a part palette: flick to pick a part, then click to put it down
 *          (hold a sector for its variants: NMOS → bulk NMOS, NPN; rails →
 *          ground, supply, VCM; ...)
 *   pin    connect it: ground, supply, VCM, a port, a labelled stub, a wire
 *   part   swap it for a related type (as q)
 *   wire   its net: name it, label it here, tidy it, delete the run, or pick
 *          its highlight color off a color wheel
 *
 * Sector 0 is up and indices run clockwise, so a practiced flick needs no
 * reading; release in the centre cancels. Pointing only lights a sector:
 * the drawing changes once, on release, so sweeping the ring costs nothing.
 * The ring geometry is in gestures.js.
 */

import { getSymbol } from '../core/components/index.js';
import { snap, GRID } from '../core/grid.js';
import { NET_HIGHLIGHT_COLORS } from '../core/model.js';
import { addPinRail } from '../core/pin-rails.js';
import { addTerminalStubs } from '../core/stubs.js';
import { swapCandidates } from '../core/swap.js';
import { setHighlightFrom } from '../core/beats.js';
import { resolveColor } from '../core/style.js';
import { radialRingRadius, radialSector, quickAddPlacement } from './gestures.js';
import { ICON_PATHS } from './icons.js';
import { noteTip } from './onboarding.js';
import { editor } from './editor-state.js';
import { clientToWorld } from './canvas-view.js';
import { selectContextTarget } from './context-menu.js';
import { PLACEMENT_LABELS, shortPlacementLabel } from './toolbar.js';
import { beginPlacing, swapParts, symbolPreviewSvg } from './insert-menu.js';
import { placeNetLabelAt } from './annotation-tools.js';
import { activeBeatIndex } from './beats-ui.js';
import { logLine } from './status-bar-ui.js';
import {
  activateAlign, activateCopy, activateMove, applyEditorSelection, applyJson, armModalMove, beginCopySource, commit, deleteSelection,
  editSelectionText, render, selectedTransform, snapshot, startWireFromPoint, stubSelection, tidyNow,
} from './main.js';

const TILE = 64;

/** One undoable edit; a failed one leaves the drawing as it was. */
function edit(fn) {
  const before = snapshot();
  const result = commit(fn);
  if (result === false) applyJson(before);
  return result || null;
}
const DEAD_ZONE = 22;
// Resting this long on a sector with variants opens them as the ring.
const DWELL_MS = 380;

// ----- what each ring offers --------------------------------------------------

// A pick arms the part as a placement ghost under the pointer, to be put
// down with a click (r and the mirrors turn it first), as from the insert menu.
const part = (type, label = shortPlacementLabel(type)) => ({
  label,
  title: PLACEMENT_LABELS[type] || label,
  symbol: type,
  run: () => beginPlacing(type),
});

// The palette keeps its places, so a flick learned once stays right.
const PALETTE = [
  { ...part('nmos', 'NMOS'), children: [part('nmos', 'NMOS'), part('nmosb', 'NMOS bulk'), part('npn', 'NPN')] },
  { ...part('resistor', 'R'), children: [part('resistor', 'R'), part('variable_resistor', 'Var. R'), part('impedance', 'Z')] },
  { ...part('capacitor', 'C'), children: [part('capacitor', 'C'), part('variable_capacitor', 'Var. C'), part('inductor', 'L')] },
  { ...part('current_source', 'I source'), children: [part('current_source', 'I'), part('voltage_source', 'V'), part('vccs', 'VCCS'), part('vcvs', 'VCVS')] },
  { ...part('ground', 'Rails'), children: [part('ground', 'Ground'), part('supply', 'Supply'), part('vcm', 'VCM')] },
  { ...part('port', 'Port'), children: [part('input', 'In'), part('output', 'Out'), part('inputoutput', 'In/out'), part('port', 'Port')] },
  { ...part('opamp', 'Op-amp'), children: [part('opamp', 'Op-amp'), part('opamp_diff', 'Diff'), part('gm', 'Gm'), part('comparator', 'Comp.')] },
  { ...part('pmos', 'PMOS'), children: [part('pmos', 'PMOS'), part('pmosb', 'PMOS bulk'), part('pnp', 'PNP')] },
];

function pinRail(type, label) {
  return {
    label,
    symbol: type,
    enabled: (radial) => !radial.connected,
    run: (radial) => {
      const marker = edit(() => addPinRail(editor.circuit, radial.ref, type));
      if (marker) logLine(`${marker.refdes} (${type}) on ${radial.refdes}.${radial.term}`);
    },
  };
}

/** A port two cells out along the pin, facing away from it, wired to it. */
function addPinPort(circuit, radial, type) {
  const component = circuit.getComponent(radial.refdes);
  const def = component.terminalDefs.find((terminal) => terminal.name === radial.term);
  const pin = component.terminalWorld(radial.term);
  const dir = circuit._pinDir(component, def, pin.x, pin.y);
  const point = { x: pin.x + dir.x * GRID * 2, y: pin.y + dir.y * GRID * 2 };
  const placement = quickAddPlacement(getSymbol(type), point, dir);
  const port = circuit.addComponent(type, { x: placement.x, y: placement.y, rotation: placement.rotation, mirrorX: placement.mirrorX, mirrorY: placement.mirrorY });
  circuit.connect(`${radial.refdes}.${radial.term}`, `${port.refdes}.${placement.terminal}`);
  return port;
}

const pinPort = (type, label) => ({
  label,
  symbol: type,
  enabled: (radial) => !radial.connected,
  run: (radial) => {
    const port = edit(() => addPinPort(editor.circuit, radial, type));
    if (port) logLine(`${port.refdes} on ${radial.refdes}.${radial.term}`);
  },
});

const PIN_RING = [
  pinRail('supply', 'Supply'),
  { label: 'Stub + label', icon: 'stub', enabled: (radial) => !radial.connected,
    run: (radial) => {
      const out = edit(() => addTerminalStubs(editor.circuit, [radial.refdes], { terms: [`${radial.refdes}.${radial.term}`] }));
      if (out?.stubs.length) logLine(`${out.stubs[0].ref}: stub labelled ${out.stubs[0].name}`);
      else if (out) logLine(`${radial.refdes}.${radial.term}: a stub there would short`, 'error');
    } },
  { ...pinPort('output', 'Port'), children: [pinPort('input', 'In'), pinPort('output', 'Out'), pinPort('inputoutput', 'In/out'), pinPort('port', 'Port')] },
  pinRail('vcm', 'VCM'),
  pinRail('ground', 'Ground'),
  { label: 'Wire', icon: 'wire', run: (radial) => startWireFromPoint(radial.point) },
];

/** The ring that swaps a part, else (nothing to swap to) its old transforms. */
function partRing(radial) {
  const component = editor.circuit.components.get(radial.refdes);
  const swaps = component ? swapCandidates(component.type).slice(0, 8) : [];
  if (!swaps.length) return LEGACY_PART_RING;
  return swaps.map((type) => ({
    label: shortPlacementLabel(type),
    title: PLACEMENT_LABELS[type] || type,
    symbol: type,
    run: () => swapParts([radial.refdes], type),
  }));
}

const LEGACY_PART_RING = [
  { label: 'Rotate', icon: 'rotate', run: () => selectedTransform('rotate') },
  { label: 'Mirror H', icon: 'mirror-x', run: () => selectedTransform('mirror-x') },
  { label: 'Mirror V', icon: 'mirror-y', run: () => selectedTransform('mirror-y') },
  { label: 'Delete', icon: 'trash', danger: true, run: () => deleteSelection() },
  { label: 'Copy', icon: 'copy', run: (radial, at) => {
    activateCopy();
    if (editor.copyMode) beginCopySource(at.world, at.client);
  } },
  { label: 'Move', icon: 'move', run: (radial, at) => {
    activateMove('connected');
    if (!editor.moveMode || !editor.circuit.components.has(radial.refdes)) return;
    editor.cursor = { x: snap(at.world.x), y: snap(at.world.y) };
    armModalMove({ refdes: radial.refdes }, at.world, at.client);
  } },
  { label: 'Align', icon: 'align', run: () => activateAlign() },
  { label: 'Wire stubs', icon: 'stub', run: () => stubSelection() },
];

/** Set the highlight of the press's net (on the beat on screen, that beat's). */
function setHighlight(circuit, netId, color) {
  const net = circuit.nets.get(netId);
  if (!net) return;
  const beat = activeBeatIndex();
  if (beat === null) circuit.setNetHighlight(net, color);
  else setHighlightFrom(circuit, beat, circuit.netGroupKey(net), color);
}

const highlightItem = (color) => ({
  label: color || 'None',
  swatch: color ? resolveColor(color) : null,
  icon: color ? null : 'x-circle',
  run: (radial) => edit(() => setHighlight(editor.circuit, radial.netId, color)),
});

const WIRE_RING = [
  { label: 'Name net', icon: 'text', run: (radial) => {
    applyEditorSelection({ kind: 'wire', id: radial.wireKey });
    editSelectionText();
  } },
  { label: 'Net label', icon: 'tag', run: (radial) => {
    placeNetLabelAt(radial.point);
    render();
  } },
  { label: 'Highlight', icon: 'highlight', children: [...NET_HIGHLIGHT_COLORS.slice(0, 7).map(highlightItem), highlightItem(null)] },
  { label: 'Tidy', icon: 'route-orthogonal', run: (radial) => {
    applyEditorSelection({ kind: 'wire', id: radial.wireKey });
    tidyNow();
  } },
  { label: 'Delete run', icon: 'trash', danger: true, run: (radial) => {
    applyEditorSelection({ kind: 'wire', id: radial.wireKey });
    deleteSelection();
  } },
  { label: 'Wire from', icon: 'wire', run: (radial) => startWireFromPoint(radial.point) },
];

/** The ring for a press (radial.kind), and the hub's caption. */
function ringFor(radial) {
  if (radial.kind === 'paper') return { items: PALETTE, hub: 'Place' };
  if (radial.kind === 'pin') return { items: PIN_RING, hub: `${radial.refdes}.${radial.term}` };
  if (radial.kind === 'wire') {
    const net = editor.circuit.nets.get(radial.netId);
    return { items: WIRE_RING, hub: net?.name ? net.name.replace(/[_^{}]/g, '') : 'net' };
  }
  return { items: partRing(radial), hub: radial.refdes };
}

// ----- the menu ----------------------------------------------------------------

function itemEl(item, index, count, enabled) {
  const el = document.createElement('div');
  el.className = `radial-item glass${item.danger ? ' danger' : ''}${enabled ? '' : ' disabled'}${item.children ? ' has-children' : ''}`;
  el.setAttribute('role', 'menuitem');
  if (!enabled) el.setAttribute('aria-disabled', 'true');
  // Placed by CSS from its angle, so the opening animation can sweep it
  // around the hub and out to the ring.
  el.style.setProperty('--radial-angle', `${(index / count) * 360}deg`);
  el.style.setProperty('--radial-delay', `${index * 14}ms`);
  if (item.swatch) {
    el.classList.add('swatch-item');
    el.style.setProperty('--radial-swatch', item.swatch);
    el.innerHTML = '<span class="radial-swatch" aria-hidden="true"></span>';
  } else if (item.symbol) {
    el.classList.add('symbol-item');
    el.innerHTML = `<span class="radial-symbol" aria-hidden="true">${symbolPreviewSvg(item.symbol)}</span>`;
  } else {
    el.innerHTML = `<svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[item.icon] || ''}</svg>`;
  }
  el.title = item.title || item.label;
  const text = document.createElement('span');
  text.className = 'radial-label';
  text.textContent = item.label;
  el.appendChild(text);
  return el;
}

/** Lay out the ring for `items` (the top level, or a sector's variants). */
function showRing(radial, items, hubText) {
  const menu = editor.radialMenuEl;
  radial.items = items;
  radial.enabled = items.map((item) => !item.enabled || item.enabled(radial));
  radial.active = -1;
  menu.style.setProperty('--radial-radius', `${radialRingRadius(Math.max(items.length, 6), TILE, 10)}px`);
  for (const el of menu.querySelectorAll('.radial-item')) el.remove();
  menu.querySelector('.radial-hub').textContent = hubText;
  menu.classList.toggle('nested', radial.stack.length > 0);
  items.forEach((item, index) => menu.appendChild(itemEl(item, index, items.length, radial.enabled[index])));
}

export function openRadialMenu(radial) {
  noteTip('radial');
  window.clearTimeout(radial.holdTimer);
  radial.mode = 'radial';
  radial.point = { x: snap(radial.startWorld.x), y: snap(radial.startWorld.y) };
  if (radial.kind === 'part' || radial.kind === 'pin') {
    const comp = editor.circuit.components.get(radial.refdes);
    if (comp) selectContextTarget({ kind: 'component', value: comp });
  }
  if (radial.kind === 'pin') {
    radial.ref = { comp: radial.refdes, term: radial.term };
    radial.connected = !!editor.circuit.netOfTerminal(radial.ref);
    radial.point = editor.circuit.components.get(radial.refdes)?.terminalWorld(radial.term) || radial.point;
  }
  radial.stack = [];
  render();
  editor.radialMenuEl?.remove();
  const menu = document.createElement('div');
  menu.className = `radial-menu radial-${radial.kind || 'part'}`;
  menu.setAttribute('role', 'menu');
  menu.style.left = `${radial.startClient.x}px`;
  menu.style.top = `${radial.startClient.y}px`;
  menu.style.setProperty('--radial-tile', `${TILE}px`);
  // A trail from the press to the pointer: the flick drawn as it is made.
  menu.innerHTML = '<svg class="radial-trail" aria-hidden="true"><line x1="0" y1="0" x2="0" y2="0"/></svg>';
  const hub = document.createElement('div');
  hub.className = 'radial-hub glass';
  menu.appendChild(hub);
  editor.radialMenuEl = menu;
  const ring = ringFor(radial);
  radial.hub = ring.hub;
  showRing(radial, ring.items, ring.hub);
  document.body.appendChild(menu);
}

function sectorAt(radial, dx, dy) {
  const sector = radialSector(dx, dy, radial.items.length, DEAD_ZONE);
  return sector >= 0 && radial.enabled[sector] ? sector : -1;
}

/** Follow the pointer: light its sector, and after a rest open
 *  its variants (or, back in the centre of variants, the ring before). */
export function highlightRadial(dx, dy) {
  const radial = editor.drag;
  const menu = editor.radialMenuEl;
  if (!menu || radial?.mode !== 'radial') return;
  menu.querySelector('.radial-trail line')?.setAttribute('x2', String(dx));
  menu.querySelector('.radial-trail line')?.setAttribute('y2', String(dy));
  const sector = sectorAt(radial, dx, dy);
  if (sector === radial.active) return;
  radial.active = sector;
  [...menu.querySelectorAll('.radial-item')].forEach((el, index) => el.classList.toggle('active', index === sector));
  window.clearTimeout(radial.dwellTimer);
  const item = radial.items[sector];
  if (item?.children) {
    radial.dwellTimer = window.setTimeout(() => {
      if (editor.drag !== radial || radial.active !== sector) return;
      radial.stack.push({ items: radial.items, hub: menu.querySelector('.radial-hub').textContent });
      showRing(radial, item.children, item.label);
    }, DWELL_MS);
  } else if (sector < 0 && radial.stack.length) {
    radial.dwellTimer = window.setTimeout(() => {
      if (editor.drag !== radial || radial.active !== -1 || !radial.stack.length) return;
      const back = radial.stack.pop();
      showRing(radial, back.items, back.hub);
    }, DWELL_MS);
  }
}

export function closeRadialMenu() {
  window.clearTimeout(editor.drag?.dwellTimer);
  editor.radialMenuEl?.remove();
  editor.radialMenuEl = null;
}

export function finishRadialMenu(radial, client) {
  window.clearTimeout(radial.dwellTimer);
  const sector = radial.items ? sectorAt(radial, client.x - radial.startClient.x, client.y - radial.startClient.y) : -1;
  const item = radial.items?.[sector];
  const flash = sector >= 0 ? editor.radialMenuEl?.querySelectorAll('.radial-item')[sector] : null;
  // The chosen tile pulses as the menu goes.
  if (flash) {
    const ghost = editor.radialMenuEl.cloneNode(false);
    ghost.classList.add('radial-chosen');
    const copy = flash.cloneNode(true);
    ghost.appendChild(copy);
    document.body.appendChild(ghost);
    copy.addEventListener('animationend', () => ghost.remove(), { once: true });
    window.setTimeout(() => ghost.remove(), 400);
  }
  closeRadialMenu();
  // A sector with variants and none picked yet takes its first one.
  const choice = item?.children && !item.run ? item.children[0] : item;
  if (choice?.run) choice.run(radial, { client: { ...client }, world: clientToWorld(client.x, client.y) });
  render();
}
