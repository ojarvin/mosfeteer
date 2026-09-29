/**
 * A loose design hierarchy in the editor (docs/hierarchy.md). A part may link
 * to another design of the workspace (ComponentInstance#link) to show what
 * it is -- an amplifier's transistors inside a system drawing. It carries no
 * connectivity. The linked design can be:
 *
 *   peeked   `o`: drawn beside the drawing in a bubble, a picture framed by a
 *            box with its name and joined to its part by a connector;
 *   entered  Alt+Down (or double-click the bubble): opened in the editor,
 *            with a trail back up (Alt+Up, or the trail in the toolbar).
 *
 * A link to a design that is not in the workspace is simply broken: the
 * bubble says so and the part's menu offers another design. Bubbles are the
 * editor's view state: never saved, exported, or undone.
 */

import { loadDocument } from '../core/document.js';
import { svgString } from '../core/render.js';
import { DRAWING_EXPORT_OPTIONS } from '../core/selection-drawing.js';
import { GRID } from '../core/grid.js';
import { BUBBLE_CAPTION, BUBBLE_PAD, bubbleAt, layoutBubbles } from '../core/link-bubble.js';
import { applyExportDarkTheme, withEmbeddedMathFont } from './drawing-export.js';
import { logLine, hintLine } from './status-bar-ui.js';
import { animateViewTo } from './canvas-view.js';
import { viewFitting } from './atlas-layout.js';
import { componentContextMenuEl } from './elements.js';
import { appendContextItem, appendContextSubmenu, closeComponentContextMenu } from './context-menu.js';
import { editor } from './editor-state.js';
import { persistence, openDocumentPath } from './document-session.js';
import { commit, render, selectedComps, setSelection } from './main.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// refdes -> { name, status: 'loading'|'ready'|'missing'|'error', message, box, href: { light, dark } }
const bubbles = new Map();
let bubblesDocument = null; // the document the bubbles belong to
let layout = []; // where the bubbles were last laid out
let layerEl = null;
const nodes = new Map();

// The way back up: [{ path, name, view, refdes, childPath }], outermost first.
let trail = [];

// ----- finding a linked design -----------------------------------------------------

/** Every design the editor knows of: the workspace's, then recent ones. */
function knownDesigns() {
  const state = editor.workspaceState || {};
  return [...(state.documents || []), ...(state.recent || [])].filter((doc) => doc.kind === 'circuit' || !doc.kind);
}

/** The document a link names, or null: one of that name beside the open
 *  document first, else any. */
export function linkedDocument(name) {
  if (!name) return null;
  const matches = knownDesigns().filter((doc) => doc.name === name && !doc.missing);
  return matches.find((doc) => doc.dir && doc.dir === editor.currentDocumentDir) || matches[0] || null;
}

