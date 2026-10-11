import { editorSource, functionSource } from './helpers/editor-source.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { GRID } from '../src/core/grid.js';
import { alignedAnchorShift, attachedEdgeShift, compatibilityMoveFilter, constrainAxis, isKeyboardSurfaceTarget, isPrimaryPointerEvent, isSelectionModifier, moveAnnotationEndpoint, nearestPoint, resizeRect, shouldForwardCanvasMove, shouldPanTouch, symmetryOperation, viewFollowingCursor, worldAndCursorFromClient } from '../src/web/interaction.js';

const rect = { left: 10, top: 20, width: 100, height: 100 };
const view = { x: -80, y: -80, w: 400, h: 400 };

test('document raster export sizes PNGs by the chosen DPI and keeps a fine PDF fallback', () => {
  const main = editorSource();
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  assert.match(main, /svgToPngDataUrl\(svg, exportPngScale\(pngDpi\), \{ dpi: pngDpi \}\)/);
  assert.match(main, /request\.pdfPng = await svgToPngDataUrl\(svg, PDF_FALLBACK_PNG_SCALE\)/);
  assert.match(main, /pngRasterScale\(dpi, pageGuide\?\.textPt \?\? DEFAULT_EXPORT_TEXT_PT\)/);
  assert.match(main, /writeDrawingToClipboard\(svg, \{ dpi, scale: exportPngScale\(dpi\) \}\)/);
  assert.match(html, /<select name="pngDpi">[\s\S]*?value="300" selected/);
});

test('insert categories keep switches and macros separate and include vccs with sources', async () => {
  const { symbolCategories } = await import('../src/core/components/categories.js');
  const groups = Object.fromEntries(symbolCategories().map(({ title, types }) => [title, types]));
  assert.deepEqual(groups.Switches, ['switch_open', 'switch_closed']);
  assert.deepEqual([...groups['Sources & power']].sort(), ['current_source', 'ground', 'supply', 'vccs', 'vcm', 'vcvs', 'voltage_source']);
  assert.deepEqual([...groups.Macros].sort(), ['adc', 'adc_diff', 'comparator', 'comparator_clocked', 'dac', 'dac_diff', 'gm', 'opamp', 'opamp_diff']);
  assert.ok(groups.Logic.includes('mux2') && groups.Logic.includes('tristate_buffer') && groups.Logic.includes('xnor3_gate'));
  assert.ok(groups.Sequential.includes('dff') && groups.Sequential.includes('latch_enb_rstb_qb'));
  assert.deepEqual(groups['Signal flow'], ['signal_sum', 'signal_multiply', 'tf_s', 'tf_z', 'tf_dac', 'tf_dac_rz', 'tf_delay', 'tf_zdelay', 'gain', 'sampler', 'quantizer', 'dither']);
  // Filters draw block diagrams; the signal-flow analysis does not read them.
  assert.deepEqual(groups['Block diagram'], ['block', 'filter_lpf', 'filter_hpf', 'filter_bpf', 'filter_notch']);
  assert.equal(groups.Other, undefined, 'every registered symbol has a category');
  // The insert menu uses the same groups.
  assert.match(readFileSync(new URL('../src/web/insert-menu.js', import.meta.url), 'utf8'), /symbolCategories\(availableTypes\)/);
});

test('an aligned label keeps its own edge when its measured box changes', () => {
  // The anchor is the box center, so half of a width change moves with it.
  assert.equal(alignedAnchorShift('left', 560, 640), 40);
  assert.equal(alignedAnchorShift('right', 560, 640), -40);
  assert.equal(alignedAnchorShift('left', 640, 560), -40);
  // A centered label stays centered, and an unchanged box never moves.
  assert.equal(alignedAnchorShift('center', 560, 640), 0);
  assert.equal(alignedAnchorShift('left', 560, 560), 0);
  assert.equal(alignedAnchorShift('left', 560, Number.NaN), 0);
});

