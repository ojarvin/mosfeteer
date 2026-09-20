import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { alignedAnchorShift, constrainAxis, isKeyboardSurfaceTarget, isPrimaryPointerEvent, isSelectionModifier, moveAnnotationEndpoint, shouldForwardCanvasMove, shouldPanTouch, symmetryOperation, viewFollowingCursor, worldAndCursorFromClient } from '../src/web/interaction.js';

const rect = { left: 10, top: 20, width: 100, height: 100 };
const view = { x: -80, y: -80, w: 400, h: 400 };

test('tool cursors badge the select arrow per tool, theme, and danger', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  const start = main.indexOf('function toolCursorValue(');
  const end = main.indexOf('\nfunction cursorIconFor(', start);
  const build = vm.runInNewContext(`(${main.slice(start, end)})`, {
    ICON_PATHS: { trash: '<path d="M4 6h16"/>' },
    toolCursorCache: new Map(),
    CURSOR_ARROW: 'M1 1 1 9 5 5Z',
    preloadToolCursorImage: () => {},
  });
  const decode = (value) => decodeURIComponent(value.match(/url\("data:image\/svg\+xml,([^"]+)"\)/)[1]);
  const plain = build(null, {});
  assert.match(plain, /\) 2 1, default$/); // the hotspot stays on the arrow tip
  assert.ok(!decode(plain).includes('M4 6h16'));
  const badged = decode(build('trash', {}));
  // The glyph is drawn twice: a halo pass under the ink pass keeps it legible.
  assert.equal(badged.split('M4 6h16').length - 1, 2);
  assert.ok(!badged.includes('#c33b2e'));
  assert.ok(decode(build('trash', { danger: true })).includes('#c33b2e'));
  assert.notEqual(build('trash', {}), build('trash', { dark: true }));
  assert.equal(build('trash', {}), build('trash', {})); // cached per icon/theme
});

