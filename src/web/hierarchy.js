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
 * A link to a design that is not in the workspace is simply broken: the side
 * panel marks the part with a red dot, and its bubble and menu say so. Which
 * bubbles are open, and where any was dragged to, is remembered per document
 * in this browser; they are never saved in the document or undone.
 */

import { loadDocument } from '../core/document.js';
import { svgString } from '../core/render.js';
import { DRAWING_EXPORT_OPTIONS } from '../core/selection-drawing.js';
import { GRID } from '../core/grid.js';
import { searchKey } from '../core/design-index.js';
import { BUBBLE_DOT, BUBBLE_RADIUS, captionAnchor, bubbleAt, bubbleExtras, bubbleOffset, layoutBubbles } from '../core/link-bubble.js';
import { applyExportDarkTheme, withEmbeddedMathFont } from './drawing-export.js';
import { logLine, hintLine } from './status-bar-ui.js';
import { animateViewTo, fitTarget, fitView } from './canvas-view.js';
import { viewFitting } from './atlas-layout.js';
import { componentContextMenuEl } from './elements.js';
import { appendContextItem, appendContextSubmenu, closeComponentContextMenu } from './context-menu.js';
import { editor } from './editor-state.js';
import { persistence, openDocumentPath } from './document-session.js';
import { commit, render, selectedComps, setSelection } from './main.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const OPEN_KEY = 'mosfeteer.linkBubbles:';
const SPOTS_KEY = 'mosfeteer.linkBubbleSpots:';
const CLOSE_MS = 180;
const UP_MS = 380;

// refdes -> { name, path, status: 'loading'|'ready'|'missing'|'error', message, box, href: { light, dark } }
const bubbles = new Map();
let bubblesDocument; // the document the bubbles belong to (undefined: none yet)
let layoutCache = { key: '', layout: [] };
const angles = new Map(); // refdes -> the angle its bubble last took
const spots = new Map(); // refdes -> { dx, dy }: a dragged bubble's corner from its part's centre
let layerEl = null;
const nodes = new Map(); // refdes -> its drawn bubble
const pictures = new Map(); // path -> { revision, box, href }: drawn once per revision

// The way back up: [{ path, name, view, refdes, childPath }], outermost first.
let trail = [];

// ----- finding a linked design -----------------------------------------------------

/** Every design the editor knows of: the workspace's, then recent ones. */
function knownDesigns(state = editor.workspaceState || {}) {
  return [...(state.documents || []), ...(state.recent || [])].filter((doc) => doc.kind === 'circuit' || !doc.kind);
}

/** The document a link names, or null: one of that name beside the open
 *  document first, else any. */
export function linkedDocument(name, state = editor.workspaceState || {}) {
  if (!name) return null;
  const matches = knownDesigns(state).filter((doc) => doc.name === name && !doc.missing);
  return matches.find((doc) => doc.dir && doc.dir === editor.currentDocumentDir) || matches[0] || null;
}