test('the view follows the cursor out of frame, minimally and with a margin', () => {
  const view = { x: 0, y: 0, w: 400, h: 400 };
  assert.equal(viewFollowingCursor(view, { x: 200, y: 200 }, 40), null, 'no scroll while inside');
  assert.equal(viewFollowingCursor(view, { x: 360, y: 40 }, 40), null, 'the margin edge is still inside');
  // Scrolling stops as soon as the cursor is one margin inside the frame.
  assert.deepEqual(viewFollowingCursor(view, { x: 420, y: 200 }, 40), { x: 60, y: 0 });
  assert.deepEqual(viewFollowingCursor(view, { x: 200, y: -80 }, 40), { x: 0, y: -120 });
  assert.deepEqual(viewFollowingCursor(view, { x: -40, y: 440 }, 40), { x: -80, y: 80 });
  // A margin wider than the view cannot pin the cursor mid-screen.
  assert.deepEqual(viewFollowingCursor({ x: 0, y: 0, w: 80, h: 80 }, { x: 120, y: 40 }, 400), { x: 60, y: 0 });
  assert.equal(viewFollowingCursor(null, { x: 0, y: 0 }, 40), null);
});

test('generated category labels keep their persisted grid metrics', () => {
  const main = editorSource();
  const start = main.indexOf('function syncRenderedLabelMetrics()');
  const end = main.indexOf('\n}\n', start) + 2;
  assert.match(main.slice(start, end), /if \(label\.id\.startsWith\('category_'\)\) continue;/);
});

test('selection extension uses one cross-platform modifier policy', () => {
  assert.equal(isSelectionModifier({ shiftKey: true }), true);
  assert.equal(isSelectionModifier({ ctrlKey: true }), true);
  assert.equal(isSelectionModifier({ metaKey: true }), true);
  assert.equal(isSelectionModifier({ altKey: true }), false);
});

test('axis constraint follows the dominant pointer direction', () => {
  const start = { x: 40, y: 80 };
  assert.deepEqual(constrainAxis(start, { x: 200, y: 160 }), { x: 200, y: 80 });
  assert.deepEqual(constrainAxis(start, { x: 120, y: 280 }), { x: 40, y: 280 });
  assert.deepEqual(constrainAxis(start, { x: 200, y: 240 }), { x: 200, y: 80 });
  assert.deepEqual(constrainAxis(start, { x: 200, y: 240 }, false), { x: 200, y: 240 });
});

test('pointer policy accepts pen/touch primary presses and pans blank touch space', () => {
  assert.equal(isPrimaryPointerEvent({ pointerType: 'mouse', button: 0 }), true);
  assert.equal(isPrimaryPointerEvent({ pointerType: 'pen', button: 0 }), true);
  assert.equal(isPrimaryPointerEvent({ pointerType: 'touch', button: 0 }), true);
  assert.equal(isPrimaryPointerEvent({ pointerType: 'touch', button: 1 }), false);
  assert.equal(shouldPanTouch({ pointerType: 'touch', hasHit: false }), true);
  assert.equal(shouldPanTouch({ pointerType: 'touch', hasHit: true }), false);
  assert.equal(shouldPanTouch({ pointerType: 'pen', hasHit: false }), false);
});

test('window pointer forwarding ignores the insert menu overlay', () => {
  const canvas = {};
  const canvasTarget = {};
  canvas.contains = (target) => target === canvasTarget;
  const insertMenuTarget = { closest: (selector) => selector.includes('#insert-menu') ? {} : null };
  const windowTarget = { closest: (selector) => selector.includes('.floating-window') ? {} : null };
  const otherOverlayTarget = { closest: () => null };
  assert.equal(shouldForwardCanvasMove(canvasTarget, canvas), false, 'canvas events are already handled directly');
  assert.equal(shouldForwardCanvasMove(insertMenuTarget, canvas), false, 'insert-menu events stay in the menu');
  assert.equal(shouldForwardCanvasMove(windowTarget, canvas), false, 'a floating window keeps its moves (dragging it does not repaint the drawing)');
  assert.equal(shouldForwardCanvasMove(otherOverlayTarget, canvas), true, 'other pane overlays still forward moves');
});

test('global shortcuts yield to interactive controls', () => {
  assert.equal(isKeyboardSurfaceTarget({ tagName: 'BUTTON' }), true);
  assert.equal(isKeyboardSurfaceTarget({ tagName: 'div', closest: (selector) => selector.includes('option') }), true);
  assert.equal(isKeyboardSurfaceTarget({ tagName: 'div' }), false);
});