test('named net edits confirm virtual connections, and port names never repeat', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  assert.match(main, /function namedConnectionConflicts\(/);
  assert.match(main, /function confirmNamedConnection\(/);
  assert.match(main, /cancelLabel: 'Keep separate'/);
  assert.match(main, /namedConnectionConflicts\(v, \{ netId: net\.id \}\)/);
  assert.match(main, /input\.focus\(\);\s*input\.select\(\);\s*return false;/);
  // A port's label is its identity: a name another port carries is reported
  // as a collision instead of being offered as a virtual connection.
  assert.match(main, /function portNameConflict\(/);
  assert.match(main, /function reportPortNameConflict\(/);
  assert.doesNotMatch(main, /applySharedInterfaceName|sharedInterfaceNameTarget|setInterfacePinName/);
});

test('insert categories keep switches and macros separate and include vccs with sources', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  assert.match(main, /\['Switches', \/\^switch_\//);
  assert.match(main, /\['Sources & power', \/\^\(current_source\|voltage_source\|vccs\|supply\|ground\|vcm\)\$\//);
  assert.match(main, /\['Macros', \/\^\(opamp\|opamp_diff\|adc\|dac\)\$\//);
  assert.match(main, /\['Logic', \/\^\(inverter\|buffer\|tristate_\(inverter\|buffer\)\|mux2\|\.\*_gate\)\$\//);
  assert.match(main, /\['Sequential', \/\^\(\?:dff\|latch\)\(\?:_\|\$\)\//);
});

test('the small-signal figure owns Escape and hands the keyboard back', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  const start = main.indexOf("modelDialog?.addEventListener('keydown'");
  assert.ok(start > 0, 'the model dialog handles Escape itself');
  const handlers = main.slice(start, start + 900);
  // Stopped here, so the analysis dock's own Escape never fires behind it.
  assert.match(handlers, /ev\.stopPropagation\(\);\s*modelDialog\.close\(\);/);
  // Clicking beside the figure dismisses it, and closing returns focus to the
  // drawing it was covering.
  assert.match(handlers, /ev\.target === modelDialog/);
  assert.match(handlers, /addEventListener\('close'[\s\S]*canvasEl\.focus\(\)/);
});

test('the full-size figure is a view over one drawing, driven like the canvas', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  const start = main.indexOf('function bindModelFigureView(');
  assert.ok(start > 0);
  const view = main.slice(start, main.indexOf('bindModelFigureView(modelDialogFigure)', start));
  // Wheel zooms about the pointer, the middle button pans, the right button
  // drags a box (and zooms out on a click), and a double-click refits.
  assert.match(view, /'wheel'[\s\S]*Math\.pow\(1\.0016, ev\.deltaY\)/);
  assert.match(view, /ev\.button === 1 \? 'pan' : 'zoom'/);
  assert.match(view, /if \(!drag\.moved\) \{\s*zoomModelFigure\(2, world\);/);
  assert.match(view, /'dblclick'[\s\S]*fitModelFigure\(\)/);
  // Nothing re-renders and nothing is mutated: it is the SVG's own viewBox.
  assert.match(main, /function applyModelFigureView\(\)[\s\S]*setAttribute\('viewBox'/);
});

test('the insert menu is one scrolling column led by the recent placements', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  // Committed placements are what feed the Recent group, so an armed ghost the
  // user escapes never claims a slot.
  assert.match(main, /rememberInsertType\(pendingPlace\.type\)/);
  assert.match(main, /rememberInsertType\('label'\)/);
  assert.match(main, /rememberInsertType\('block'\)/);
  // Session state only: nothing reads or writes it through the document or
  // localStorage, so a reopened file never inherits someone else's shortcuts.
  assert.doesNotMatch(main, /insertRecentTypes[\s\S]{0,200}localStorage/);
  // The group leads the menu, and only while the list is being browsed: a
  // query is answered by the fuzzy ranking alone.
  assert.match(main, /\{ title: 'Recent', entries: recent \}, \.\.\.groups/);
  const recentGroup = main.indexOf("title: 'Recent'");
  assert.ok(recentGroup > 0 && main.lastIndexOf('if (!insertQuery) {', recentGroup) > 0);
  // Most of the column is out of sight, so the highlight scrolls into view.
  assert.match(main, /items\[highlight\]\?\.scrollIntoView\(\{ block: 'nearest' \}\)/);

  const css = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
  const body = css.slice(css.indexOf('.insert-menu-body {'));
  assert.match(body.slice(0, body.indexOf('}')), /overflow-y: auto/);
  assert.match(body.slice(0, body.indexOf('}')), /overflow-x: hidden/);
  // Columns would spread the list sideways over the drawing again.
  assert.doesNotMatch(body.slice(0, body.indexOf('}')), /column-width/);
});

test('every tool cursor is fetched up front so a keyboard tool change paints one', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  const start = main.indexOf('function preloadToolCursors(');
  const end = main.indexOf('\nfunction installButtonIcons(', start);
  const built = [];
  const preload = vm.runInNewContext(`(${main.slice(start, end)})`, {
    TOOL_CURSOR_ICONS: { normal: null, wire: 'wire', delete: 'trash' },
    toolCursorValue: (icon, opts) => built.push(`${icon}|${opts.dark}|${!!opts.danger}`),
  });
  preload();
  // Both themes, both wire shapes, the bare arrow, and Delete's danger badge.
  for (const key of ['null|false|false', 'null|true|false', 'wire|false|false', 'wire-diagonal|false|false',
    'wire-diagonal|true|false', 'trash|true|false', 'trash|false|true', 'trash|true|true']) {
    assert.ok(built.includes(key), `missing preloaded cursor ${key}`);
  }
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

test('MathML annotation measurements are independent of zoom on reload', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  const start = main.indexOf('function renderedLabelTextBounds(');
  const end = main.indexOf('\n// Equation annotations are initially positioned', start);
  for (const scale of [0.08, 0.5, 1, 2]) {
    const rect = { left: 100 * scale, top: 200 * scale, right: 400 * scale, bottom: 291 * scale, width: 300 * scale, height: 91 * scale };
    const content = { getBoundingClientRect: () => rect };
    const math = { querySelectorAll: () => [content], getBoundingClientRect: () => ({ width: 400 * scale }) };
    const measure = vm.runInNewContext(`(${main.slice(start, end)})`, {
      canvasSvgEl: { getScreenCTM: () => ({ a: scale, b: 0, c: 0, d: scale }) },
      document: { createRange: () => ({ selectNodeContents() {}, getBoundingClientRect: () => rect }) },
      getComputedStyle: () => ({ paddingLeft: '6px', paddingTop: '6px', paddingRight: '6px', paddingBottom: '6px' }),
      clientRectToSvgBounds: (_, bounds) => ({ x: bounds.left / scale, y: bounds.top / scale, w: bounds.width / scale, h: bounds.height / scale }),
    });
    const result = measure({ querySelector: (selector) => selector === 'text' ? null : math });
    assert.ok(Math.abs(result.w - 312) < 1e-9);
    assert.ok(Math.abs(result.h - 103) < 1e-9);
    assert.ok(Math.abs(result.y + result.h / 2 - 245.5) < 1e-9);
  }
});

test('generated category labels keep their persisted grid metrics', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  const start = main.indexOf('function syncRenderedLabelMetrics()');
  const end = main.indexOf('\nfunction scheduleMeasuredLabelRender()', start);
  assert.match(main.slice(start, end), /if \(label\.id\.startsWith\('category_'\)\) continue;/);
});

test('multiline assumptions measure their text independently of the restored container width', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  const start = main.indexOf('function renderedLabelTextBounds(');
  const end = main.indexOf('\n// Equation annotations are initially positioned', start);
  for (const containerWidth of [240, 320, 400]) {
    for (const scale of [0.08, 0.590074019, 1, 2]) {
      const rect = (width, top) => ({ left: 100 * scale, right: (100 + width) * scale, top: top * scale, bottom: (top + 36) * scale, width: width * scale, height: 36 * scale });
      const nodes = [rect(209, 200), rect(155, 248), rect(124, 296)].map((bounds) => ({ getBoundingClientRect: () => bounds }));
      const math = { querySelectorAll: () => nodes, getBoundingClientRect: () => rect(containerWidth, 200) };
      const measure = vm.runInNewContext(`(${main.slice(start, end)})`, {
        canvasSvgEl: { getScreenCTM: () => ({ a: scale, b: 0, c: 0, d: scale }) },
        document: { createRange: () => { throw new Error('must measure intrinsic lines, not the full-width wrapper'); } },
        getComputedStyle: () => ({ paddingLeft: '6px', paddingTop: '6px', paddingRight: '6px', paddingBottom: '6px' }),
        clientRectToSvgBounds: (_, bounds) => ({ x: bounds.left / scale, y: bounds.top / scale, w: bounds.width / scale, h: bounds.height / scale }),
      });
      const measured = measure({ querySelector: (selector) => selector === 'text' ? null : math });
      assert.ok(Math.abs(measured.w - 221) < 1e-9);
      assert.ok(Math.abs(measured.h - 144) < 1e-9);
      assert.ok(Math.abs(measured.x - 94) < 1e-9);
    }
  }
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
  const insertMenuTarget = { closest: (selector) => selector === '#insert-menu' ? {} : null };
  const otherOverlayTarget = { closest: () => null };
  assert.equal(shouldForwardCanvasMove(canvasTarget, canvas), false, 'canvas events are already handled directly');
  assert.equal(shouldForwardCanvasMove(insertMenuTarget, canvas), false, 'insert-menu events stay in the menu');
  assert.equal(shouldForwardCanvasMove(otherOverlayTarget, canvas), true, 'other pane overlays still forward moves');
});

test('global shortcuts yield to interactive controls', () => {
  assert.equal(isKeyboardSurfaceTarget({ tagName: 'BUTTON' }), true);
  assert.equal(isKeyboardSurfaceTarget({ tagName: 'div', closest: (selector) => selector.includes('option') }), true);
  assert.equal(isKeyboardSurfaceTarget({ tagName: 'div' }), false);
});

test('annotation endpoints move, resize, and reject invalid shapes', () => {
  const arrow = { kind: 'arrow', anchor: { x: 0, y: 0 }, end: { x: 160, y: 0 } };
  assert.equal(moveAnnotationEndpoint(arrow, 'end', { x: 240, y: 80 }), true);
  assert.deepEqual(arrow.end, { x: 240, y: 80 });
  const before = { ...arrow.end };
  assert.equal(moveAnnotationEndpoint(arrow, 'end', { x: 40, y: 0 }), false);
  assert.deepEqual(arrow.end, before);

  const box = { kind: 'box', anchor: { x: 0, y: 0 }, end: { x: 160, y: 80 } };
  assert.equal(moveAnnotationEndpoint(box, 'corner:bottom-right', { x: 240, y: 120 }), true);
  assert.deepEqual(box, { kind: 'box', anchor: { x: 240, y: 120 }, end: { x: 0, y: 0 } });

  const line = { kind: 'line', anchor: { x: 0, y: 0 }, end: { x: 160, y: 0 }, points: [{ x: 0, y: 0 }, { x: 160, y: 0 }] };
  line.moveVertex = (index, x, y) => { line.points[index] = { x, y }; };
  assert.equal(moveAnnotationEndpoint(line, 'vertex:1', { x: 160, y: 80 }), true);
  assert.deepEqual(line.points[1], { x: 160, y: 80 });
});


test('editor shell exposes keyboard canvas and live status surfaces', () => {
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="canvas"[^>]+tabindex="0"[^>]+role="application"/);
  assert.match(html, /id="status"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(html, /id="accessibility-announcement"[^>]+aria-live="polite"/);
  assert.doesNotMatch(html, /id="btn-label-bboxes"/);
});

test('new document control exposes one popup with schematic and block choices', () => {
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="btn-new-document"[^>]+aria-haspopup="menu"/);
  assert.match(html, /id="new-document-menu"[^>]+role="menu"/);
  assert.match(html, /data-new-document="circuit"/);
  assert.match(html, /data-new-document="block"/);
  assert.doesNotMatch(html, /id="btn-new-circuit"|id="btn-new-block"/);
});

test('an explicit new document is protected from active-document auto-loads', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  const start = main.indexOf('function startNewDocument(');
  const end = main.indexOf('\n/**', start);
  const startNew = main.slice(start, end);
  assert.match(startNew, /syncGeneration \+= 1;/);
  assert.match(startNew, /activeSyncSuspended = true;/);

  const syncStart = main.indexOf('async function syncActiveCircuitOnce(');
  const syncEnd = main.indexOf('\nasync function syncActiveCircuit()', syncStart);
  const sync = main.slice(syncStart, syncEnd);
  assert.match(sync, /if \(activeSyncSuspended\)[\s\S]*lastSeenActive = active[\s\S]*return;/);
  assert.match(main.slice(0, main.indexOf('function copySelectionSource(')), /activeSyncSuspended = false;/);
});

test('small-signal analysis exposes the canonical v2 controls', () => {
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="btn-analysis"/);
  assert.match(html, /class="toolbar-cluster analysis-cluster"[^>]+data-doc-kind="schematic"/);
  assert.match(html, /id="btn-analysis"[\s\S]*id="btn-theme"/);
  assert.match(html, /id="analysis-dialog"/);
  assert.match(html, /id="analysis-input-field"[^>]*>Input node/);
  assert.match(html, /for="analysis-target">Output node/);
  assert.match(html, /for="analysis-reference">Reference \(optional\)/);
  assert.match(html, /id="analysis-submit"[^>]*>Derive all equations/);
  assert.match(html, /id="analysis-ac-grounds"/);
  assert.match(html, /id="analysis-device-regions"/);
  assert.match(html, /REF=triode/);
  assert.match(html, /id="analysis-annotate"/);
  assert.match(html, /id="analysis-equation"/);
  assert.match(html, /id="analysis-details"/);
  assert.match(html, /id="analysis-netlist"/);
  assert.match(html, /id="analysis-panel-netlist"[^>]+role="tabpanel"/);
  assert.doesNotMatch(html, /id="analysis-netlist-panel"/);
  assert.match(html, /id="analysis-tab-equations"[^>]+role="tab"/);
  assert.match(html, /id="analysis-tab-log"[^>]+role="tab"/);
  assert.match(html, /id="analysis-tab-netlist"[^>]+role="tab"/);
  assert.match(html, /id="analysis-panel-equations"[^>]+role="tabpanel"/);
  assert.match(html, /id="analysis-panel-log"[^>]+role="tabpanel"/);
  assert.match(html, /id="analysis-panel-netlist"[^>]+role="tabpanel"/);
  assert.match(html, /id="analysis-approx-ro"[^>]+type="checkbox"/);
  assert.match(html, /id="analysis-approx-body"[^>]+type="checkbox"[^>]+checked/);
  assert.match(html, /id="analysis-approx-gmro"[^>]+type="checkbox"[^>]+checked/);
  assert.match(html, /id="analysis-approx-dominant-pole"[^>]+type="checkbox"/);
  // The card separates what changes the model from what changes the equation.
  // Miller decoupling belongs to the first group: it is the engine's own
  // pre-solve transform, not the removed v1 "miller" presentation control.
  assert.match(html, /id="analysis-approx-miller"[^>]+type="checkbox"[^>]+checked/);
  assert.match(html, /<legend>Model simplifications<\/legend>[\s\S]*id="analysis-approx-miller"/);
  assert.match(html, /<legend>Equation approximations<\/legend>[\s\S]*id="analysis-approx-dominant-pole"/);
  assert.doesNotMatch(html, /id="analysis-(?:kind|context|mode|complementary|models)"/);
  assert.doesNotMatch(html, /id="analysis-approx-(?:dc|cascode)"/);
  assert.doesNotMatch(html, /current-source|cascode|Analyze DC topology only/i);
  assert.match(html, /<div class="analysis-scroll">[\s\S]*id="analysis-result"[\s\S]*<\/div>\s*<div class="dialog-actions">/);
  const style = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
  assert.match(html, /<section id="analysis-dialog" class="analysis-dock"[^>]*hidden/);
  assert.doesNotMatch(html, /<dialog id="analysis-dialog"/);
  assert.match(html, /data-analysis-pick="analysis-input"/);
  assert.match(html, /data-analysis-pick="analysis-target"/);
  assert.match(style, /\.analysis-dock\s*\{[\s\S]*width: var\(--analysis-dock-width\)/);
  assert.match(style, /\.analysis-dock\s*\{[\s\S]*overflow: hidden/);
  assert.match(style, /\.analysis-scroll\s*\{[\s\S]*overflow: auto/);
  assert.match(style, /\.analysis-dock \.dialog-actions\s*\{[\s\S]*flex: 0 0 auto/);
  assert.match(style, /\.analysis-tabs\s*\{[\s\S]*border-bottom/);
  assert.match(style, /\.analysis-tab-panels\s*\{[\s\S]*overflow: hidden/);
});

test('analysis form state is scoped and role metadata is restored from the active schematic', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  assert.match(main, /analysisFormStorageKey\(analysisFormScope\(\)\)/);
  assert.match(main, /Select an input node before deriving equations/);
  assert.match(main, /analysis failed: \$\{message\}/);
  assert.match(main, /migrateAnalysisFormState\(saved\)/);
  assert.match(main, /pruneAnalysisNetValues\(state\.acGrounds, visibleNets\(\)\)/);
  assert.match(main, /pruneAnalysisDeviceRegions/);
  assert.match(main, /defaults\.targetMarked \? defaults\.target : state\.output/);
  assert.match(main, /defaults\.inputMarked \? defaults\.input : state\.input/);
  assert.match(main, /neglectChannelLengthModulation: !!analysisApproxRo\?\.checked/);
  assert.match(main, /neglectBodyEffect: !!analysisApproxBody\?\.checked/);
  assert.match(main, /highIntrinsicGain: !!analysisApproxGmRo\?\.checked/);
  assert.match(main, /dominantPole: !!analysisApproxDominantPole\?\.checked/);
  assert.match(main, /deviceRegions: analysisDeviceRegions\?\.value/);
  assert.match(main, /options\.neglectBodyEffect = source\.ignoreBodyEffect/);
  assert.match(main, /options\.highIntrinsicGain = source\.gmroLarge/);
  assert.match(main, /options\.neglectChannelLengthModulation = true/);
  assert.match(main, /\.\.\.\(Object\.keys\(devices\)\.length \? \{ devices \} : \{\}\)/);
  assert.match(main, /resistance: 'infinite'/);
  assert.equal((main.match(/analyzeSmallSignalV2\(/g) || []).length, 1);
  assert.match(main, /adaptCombinedReport\(analyzeSmallSignalV2\(circuit, request\)\)/);
  assert.doesNotMatch(main, /analyzeInputImpedance|analyzeOutputImpedance|analyzeTransferFunction/);
  assert.doesNotMatch(main, /core\/analysis\/index\.js/);
  // Whole identifiers: `analysisModelEl` (the drawn small-signal model) is
  // not the removed `analysisMode` control.
  assert.doesNotMatch(main, /\b(?:analysisKind|analysisMode|analysisComplementary|analysisContext|analysisModels|analysisApproxCascode|dcOnly)\b/);
  assert.match(main, /Array\.isArray\(report\?\.equationEntries\)/);
  assert.match(main, /for \(const \{ title, result: child \} of entries\)/);
  // A tab whose content this report has no data for falls back to Equations.
  assert.match(main, /selectedTab === 'netlist' && !netlist/);
  assert.match(main, /selectedTab === 'model' && !drawn/);
  assert.match(main, /const topGap = 2 \* GRID/);
  assert.match(main, /const bottomEdge = circuitBounds\.h > 0 \? circuitBounds\.y \+ circuitBounds\.h/);
  assert.match(main, /const leftEdge = circuitBounds\.w > 0 \? circuitBounds\.x/);
  assert.match(main, /function analysisEquationEntries\(report\)/);
  assert.match(main, /layout\.bottomEdge \+ layout\.topGap/);
  assert.match(main, /align: 'left'/);
  assert.match(main, /analysisAnnotationAssumptions/);
  assert.match(main, /text: \['\\\\text\{Assumptions\\\\:\}', \.\.\.assumptions\]/);
  assert.match(main, /syncRenderedLabelMetrics/);
  assert.match(main, /function reflowEquationAnnotations/);
  assert.match(main, /const pitch = heights\.length < 2/);
  assert.match(main, /options\.neglectBodyEffect/);
  assert.match(main, /options\.highIntrinsicGain/);
  assert.match(main, /options\.neglectChannelLengthModulation/);
  assert.match(main, /options\.dominantPoleApplied/);
});

test('arrow-key nudging moves mixed selections atomically', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  assert.match(main, /transformMixedSelection\('translate', \{ translation: \{ dx, dy \} \}\)/);
  assert.match(main, /function nudgeBlockSelection\(dx, dy\)/);
  assert.match(main, /cannot nudge attached connector/);
  assert.match(main, /circuit\.validate\(\);\s*recordBlockHistory\(before\);/);
});

test('startup paints before listing documents and restoring the requested document', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  assert.match(main, /const listPromise = refreshCircuitList\(\);/);
  assert.match(main, /if \(openPath && openPath !== currentDocumentPath\) requestCircuitLoad\(openPath\);/);
  assert.match(main, /fitView\(\);\s*restoreStartup\(\)/);
  assert.doesNotMatch(main, /fitView\(\);\s*render\(\);\s*restoreStartup/);
});

test('fit reserves the axis the mode rail is thin along', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  const fit = main.slice(main.indexOf('function fitView('), main.indexOf('function cycleSelection('));
  // On a narrow window the rail is a horizontal strip across the top. Reserving
  // its width there leaves a 1 px usable pane, so the fit clamps to the widest
  // allowed view and the drawing disappears -- F looks like it stopped working.
  assert.match(fit, /railIsColumn = railRect \? railRect\.width <= railRect\.height : false/);
  assert.match(fit, /leftPx = railRect && railIsColumn/);
  assert.match(fit, /topPx = railRect && !railIsColumn/);
  // Whichever axis is reserved, the drawing centres in what is left of it.
  assert.match(fit, /fitH = Math\.max\(1, usableH - marginPx \* 2\)/);
  assert.match(fit, /view\.y = \(y0 \+ y1\) \/ 2 - th \* usableCenterPy \/ paneH/);
});

test('empty canvas fit starts at a 30-cell planning view', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  const fit = main.slice(main.indexOf('function fitView('), main.indexOf('function cycleSelection('));
  assert.match(fit, /x0 = -600;\s*y0 = -600;\s*x1 = 600;\s*y1 = 600;/);
});

test('F5 reloads the application instead of entering the normal keymap', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  assert.match(main, /if \(ev\.key === 'F5'\)/);
  assert.match(main, /ev\.preventDefault\(\);\s*flushDraft\(\);\s*window\.location\.reload\(\);/);
});

test('analysis annotations use structured canonical assumptions', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  const start = main.indexOf('function analysisAnnotationAssumptions');
  const end = main.indexOf('\n\nfunction openAnalysisDialog', start);
  assert.ok(start >= 0 && end > start);
  const summarize = vm.runInNewContext(`(${main.slice(start, end)})`);
  assert.deepEqual(Array.from(summarize({
    analysisOptions: {
      highIntrinsicGain: true,
      neglectChannelLengthModulation: true,
      neglectBodyEffect: true,
      dominantPoleApplied: true,
    },
  })), [
    'g_{m}r_{o} \\gg 1',
    'r_{o} = \\infty',
    'g_{mb} = 0',
    '\\text{Dominant-pole approximation}',
  ]);
  assert.deepEqual(Array.from(summarize({ analysisOptions: {} })), []);
  assert.deepEqual(Array.from(summarize({ analysisOptions: {}, assumptions: ['Miller approximation (M1)'] })), ['\\text{Miller approximation (M1)}']);
});

test('committed inserts repair coincident connectivity and analysis menus support multi-selection', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  // One placement or a mirrored pair, each half repaired the same way.
  assert.match(main, /placements\.map\(\(t\) => circuit\.addComponent\(pendingPlace\.type/);
  assert.match(main, /for \(const comp of placed\) circuit\.connectCoincident\(comp\.refdes\);/);
  assert.match(main, /circuit\.reconnectCoincidentNets\(\);/);
  assert.match(main, /circuit\.ensureUniqueTerminals\(placed\.map\(\(comp\) => comp\.refdes\)\);/);
  assert.match(main, /function analysisComponentTargets\(target/);
  assert.match(main, /function analysisNetTargets\(target/);
  assert.match(main, /for \(const component of components\) circuit\.setComponentAnalysis/);
  assert.match(main, /for \(const net of nets\) circuit\.setNetAnalysis/);
  assert.match(main, /channelLengthModulation: 'ignore'/);
  assert.match(main, /channelLengthModulation: 'finite'/);
  assert.match(main, /Clear r_o override/);
  assert.match(main, /gmroLarge: true/);
  assert.match(main, /ignoreBodyEffect: true/);
  assert.match(main, /resistance: 'infinite'/);
  assert.match(main, /Treat as R = ∞/);
  assert.match(main, /Clear resistance override/);
  assert.match(main, /Clear g_m r_o override/);
  assert.match(main, /Clear body-effect override/);
  assert.match(main, /function appendContextSmallSignalMenu\(menu, target\)/);
  assert.match(main, /appendContextSubmenu\(menu, 'Select'/);
  assert.match(main, /function analysisChoiceState\(targets, read, expected\)/);
  assert.match(main, /context-item-active/);
  assert.match(main, /trigger\.focus\(\{ preventScroll: true \}\)/);
  assert.match(main, /trigger\.classList\.add\('context-item-open'\)/);
  assert.match(main, /aria-checked/);
  assert.match(main, /function openComponentChildLabelEditor\(component\)/);
  assert.match(main, /ownedLabelDraft: true/);
  assert.match(main, /if \(component\) openComponentChildLabelEditor\(component\)/);
  assert.match(main, /const doubleClick = ev\.detail >= 2/);
  assert.match(main, /setTimeout\(\(\) => openComponentChildLabelEditor\(componentHit\), 0\)/);
  assert.match(main, /openComponentContextMenu\(\{ kind: 'component', value: comp \}/);
  assert.match(main, /openComponentContextMenu\(\{ kind: 'net', value: net \}/);
  assert.doesNotMatch(main, /Current source \(ideal small-signal open\)/);
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /M1=current-source/);
});

test('schematic and block pointer paths share snapped cursor conversion', () => {
  for (const documentKind of ['circuit', 'block']) {
    assert.deepEqual(worldAndCursorFromClient(50, 70, rect, view), {
      world: { x: 80, y: 120 }, cursor: { x: 80, y: 120 },
    }, documentKind);
  }
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
});

test('a held modifier arms symmetric placement without swallowing the ghost keys', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  // Ctrl (or Cmd, which is the one that survives a click on macOS) held on its
  // own arms it; releasing it or losing the window drops the mirrored ghost.
  assert.match(main, /if \(k === 'control' \|\| k === 'meta'\) \{\s*setSymmetry\(true\);/);
  assert.match(main, /keyup[\s\S]{0,120}ev\.key === 'Control' \|\| ev\.key === 'Meta'[\s\S]{0,40}setSymmetry\(false\)/);
  assert.match(main, /'blur', \(\) => setSymmetry\(false\)/);
  // The modifier branch otherwise swallows every key it does not bind, which
  // would leave the ghost undrivable, untransformable and uncommittable while
  // Ctrl is down -- r and Shift+r included, which read as Ctrl+r there.
  assert.match(main, /drivingSymmetry = symmetry\s*\n?\s*&& \(ev\.key === 'Enter' \|\| ev\.key === 'Escape' \|\| ev\.key\.startsWith\('Arrow'\) \|\| ev\.key\.toLowerCase\(\) === 'r'\)/);
  assert.match(main, /if \(\(ev\.metaKey \|\| ev\.ctrlKey\) && !drivingSymmetry\)/);
  // A settled axis outlives the modifier, so stepping off it for one transform
  // does not cost the axis; dropping the ghost forgets it.
  assert.match(main, /symmetry = symmetryMemory\s*\n?\s*\? \{ pin: \{ \.\.\.symmetryMemory\.pin \}, operation: symmetryMemory\.operation, settled: true \}/);
  assert.match(main, /symmetryMemory = \{ pin: \{ \.\.\.symmetry\.pin \}, operation: symmetry\.operation \};/);
  assert.match(main, /function clearSymmetry\(\) \{\s*dropCopyGhostMirror\(\);\s*symmetry = null;\s*symmetryMemory = null;/);
  // It belongs to a component ghost or a managed wire draft, and a dropped
  // ghost drops it too.
  assert.match(main, /const armed = \(mode === 'insert' && pendingPlace\?\.kind === 'component'\)\s*\n?\s*\|\| \(!!wire\?\.source && !wire\.source\.fixed\)\s*\n?\s*\|\| drag\?\.mode === 'copyghost';/);
  const drops = main.match(/pendingPlace = null;\n\s*clearSymmetry\(\);/g) || [];
  assert.ok(drops.length >= 8, `every ghost drop clears the axis (${drops.length})`);
  // Both halves land in one commit, so the pair is one undo.
  assert.match(main, /const placements = \[pendingTransform\(\), \.\.\.\(twin \? \[twin\] : \[\]\)\]/);
  // Placing a pair settles the axis, so stacking the next pair above the first
  // -- movement along the axis -- does not turn the mirror ninety degrees.
  assert.match(main, /if \(placed\.length > 1\) \{\s*symmetry\.settled = true;/);
  assert.match(main, /if \(!symmetry \|\| symmetry\.settled\) return;/);
});
test('the placement guides are a view toggle beside the grid', () => {
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="btn-guides"[^>]*aria-pressed="true"/);
  assert.ok(html.indexOf('id="btn-guides"') > html.indexOf('id="btn-grid"'));
  assert.ok(html.indexOf('id="btn-guides"') < html.indexOf('id="btn-theme"'));

  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  assert.match(main, /key === 'G' \|\| \(key === 'g' && shiftKey\)\) setGuides\(!guidesVisible\)/);
  assert.match(main, /guides: guidesVisible \? placementGuides\(/);
  // Off by keyboard or button, but never reaching the deliberately armed axis.
  assert.doesNotMatch(main, /guidesVisible[\s\S]{0,80}symmetryAxis/);

  const keymap = readFileSync(new URL('../src/web/toolbar.js', import.meta.url), 'utf8');
  assert.match(keymap, /\['G', 'toggle the spacing and alignment guides'\]/);
});

test('view toggles answer in every mode but the insert search', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  const start = main.indexOf('function viewKey(');
  const view = main.slice(start, main.indexOf('\nfunction onVisualKey(', start));
  // Typing a component name is the one place a printable key is not a command.
  assert.match(view, /if \(mode === 'insert' && !pendingPlace\) return false;/);
  for (const binding of [/setGrid\(!showGrid\)/, /setCrosshair\(!crosshairVisible\)/,
    /setGuides\(!guidesVisible\)/, /toggleTheme\(\)/, /fitView\(\)/, /showHelp\(\)/]) {
    assert.match(view, binding);
  }
  // Lower-case d and c belong to dd and copy mode, so only the shifted forms.
  assert.doesNotMatch(view, /key === 'd'/);
  assert.doesNotMatch(view, /key === 'c'(?! && shiftKey)/);
  // Routed before the per-mode handlers, and no longer duplicated inside one.
  assert.match(main, /if \(viewKey\(key, ev\.shiftKey\)\) \{[\s\S]{0,60}return;\s*\}\s*\n\s*if \(directWire\)/);
  const normal = main.slice(main.indexOf('function onNormalKey('), main.indexOf('\nfunction onInsertKey('));
  assert.doesNotMatch(normal, /setGrid\(!showGrid\)|toggleTheme\(\)|setCrosshair\(!crosshairVisible\)/);
});

test('a held modifier mirrors a wire by replaying its own commit', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  const wrap = main.slice(main.indexOf('function withMirroredWire('), main.indexOf('\n/** Commit the draft wire onto'));
  // The mirror re-runs the ordinary commit with the reflected draft in place,
  // so every path it can take -- onto a terminal, into a net, open-ended --
  // mirrors without being reimplemented.
  assert.match(wrap, /run\(point\);/);
  assert.match(wrap, /if \(!wire\?\.source\) \{/);
  assert.match(wrap, /source: twin\.source, points: twin\.points/);
  // Two commits, one undo.
  assert.match(wrap, /history\.length = depth;\s*rememberHistory\(before\);\s*future\.length = 0;/);
  // A mirror that cannot commit leaves no half-drawn draft behind.
  assert.match(wrap, /if \(wire\?\.source\) \{\s*wire = \{ \.\.\.newWireDraft\(\)/);

  const draft = main.slice(main.indexOf('function mirroredWireDraft('), main.indexOf('\n/** Run one wire commit'));
  // A source standing ON the axis reflects onto its own terminal, which is
  // what fans a tail drain out to both sides of a differential pair.
  assert.match(draft, /const terminal = matchAt\(mirroredFrom\.x, mirroredFrom\.y\);/);
  // A draft lying entirely on the axis is one wire, not two.
  assert.match(draft, /mirroredFrom\.x === from\.x && mirroredFrom\.y === from\.y\s*\n?\s*&& mirroredPoint\.x === point\.x && mirroredPoint\.y === point\.y\) return null;/);
  // Both commit routes go through it, and the preview is built after the axis
  // has been aimed rather than before.
  assert.match(main, /withMirroredWire\(\(point\) => \{\s*cursor = \{ \.\.\.point \};\s*commitWireAtCursor\(\);/);
  assert.match(main, /withMirroredWire\(\(point\) => doWireClick\(/);
  const canvas = main.slice(main.indexOf('  syncSymmetryOperation();'), main.indexOf('  const ghostTwin ='));
  assert.match(canvas, /mirrorWirePreview = wire\?\.source \? mirroredWirePreview\(\) : null;/);
});

test('a copy ghost mirrors by pasting a second set and reflecting it', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  const arm = main.slice(main.indexOf('function armCopyGhostMirror('), main.indexOf('function dropCopyGhostMirror('));
  // One transform both carries the copy to the far side and flips its symbols,
  // which is why the second set is pasted on top of the first rather than at
  // the reflected point.
  assert.match(arm, /pasteClipboard\(\{ recordHistory: false, connect: false \}\);/);
  assert.match(arm, /transformMixedSelection\(symmetry\.operation, \{ recordHistory: false, center: symmetry\.pin \}\)/);
  // A selection that cannot be reflected whole leaves nothing behind.
  assert.match(arm, /circuit = Circuit\.fromJSON\(JSON\.parse\(beforeSnapshot\)\);\s*\n\s*restoreCopyGhostSelection\(ghost\);/);
  // Its own base geometry makes every later move a translation.
  assert.match(arm, /mirror\.baseGeometry = captureCopyGhostGeometry\(mirror\);/);

  const move = main.slice(main.indexOf('function moveCopyGhost('), main.indexOf('function commitCopyGhost('));
  assert.match(move, /translateCopyGhost\(ghost\.mirror,\s*\n?\s*symmetry\?\.operation === 'mirrorY' \? dx : -dx,/);

  const commit = main.slice(main.indexOf('function commitCopyGhost('), main.indexOf('\n/** Paste the clipboard'));
  // The mirror is pasted after the primary's own snapshot, so both halves are
  // already inside the single history entry -- one undo for the pair.
  assert.match(commit, /const refs = \[\.\.\.ghost\.refs, \.\.\.\(ghost\.mirror\?\.refs \|\| \[\]\)\];/);
  assert.match(commit, /recordHistoryEntry\(ghost\.beforeSnapshot\);/);
  assert.match(commit, /if \(mirrored && symmetry\?\.operation\) armCopyGhostMirror\(\);/);
});
