import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { constrainAxis, isKeyboardSurfaceTarget, isPrimaryPointerEvent, isSelectionModifier, moveAnnotationEndpoint, shouldPanTouch, worldAndCursorFromClient } from '../src/web/interaction.js';

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
  assert.doesNotMatch(html, /id="analysis-(?:kind|context|mode|complementary|models)"/);
  assert.doesNotMatch(html, /id="analysis-approx-(?:dc|cascode|miller)"/);
  assert.doesNotMatch(html, /current-source|Miller|cascode|Analyze DC topology only/i);
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
  assert.doesNotMatch(main, /analysisKind|analysisMode|analysisComplementary|analysisContext|analysisModels|analysisApproxMiller|analysisApproxCascode|dcOnly/);
  assert.match(main, /Array\.isArray\(report\?\.equationEntries\)/);
  assert.match(main, /for \(const \{ title, result: child \} of entries\)/);
  assert.match(main, /const availableTab = selectedTab === 'netlist' && netlist/);
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
  assert.match(main, /const comp = circuit\.addComponent\(pendingPlace\.type/);
  assert.match(main, /circuit\.connectCoincident\(comp\.refdes\);/);
  assert.match(main, /circuit\.reconnectCoincidentNets\(\);/);
  assert.match(main, /circuit\.ensureUniqueTerminals\(\[comp\.refdes\]\);/);
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