test('annotation endpoints move and reject invalid shapes', () => {
  const arrow = { kind: 'arrow', anchor: { x: 0, y: 0 }, end: { x: 160, y: 0 } };
  assert.equal(moveAnnotationEndpoint(arrow, 'end', { x: 240, y: 80 }), true);
  assert.deepEqual(arrow.end, { x: 240, y: 80 });
  const before = { ...arrow.end };
  assert.equal(moveAnnotationEndpoint(arrow, 'end', { x: 40, y: 0 }), false);
  assert.deepEqual(arrow.end, before);

  const line = { kind: 'line', anchor: { x: 0, y: 0 }, end: { x: 160, y: 0 }, points: [{ x: 0, y: 0 }, { x: 160, y: 0 }] };
  line.moveVertex = (index, x, y) => { line.points[index] = { x, y }; };
  assert.equal(moveAnnotationEndpoint(line, 'vertex:1', { x: 160, y: 80 }), true);
  assert.deepEqual(line.points[1], { x: 160, y: 80 });
});


test('resize handles move their edges, and Ctrl mirrors them about the center', () => {
  const rect = { x: 0, y: 0, w: 160, h: 80 };
  assert.deepEqual(resizeRect(rect, 'e', { x: 238, y: 999 }), { x: 0, y: 0, w: 240, h: 80 });
  assert.deepEqual(resizeRect(rect, 'nw', { x: -40, y: -40 }), { x: -40, y: -40, w: 200, h: 120 });
  // An edge never passes the minimum size, however far it is pulled.
  assert.deepEqual(resizeRect(rect, 'w', { x: 400, y: 0 }), { x: 80, y: 0, w: 80, h: 80 });
  assert.deepEqual(resizeRect(rect, 'w', { x: 400, y: 0 }, { min: GRID }), { x: 120, y: 0, w: 40, h: 80 });

  // Blocks step two cells at a time so their center stays on the grid.
  assert.deepEqual(resizeRect(rect, 's', { x: 0, y: 120 }, { step: 2 * GRID }), { x: 0, y: 0, w: 160, h: 160 });
  assert.deepEqual(resizeRect(rect, 'e', { x: 200, y: 0 }, { step: 2 * GRID }), { x: 0, y: 0, w: 240, h: 80 });

  assert.deepEqual(resizeRect(rect, 'e', { x: 200, y: 0 }, { symmetric: true }), { x: -40, y: 0, w: 240, h: 80 });
  assert.deepEqual(resizeRect(rect, 'se', { x: 200, y: 120 }, { symmetric: true }), { x: -40, y: -40, w: 240, h: 160 });
  // Dragging past the center mirrors back out instead of inverting.
  assert.deepEqual(resizeRect(rect, 'e', { x: -40, y: 0 }, { symmetric: true }), { x: -40, y: 0, w: 240, h: 80 });
  // A half-cell center keeps mirrored edges on the grid, down to the minimum.
  const odd = { x: 0, y: 0, w: 120, h: 120 };
  assert.deepEqual(resizeRect(odd, 's', { x: 0, y: 200 }, { symmetric: true }), { x: 0, y: -80, w: 120, h: 280 });
  assert.deepEqual(resizeRect(odd, 'e', { x: 60, y: 0 }, { symmetric: true }), { x: 0, y: 0, w: 120, h: 120 });
  assert.deepEqual(resizeRect(odd, 'e', { x: 60, y: 0 }, { symmetric: true, min: GRID }), { x: 40, y: 0, w: 40, h: 120 });
});

test('a child label keeps the edge that was flush against its parent when it is measured', () => {
  const start = { x0: 0, x1: 0, y0: 0, y1: 0 };
  // Caption left of a rightward arrow: estimated 80 wide, measured 160.
  assert.deepEqual(attachedEdgeShift({ x: -80, y: -40, w: 80, h: 80 }, { w: 160, h: 80 }, start), { dx: -40, dy: 0 });
  // Caption right of a leftward arrow, and one above a downward arrow.
  assert.deepEqual(attachedEdgeShift({ x: 0, y: -40, w: 80, h: 80 }, { w: 160, h: 80 }, start), { dx: 40, dy: 0 });
  assert.deepEqual(attachedEdgeShift({ x: -40, y: -80, w: 80, h: 80 }, { w: 80, h: 160 }, start), { dx: 0, dy: -40 });
  // A title above a box keeps its bottom edge on the box top.
  const box = { x0: -200, x1: 200, y0: 0, y1: 160 };
  assert.deepEqual(attachedEdgeShift({ x: -40, y: -80, w: 80, h: 80 }, { w: 160, h: 160 }, box), { dx: 0, dy: -40 });
  // A reloaded caption re-measured against its estimate is not flush: no drift.
  assert.deepEqual(attachedEdgeShift({ x: -120, y: -40, w: 80, h: 80 }, { w: 160, h: 80 }, start), { dx: 0, dy: 0 });
});

