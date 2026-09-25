import { editorSource } from './helpers/editor-source.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { GRID } from '../src/core/grid.js';
import { alignedAnchorShift, attachedEdgeShift, compatibilityMoveFilter, constrainAxis, isKeyboardSurfaceTarget, isPrimaryPointerEvent, isSelectionModifier, moveAnnotationEndpoint, nearestPoint, resizeRect, shouldForwardCanvasMove, shouldPanTouch, symmetryOperation, viewFollowingCursor, worldAndCursorFromClient } from '../src/web/interaction.js';

const rect = { left: 10, top: 20, width: 100, height: 100 };
const view = { x: -80, y: -80, w: 400, h: 400 };

test('tool cursors badge the select arrow per tool, theme, and danger', () => {
  const main = editorSource();
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

test('component rows share the net-list layout without inline delete controls', () => {
  const main = editorSource();
  const start = main.indexOf('function renderComponents()');
  const end = main.indexOf('\nfunction renderNets()', start);
  assert.ok(start > 0 && end > start);
  const render = main.slice(start, end);
  assert.match(render, /row\.appendChild\(ref\);[\s\S]*row\.appendChild\(meta\);/);
  assert.doesNotMatch(render, /document\.createElement\('button'\)|row\.appendChild\(remove\)/);

  const css = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\.row \.remove/);
});

test('export has a Ctrl/Cmd+E shortcut before focused-control handling', () => {
  const main = editorSource();
  assert.match(main, /ev\.key\.toLowerCase\(\) === 'e'[^\n]*!inlineInput[\s\S]*?ev\.preventDefault\(\);\s*exportCircuit\(\);/);
});

test('document raster export sizes PNGs by the chosen DPI and keeps a fine PDF fallback', () => {
  const main = editorSource();
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  assert.match(main, /svgToPngDataUrl\(svg, exportPngScale\(pngDpi\), \{ dpi: pngDpi \}\)/);
  assert.match(main, /request\.pdfPng = await svgToPngDataUrl\(svg, PDF_FALLBACK_PNG_SCALE\)/);
  assert.match(main, /pngRasterScale\(dpi, pageGuide\?\.textPt \?\? DEFAULT_EXPORT_TEXT_PT\)/);
  assert.match(main, /writeDrawingToClipboard\(svg, \{ dpi, scale: exportPngScale\(dpi\) \}\)/);
  assert.match(html, /<select name="pngDpi">[\s\S]*?value="300" selected/);
});

test('named net edits confirm virtual connections, and port names never repeat', () => {
  const main = editorSource();
  assert.match(main, /function namedConnectionConflicts\(/);
  assert.match(main, /function confirmNamedConnection\(/);
  assert.match(main, /cancelLabel: 'Keep separate'/);
  assert.match(main, /namedConnectionConflicts\(v, \{ netId: net\.id \}\)/);
  assert.match(main, /input\.focus\((\{ preventScroll: true \})?\);\s*input\.select\(\);\s*return false;/);
  // A port's label is its identity: a name another port carries is reported
  // as a collision instead of being offered as a virtual connection.
  assert.match(main, /function portNameConflict\(/);
  assert.match(main, /function reportPortNameConflict\(/);
  assert.doesNotMatch(main, /applySharedInterfaceName|sharedInterfaceNameTarget|setInterfacePinName/);
});

test('insert categories keep switches and macros separate and include vccs with sources', () => {
  const main = editorSource();
  assert.match(main, /\['Switches', \/\^switch_\//);
  assert.match(main, /\['Sources & power', \/\^\(current_source\|voltage_source\|vccs\|supply\|ground\|vcm\)\$\//);
  assert.match(main, /\['Macros', \/\^\(opamp\|opamp_diff\|adc\|dac\)\$\//);
  assert.match(main, /\['Logic', \/\^\(inverter\|buffer\|tristate_\(inverter\|buffer\)\|mux2\|\.\*_gate\)\$\//);
  assert.match(main, /\['Sequential', \/\^\(\?:dff\|latch\)\(\?:_\|\$\)\//);
  assert.match(main, /\['Signal flow', \/\^signal_\(sum\|multiply\)\$\//);
});

test('selection style controls keep their text-target result shape', () => {
  const main = editorSource();
  const start = main.indexOf('function selectedTextTargets()');
  const end = main.indexOf('\nfunction selectedFontState(', start);
  assert.ok(start > 0 && end > start);
  assert.match(main.slice(start, end), /return \{ labels: \[\.\.\.labels\.values\(\)\], blocks: \[\] \};/);
});

test('the small-signal figure owns Escape and hands the keyboard back', () => {
  const main = editorSource();
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
  const main = editorSource();
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
  const main = editorSource();
  // Committed placements are what feed the Recent group, so an armed ghost the
  // user escapes never claims a slot.
  assert.match(main, /rememberInsertType\(pendingPlace\.type\)/);
  assert.match(main, /rememberInsertType\('label'\)/);
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

test('component drag snapshots restore segment styles with route geometry', () => {
  const main = editorSource();
  const start = main.indexOf('function captureNetGeometry(');
  const end = main.indexOf('\nfunction armModalLabelMove', start);
  const helpers = vm.runInNewContext(`(() => {
    ${main.slice(start, end)}
    return { captureNetGeometry, translateNetGeometry };
  })()`, {
    cloneFixedPaths: (entries) => entries,
    cloneWireStyles: (styles) => Object.fromEntries(Object.entries(styles || {}).map(([key, style]) => [key, { ...style }])),
    captureRouteGeometry: (net, move = (point) => ({ ...point })) => ({
      route: net.route ? net.route.map(move) : null,
      branches: net.branches ? net.branches.map((path) => path.map(move)) : null,
      junctions: (net.junctions || []).map(move),
    }),
  });
  const net = {
    routingMode: 'managed',
    route: [{ x: 0, y: 0 }, { x: 0, y: 400 }],
    branches: [[{ x: 0, y: 0 }, { x: 0, y: 400 }]],
    junctions: [],
    wireStyles: { '0:1': { color: '#111', arrowhead: 'end' } },
  };
  const saved = helpers.captureNetGeometry(net);
  net.route = [{ x: 0, y: 0 }, { x: 0, y: 120 }, { x: 160, y: 120 }, { x: 160, y: 400 }];
  net.branches = [net.route];
  net.wireStyles = {
    '0:1': { color: '#111', arrowhead: 'none' },
    '0:2': { color: '#111', arrowhead: 'none' },
    '0:3': { color: '#111', arrowhead: 'end' },
  };

  helpers.translateNetGeometry(net, saved, 0, 0);

  assert.deepEqual(net.wireStyles, saved.wireStyles);
  assert.equal(JSON.stringify(net.route), JSON.stringify(saved.route));
});

test('every tool cursor is fetched up front so a keyboard tool change paints one', () => {
  const main = editorSource();
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
  const main = editorSource();
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
  const main = editorSource();
  const start = main.indexOf('function syncRenderedLabelMetrics()');
  const end = main.indexOf('\nfunction scheduleMeasuredLabelRender()', start);
  assert.match(main.slice(start, end), /if \(label\.id\.startsWith\('category_'\)\) continue;/);
});

test('multiline assumptions measure their text independently of the restored container width', () => {
  const main = editorSource();
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

test('editor shell exposes keyboard canvas and live status surfaces', () => {
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="canvas"[^>]+tabindex="0"[^>]+role="application"/);
  assert.match(html, /id="status"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(html, /id="accessibility-announcement"[^>]+aria-live="polite"/);
  assert.doesNotMatch(html, /id="btn-label-bboxes"/);
});

test('new document control starts a schematic directly', () => {
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="btn-new-document"[^>]+title="Start a new schematic"/);
  assert.doesNotMatch(html, /id="btn-new-document"[^>]+aria-haspopup="menu"/);
  assert.doesNotMatch(html, /id="new-document-menu"|data-new-document=/);
  assert.doesNotMatch(html, /id="btn-new-circuit"|id="btn-new-block"/);

  const main = editorSource();
  assert.match(main, /newDocumentButton\?\.addEventListener\('click', \(\) => \{[\s\S]*?startNewDocument\(\);/);
});

test('an explicit new document is protected from active-document auto-loads', () => {
  const main = editorSource();
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
  const main = editorSource();
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
  const main = editorSource();
  assert.match(main, /transformMixedSelection\('translate', \{ translation: \{ dx, dy \} \}\)/);
});

test('wire previews exclude the destination net and transformed nets keep terminal moves', () => {
  const main = editorSource();
  const preview = main.slice(main.indexOf('function draftRoutePath('), main.indexOf('\nfunction draftWirePreview(', main.indexOf('function draftRoutePath(')));
  assert.match(preview, /const excludedNets = new Set\(sourceNetId && !isOpenEnd\(endpoints\[0\], sourceNetId\) \? \[sourceNetId\] : \[\]\)/);
  assert.match(preview, /circuit\._netEnv\(excludedNets\)/);
  const transform = main.slice(main.indexOf('function transformMixedSelection('), main.indexOf('/** Re-route every net', main.indexOf('function transformMixedSelection(')));
  assert.match(transform, /componentTerminalMoves\(refs, beforeComponents\)/);
  assert.match(main, /net\.routingMode === 'fixed' \? \(fresh \? 'refresh' : moved\)/);
});

test('startup paints before listing documents and restoring the requested document', () => {
  const main = editorSource();
  assert.match(main, /const listPromise = refreshCircuitList\(\);/);
  assert.match(main, /if \(openPath && openPath !== currentDocumentPath\) requestCircuitLoad\(openPath\);/);
  assert.match(main, /fitView\(\);\s*restoreStartup\(\)/);
  assert.doesNotMatch(main, /fitView\(\);\s*render\(\);\s*restoreStartup/);
});

test('fit reserves the axis the mode rail is thin along', () => {
  const main = editorSource();
  const fit = main.slice(main.indexOf('function fitView('), main.indexOf('function cycleSelection('));
  // On a narrow window the rail is a horizontal strip across the top. Reserving
  // its width there leaves a 1 px usable pane, so the fit clamps to the widest
  // allowed view and the drawing disappears -- F looks like it stopped working.
  assert.match(fit, /railIsColumn = railRect \? railRect\.width <= railRect\.height : false/);
  assert.match(fit, /leftPx = railRect && railIsColumn/);
  assert.match(fit, /topPx = railRect && !railIsColumn/);
  // Whichever axis is reserved, the drawing centres in what is left of it.
  assert.match(fit, /fitH = Math\.max\(1, usableH - marginPx \* 2\)/);
  assert.match(fit, /target\.y = \(y0 \+ y1\) \/ 2 - th \* usableCenterPy \/ paneH/);
});

test('empty canvas fit starts at a 30-cell planning view', () => {
  const main = editorSource();
  const fit = main.slice(main.indexOf('function fitView('), main.indexOf('function cycleSelection('));
  assert.match(fit, /x0 = -600;\s*y0 = -600;\s*x1 = 600;\s*y1 = 600;/);
});

test('F5 reloads the application instead of entering the normal keymap', () => {
  const main = editorSource();
  assert.match(main, /if \(ev\.key === 'F5'\)/);
  assert.match(main, /ev\.preventDefault\(\);\s*flushDraft\(\);\s*window\.location\.reload\(\);/);
});

test('analysis annotations use structured canonical assumptions', () => {
  const main = editorSource();
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
  const main = editorSource();
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
  assert.match(main, /function appendSignalFlowPolarityMenu\(menu, target\)/);
  assert.match(main, /signalRole === 'input'/);
  assert.match(main, /circuit\.setSignalInputNegative\(component\.refdes, terminal\.name/);
  assert.match(main, /Input polarity/);
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

test('Alt arms symmetric placement without swallowing the ghost keys', () => {
  const main = editorSource();
  // Alt held on its own arms it; releasing it or losing the window drops the
  // mirrored ghost.
  assert.match(main, /if \(ev\.key === 'Alt'\) \{[\s\S]{0,220}setSymmetry\(true\)/);
  assert.match(main, /keyup[\s\S]{0,260}ev\.key !== 'Alt'[\s\S]{0,120}setSymmetry\(false\)/);
  assert.match(main, /'blur', \(\) => \{[\s\S]{0,260}setSymmetry\(false\)/);
  // The modifier branch otherwise swallows every key it does not bind, which
  // would leave the ghost undrivable, untransformable and uncommittable while
  // Alt is down -- r and Shift+r included, which carry the Alt modifier.
  assert.match(main, /drivingSymmetry = symmetry\s*\n?\s*&& \(ev\.key === 'Enter' \|\| ev\.key === 'Escape' \|\| ev\.key\.startsWith\('Arrow'\) \|\| ev\.key\.toLowerCase\(\) === 'r'\)/);
  assert.match(main, /if \(\(ev\.metaKey \|\| ev\.ctrlKey\) && !drivingSymmetry\)/);
  // A settled axis outlives the modifier, so stepping off it for one transform
  // does not cost the axis; dropping the ghost forgets it.
  assert.match(main, /symmetry = symmetryMemory\s*\n?\s*\? \{ pin: \{ \.\.\.symmetryMemory\.pin \}, operation: symmetryMemory\.operation, settled: true \}/);
  assert.match(main, /symmetryMemory = \{ pin: \{ \.\.\.symmetry\.pin \}, operation: symmetry\.operation \};/);
  assert.match(main, /function clearSymmetry\(\) \{\s*dropCopyGhostMirror\(\);\s*symmetry = null;\s*symmetryMemory = null;/);
  // It belongs to a component ghost or copy ghost, never to a wire draft.
  assert.match(main, /const armed = \(mode === 'insert' && pendingPlace\?\.kind === 'component'\)\s*\n?\s*\|\| drag\?\.mode === 'copyghost';/);
  assert.doesNotMatch(main, /!!wire\?\.source && !wire\.source\.fixed/);
  const drops = main.match(/pendingPlace = null;\n\s*clearSymmetry\(\);/g) || [];
  assert.ok(drops.length >= 5, `every ghost drop clears the axis (${drops.length})`);
  // Both halves land in one commit, so the pair is one undo.
  assert.match(main, /const placements = \[pendingTransform\(\), \.\.\.\(twin \? \[twin\] : \[\]\)\]/);
  // Placing a pair settles the axis, so stacking the next pair above the first
  // -- movement along the axis -- does not turn the mirror ninety degrees.
  assert.match(main, /if \(placed\.length > 1\) \{\s*symmetry\.settled = true;/);
  assert.match(main, /if \(!symmetry \|\| symmetry\.settled\) return;/);
});

test('Ctrl+r still mirrors vertically while Alt symmetry is held', () => {
  // Alt symmetry is held while Ctrl+r is pressed, so the explicit branch must
  // preserve the vertical mirror instead of treating r as a rotation.
  const main = editorSource();
  const drivingSymmetryIndex = main.indexOf('const drivingSymmetry = symmetry');
  const modifierBranchIndex = main.indexOf("if ((ev.metaKey || ev.ctrlKey) && !drivingSymmetry) {");
  assert.ok(drivingSymmetryIndex > 0 && modifierBranchIndex > drivingSymmetryIndex);
  const between = main.slice(drivingSymmetryIndex, modifierBranchIndex);
  assert.match(between, /if \(drivingSymmetry && \(ev\.metaKey \|\| ev\.ctrlKey\) && !ev\.shiftKey && ev\.key\.toLowerCase\(\) === 'r'\) \{/);
  assert.match(between, /ev\.preventDefault\(\);/);
  assert.match(between, /transformPendingComponent\('mirrorY'\);/);
  assert.match(between, /selectedTransform\('mirror-y'\);/);
});

test('rejected actions do not create history entries and use the shared note', () => {
  const main = editorSource();
  const start = main.indexOf('function commit(fn)');
  const end = main.indexOf('\nfunction snapshot()', start);
  const commit = main.slice(start, end);
  assert.match(commit, /const before = snapshot\(\);/);
  assert.match(commit, /if \(snapshot\(\) === before\) return result;/);
  assert.match(commit, /noteActionPrevented\(error\)/);
  assert.match(main, /if \(rerouteNet\(net, routeArg\) === false\) throw new Error\(`unable to reroute net \$\{id\} safely`\)/);
  assert.match(main, /function noteActionPrevented\(error\)/);
});
test('the placement guides are a view toggle beside the grid', () => {
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="btn-guides"[^>]*aria-pressed="true"/);
  assert.ok(html.indexOf('id="btn-guides"') > html.indexOf('id="btn-grid"'));
  assert.ok(html.indexOf('id="btn-guides"') < html.indexOf('id="btn-theme"'));

  const main = editorSource();
  assert.match(main, /key === 'G' \|\| \(key === 'g' && shiftKey\)\) setGuides\(!guidesVisible\)/);
  assert.match(main, /guides: guidesVisible \? placementGuides\(/);
  // Off by keyboard or button, but never reaching the deliberately armed axis.
  assert.doesNotMatch(main, /guidesVisible[\s\S]{0,80}symmetryAxis/);

  const keymap = readFileSync(new URL('../src/web/toolbar.js', import.meta.url), 'utf8');
  assert.match(keymap, /\['Shift\+G', 'toggle the spacing and alignment guides'\]/);
});

test('the style menu exposes one shared arrowhead as independent start/end toggle buttons', () => {
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="style-arrow-start"[^>]*data-arrow-end="start"/);
  assert.match(html, /id="style-arrow-end"[^>]*data-arrow-end="end"/);
  assert.match(html, /id="style-line-pattern"/);
  assert.match(html, /data-line-style="solid"/);
  assert.match(html, /data-line-style="dashed"/);
  assert.match(html, /data-line-style="dash-dot"/);
  assert.match(html, /data-line-style="dotted"/);
  const main = editorSource();
  assert.match(main, /function combineArrowheadEnds\(start, end\)/);
  assert.match(main, /start && end \? 'both' : start \? 'start' : end \? 'end' : 'none'/);
  assert.match(main, /field !== 'arrowhead' \|\| supportsArrowhead/);
});

test('the context menu carries the style panel controls and stays open while styling', () => {
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="style-line-row" data-style-row="line"/);
  assert.match(html, /id="style-text-row" data-style-row="text"/);
  const main = editorSource();
  const open = main.slice(main.indexOf('function openComponentContextMenu('), main.indexOf('\nfunction selectContextTarget('));
  assert.match(open, /menu\.appendChild\(heading\);\s*appendContextStyleStrip\(menu\);\s*appendContextActions\(menu, target\);/);
  const strip = main.slice(main.indexOf('function appendContextStyleStrip('), main.indexOf('\nfunction openComponentContextMenu('));
  // Cloned panel controls must not duplicate the panel's ids.
  assert.match(strip, /removeAttribute\('id'\)/);
  assert.match(strip, /strip\.addEventListener\('click', \(ev\) => handleStyleControlClick\(strip, ev\)\)/);
  assert.doesNotMatch(strip, /closeComponentContextMenu/);
  const handler = main.slice(main.indexOf('function handleStyleControlClick('), main.indexOf('\nfunction updateStyleControls('));
  assert.doesNotMatch(handler, /closeComponentContextMenu/);
  // The panel and an open strip reflect the same selection after every render.
  const update = main.slice(main.indexOf('function updateStyleControls('), main.indexOf('\nfunction pickLabel('));
  assert.match(update, /syncStyleControls\(panel, state\)/);
  assert.match(update, /syncStyleControls\(strip, state\)/);
  assert.match(main, /getElementById\('style-panel'\)\?\.addEventListener\('click', \(ev\) => handleStyleControlClick\(ev\.currentTarget, ev\)\)/);
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

test('hovering another context menu item closes submenus it is not part of', () => {
  const main = editorSource();
  const start = main.indexOf('function closeStrayContextSubmenus(');
  const close = vm.runInNewContext(`(${main.slice(start, main.indexOf('\n}\n', start) + 2)})`, {
    get componentContextMenuEl() { return menu; },
    get document() { return { activeElement: active }; },
  });
  const el = (children = []) => {
    const node = { children, classes: new Set(), attrs: {}, parent: null, focused: false,
      classList: { remove: (c) => node.classes.delete(c), add: (c) => node.classes.add(c) },
      setAttribute: (k, v) => { node.attrs[k] = v; },
      contains: (other) => other === node || node.children.some((child) => child.contains(other)),
      focus: () => { active = node; } };
    for (const child of children) child.parent = node;
    return node;
  };
  const inner = el();
  const trigger = el();
  const submenu = el([inner]);
  submenu.classes.add('open');
  const plain = el();
  const menu = el([trigger, submenu, plain]);
  menu.hidden = false;
  submenu.previousElementSibling = trigger;
  menu.querySelectorAll = () => [...(submenu.classes.has('open') ? [submenu] : [])];
  let active = trigger;
  close(inner); // pointer inside the submenu keeps it
  assert.ok(submenu.classes.has('open'));
  close(trigger); // back on its own trigger keeps it
  assert.ok(submenu.classes.has('open'));
  close(plain); // a sibling row closes it and takes focus
  assert.ok(!submenu.classes.has('open'));
  assert.equal(trigger.attrs['aria-expanded'], 'false');
  assert.equal(active, plain);
});

test('tools switch straight from inside another tool, dropping its uncommitted work', () => {
  const main = editorSource();
  const body = (name) => main.slice(main.indexOf(`function ${name}(`), main.indexOf('\n}\n', main.indexOf(`function ${name}(`)));
  // No tool refuses because another one is mid-interaction any more.
  assert.doesNotMatch(main, /finish (or cancel )?the active interaction/);
  for (const name of ['activateLabelPlacement', 'activatePlace', 'activateSelect', 'activateVisual', 'activateDelete', 'activateMove', 'activateCopy']) {
    assert.match(body(name), /^function \w+\([^)]*\) \{\s*leaveActiveInteraction\(\);/, name);
  }
  // Re-picking Wire keeps a half-drawn wire; anything else is dropped first.
  assert.match(body('activateWire'), /if \(hasWireDraft\(\)\) \{[^}]*return; \}\s*leaveActiveInteraction\(\);/);
  const leave = body('leaveActiveInteraction');
  for (const part of [/cancelDrag\(\)/, /wire = null;/, /directWire = null;/, /pendingPlace = null;/, /mode = 'normal';/, /visual = null;/]) assert.match(leave, part);

  const pick = vm.runInNewContext(`(${body('toolSwitchForKey')}\n})`, {
    get wire() { return state.wire; }, get directWire() { return null; }, get mode() { return state.mode; },
    get pendingPlace() { return state.pendingPlace; }, get visual() { return null; }, get drag() { return null; },
    hasModalPlacement: () => false, wireTerminalLetter: (key) => state.terminals.includes(key),
    activatePlace: 'place', activateWire: 'wire', activateMove: () => {}, activateCopy: 'copy', activateAlign: 'align', activateHighlight: 'hl',
    activateShapeAnnotation: () => {}, activateNetLabel: 'netlabel', activateEquation: 'eq', activateVisual: 'visual', activateAnnotation: 'note',
  });
  let state = { mode: 'insert', pendingPlace: null, wire: null, terminals: [] };
  assert.equal(pick('w'), null); // the insert search keeps its letters
  state.pendingPlace = { kind: 'component' };
  assert.equal(pick('w'), 'wire'); // a placement ghost gives way to the wire tool
  assert.equal(pick('r'), null); // r still rotates the ghost
  state = { mode: 'normal', pendingPlace: null, wire: {}, terminals: ['c'] };
  assert.equal(pick('i'), 'place');
  assert.equal(pick('w'), null); // re-picking Wire keeps the draft
  assert.equal(pick('c'), null); // pointing at a BJT, c is still its collector
  assert.equal(pick('L'), 'netlabel');
  assert.equal(pick('A'), 'align');
  state = { mode: 'normal', pendingPlace: null, wire: null, terminals: [] };
  assert.equal(pick('w'), null); // idle normal mode is onNormalKey's
});

test('view toggles answer in every mode but the insert search', () => {
  const main = editorSource();
  const start = main.indexOf('function viewKey(');
  const view = main.slice(start, main.indexOf('\nfunction onVisualKey(', start));
  // Typing a component name is the one place a printable key is not a command.
  assert.match(view, /if \(mode === 'insert' && !pendingPlace\) return false;/);
  for (const binding of [/setGrid\(!showGrid\)/, /setCrosshair\(!crosshairVisible\)/,
    /setGuides\(!guidesVisible\)/, /toggleTheme\(\)/, /fitView\(\{ animate: true \}\)/, /showHelp\(\)/]) {
    assert.match(view, binding);
  }
  // Lower-case d and c belong to dd and copy mode, so only the shifted forms.
  assert.doesNotMatch(view, /key === 'd'/);
  assert.doesNotMatch(view, /key === 'c'(?! && shiftKey)/);
  // Routed before the per-mode handlers, and no longer duplicated inside one.
  assert.match(main, /if \(viewKey\(key, ev\.shiftKey\)\) \{[\s\S]{0,60}return;\s*\}\s*\n\s*const toolSwitch = toolSwitchForKey\(key, ev\.shiftKey\);[\s\S]{0,120}return;\s*\}\s*\n\s*if \(directWire\)/);
  const normal = main.slice(main.indexOf('function onNormalKey('), main.indexOf('\nfunction onInsertKey('));
  assert.doesNotMatch(normal, /setGrid\(!showGrid\)|toggleTheme\(\)|setCrosshair\(!crosshairVisible\)/);
});

test('wiring uses Alt for nearest-terminal snapping instead of symmetric routing', () => {
  const main = editorSource();
  assert.match(main, /function terminalSnapWorld\(point\)/);
  assert.match(main, /function nearestSnapTarget\(point\)[\s\S]*?circuit\.openWireEnds\(\)[\s\S]*?nearestTerminal\(point, \{ anyDistance: true \}\)/);
  assert.match(main, /const hit = nearestSnapTarget\(point\);/);
  assert.match(main, /return wire && terminalSnap \? terminalSnapWorld\(point\) : snappedWorld\(point\);/);
  assert.match(main, /if \(wire\) setTerminalSnap\(true\)/);
  assert.match(main, /if \(terminalSnap\) \{\s*terminalSnap = false;/);
  assert.match(main, /terminalSnapTarget: terminalSnap \? nearestSnapTarget\(cursor\) : null/);
  // A click on a free wire end finishes the draft there, like a terminal.
  const click = main.slice(main.indexOf('function doWireClick('), main.indexOf('\nfunction noteWireToolStart'));
  assert.match(click, /circuit\.openWireEnds\(\)\.find\([\s\S]*?joinWireToNet\(/);
  assert.doesNotMatch(main, /withMirroredWire|mirroredWireDraft|mirrorWirePreview/);
  const toolbar = readFileSync(new URL('../src/web/toolbar.js', import.meta.url), 'utf8');
  assert.match(toolbar, /hold Alt \(wire\).*nearest terminal/);
  assert.doesNotMatch(toolbar, /symmetric wiring/);
});

test('wire previews prefer a centered equivalent route', () => {
  const main = editorSource();
  const draft = main.slice(main.indexOf('function draftRoutePath('), main.indexOf('\nfunction draftWirePreview', main.indexOf('function draftRoutePath(')));
  assert.match(draft, /allowDiagonal: false, preferMidpoint: true/);
});

test('wire drafts meet a free wire end at its tip instead of running along that wire', () => {
  const main = editorSource();
  const draft = main.slice(main.indexOf('function draftRoutePath('), main.indexOf('\nfunction draftWirePreview', main.indexOf('function draftRoutePath(')));
  assert.match(draft, /circuit\.openWireEnds\(\)/);
  assert.match(draft, /if \(isOpenEnd\(endpoints\.at\(-1\), net\.id\)\) continue;/);
});

test('terminal commits preserve the routed preview without manual waypoints', () => {
  const main = editorSource();
  const connect = main.slice(main.indexOf('function connectWireToTerminal('), main.indexOf('\n/** A point reflected', main.indexOf('function connectWireToTerminal(')));
  assert.match(connect, /const draftPath = draftRoutePath\(wire, end\);/);
  assert.doesNotMatch(connect, /wire\.points\.length \? draftRoutePath/);
});

test('wire previews can cross neighbours but validate the final drop, and canvas menus do not promise rename by double-click', () => {
  const main = editorSource();
  const drag = main.slice(main.indexOf('function managedWireDragAt('), main.indexOf('\nfunction canvasMouseDown', main.indexOf('function managedWireDragAt(')));
  assert.match(drag, /allowPastNeighbors: true/);
  assert.match(drag, /preserveDiagonalNeighbors: true/);
  const canvasDown = main.slice(main.indexOf('function canvasMouseDown('), main.indexOf('\nfunction beginObjectMove', main.indexOf('function canvasMouseDown(')));
  assert.match(canvasDown, /allowPastNeighbors: true/);
  assert.match(canvasDown, /preserveDiagonalNeighbors: true/);
  const upStart = main.indexOf('function canvasMouseUp(');
  const mouseup = main.slice(upStart, main.indexOf("\ncanvasEl.addEventListener('mousedown'", upStart));
  assert.match(mouseup, /newWireBodyViolation\(drag\.startSnapshot, touchedNets\)/);
  assert.match(mouseup, /drag\.mode === 'wireseg' && !drag\.modal && movedOut\) canvasMouseMove\(ev\)/);

  const wireRename = main.match(/appendContextItem\(group, 'Rename net…',[^\n]*/)?.[0];
  assert.ok(wireRename, 'the wire context menu still offers net rename');
  assert.doesNotMatch(wireRename, /shortcut: 'dbl-click'/);
  const netList = main.slice(main.indexOf('function renderNets('), main.indexOf('\nfunction startNetRename(', main.indexOf('function renderNets(')));
  assert.match(netList, /row\.addEventListener\('dblclick', \(\) => \{[\s\S]*startNetRename\(net, ref\)/);
});

test('a copy ghost mirrors by pasting a second set and reflecting it', () => {
  const main = editorSource();
  const arm = main.slice(main.indexOf('function armCopyGhostMirror('), main.indexOf('function dropCopyGhostMirror('));
  const symmetry = main.slice(main.indexOf('function copyGhostSymmetryPin('), main.indexOf('function setSymmetry('));
  assert.match(symmetry, /components\[0\]\.transform\.x, y: components\[0\]\.transform\.y/);
  assert.match(symmetry, /components\.length > 1/);
  assert.match(symmetry, /x: snap\(\(x0 \+ x1\) \/ 2\), y: snap\(\(y0 \+ y1\) \/ 2\)/);
  assert.match(main, /const pin = drag\?\.mode === 'copyghost' \? copyGhostSymmetryPin\(\) : \{ \.\.\.cursor \};/);
  assert.match(main, /waitingForMotion: drag\?\.mode === 'copyghost'/);
  assert.match(main, /if \(symmetry\.waitingForMotion\)[\s\S]*symmetry\.waitingForMotion = false/);
  assert.match(main, /const directionPin = symmetry\.armedCursor \|\| symmetry\.pin;/);
  assert.match(main, /symmetry\.operation = symmetryOperation\(directionPin, cursor, symmetry\.operation\);/);
  // One transform both carries the copy to the far side and flips its symbols,
  // which is why the second set is pasted on top of the first rather than at
  // the reflected point.
  assert.match(arm, /const savedClipboard = clipboard;/);
  assert.match(arm, /restoreCopyGhostSelection\(ghost\);\s*if \(!copySelection\(\)\)/);
  assert.match(arm, /cursor = \{ \.\.\.clipboard\.anchor \};/);
  assert.match(arm, /pasteClipboard\(\{ recordHistory: false, connect: false \}\);/);
  assert.match(arm, /clipboard = savedClipboard;\s*cursor = savedCursor;/);
  assert.match(arm, /transformMixedSelection\(symmetry\.operation, \{ recordHistory: false, center: symmetry\.pin \}\)/);
  // A selection that cannot be reflected whole leaves nothing behind.
  assert.match(arm, /circuit = Circuit\.fromJSON\(JSON\.parse\(beforeSnapshot\)\);\s*\n\s*restoreCopyGhostSelection\(ghost\);/);
  // Its own base geometry makes every later move a translation.
  assert.match(arm, /mirror\.baseGeometry = captureCopyGhostGeometry\(mirror\);/);

  const move = main.slice(main.indexOf('function moveCopyGhost('), main.indexOf('function commitCopyGhost('));
  assert.match(move, /translateCopyGhost\(ghost\.mirror,\s*\n?\s*symmetry\?\.operation === 'mirrorY' \? dx : -dx,/);
  const refresh = main.slice(main.indexOf('function mirroredCopyGhostOperation('), main.indexOf('function refreshCopyGhostBase('));
  assert.match(refresh, /transformMixedSelection\(mirroredCopyGhostOperation\(operation\),/);
  assert.match(refresh, /const mirrorPivot = transformWorldPoints\(\[pivot\], symmetry\.pin, symmetry\.operation\)\[0\];/);
  assert.match(main, /const operation = axis === 'x' \? 'mirrorX' : 'mirrorY';[\s\S]*refreshCopyGhostBase\(\{ operation, pivot \}\)/);
  assert.match(main, /function rotateSelectionAbout\([\s\S]*?if \(inCopyGhost \|\| multi\.size > 1/);
  assert.match(main, /function mirrorSelectionAbout\([\s\S]*?if \(inCopyGhost \|\| multi\.size > 1/);
  assert.doesNotMatch(main, /copyPivot/);

  const render = main.slice(main.indexOf('function renderCanvas('), main.indexOf('\n// ----- mouse', main.indexOf('function renderCanvas(')));
  assert.match(render, /for \(const ref of drag\.ghost\.mirror\?\.refs \|\| \[\]\) ghostRefs\.add\(ref\);/);
  assert.match(render, /for \(const id of drag\.ghost\.mirror\?\.labels \|\| \[\]\) ghostLabels\.add\(id\);/);
  assert.match(render, /for \(const id of drag\.ghost\.mirror\?\.netIds \|\| \[\]\) ghostNets\.add\(id\);/);

  const drop = main.slice(main.indexOf('function dropCopyGhostMirror('), main.indexOf('function commitCopyGhost('));
  // The mirror snapshot is based at the ghost's original placement. Dropping
  // Alt must replay the primary displacement instead of returning it to the
  // source component before the mirrored half is removed.
  assert.match(drop, /const dx = snap\(cursor\.x\) - snap\(drag\.startWorld\.x\);/);
  assert.match(drop, /const dy = snap\(cursor\.y\) - snap\(drag\.startWorld\.y\);/);
  assert.match(drop, /beforeMirror\.topologyOnly = true;\s*circuit = Circuit\.fromJSON\(beforeMirror\);/);
  assert.match(drop, /ghost\.mirror = null;\s*translateCopyGhost\(ghost, dx, dy\);/);

  const commit = main.slice(main.indexOf('function commitCopyGhost('), main.indexOf('\n/** Paste the clipboard'));
  // The mirror is pasted after the primary's own snapshot, so both halves are
  // already inside the single history entry -- one undo for the pair.
  assert.match(commit, /const refs = \[\.\.\.ghost\.refs, \.\.\.\(ghost\.mirror\?\.refs \|\| \[\]\)\];/);
  assert.match(commit, /recordHistoryEntry\(ghost\.beforeSnapshot\);/);
  assert.match(commit, /if \(mirrored && symmetry\?\.operation\) armCopyGhostMirror\(\);/);
});

test('transient copy ghosts stay out of side panels until committed', () => {
  const main = editorSource();
  const components = main.slice(main.indexOf('function renderComponents('), main.indexOf('function renderNets('));
  assert.match(components, /componentPaletteItems\(sortedComps\(\)\)[\s\S]*\.filter\(\(comp\) => !isTransientCopyGhostRef\(comp\.refdes\)\)/);

  const nets = main.slice(main.indexOf('function renderNets('), main.indexOf('\n/** Open the inline refdes editor', main.indexOf('function renderNets(')));
  assert.match(nets, /const visibleGroupNets =/);
  assert.match(nets, /const groupedNets = visibleGroupNets\(net\)/);

  const detail = main.slice(main.indexOf('function renderDetail('), main.indexOf('// ----- insert-mode menu'));
  assert.match(detail, /isTransientCopyGhostRef\(comp\.refdes\)/);
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

test('9 arms net highlighting and 8 clears it unless they continue a count', () => {
  const main = editorSource();
  assert.match(main, /if \(key === '9' && !counts\) \{\s*activateHighlight\(\);/);
  assert.match(main, /if \(key === '8' && !counts\) \{\s*removeAllNetHighlights\(\);/);
  // Clicks cycle through one undoable model edit (on a beat, the beat's own
  // highlight); the net list shows the color.
  assert.match(main, /commit\(\(\) => \{\s*color = beatIndex === null \? circuit\.cycleNetHighlight\(net\) : cycleBeatHighlight\(circuit, beatIndex, net, NET_HIGHLIGHT_COLORS\);\s*\}\);/);
  assert.match(main, /dot\.className = 'net-highlight-dot';/);
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="btn-mode-highlight" class="mode-control"[^>]*data-action="highlight"/);
});

test('Ctrl/Cmd on any annotation arms a copy before the selection toggle', () => {
  const main = editorSource();
  const down = main.slice(main.indexOf('const pickedLine = endpointHit?.label'), main.indexOf("mode: 'labelmove', labelId: annotationGeometry.id"));
  // Lines and arrows (grabbed by a vertex or segment), shape captions, and
  // box outlines each try the copy grab first; a click without a drag still
  // toggles the selection when the grab is released.
  for (const target of ['pickedLine', 'annotationText', 'annotationGeometry']) {
    const arm = down.indexOf(`armLabelCopyGrab(${target}, startWorld, startClient, ev)`);
    assert.ok(arm >= 0, `${target} arms a copy`);
    assert.ok(arm < down.indexOf(`isSelectionModifier(ev)`, down.indexOf(target)), `${target} copies before it toggles`);
  }
});

test('a still click on a selected object cycles to the next one stacked under it, and a press drags the selected one', () => {
  const main = editorSource();
  const up = main.slice(main.indexOf('function canvasMouseUp('), main.indexOf('\nfunction finishCanvasMouseUp('));
  assert.match(up, /const still = !!drag && !dragMoved\(/);
  assert.match(up, /nextStackedSelection\(click\.candidates, click\.pressKey\)/);
  const down = main.slice(main.indexOf('function canvasMouseDown('), main.indexOf('\n/** Arm one translation drag'));
  assert.match(down, /stackedClick = !isSelectionModifier\(ev\) && ev\.detail < 2/);
  assert.match(down, /beginComponentDrag\(\{ refdes: preferred\.slice\('component:'\.length\) \}/);
  assert.match(down, /const wireHit = preferredWire \|\| pickWire\(startWorld\);/);
});

test('a click picks the label whose text is under the pointer before one whose box merely reaches there, and cycles through every label', () => {
  const main = editorSource();
  const at = main.slice(main.indexOf('function labelsAt('), main.indexOf('\nfunction annotationTextAt('));
  assert.match(at, /const ink = label\.inkRect\(\);/);
  assert.match(at, /return \[\.\.\.onText, \.\.\.inBox\];/);
  assert.match(main, /function pickLabel\(w\) \{\s*return labelsAt\(w\)\[0\] \|\| null;/);
  assert.match(main, /for \(const label of labelsAt\(w\)\) add\(`label:\$\{label\.id\}`\);/);
});

test('the inline label editor covers the text, not the label\'s grid box, and follows zoom', () => {
  const main = editorSource();
  const edit = main.slice(main.indexOf('function inlineEditLabel('), main.indexOf('  resize();', main.indexOf('function inlineEditLabel(')));
  // The label's own size, one line tall per line, centred where the text is drawn.
  assert.match(edit, /labelFontSize\(label\.style\?\.width\) \* scale/);
  assert.match(edit, /const lines = input\.value\.split\('\\n'\)\.length \* fontPx \* 1\.2 \+ 4;/);
  assert.match(edit, /const centre = r\.top \+ \(b\.y \+ b\.h \/ 2 - view\.y\) \* scale;/);
  // Long text wraps and scrolls inside the visible canvas instead of running off it.
  assert.match(edit, /const width = Math\.min\(r\.width - 2 \* margin,/);
  assert.match(edit, /Math\.min\(Math\.max\(wanted, r\.left \+ margin\), r\.right - margin - width\)/);
  assert.match(edit, /const height = Math\.min\(r\.height - 2 \* margin, Math\.max\(lines, input\.scrollHeight \+ 2\)\);/);
  assert.match(edit, /input\.style\.overflowY = input\.scrollHeight > height \+ 1 \? 'auto' : 'hidden';/);
  assert.match(edit, /input\.style\.overflowWrap = 'anywhere';/);
  // It is laid out again on every repaint, so it follows zoom and pan.
  assert.match(edit, /input\.relayout = resize;/);
  assert.match(main, /syncViewToPane\(\);\s*\/\/ An open inline editor sits over its text at the current zoom and pan\.\s*inlineInput\?\.relayout\?\.\(\);/);
  // Aligned text grows from its aligned edge, as the drawn text does.
  assert.match(edit, /align === 'left' \? screenX\(b\.x \+ inset\) - editorPad/);
  assert.doesNotMatch(edit, /const sh = /);
});

test('canvas text editors never scroll the page when they run past the window', () => {
  const main = editorSource();
  for (const name of ['function inlineEditLabel(', 'function inlineEditSchematicBlock(']) {
    const body = main.slice(main.indexOf(name), main.indexOf('\n}\n', main.indexOf(name)));
    assert.match(body, /input\.style\.position = 'fixed';/, name);
    assert.doesNotMatch(body, /input\.focus\(\);/, name);
  }
});
