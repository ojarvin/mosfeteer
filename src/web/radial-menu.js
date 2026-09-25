/**
 * The radial marking menu a right-drag or hold on a part opens. The ring
 * geometry is in gestures.js.
 */

import { snap } from '../core/grid.js';
import { radialRingRadius, radialSector } from './gestures.js';
import { ICON_PATHS } from './icons.js';
import { noteTip } from './onboarding.js';
import { editor } from './editor-state.js';
import { clientToWorld } from './canvas-view.js';
import { selectContextTarget } from './context-menu.js';
import { activateAlign, activateCopy, activateMove, armModalMove, beginCopySource, deleteSelection, render, selectedTransform, stubSelection } from './main.js';

// Right-drag (or hold) on a component opens a marking menu around the press.
// Releasing in a sector runs it, so a practiced flick needs no reading; release
// in the centre cancels. Sector 0 is up and indices run clockwise.
// Every item acts on the part the menu was opened on: the tools pick it up at
// the release point exactly as a click on it with that tool armed would, so
// the part follows the pointer from where the flick ended.
const RADIAL_ITEMS = [
  { label: 'Rotate', icon: 'rotate', run: () => selectedTransform('rotate') },
  { label: 'Mirror H', icon: 'mirror-x', run: () => selectedTransform('mirror-x') },
  { label: 'Mirror V', icon: 'mirror-y', run: () => selectedTransform('mirror-y') },
  { label: 'Delete', icon: 'trash', danger: true, run: () => deleteSelection() },
  { label: 'Copy', icon: 'copy', run: (radial, at) => {
    activateCopy();
    if (editor.copyMode) beginCopySource(at.world, at.client);
  } },
  { label: 'Detach move', icon: 'detach', run: (radial, at) => radialMove(radial, at, 'detached') },
  { label: 'Move', icon: 'move', run: (radial, at) => radialMove(radial, at, 'connected') },
  // The part is selected; pick its edge or point to align, then the target's.
  { label: 'Align', icon: 'align', run: () => activateAlign() },
  { label: 'Wire stubs', icon: 'stub', run: () => stubSelection() },
];

function radialMove(radial, at, kind) {
  activateMove(kind);
  if (!editor.moveMode || !editor.circuit.components.has(radial.refdes)) return;
  editor.cursor = { x: snap(at.world.x), y: snap(at.world.y) };
  armModalMove({ refdes: radial.refdes }, at.world, at.client);
}
// Round tiles of one size at equal angles, on a ring sized so every pair of
// neighbours has the same gap.
const RADIAL_TILE = 64;
const RADIAL_RADIUS = radialRingRadius(RADIAL_ITEMS.length, RADIAL_TILE, 10);

export function openRadialMenu(radial) {
  noteTip('radial');
  window.clearTimeout(radial.holdTimer);
  radial.mode = 'radial';
  const comp = editor.circuit.components.get(radial.refdes);
  if (comp) selectContextTarget({ kind: 'component', value: comp });
  render();
  editor.radialMenuEl?.remove();
  editor.radialMenuEl = document.createElement('div');
  editor.radialMenuEl.className = 'radial-menu';
  editor.radialMenuEl.setAttribute('role', 'menu');
  editor.radialMenuEl.style.left = `${radial.startClient.x}px`;
  editor.radialMenuEl.style.top = `${radial.startClient.y}px`;
  editor.radialMenuEl.style.setProperty('--radial-radius', `${RADIAL_RADIUS}px`);
  editor.radialMenuEl.style.setProperty('--radial-tile', `${RADIAL_TILE}px`);
  const hub = document.createElement('div');
  hub.className = 'radial-hub glass';
  hub.textContent = radial.refdes;
  editor.radialMenuEl.appendChild(hub);
  RADIAL_ITEMS.forEach((item, index) => {
    const el = document.createElement('div');
    el.className = `radial-item glass${item.danger ? ' danger' : ''}`;
    el.setAttribute('role', 'menuitem');
    // Placed by CSS from its angle, so the opening animation can sweep it
    // around the hub and out to the ring.
    el.style.setProperty('--radial-angle', `${(index / RADIAL_ITEMS.length) * 360}deg`);
    el.style.setProperty('--radial-delay', `${index * 14}ms`);
    el.innerHTML = `<svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[item.icon] || ''}</svg>`;
    el.title = item.label;
    const text = document.createElement('span');
    text.textContent = item.label;
    el.appendChild(text);
    editor.radialMenuEl.appendChild(el);
  });
  document.body.appendChild(editor.radialMenuEl);
}

export function highlightRadial(dx, dy) {
  if (!editor.radialMenuEl) return;
  const sector = radialSector(dx, dy, RADIAL_ITEMS.length, 22);
  [...editor.radialMenuEl.querySelectorAll('.radial-item')].forEach((el, index) => el.classList.toggle('active', index === sector));
}

export function closeRadialMenu() {
  editor.radialMenuEl?.remove();
  editor.radialMenuEl = null;
}

export function finishRadialMenu(radial, client) {
  closeRadialMenu();
  const sector = radialSector(client.x - radial.startClient.x, client.y - radial.startClient.y, RADIAL_ITEMS.length, 22);
  if (sector >= 0) RADIAL_ITEMS[sector].run(radial, { client: { ...client }, world: clientToWorld(client.x, client.y) });
  render();
}