/** Designs a part may link to: every known one but the open document. */
export function linkableDesigns() {
  const seen = new Set();
  return knownDesigns()
    .filter((doc) => doc.path !== editor.currentDocumentPath && !seen.has(doc.name) && seen.add(doc.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

// ----- pictures ----------------------------------------------------------------------

const dataUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** A design drawn as a bubble's picture, in both themes; null when empty. */
async function pictureOf(circuit) {
  if (!circuit.components.size && !circuit.labels.size) return null;
  const svg = svgString(circuit, { ...DRAWING_EXPORT_OPTIONS, background: false, emptyHint: false });
  const match = svg.match(/viewBox="([-\d.e]+)[ ,]+([-\d.e]+)[ ,]+([-\d.e]+)[ ,]+([-\d.e]+)"/);
  if (!match) return null;
  const [light, dark] = await Promise.all([withEmbeddedMathFont(svg), withEmbeddedMathFont(applyExportDarkTheme(svg))]);
  const [x, y, w, h] = match.slice(1).map(Number);
  // `svg` stays as drawn, for exports to nest as vector drawing.
  return { svg, box: { x, y, w, h }, href: { light: dataUrl(light), dark: dataUrl(dark) } };
}

/** The document a link names, asking for the workspace's documents when
 *  the editor has not listed them yet (right after launch) or lists them
 *  without it, so a link is only broken when the design is really gone. */
async function resolveLink(name) {
  const doc = linkedDocument(name);
  if (doc) return doc;
  try {
    return linkedDocument(name, await persistence.workspace());
  } catch {
    return null;
  }
}

async function loadBubble(refdes, name) {
  const doc = await resolveLink(name);
  const settle = (entry) => {
    if (bubbles.get(refdes)?.name !== name) return; // closed or relinked meanwhile
    bubbles.set(refdes, entry);
    render();
    revealBubbles();
  };
  if (!doc) {
    settle({ name, status: 'missing', message: `“${name}” is not in the workspace` });
    return;
  }
  try {
    const cached = pictures.get(doc.path);
    let picture = cached && (!doc.revision || cached.revision === doc.revision) ? cached : null;
    if (!picture) {
      const data = await persistence.load(doc.path);
      picture = await pictureOf(loadDocument(data.state));
      if (picture) pictures.set(doc.path, { ...picture, revision: doc.revision || data.revision || null });
    }
    settle(picture
      ? { name, path: doc.path, status: 'ready', svg: picture.svg, box: picture.box, href: picture.href }
      : { name, status: 'error', message: `“${name}” is empty` });
  } catch (err) {
    settle({ name, status: 'error', message: `“${name}” could not be read: ${err.message}` });
  }
}

// ----- which bubbles are open ----------------------------------------------------------

function rememberOpen() {
  const path = editor.currentDocumentPath;
  if (!path) return;
  try {
    if (bubbles.size) localStorage.setItem(OPEN_KEY + path, JSON.stringify([...bubbles.keys()]));
    else localStorage.removeItem(OPEN_KEY + path);
  } catch { /* not remembered, then */ }
}

function rememberSpots() {
  const path = editor.currentDocumentPath;
  if (!path) return;
  try {
    if (spots.size) localStorage.setItem(SPOTS_KEY + path, JSON.stringify(Object.fromEntries(spots)));
    else localStorage.removeItem(SPOTS_KEY + path);
  } catch { /* not remembered, then */ }
}

function rememberedSpots(path) {
  if (!path) return {};
  try {
    const saved = JSON.parse(localStorage.getItem(SPOTS_KEY + path) || '{}');
    return saved && typeof saved === 'object' ? saved : {};
  } catch { return {}; }
}

function rememberedOpen(path) {
  if (!path) return [];
  try {
    const saved = JSON.parse(localStorage.getItem(OPEN_KEY + path) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch { return []; }
}

/** Another document is open: its own remembered bubbles come back. */
function followDocument() {
  if (bubblesDocument === editor.currentDocumentPath) return;
  bubblesDocument = editor.currentDocumentPath;
  bubbles.clear();
  angles.clear();
  spots.clear();
  for (const [refdes, spot] of Object.entries(rememberedSpots(bubblesDocument))) {
    if (Number.isFinite(spot?.dx) && Number.isFinite(spot?.dy)) spots.set(refdes, { dx: spot.dx, dy: spot.dy });
  }
  for (const refdes of rememberedOpen(bubblesDocument)) {
    const component = editor.circuit.components.get(refdes);
    if (component?.link) openBubble(component, { remember: false });
  }
}

/** Linked parts an action is about: the selected ones, else the one whose
 *  bubble is under the cursor. */
function linkTargets() {
  const selected = selectedComps().filter((c) => c.link);
  if (selected.length) return selected;
  const bubble = bubbleAt(currentLayout(), editor.cursor);
  const component = bubble ? editor.circuit.components.get(bubble.id) : null;
  return component ? [component] : [];
}

/** Shift+O: show every linked part's design, or hide them all when they
 *  all show. */
export function toggleAllLinkBubbles() {
  const linked = [...editor.circuit.components.values()].filter((c) => c.link);
  if (!linked.length) {
    hintLine('LINK: no part links to a design yet (right-click a part → Link to design)');
    return;
  }
  toggleLinkBubbles(linked);
}

/** o: show the selected (or pointed-at) parts' linked designs, or hide them
 *  when they all show. */
export function toggleLinkBubbles(components = linkTargets()) {
  const linked = components.filter((c) => c.link);
  if (!linked.length) {
    hintLine('LINK: select a part linked to a design (right-click → Link to design), then o shows it beside the drawing');
    return;
  }
  followDocument();
  const close = linked.every((c) => bubbles.has(c.refdes));
  const shown = close ? linkBubbleFrames() : [];
  for (const component of linked) {
    if (close) closeLinkBubble(component.refdes, { refit: false });
    else if (!bubbles.has(component.refdes)) openBubble(component);
  }
  render();
  if (close) refitAfterClosing(shown);
}

function openBubble(component, { remember = true } = {}) {
  bubbles.set(component.refdes, { name: component.link, status: 'loading' });
  if (remember) rememberOpen();
  void loadBubble(component.refdes, component.link);
}

export function closeLinkBubble(refdes, { refit = true } = {}) {
  const shown = refit ? linkBubbleFrames() : [];
  if (!bubbles.delete(refdes)) return;
  rememberOpen();
  render();
  if (refit) refitAfterClosing(shown);
}

/** Bubbles that were just hidden leave room the view no longer needs: when
 *  the view showed all that is left with room to spare and a hidden bubble
 *  was on screen, it fits inward again. A view zoomed in past that is kept. */
function refitAfterClosing(before) {
  const view = editor.view;
  const onScreen = (frame) => frame.x < view.x + view.w && frame.x + frame.w > view.x
    && frame.y < view.y + view.h && frame.y + frame.h > view.y;
  const remaining = new Set(linkBubbleFrames().map((frame) => `${frame.x},${frame.y},${frame.w},${frame.h}`));
  const left = before.filter((frame) => !remaining.has(`${frame.x},${frame.y},${frame.w},${frame.h}`));
  if (!left.some(onScreen)) return;
  const target = fitTarget();
  if (target.w < view.w * 0.98 && target.h < view.h * 0.98) fitView({ animate: true });
}

export function linkBubbleOpen(refdes) {
  return bubbles.has(refdes);
}

/** The part whose bubble is at a world point: { refdes } or null. */
export function linkBubbleAt(point) {
  const hit = bubbleAt(currentLayout(), point);
  return hit ? { refdes: hit.id } : null;
}

/**
 * The open bubbles, for an export of `drawing` (the document, or a selected
 * subset of it): render.js `extras`, the designs nested as vector drawing,
 * laid out as the editor shows them (or afresh around a subset). Only
 * bubbles whose design has drawn are exported; null when there are none.
 */
export function linkBubbleExtras(drawing = editor.circuit) {
  const whole = drawing === editor.circuit;
  const ready = [...bubbles].filter(([refdes, bubble]) => bubble.status === 'ready' && drawing.components.has(refdes));
  if (!ready.length) return null;
  const layout = whole
    ? currentLayout().filter((entry) => bubbles.get(entry.id)?.status === 'ready')
    : layoutBubbles(drawing.inkBounds(), ready.map(([refdes, bubble]) => ({
      id: refdes, part: drawing.components.get(refdes).bboxWorld(), size: bubble.box, offset: spots.get(refdes),
    })), { obstacles: obstacles(drawing), previous: angles });
  return bubbleExtras(layout.map((entry) => {
    const bubble = bubbles.get(entry.id);
    return { ...entry, name: bubble.name, svg: bubble.svg, box: bubble.box };
  }));
}

/** Drag a bubble: its frame's top-left corner goes to `at` (a world point),
 *  and stays there beside its part until put back. `remember` saves the
 *  spot, once the drag ends. */
export function moveLinkBubble(refdes, at, { remember = true } = {}) {
  const component = editor.circuit.components.get(refdes);
  if (!component || !bubbles.has(refdes)) return;
  spots.set(refdes, bubbleOffset(component.bboxWorld(), at));
  if (remember) rememberSpots();
  render();
}

/** The frame a bubble is drawn in now, or null. */
export function linkBubbleFrame(refdes) {
  return currentLayout().find((entry) => entry.id === refdes)?.frame || null;
}

/** Put a dragged bubble back where the layout would place it. */
export function resetLinkBubble(refdes) {
  if (!spots.delete(refdes)) return;
  rememberSpots();
  render();
}

/** The frames of the bubbles on show, for fitting the view to them. */
export function linkBubbleFrames() {
  return currentLayout().map((bubble) => bubble.frame);
}

/** A bubble that has just appeared out of view brings the view to fit it. */
function revealBubbles() {
  const view = editor.view;
  const hidden = currentLayout().some(({ frame }) => frame.x < view.x || frame.y < view.y
    || frame.x + frame.w > view.x + view.w || frame.y + frame.h > view.y + view.h);
  if (hidden) fitView({ animate: true });
}

// ----- laying them out -----------------------------------------------------------------

/** What a connector should keep clear of: parts, labels, and wires. */
function obstacles(circuit) {
  const rects = [];
  for (const component of circuit.components.values()) if (component.type !== 'solder') rects.push(component.bboxWorld());
  for (const label of circuit.labels.values()) if (label.text && !label.points) rects.push(label.inkRect());
  const segments = [];
  for (const net of circuit.nets.values()) {
    for (const path of net.paths()) for (let i = 1; i < path.length; i++) segments.push([path[i - 1], path[i]]);
  }
  return { rects, segments };
}

/** The bubbles with a picture (or a broken link) to show, laid out; kept
 *  while neither the drawing nor the bubbles change. */
function currentLayout() {
  followDocument();
  const circuit = editor.circuit;
  for (const [refdes, bubble] of [...bubbles]) {
    const component = circuit.components.get(refdes);
    if (!component?.link) bubbles.delete(refdes);
    // A changed link, or a broken one the workspace now has, loads afresh.
    else if (component.link !== bubble.name || (bubble.status === 'missing' && linkedDocument(bubble.name))) {
      openBubble(component, { remember: false });
    }
  }
  const shown = [...bubbles].filter(([, bubble]) => bubble.status !== 'loading');
  const spot = (refdes) => (spots.has(refdes) ? `@${spots.get(refdes).dx},${spots.get(refdes).dy}` : '');
  const key = `${editor.modelRevision}|${editor.currentDocumentPath}|${shown.map(([refdes, b]) => `${refdes}:${b.status}:${b.box?.w}x${b.box?.h}${spot(refdes)}`).join(',')}`;
  if (layoutCache.key === key) return layoutCache.layout;
  // A broken link's box fits its message (24-unit italic, about half an em
  // a character).
  const messageSize = (bubble) => ({ w: Math.max(12 * GRID, messageText(bubble).length * 13), h: 2 * GRID });
  const layout = shown.length ? layoutBubbles(circuit.inkBounds(), shown.map(([refdes, bubble]) => ({
    id: refdes,
    part: circuit.components.get(refdes).bboxWorld(),
    size: bubble.status === 'ready' ? bubble.box : messageSize(bubble),
    offset: spots.get(refdes),
  })), { obstacles: obstacles(circuit), previous: angles }) : [];
  for (const entry of layout) angles.set(entry.id, entry.angle);
  layoutCache = { key, layout };
  return layout;
}

// ----- drawing them --------------------------------------------------------------------

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
 *  rebuilds, so a picture is decoded once and never flickers. */
export function mountLinkBubbles(svgRoot, before) {
  if (!layerEl) layerEl = svgEl('g', { class: 'link-bubbles' });
  svgRoot.insertBefore(layerEl, before || null);
  syncLinkBubbles();
}

const messageText = (bubble) => `${bubble.message} · right-click to link another`;

const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Bring the drawn bubbles up to date: called on every render. A bubble
 *  appears only once its picture is ready, growing out of its part; a
 *  closed one shrinks back into it. */
export function syncLinkBubbles() {
  checkTrail();
  if (!layerEl) return;
  const layout = currentLayout();
  const dark = document.documentElement.classList.contains('dark');
  const live = new Set();
  for (const entry of layout) {
    const bubble = bubbles.get(entry.id);
    live.add(entry.id);
    let node = nodes.get(entry.id);
    if (node?.closing) {
      node.group.remove();
      nodes.delete(entry.id);
      node = null;
    }
    const [from, to] = entry.connector;
    if (!node) {
      const group = svgEl('g', { class: 'link-bubble' });
      node = {
        group,
        connector: svgEl('path', { class: 'link-bubble-connector', fill: 'none' }),
        dot: svgEl('circle', { class: 'link-bubble-dot', r: BUBBLE_DOT }),
        // Rounded corners set the bubble apart from box annotations.
        frame: svgEl('rect', { class: 'link-bubble-frame', rx: BUBBLE_RADIUS }),
        caption: svgEl('text', { class: 'link-bubble-caption' }),
        image: svgEl('image', { preserveAspectRatio: 'xMidYMid meet' }),
        message: svgEl('text', { class: 'link-bubble-message', 'text-anchor': 'middle', 'dominant-baseline': 'central' }),
      };
      group.append(node.connector, node.frame, node.dot, node.caption, node.image, node.message);
      nodes.set(entry.id, node);
      if (!reducedMotion()) {
        // Grow out of the part. The class goes once it has played, so the
        // canvas redrawing under it never plays it again.
        group.style.transformOrigin = `${from.x}px ${from.y}px`;
        group.classList.add('entering');
        group.addEventListener('animationend', () => group.classList.remove('entering'), { once: true });
      }
    }
    setAttrs(node.connector, { d: `M ${from.x} ${from.y} L ${to.x} ${to.y}` });
    setAttrs(node.dot, { cx: from.x, cy: from.y });
    setAttrs(node.frame, { x: entry.frame.x, y: entry.frame.y, width: entry.frame.w, height: entry.frame.h });
    setAttrs(node.caption, captionAnchor(entry.frame));
    if (node.caption.textContent !== bubble.name) node.caption.textContent = bubble.name;
    node.from = from;
    node.group.classList.toggle('broken', bubble.status !== 'ready');
    if (bubble.status === 'ready') {
      setAttrs(node.image, { x: entry.image.x, y: entry.image.y, width: entry.image.w, height: entry.image.h, href: dark ? bubble.href.dark : bubble.href.light });
      node.image.style.display = '';
      node.message.style.display = 'none';
    } else {
      node.image.style.display = 'none';
      node.message.style.display = '';
      setAttrs(node.message, { x: entry.image.x + entry.image.w / 2, y: entry.image.y + entry.image.h / 2 });
      const text = messageText(bubble);
      if (node.message.textContent !== text) node.message.textContent = text;
    }
    if (node.group.parentNode !== layerEl) layerEl.appendChild(node.group);
  }
  for (const [refdes, node] of [...nodes]) {
    if (live.has(refdes) || node.closing) continue;
    if (reducedMotion() || !node.group.isConnected) {
      node.group.remove();
      nodes.delete(refdes);
      continue;
    }
    node.closing = true;
    node.group.classList.remove('entering');
    node.group.style.transformOrigin = `${node.from.x}px ${node.from.y}px`;
    node.group.classList.add('leaving');
    setTimeout(() => {
      if (nodes.get(refdes) !== node) return;
      node.group.remove();
      nodes.delete(refdes);
    }, CLOSE_MS);
  }
}

// ----- entering and leaving ------------------------------------------------------------

/** The trail is only good while the documents it passed through are the
 *  ones open: opening another design any other way leaves the hierarchy. */
function checkTrail() {
  if (trail.length && trail.at(-1).childPath !== editor.currentDocumentPath) trail = [];
  renderTrail();
}

const paneRect = () => document.querySelector('.canvas-pane')?.getBoundingClientRect();

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
  const bubble = currentLayout().find((item) => item.id === component.refdes);
  const pane = paneRect();
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

/** Alt+Up (or a step of the trail): back to the design `levels` up. The
 *  design just left shrinks into its bubble there as the view returns to
 *  where the parent was left, its linked part selected. */
export async function leaveLinkedDesign(levels = 1) {
  checkTrail();
  if (!trail.length) {
    hintLine('LINK: not inside a linked design; Alt+↓ on a linked part opens it');
    return false;
  }
  const index = Math.max(0, trail.length - levels);
  const target = trail[index];
  // The child as saved, drawn now, so its bubble is ready the moment the
  // parent opens.
  const childPath = editor.currentDocumentPath;
  let picture = null;
  if (levels === 1) {
    try { picture = await pictureOf(loadDocument(JSON.parse(editor.lastSavedSnapshot))); } catch { picture = null; }
  }
  const opened = await openDocumentPath(target.path);
  if (!opened) return false;
  trail = trail.slice(0, index);
  const component = editor.circuit.components.get(target.refdes);
  if (component) setSelection([target.refdes]);
  const pane = paneRect();
  if (picture && component?.link && pane) {
    pictures.set(childPath, { ...picture, revision: null });
    followDocument();
    bubbles.set(target.refdes, { name: component.link, path: childPath, status: 'ready', svg: picture.svg, box: picture.box, href: picture.href });
    rememberOpen();
    const bubble = currentLayout().find((item) => item.id === target.refdes);
    if (bubble && !reducedMotion()) {
      Object.assign(editor.view, viewFitting(bubble.image, pane.width, pane.height, 0.05));
      render();
      animateViewTo(target.view, UP_MS);
      renderTrail();
      return true;
    }
  }
  Object.assign(editor.view, target.view);
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

// ----- the side panel and menus ------------------------------------------------------

/** The dot after a linked part's name in the side panel: the accent color,
 *  or red when the design it names is not in the workspace. */
export function linkDot(component) {
  if (!component?.link) return null;
  const dot = document.createElement('span');
  const broken = !linkedDocument(component.link);
  dot.className = `link-dot${broken ? ' broken' : ''}`;
  dot.title = broken
    ? `Links to “${component.link}”, which is not in the workspace — right-click to link another`
    : `Links to ${component.link} · o shows it · Alt+↓ opens it`;
  dot.setAttribute('aria-label', dot.title);
  return dot;
}

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

/** The designs to link to, with a field that narrows them as it is typed
 *  into (typing anywhere in the list goes there). */
function appendDesignPicker(group, scope, current) {
  const submenu = appendContextSubmenu(group, current ? 'Link to another design' : 'Link to design', (list) => {
    list.classList.add('context-submenu-scroll');
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'context-submenu-search';
    search.placeholder = 'Find a design…';
    search.setAttribute('aria-label', 'Find a design to link to');
    list.appendChild(search);
    const designs = linkableDesigns();
    const items = designs.map((doc) => {
      appendContextItem(list, doc.name, () => setLinks(scope, doc.name), { active: doc.name === current });
      const item = list.lastElementChild;
      item.dataset.key = searchKey(doc.name);
      return item;
    });
    const empty = document.createElement('div');
    empty.className = 'context-submenu-empty';
    empty.textContent = designs.length ? 'No design matches' : 'No other designs in the workspace';
    empty.hidden = designs.length > 0;
    list.appendChild(empty);
    if (current) appendContextItem(list, 'None (unlink)', () => setLinks(scope, null));
    const visible = () => items.filter((item) => !item.hidden);
    search.addEventListener('input', () => {
      const key = searchKey(search.value);
      for (const item of items) item.hidden = !!key && !item.dataset.key.includes(key);
      empty.hidden = visible().length > 0;
    });
    search.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') return;
      ev.stopPropagation();
      if (ev.key === 'Enter') {
        ev.preventDefault();
        visible()[0]?.click();
      } else if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        visible()[0]?.focus();
      }
    });
    list.addEventListener('keydown', (ev) => {
      if (ev.target === search || ev.key.length !== 1 || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      search.focus();
    });
  });
  submenu.previousElementSibling?.addEventListener('keydown', (ev) => {
    if (ev.key.length !== 1 || ev.ctrlKey || ev.metaKey || ev.altKey || ev.key === ' ') return;
    submenu.querySelector('.context-submenu-search')?.focus();
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
  if (spots.has(refdes)) appendContextItem(group, 'Put back beside the drawing', () => resetLinkBubble(refdes));
  appendDesignPicker(group, [component], component.link);
  menu.appendChild(group);
  menu.querySelector('button:not(:disabled)')?.focus();
}

export function installHierarchy() {
  document.getElementById('hierarchy-up')?.addEventListener('click', () => void leaveLinkedDesign(1));
}