test('Atlas creates a circuit through the unsaved-changes guard and preserves name focus', () => {
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  const atlas = readFileSync(new URL('../src/web/atlas.js', import.meta.url), 'utf8');
  assert.match(html, /id="atlas-new-circuit"[^>]+type="button"[^>]+data-icon="file-plus"[^>]*>New<\/button>/);
  assert.match(atlas, /newCircuitEl.hidden = source !== 'workspace'/);
  assert.match(atlas, /newCircuitEl\?\.addEventListener\('click', newDesign\);/);
  // The header's New and an empty desk's "New design" are the one guarded action.
  assert.match(atlas, /function newDesign\(\) \{\s*if \(state\?\.source !== 'workspace'\) return;\s*requestDocumentAction\('Starting a new circuit', \(\) => \{\s*finishClose\(\);\s*startNewDocument\(\);/);
  assert.match(atlas, /if \(ev.target.closest\?\.\('dialog'\)\) return;/);
  // A focused header button (a click, or a closed dialog handing focus back)
  // keeps only the keys that press or leave it; every other key is the desk's.
  assert.match(atlas, /querySelector\('\.atlas-head'\)\?\.addEventListener\('mousedown', \(ev\) => \{\s*if \(ev.target.closest\('button'\)\) ev.preventDefault\(\);/);
  // So do an empty desk's prompt buttons.
  assert.match(atlas, /if \(ev.target.closest\?\.\('\.atlas-head button, \.atlas-empty button'\) && \(ev.key === 'Enter' \|\| ev.key === ' ' \|\| ev.key === 'Tab'\)\) return;/);
  // The desk's drag leaves the prompt's clicks alone.
  assert.match(atlas, /ev\.target\.closest\?\.\('\.atlas-head, \.atlas-tags, \.atlas-empty'\)/);
});

test('opening a design from the Atlas flies once and loads without costing the flight a frame', () => {
  const atlas = readFileSync(new URL('../src/web/atlas.js', import.meta.url), 'utf8');
  const open = atlas.slice(atlas.indexOf('async function openTile'), atlas.indexOf('/** What the search found'));
  // The file is read at once but let in only when the flight lands, aimed at
  // where the editor will fit it; the header keeps its name until then.
  assert.match(open, /const loading = openDocumentPath\(entry\.path, \{ gate \}\);/);
  assert.match(open, /fittedView\(\{\s*x: entry\.box\.x \+ pad/);
  // The desk's toolbars slide away first; the design lands after the flight.
  assert.match(open, /await slideChrome\(rootEl, true\);\s*await animateView\(predicted, flightMs\(state\.view, predicted\), \{ camera: true, scatter: \{ tile, outward: true \} \}\);\s*\}\s*land\(\);/);
  // The other designs part around it as it flies, and gather back on the way out.
  assert.match(atlas, /function scattered\(tile\) \{/);
  assert.match(atlas, /if \(openTile\) partDesk\(openTile, false, state\.view, \{ t: 0 \}\);/);
  assert.match(atlas, /if \(!backEl \|\| state\.opening\) return;/);
  // Reduced motion flies nowhere: the desk fades, both ways, laid out unseen first.
  assert.match(open, /if \(reduced\) \{\s*\/\/ No flight/);
  assert.match(atlas, /if \(reduced && !startup\) rootEl\.classList\.add\('preparing'\);/);
  // Zooming out, the desk shows only once the open design is drawn on it.
  assert.match(atlas, /showOpenDesign\(\);\s*await bakeOpenDesign\(250\);/);
  const session = readFileSync(new URL('../src/web/document-session.js', import.meta.url), 'utf8');
  assert.match(session, /if \(gate\) await gate;/);
  const css = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.atlas\.preparing \{\s*opacity: 0;/);
  assert.match(css, /\.atlas \{ animation: none; transition: opacity 180ms ease-out; \}/);
});

test('the Atlas marks the open design apart from the pick and the hover; the pick lifts, its kin with it', () => {
  const atlas = readFileSync(new URL('../src/web/atlas.js', import.meta.url), 'utf8');
  const caption = atlas.slice(atlas.indexOf('function drawCaption'), atlas.indexOf('function fitText'));
  // A design lying flat shows the hover as a faint frame; the pick lifts it on a card.
  assert.match(caption, /if \(hovered && !selected && liftOf\(tile\.id\)\.lift < 0\.01\) \{\s*ctx\.save\(\);\s*ctx\.globalAlpha \*= 0\.3;/);
  assert.match(atlas, /function drawCard\(ctx, tile, rect, lift, palette\) \{/);
  assert.match(atlas, /lift: focus\.has\(tile\.id\) \? 1 : related\.has\(tile\.id\) \? RELATED_LIFT : 0, dim: focus\.size && !focus\.has\(tile\.id\) && !related\.has\(tile\.id\) \? 1 : 0/);
  // The open design, where Esc returns, carries an OPEN badge, and the way back names it.
  assert.match(caption, /if \(entry\.current\) \{[^]*ctx\.fillText\('OPEN'/);
  assert.match(atlas, /const label = `Back to \$\{name\}\$\{onDesk \|\| state\.source === 'symbols' \? '' : ' \(not in this workspace\)'\}`;/);
});

test('the Atlas header carries the editor toolbar\'s mark and theme toggle', () => {
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  const head = html.slice(html.indexOf('<header class="atlas-head'), html.indexOf('</header>', html.indexOf('<header class="atlas-head')));
  assert.match(head, /^<header[^>]*>\s*<button type="button" id="atlas-mark" class="app-mark app-mark-button atlas-mark"/);
  // The mark toggles: the toolbar's opens the Atlas, the Atlas's closes it.
  assert.match(html, /<button type="button" id="app-mark" class="app-mark app-mark-button"/);
  const atlas = readFileSync(new URL('../src/web/atlas.js', import.meta.url), 'utf8');
  assert.match(atlas, /getElementById\('atlas-mark'\)\?\.addEventListener\('click', \(\) => void closeAtlas\(\)\)/);
  assert.match(atlas, /getElementById\('app-mark'\)\?\.addEventListener\('click', \(\) => void openAtlas\(\)\)/);
  assert.match(head, /id="atlas-theme"[^>]+class="icon-button"[^>]+data-icon="moon"[^>]+aria-pressed="false"/);
  const toolbar = readFileSync(new URL('../src/web/toolbar-ui.js', import.meta.url), 'utf8');
  // The editor's switch is a checkbox item in the settings menu; the Atlas's a toggle.
  assert.match(html, /id="btn-theme" type="button" role="menuitemcheckbox"/);
  assert.match(toolbar, /for \(const button of themeButtons\) \{[\s\S]{0,200}button.setAttribute\('aria-checked', String\(dark\)\);[\s\S]{0,80}button.setAttribute\('aria-pressed', String\(dark\)\);/);
  assert.match(toolbar, /for \(const button of themeButtons\) button.addEventListener\('click', toggleTheme\);/);
  const elements = readFileSync(new URL('../src/web/elements.js', import.meta.url), 'utf8');
  assert.match(elements, /themeButtons = \[themeBtn, document.getElementById\('atlas-theme'\)\]/);
});

test('an Atlas search packs the found designs together once typing pauses', () => {
  const atlas = readFileSync(new URL('../src/web/atlas.js', import.meta.url), 'utf8');
  // Each keystroke marks and fades; the desk is packed again after a pause.
  assert.match(atlas, /const ARRANGE_DELAY_MS = 400;/);
  assert.match(atlas, /searchEl\?\.addEventListener\('input', \(\) => applySearch\(searchEl.value\)\);/);
  assert.match(atlas, /function applySearch\(query, \{ arrange = 'soon' \} = \{\}\)/);
  assert.match(atlas, /if \(arrange === 'soon'\) \{[\s\S]*?setTimeout\(\(\) => \{\s*if \(state\?\.generation === generation\) arrangeDesk\(\);\s*\}, ARRANGE_DELAY_MS\);/);
  // Only what the search found is laid out; nothing found keeps the desk, faded.
  assert.match(atlas, /const ids = state.matches \? \[\.\.\.state.matches.keys\(\)\] : \[\.\.\.state.entries.keys\(\)\];\s*if \(!ids.length && state.arranged !== null\) return;/);
  assert.match(atlas, /if \(key === state.arranged\) return;/);
  // Acting on the results packs first; opening or leaving drops a pending pack.
  assert.match(atlas, /function leaveSearch\(\) \{\s*arrangePending\(\);/);
  assert.match(atlas, /function stepMatch\(step\) \{\s*arrangePending\(\);/);
  assert.match(atlas, /function clearSearch\(\) \{[\s\S]*?applySearch\('', \{ arrange: 'now' \}\);/);
  assert.match(atlas, /async function openTile\(tile\) \{\s*clearTimeout\(state.arrangeTimer\);/);
  // A reopened Atlas lays out an on-going search at once.
  assert.match(atlas, /applySearch\(lastQuery, \{ arrange: 'instant' \}\);/);
});

test('the Atlas exports the designs on the desk as one vector sheet through the export dialog', () => {
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  const atlas = readFileSync(new URL('../src/web/atlas.js', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('../src/web/export-ui.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
  assert.match(html, /id="atlas-export" type="button" data-icon="download"[^>]*>Export<\/button>/);
  // What a search found, packed first; nothing found exports nothing.
  assert.match(atlas, /function exportDesk\(\) \{\s*if \(!state\) return;\s*arrangePending\(\);\s*if \(state.matches && !state.matches.size\)/);
  assert.match(atlas, /const items = state.tiles.map\(/);
  assert.match(atlas, /else if \(\(ev.ctrlKey \|\| ev.metaKey\) && !ev.shiftKey && !ev.altKey && key.toLowerCase\(\) === 'e'\) exportDesk\(\);/);
  // The dialog, dressed for the sheet: vectors only, the grid and theme shared.
  assert.match(ui, /export function exportAtlasSheet\(target\)/);
  assert.match(ui, /input.checked = input.value !== 'png' && supported && formats.includes\(input.value\);/);
  assert.match(css, /\.export-dialog\[data-target="atlas"\] \.export-png,/);
  assert.match(ui, /const svg = await withEmbeddedMathFont\(dark \? applyExportDarkTheme\(sheet\) : sheet\);/);
  // A document export keeps the Atlas's remembered formats.
  assert.match(ui, /JSON.stringify\(\{ \.\.\.saved, \.\.\.settings, formats, folders \}\)/);
});

test('exporting every beat writes one PDF with a page per beat beside numbered SVG and PNG files', () => {
  const ui = readFileSync(new URL('../src/web/export-ui.js', import.meta.url), 'utf8');
  assert.match(ui, /const onePdf = allBeats && formats.includes\('pdf'\);/);
  assert.match(ui, /formats: formats.filter\(\(format\) => format !== 'pdf'\)/);
  assert.match(ui, /if \(onePdf\) pages.push\(svg\);\s*if \(!job.formats.length\) continue;/);
  assert.match(ui, /write\(\{ dir, name, formats: \['pdf'\], svg: pages\[0\], pdfPages: pages, pdfPngPages \}\)/);
  assert.match(ui, /option\('all', `Every beat \(a \$\{editor.circuit.beats.length\}-page PDF; numbered SVG and PNG files\)`\)/);
});

test('an explicit new document is protected from active-document auto-loads', () => {
  const main = editorSource();
  const start = main.indexOf('function startNewDocument(');
  const end = main.indexOf('\n/**', start);
  const startNew = main.slice(start, end);
  assert.match(startNew, /syncGeneration \+= 1;/);
  assert.match(startNew, /activeSyncSuspended = true;/);

  const syncStart = main.indexOf('async function syncActiveCircuitOnce(');
  const syncEnd = main.indexOf('\n}\n', syncStart) + 2;
  const sync = main.slice(syncStart, syncEnd);
  assert.match(sync, /if \(activeSyncSuspended\)[\s\S]*lastSeenActive = active[\s\S]*return;/);
  assert.match(main.slice(0, main.indexOf('function copySelectionSource(')), /activeSyncSuspended = false;/);
});

test('startup paints before listing documents and restoring the requested document', () => {
  const main = editorSource();
  assert.match(main, /const listPromise = refreshCircuitList\(\);/);
  assert.match(main, /if \(openPath && openPath !== currentDocumentPath\) await openDocumentPath\(openPath\);/);
  assert.match(main, /fitView\(\);\s*restoreStartup\(\)/);
  assert.doesNotMatch(main, /fitView\(\);\s*render\(\);\s*restoreStartup/);
});

test('F5 reloads the application instead of entering the normal keymap', () => {
  const main = editorSource();
  assert.match(main, /if \(ev\.key === 'F5'\)/);
  assert.match(main, /ev\.preventDefault\(\);\s*flushDraft\(\);\s*window\.location\.reload\(\);/);
});

test('pointer paths use snapped cursor conversion', () => {
  assert.deepEqual(worldAndCursorFromClient(50, 70, rect, view), {
    world: { x: 80, y: 120 }, cursor: { x: 80, y: 120 },
  });
});

test('nearest-point selection provides the terminal target for Alt snapping', () => {
  const nearest = nearestPoint({ x: 75, y: 5 }, [
    { refdes: 'R1', term: 'a', x: 0, y: 0 },
    { refdes: 'R2', term: 'a', x: 80, y: 0 },
  ]);
  assert.equal(nearest.refdes, 'R2');
  assert.equal(nearest.term, 'a');
  assert.equal(nearest.distance, Math.hypot(5, 5));
});

test('symmetric placement mirrors across one axis, chosen by the cursor', () => {
  const pin = { x: 0, y: 0 };
  // Mostly sideways reflects across a vertical line, mostly up or down across
  // a horizontal one -- one at a time, like the Shift constraint.
  assert.equal(symmetryOperation(pin, { x: -160, y: 40 }), 'mirrorX');
  assert.equal(symmetryOperation(pin, { x: 40, y: 240 }), 'mirrorY');
  // Still on the pin there is no direction yet, and nothing flickers: whatever
  // was chosen last is kept.
  assert.equal(symmetryOperation(pin, { x: 0, y: 0 }), null);
  assert.equal(symmetryOperation(pin, { x: 0, y: 0 }, 'mirrorY'), 'mirrorY');
  // Copy ghosts may arm from an offset click, so the direction reference can
  // be anywhere in the drawing without making the selection arrangement pick
  // the axis.
  assert.equal(symmetryOperation({ x: 400, y: 400 }, { x: 560, y: 440 }), 'mirrorX');
  assert.equal(symmetryOperation({ x: 400, y: 400 }, { x: 440, y: 640 }), 'mirrorY');
});

test('opening another design ends the tutorial, but a sync reload of its own does not', () => {
  const main = editorSource();
  const body = (name) => main.slice(main.indexOf(`function ${name}(`), main.indexOf('\n}\n', main.indexOf(`function ${name}(`)));
  assert.match(body('loadCircuit'), /if \(data\.path !== currentDocumentPath\) dropTutorial\(\);\s*\/\/[^\n]*\n[^\n]*\n\s*history = \[\];/);
  assert.match(body('openUnsavedDocument'), /dropTutorial\(\);/);
  assert.match(body('startNewDocument'), /dropTutorial\(\);/);
  assert.match(body('deleteSavedCircuit'), /dropTutorial\(\);/);
  // The tutorial starts in a fresh document, so it is dropped before it begins.
  assert.match(body('offerTutorial'), /startNewDocument\(\);\s*startTutorial\(\);/);
});

test('a compatibility mousemove after the same mouse pointermove is skipped', () => {
  const skip = compatibilityMoveFilter();
  const pointer = { type: 'pointermove', pointerType: 'mouse', clientX: 10, clientY: 20, buttons: 1 };
  const mouse = { type: 'mousemove', clientX: 10, clientY: 20, buttons: 1 };
  assert.equal(skip(pointer), false);
  assert.equal(skip(mouse), true);
  // Automation that sends only mouse events is handled every time.
  assert.equal(skip(mouse), false);
  assert.equal(skip(mouse), false);
  // A different position or button state is new motion, not the echo.
  skip(pointer);
  assert.equal(skip({ ...mouse, clientX: 11 }), false);
  skip(pointer);
  assert.equal(skip({ ...mouse, buttons: 0 }), false);
  // Touch and pen have no compatibility echo to drop.
  skip({ ...pointer, pointerType: 'touch' });
  assert.equal(skip(mouse), false);
});

test('linked-design bubbles live in a kept layer and dive keys go through hierarchy.js', () => {
  const main = editorSource();
  // The layer is re-mounted into each rebuilt drawing, under the overlay,
  // and synchronized on every render.
  assert.match(main, /mountLinkBubbles\(canvasSvgEl, overlayEl\);/);
  assert.match(main, /overlayEl\.innerHTML = themeInkSvg\(withGestureOverlay\(overlay, ghost\)\);\s*syncLinkBubbles\(\);/);
  assert.match(main, /if \(ev\.key === 'ArrowDown'\) void enterLinkedDesign\(\);\s*else void leaveLinkedDesign\(\);/);
  assert.match(main, /if \(key === 'o'\) \{\s*toggleLinkBubbles\(\);/);
  assert.match(main, /if \(key === 'O'\) \{\s*toggleAllLinkBubbles\(\);/);
  assert.match(main, /bubbleDoubleClickAt = performance\.now\(\);\s*void enterLinkedDesign\(circuit\.components\.get\(bubble\.refdes\)\);/);
  // Its native dblclick must not reach the paper of the design entered.
  assert.match(main, /if \(performance\.now\(\) - bubbleDoubleClickAt < 1000\) return;/);
});

test('the Atlas finishes its flight out: no key, scroll, or click on the way cuts it short', () => {
  const atlas = readFileSync(new URL('../src/web/atlas.js', import.meta.url), 'utf8');
  // A cut-short flight used to leave closeAtlas waiting forever, the desk
  // parted (Shift+Backspace, then Shift+T at once): a stopped animation
  // now lets its waiter go on, and the desk takes no input while leaving.
  assert.match(functionSource('stopAnimation', atlas), /state\.animation\.resolve\?\.\(\);/);
  assert.match(functionSource('animateView', atlas), /animation\.resolve = resolve;/);
  assert.match(functionSource('closeAtlas', atlas), /if \(!state \|\| state\.closing\) return;\s*state\.closing = true;/);
  // The way in too: from the moment it is asked for until it has landed.
  assert.match(atlas, /const inTransition = \(\) => !!\(state\?\.entering \|\| state\?\.closing \|\| state\?\.opening\);/);
  assert.match(functionSource('openAtlas', atlas), /state\.entering = true;[\s\S]*finally \{\s*if \(state\?\.generation === generation\) state\.entering = false;/);
  for (const handler of ['onAtlasKey', 'onWheel', 'onPointerDown', 'onDoubleClick']) {
    assert.match(functionSource(handler, atlas), /inTransition\(\)/, `${handler} ignores input in a transition`);
  }
});

test('coming back up from a linked design leaves its peek bubble as it was', () => {
  const hierarchy = readFileSync(new URL('../src/web/hierarchy.js', import.meta.url), 'utf8');
  // Entering remembers whether the bubble was open...
  assert.match(hierarchy, /peeking: bubbles\.has\(component\.refdes\)/);
  // ...and leaving shrinks the child into a bubble, then closes one that was closed.
  assert.match(hierarchy, /if \(target\.peeking\) rememberOpen\(\);/);
  assert.match(hierarchy, /if \(!target\.peeking\) \{[\s\S]*?closeLinkBubble\(target\.refdes, \{ refit: false \}\)/);
  assert.match(hierarchy, /if \(!target\.peeking\) bubbles\.delete\(target\.refdes\);/);
});

test('? opens Learn over the Atlas as over the drawing', () => {
  const atlas = readFileSync(new URL('../src/web/atlas.js', import.meta.url), 'utf8');
  const keys = atlas.slice(atlas.indexOf('export function onAtlasKey'), atlas.indexOf('export function onAtlasKey') + 4000);
  assert.match(keys, /else if \(key === '\?'\) showHelp\(\);/);
  assert.match(atlas, /import \{ showHelp \} from '\.\/help\.js';/);
});

test('windows reset only when another document is loaded, not for a drag\'s working copy', () => {
  const main = editorSource();
  assert.match(main, /if \(replacesDocument\) documentGeneration \+= 1;/);
  assert.match(main, /if \(documentGeneration === shownGeneration\) return;/);
  // The drag's copy of the circuit shares the windows' state.
  assert.match(main, /circuit = loadDocument\(JSON\.parse\(startSnapshot\)\);\s*\/\/[^\n]*\n\s*circuit\.windows = previewTransaction\.baseCircuit\.windows;/);
  // The signal-flow window has no path-based reset of its own any more.
  const flow = readFileSync(new URL('../src/web/signal-flow-ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(flow, /function syncDocument\(/);
});