/** Designs a part may link to: every known one but the open document. */
export function linkableDesigns() {
  const seen = new Set();
  return knownDesigns()
    .filter((doc) => doc.path !== editor.currentDocumentPath && !seen.has(doc.name) && seen.add(doc.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

// ----- bubbles -------------------------------------------------------------------

const dataUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

async function loadBubble(refdes, name) {
  const doc = linkedDocument(name);
  if (!doc) {
    bubbles.set(refdes, { name, status: 'missing', message: `“${name}” is not in the workspace` });
    render();
    return;
  }
  try {
    const data = await persistence.load(doc.path);
    const circuit = loadDocument(data.state);
    const svg = circuit.components.size || circuit.labels.size
      ? svgString(circuit, { ...DRAWING_EXPORT_OPTIONS, background: false, emptyHint: false })
      : null;
    const match = svg?.match(/viewBox="([-\d.e]+)[ ,]+([-\d.e]+)[ ,]+([-\d.e]+)[ ,]+([-\d.e]+)"/);
    if (!svg || !match) {
      bubbles.set(refdes, { name, status: 'error', message: `“${name}” is empty` });
    } else {
      const [light, dark] = await Promise.all([withEmbeddedMathFont(svg), withEmbeddedMathFont(applyExportDarkTheme(svg))]);
      const current = bubbles.get(refdes);
      if (!current || current.name !== name) return; // closed or relinked meanwhile
      const [, , w, h] = match.slice(1).map(Number);
      bubbles.set(refdes, { name, path: doc.path, status: 'ready', box: { w, h }, href: { light: dataUrl(light), dark: dataUrl(dark) } });
    }
  } catch (err) {
    if (bubbles.get(refdes)?.name === name) bubbles.set(refdes, { name, status: 'error', message: `“${name}” could not be read: ${err.message}` });
  }
  render();
  revealBubble(refdes);
}

/** Linked parts an action is about: the selected ones, else the one under
 *  the cursor, else the one whose bubble is under it. */
function linkTargets() {
  const selected = selectedComps().filter((c) => c.link);
  if (selected.length) return selected;
  const bubble = bubbleAt(layout, editor.cursor);
  const component = bubble ? editor.circuit.components.get(bubble.id) : null;
  return component ? [component] : [];
}

/** o: show the selected (or pointed-at) parts' linked designs, or hide them
 *  when they all show. */
export function toggleLinkBubbles(components = linkTargets()) {
  const linked = components.filter((c) => c.link);
  if (!linked.length) {
    hintLine('LINK: select a part linked to a design (right-click → Link to design), then o shows it beside the drawing');
    return;
  }
  const close = linked.every((c) => bubbles.has(c.refdes));
  for (const component of linked) {
    if (close) bubbles.delete(component.refdes);
    else if (!bubbles.has(component.refdes)) openBubble(component);
  }
  render();
}

function openBubble(component) {
  bubblesDocument = editor.currentDocumentPath;
  bubbles.set(component.refdes, { name: component.link, status: 'loading' });
  void loadBubble(component.refdes, component.link);
}

export function closeLinkBubble(refdes) {
  if (bubbles.delete(refdes)) render();
}

export function linkBubbleOpen(refdes) {
  return bubbles.has(refdes);
}

/** The part whose bubble is at a world point: { refdes } or null. */
export function linkBubbleAt(point) {
  const hit = bubbleAt(layout, point);
  return hit ? { refdes: hit.id } : null;
}

/** Pan (and zoom out if need be) so a new bubble shows beside the drawing. */
function revealBubble(refdes) {
  const bubble = layout.find((entry) => entry.id === refdes);
  const pane = document.querySelector('.canvas-pane')?.getBoundingClientRect();
  if (!bubble || !pane) return;
  const view = editor.view;
  const frame = bubble.frame;
  const inView = frame.x >= view.x && frame.y >= view.y && frame.x + frame.w <= view.x + view.w && frame.y + frame.h <= view.y + view.h;
  if (inView) return;
  const drawing = editor.circuit.inkBounds();
  const x0 = Math.min(drawing.x, frame.x);
  const y0 = Math.min(drawing.y, frame.y);
  const x1 = Math.max(drawing.x + drawing.w, frame.x + frame.w);
  const y1 = Math.max(drawing.y + drawing.h, frame.y + frame.h);
  const target = viewFitting({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, pane.width, pane.height, 0.05);
  animateViewTo(target, 260);
}

// ----- drawing the bubbles ---------------------------------------------------------

function svgEl(name, attrs = {}) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

function setAttrs(el, attrs) {
  for (const [key, value] of Object.entries(attrs)) {
    const text = String(value);
    if (el.getAttribute(key) !== text) el.setAttribute(key, text);
  }
}

/** Put the bubble layer into a freshly built canvas drawing, under `before`
 *  (the per-frame overlay). The layer and its pictures are kept across
 *  rebuilds, so a picture is decoded once. */
export function mountLinkBubbles(svgRoot, before) {
  if (!layerEl) {
    layerEl = svgEl('g', { class: 'link-bubbles' });
  }
  svgRoot.insertBefore(layerEl, before || null);
  syncLinkBubbles();
}

/** Bring the bubbles (and the linked-part badges) up to date with the
 *  drawing: called on every render. */
export function syncLinkBubbles() {
  if (!layerEl) return;
  if (bubblesDocument !== editor.currentDocumentPath) {
    bubbles.clear();
    bubblesDocument = editor.currentDocumentPath;
  }
  checkTrail();
  const circuit = editor.circuit;
  // A bubble goes with its part, and follows a changed link.
  for (const [refdes, bubble] of [...bubbles]) {
    const component = circuit.components.get(refdes);
    if (!component?.link) bubbles.delete(refdes);
    else if (component.link !== bubble.name) openBubble(component);
  }
  const linkedParts = [...circuit.components.values()].filter((c) => c.link);
  if (!linkedParts.length && !bubbles.size) {
    layout = [];
    if (layerEl.childNodes.length) layerEl.replaceChildren();
    nodes.clear();
    return;
  }
  const drawing = circuit.inkBounds();
  const placeholder = { w: 10 * GRID, h: 3 * GRID };
  layout = bubbles.size ? layoutBubbles(drawing, [...bubbles].map(([refdes, bubble]) => ({
    id: refdes,
    part: circuit.components.get(refdes).bboxWorld(),
    size: bubble.status === 'ready' ? bubble.box : placeholder,
  }))) : [];
  const dark = document.documentElement.classList.contains('dark');
  const live = new Set();
  for (const entry of layout) {
    const bubble = bubbles.get(entry.id);
    const key = `bubble:${entry.id}`;
    live.add(key);
    let node = nodes.get(key);
    if (!node) {
      const group = svgEl('g', { class: 'link-bubble' });
      node = {
        group,
        connector: svgEl('path', { class: 'link-bubble-connector', fill: 'none', 'vector-effect': 'non-scaling-stroke' }),
        dot: svgEl('circle', { class: 'link-bubble-dot', r: 6 }),
        frame: svgEl('rect', { class: 'link-bubble-frame', rx: 8, 'vector-effect': 'non-scaling-stroke' }),
        caption: svgEl('text', { class: 'link-bubble-caption' }),
        image: svgEl('image', { preserveAspectRatio: 'xMidYMid meet' }),
        message: svgEl('text', { class: 'link-bubble-message', 'text-anchor': 'middle', 'dominant-baseline': 'central' }),
      };
      group.append(node.connector, node.frame, node.dot, node.caption, node.image, node.message);
      nodes.set(key, node);
    }
    const [from, to] = entry.connector;
    setAttrs(node.connector, { d: `M ${from.x} ${from.y} L ${to.x} ${to.y}` });
    setAttrs(node.dot, { cx: from.x, cy: from.y });
    setAttrs(node.frame, { x: entry.frame.x, y: entry.frame.y, width: entry.frame.w, height: entry.frame.h });
    setAttrs(node.caption, { x: entry.frame.x + BUBBLE_PAD / 2, y: entry.frame.y + BUBBLE_CAPTION * 0.75 });
    const caption = bubble.status === 'ready' ? bubble.name : `${bubble.name} (link)`;
    if (node.caption.textContent !== caption) node.caption.textContent = caption;
    node.group.classList.toggle('broken', bubble.status === 'missing' || bubble.status === 'error');
    if (bubble.status === 'ready') {
      setAttrs(node.image, { x: entry.image.x, y: entry.image.y, width: entry.image.w, height: entry.image.h, href: dark ? bubble.href.dark : bubble.href.light });
      node.image.style.display = '';
      node.message.style.display = 'none';
    } else {
      node.image.style.display = 'none';
      node.message.style.display = '';
      setAttrs(node.message, { x: entry.image.x + entry.image.w / 2, y: entry.image.y + entry.image.h / 2 });
      const text = bubble.status === 'loading' ? 'Loading…' : `${bubble.message} · right-click to link another`;
      if (node.message.textContent !== text) node.message.textContent = text;
    }
    if (node.group.parentNode !== layerEl) layerEl.appendChild(node.group);
  }
  // A small link badge marks every linked part, broken ones in the warning color.
  for (const component of linkedParts) {
    const key = `badge:${component.refdes}`;
    live.add(key);
    let node = nodes.get(key);
    if (!node) {
      const group = svgEl('g', { class: 'link-badge' });
      const title = svgEl('title');
      group.append(svgEl('circle', { r: 14 }), svgEl('path', { d: 'M -6 2 L -2 -2 M -9 -1 a 4 4 0 0 1 0 -6 l 1 -1 a 4 4 0 0 1 6 0 M 9 1 a 4 4 0 0 1 0 6 l -1 1 a 4 4 0 0 1 -6 0', transform: 'translate(0 0)' }), title);
      node = { group, title };
      nodes.set(key, node);
    }
    const box = component.bboxWorld();
    setAttrs(node.group, { transform: `translate(${box.x + box.w} ${box.y})` });
    const broken = !linkedDocument(component.link);
    node.group.classList.toggle('broken', broken);
    const title = `${component.refdes} links to ${component.link}${broken ? ' (not in the workspace)' : ''} · o shows it · Alt+↓ opens it`;
    if (node.title.textContent !== title) node.title.textContent = title;
    if (node.group.parentNode !== layerEl) layerEl.appendChild(node.group);
  }
  for (const [key, node] of [...nodes]) {
    if (live.has(key)) continue;
    node.group.remove();
    nodes.delete(key);
  }
}

// ----- entering and leaving ---------------------------------------------------------

/** The trail is only good while the documents it passed through are the
 *  ones open: opening another design any other way leaves the hierarchy. */
function checkTrail() {
  if (trail.length && trail.at(-1).childPath !== editor.currentDocumentPath) trail = [];
  renderTrail();
}

/** Alt+Down (or double-click a bubble): open a linked part's design in the
 *  editor, remembering the way back. */
export async function enterLinkedDesign(component = linkTargets()[0]) {
  if (!component?.link) {
    hintLine('LINK: select a part linked to a design to open it (Alt+↓)');
    return false;
  }
  const doc = linkedDocument(component.link);
  if (!doc) {
    logLine(`${component.refdes} links to “${component.link}”, which is not in the workspace: right-click it → Link to design to pick another.`, 'error');
    return false;
  }
  if (!editor.currentDocumentPath) {
    logLine('Save this design first, so there is a way back up to it.', 'error');
    return false;
  }
  const entry = { path: editor.currentDocumentPath, name: editor.currentCircuitName, view: { ...editor.view }, refdes: component.refdes, childPath: doc.path };
  // With its bubble open, zoom into the picture first: the child then opens
  // where it was seen.
  const bubble = layout.find((item) => item.id === component.refdes);
  const pane = document.querySelector('.canvas-pane')?.getBoundingClientRect();
  if (bubble && bubbles.get(component.refdes)?.status === 'ready' && pane) {
    animateViewTo(viewFitting(bubble.image, pane.width, pane.height, 0.05), 240);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const opened = await openDocumentPath(doc.path);
  if (!opened) {
    Object.assign(editor.view, entry.view);
    render();
    return false;
  }
  trail = [...trail, entry];
  renderTrail();
  logLine(`Inside ${doc.name}, linked from ${entry.name} · ${component.refdes}; Alt+↑ goes back up.`);
  return true;
}

/** Alt+Up (or a step of the trail): back to the design `levels` up, where
 *  it was left, its linked part selected. */
export async function leaveLinkedDesign(levels = 1) {
  checkTrail();
  if (!trail.length) {
    hintLine('LINK: not inside a linked design; Alt+↓ on a linked part opens it');
    return false;
  }
  const index = Math.max(0, trail.length - levels);
  const target = trail[index];
  const opened = await openDocumentPath(target.path);
  if (!opened) return false;
  trail = trail.slice(0, index);
  Object.assign(editor.view, target.view);
  if (editor.circuit.components.has(target.refdes)) setSelection([target.refdes]);
  renderTrail();
  render();
  return true;
}

/** The toolbar trail and the canvas frame say that a linked design is open. */
function renderTrail() {
  const nav = document.getElementById('hierarchy-trail');
  const pane = document.querySelector('.canvas-pane');
  const up = document.getElementById('hierarchy-up');
  const key = trail.map((entry) => `${entry.path}\n${entry.name}`).join('\n\n');
  pane?.classList.toggle('inside-link', trail.length > 0);
  if (up) {
    up.hidden = !trail.length;
    if (trail.length) {
      const text = `↑ ${trail.at(-1).name}`;
      if (up.textContent !== text) up.textContent = text;
      up.title = `Back up to ${trail.at(-1).name}, where ${trail.at(-1).refdes} links to this design (Alt+↑)`;
    }
  }
  if (!nav || nav.dataset.key === key) return;
  nav.dataset.key = key;
  nav.hidden = !trail.length;
  nav.replaceChildren();
  trail.forEach((entry, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hierarchy-step';
    button.textContent = entry.name;
    button.title = `Back up to ${entry.name} (${trail.length - index} level${trail.length - index === 1 ? '' : 's'} up${index === trail.length - 1 ? ', Alt+↑' : ''})`;
    button.addEventListener('click', () => void leaveLinkedDesign(trail.length - index));
    const separator = document.createElement('span');
    separator.className = 'hierarchy-separator';
    separator.textContent = '›';
    separator.setAttribute('aria-hidden', 'true');
    nav.append(button, separator);
  });
}

// ----- menus -----------------------------------------------------------------------

function setLinks(components, name) {
  commit(() => { for (const component of components) editor.circuit.setLink(component.refdes, name); });
  logLine(name ? `${components.map((c) => c.refdes).join(', ')} ${components.length === 1 ? 'links' : 'link'} to ${name} · o shows it, Alt+↓ opens it` : `${components.map((c) => c.refdes).join(', ')} unlinked`);
  render();
}

/** A part's link items: show, open, and pick the design. */
export function appendLinkContextItems(group, component) {
  if (!component || component.type === 'solder') return;
  const scope = selectedComps().includes(component) ? selectedComps().filter((c) => c.type !== 'solder') : [component];
  if (component.link) {
    appendContextItem(group, bubbles.has(component.refdes) ? 'Hide linked design' : 'Show linked design', () => toggleLinkBubbles([component]), { shortcut: 'o' });
    appendContextItem(group, `Open ${component.link}`, () => void enterLinkedDesign(component), { shortcut: 'Alt+↓', disabled: !linkedDocument(component.link) });
  }
  appendDesignPicker(group, scope, component.link);
}

function appendDesignPicker(group, scope, current) {
  appendContextSubmenu(group, current ? 'Link to another design' : 'Link to design', (submenu) => {
    submenu.classList.add('context-submenu-scroll');
    const designs = linkableDesigns();
    if (!designs.length) appendContextItem(submenu, 'No other designs in the workspace', () => {}, { disabled: true });
    for (const doc of designs) appendContextItem(submenu, doc.name, () => setLinks(scope, doc.name), { active: doc.name === current });
    if (current) appendContextItem(submenu, 'None (unlink)', () => setLinks(scope, null));
  });
}

/** The menu of a bubble: open, hide, or relink its part. */
export function openLinkBubbleMenu(refdes, x, y) {
  const component = editor.circuit.components.get(refdes);
  if (!component || !componentContextMenuEl) return;
  closeComponentContextMenu();
  const menu = componentContextMenuEl;
  menu.hidden = false;
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - 250))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - 120))}px`;
  const heading = document.createElement('div');
  heading.className = 'context-menu-heading';
  heading.textContent = `${component.link} · linked from ${component.refdes}`;
  menu.appendChild(heading);
  const group = document.createElement('div');
  group.className = 'context-menu-group';
  appendContextItem(group, `Open ${component.link}`, () => void enterLinkedDesign(component), { shortcut: 'Alt+↓ / dbl-click', disabled: !linkedDocument(component.link) });
  appendContextItem(group, 'Hide linked design', () => closeLinkBubble(refdes), { shortcut: 'o' });
  appendDesignPicker(group, [component], component.link);
  menu.appendChild(group);
  menu.querySelector('button:not(:disabled)')?.focus();
}

export function installHierarchy() {
  document.getElementById('hierarchy-up')?.addEventListener('click', () => void leaveLinkedDesign(1));
}
