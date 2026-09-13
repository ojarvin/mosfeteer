import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { isCloseWindowShortcut, isKeyboardSurfaceTarget, isPrimaryPointerEvent, isSelectionModifier, moveAnnotationEndpoint, shouldConfirmBeforeUnload, shouldPanTouch, worldAndCursorFromClient } from '../src/web/interaction.js';

const rect = { left: 10, top: 20, width: 100, height: 100 };
const view = { x: -80, y: -80, w: 400, h: 400 };

test('close-window shortcuts are available to the Electron renderer', () => {
  assert.equal(isCloseWindowShortcut({ key: 'q', ctrlKey: true }), true);
  assert.equal(isCloseWindowShortcut({ key: 'w', metaKey: true }), true);
  assert.equal(isCloseWindowShortcut({ key: 'q', ctrlKey: true, altKey: true }), false);
  assert.equal(isCloseWindowShortcut({ key: 'q' }), false);
  assert.equal(shouldConfirmBeforeUnload({ dirty: true, desktop: false }), true);
  assert.equal(shouldConfirmBeforeUnload({ dirty: true, desktop: true }), false);
  assert.equal(shouldConfirmBeforeUnload({ dirty: false, desktop: false }), false);
});

test('selection extension uses one cross-platform modifier policy', () => {
  assert.equal(isSelectionModifier({ shiftKey: true }), true);
  assert.equal(isSelectionModifier({ ctrlKey: true }), true);
  assert.equal(isSelectionModifier({ metaKey: true }), true);
  assert.equal(isSelectionModifier({ altKey: true }), false);
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

test('desktop preload exposes close and reload commands through IPC', async () => {
  let exposed;
  const calls = [];
  vm.runInNewContext(readFileSync(new URL('../src/desktop/preload.cjs', import.meta.url), 'utf8'), {
    require: (name) => name === 'electron' ? {
      contextBridge: { exposeInMainWorld: (_, api) => { exposed = api; } },
      ipcRenderer: { invoke: (channel, ...args) => { calls.push({ channel, args }); return Promise.resolve(); } },
    } : require(name),
    module: { exports: {} },
    exports: {},
  });
  assert.equal(exposed.isDesktop, true);
  await exposed.closeWindow();
  await exposed.reloadApp();
  assert.deepEqual(calls, [
    { channel: 'window:close', args: [] },
    { channel: 'app:reload', args: [] },
  ]);
});

test('editor shell exposes keyboard canvas and live status surfaces', () => {
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="canvas"[^>]+tabindex="0"[^>]+role="application"/);
  assert.match(html, /id="status"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(html, /id="accessibility-announcement"[^>]+aria-live="polite"/);
  assert.match(html, /id="btn-label-bboxes"/);
});

test('new document control exposes one popup with schematic and block choices', () => {
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="btn-new-document"[^>]+aria-haspopup="menu"/);
  assert.match(html, /id="new-document-menu"[^>]+role="menu"/);
  assert.match(html, /data-new-document="circuit"/);
  assert.match(html, /data-new-document="block"/);
  assert.doesNotMatch(html, /id="btn-new-circuit"|id="btn-new-block"/);
});

test('small-signal analysis exposes a model/context popup', () => {
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="btn-analysis"/);
  assert.match(html, /class="toolbar-group analysis-group"[^>]+data-doc-kind="schematic"/);
  assert.match(html, /id="view-heading"[\s\S]*id="analysis-heading"/);
  assert.match(html, /id="analysis-dialog"/);
  assert.match(html, /id="analysis-input-field"[^>]*>Input node/);
  assert.match(html, /for="analysis-target">Output node/);
  assert.match(html, /id="analysis-submit"[^>]*>Derive all equations/);
  assert.match(html, /value="single-ended"/);
  assert.match(html, /value="input-impedance"/);
  assert.match(html, /id="analysis-ac-grounds"/);
  assert.match(html, /id="analysis-models"/);
  assert.match(html, /value="voltage-transfer"/);
  assert.match(html, /id="analysis-complementary"/);
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
  assert.match(html, /id="analysis-approx-dc"[^>]+type="checkbox"/);
  assert.match(html, /id="analysis-approx-cascode"[^>]+type="checkbox"/);
  assert.match(html, /id="analysis-approx-cascode"[^>]+checked/);
  assert.match(html, /id="analysis-approx-body"[^>]+type="checkbox"/);
  assert.match(html, /id="analysis-approx-gmro"[^>]+type="checkbox"/);
  assert.match(html, /id="analysis-approx-miller"[^>]+type="checkbox"/);
  assert.match(html, /id="analysis-approx-miller"[^>]+checked/);
  assert.match(html, /id="analysis-approx-body"[^>]+checked/);
  assert.match(html, /id="analysis-approx-gmro"[^>]+checked/);
  assert.match(html, /<div class="analysis-scroll">[\s\S]*id="analysis-result"[\s\S]*<\/div>\s*<div class="dialog-actions">/);
  const style = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
  assert.match(style, /\.analysis-dialog\s*\{[\s\S]*width: min\(64rem/);
  assert.match(style, /\.analysis-dialog\s*\{[\s\S]*overflow: hidden/);
  assert.match(style, /\.analysis-scroll\s*\{[\s\S]*overflow: auto/);
  assert.match(style, /\.analysis-dialog \.dialog-actions\s*\{[\s\S]*flex: 0 0 auto/);
  assert.match(style, /\.analysis-tabs\s*\{[\s\S]*border-bottom/);
  assert.match(style, /\.analysis-tab-panels\s*\{[\s\S]*overflow: hidden/);
});

test('analysis form state is scoped and role metadata is restored from the active schematic', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  assert.match(main, /analysisFormStorageKey\(currentCircuitName\)/);
  assert.match(main, /Select an input node before deriving equations/);
  assert.match(main, /analysis failed: \$\{message\}/);
  assert.match(main, /pruneAnalysisNetValues\(saved\.acGrounds, visibleNets\(\)\)/);
  assert.match(main, /pruneAnalysisModelValues\(saved\.models, sortedComps\(\)\.map/);
  assert.match(main, /defaults\.targetMarked \? defaults\.target : saved\.target/);
  assert.match(main, /defaults\.inputMarked \? defaults\.input : saved\.input/);
  assert.match(main, /ignoreChannelLengthModulation: !!analysisApproxRo\?\.checked/);
  assert.match(main, /const hasSavedRo = Object\.prototype\.hasOwnProperty\.call\(savedApproximations, 'ignoreChannelLengthModulation'\)/);
  assert.match(main, /dcOnly: !!analysisApproxDc\?\.checked/);
  assert.match(main, /cascodeApproximation: !!analysisApproxCascode\?\.checked/);
  assert.match(main, /ignoreBodyEffect: !!analysisApproxBody\?\.checked/);
  assert.match(main, /gmroLarge: !!analysisApproxGmRo\?\.checked/);
  assert.match(main, /resistance: 'infinite'/);
  assert.match(main, /analysisApproxBody\.checked = true/);
  assert.match(main, /analysisApproxGmRo\.checked = true/);
  assert.match(main, /millerApproximation: !!analysisApproxMiller\?\.checked/);
  assert.match(main, /smallSignalNetlist: reports\.transfer\.smallSignalNetlist \|\| reports\.output\.smallSignalNetlist/);
  assert.match(main, /const availableTab = selectedTab === 'netlist' && netlist/);
  assert.match(main, /const topGap = 2 \* GRID/);
  assert.match(main, /const bottomEdge = circuitBounds\.h > 0 \? circuitBounds\.y \+ circuitBounds\.h/);
  assert.match(main, /const leftEdge = circuitBounds\.w > 0 \? circuitBounds\.x/);
  assert.match(main, /layout\.bottomEdge \+ layout\.topGap/);
  assert.match(main, /align: 'left'/);
  assert.match(main, /effective transconductance/);
  assert.match(main, /analysisAnnotationAssumptions/);
  assert.match(main, /Cascode dominant term/);
  assert.match(main, /text: \['\\\\text\{Assumptions\\\\:\}', \.\.\.assumptions\]/);
  assert.match(main, /syncRenderedLabelMetrics/);
  assert.match(main, /function reflowEquationAnnotations/);
  assert.match(main, /const pitch = heights\.length < 2/);
  assert.match(main, /if \(gmroLarge\) add\('g_\{m\}r_\{o\} \\\\gg/);
  assert.match(main, /bodyEffectIgnored/);
  assert.match(main, /deviceRoFinite/);
});

test('arrow-key nudging moves mixed selections atomically', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  assert.match(main, /transformMixedSelection\('translate', \{ translation: \{ dx, dy \} \}\)/);
  assert.match(main, /function nudgeBlockSelection\(dx, dy\)/);
  assert.match(main, /cannot nudge attached connector/);
  assert.match(main, /circuit\.validate\(\);\s*recordBlockHistory\(before\);/);
});

test('desktop startup overlaps document listing with last-document restoration', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  assert.match(main, /const listPromise = refreshCircuitList\(\);/);
  assert.match(main, /if \(name\) await loadCircuit\(name, true\);/);
  assert.match(main, /fitView\(\);\s*restoreDesktopStartup\(\)/);
  assert.doesNotMatch(main, /fitView\(\);\s*render\(\);\s*restoreDesktopStartup/);
});

test('F5 reloads the application instead of entering the normal keymap', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  assert.match(main, /if \(ev\.key === 'F5'\)/);
  assert.match(main, /ev\.preventDefault\(\);\s*flushDraft\(\);/);
  assert.match(main, /reloadApp\(\)\.catch\(\(\) => window\.location\.reload\(\)\)/);
  const desktop = readFileSync(new URL('../src/desktop/main.js', import.meta.url), 'utf8');
  assert.match(desktop, /ipcMain\.handle\('app:reload'/);
  assert.match(desktop, /app\.relaunch\(\);\s*app\.quit\(\);/);
});

test('analysis assumption annotations collapse equivalent device r_o overrides', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  const start = main.indexOf('function analysisAnnotationAssumptions');
  const end = main.indexOf('\n\nfunction openAnalysisDialog', start);
  assert.ok(start >= 0 && end > start);
  const summarize = vm.runInNewContext(`(${main.slice(start, end)})`);
  const model = {
    elements: [
      { kind: 'vccs', component: 'M1' },
      { kind: 'vccs', component: 'M2' },
    ],
  };

  assert.deepEqual(Array.from(summarize({
    smallSignalModel: model,
    assumptions: [
      'Per-device approximation: M1 r_o → ∞.',
      'Per-device approximation: M2 r_o → ∞.',
    ],
    approximations: [],
  })), ['r_{o} = \\infty']);
  assert.deepEqual(Array.from(summarize({
    smallSignalModel: model,
    assumptions: ['Per-device approximation: M1 r_o → ∞.'],
    approximations: [],
  })), ['r_{o1} = \\infty \\; (M_{1})']);
  assert.deepEqual(Array.from(summarize({
    smallSignalModel: model,
    assumptions: [
      'Textbook approximation: r_o → ∞ except for M2 (finite r_o override).',
      'Per-device approximation: M1 r_o → ∞.',
    ],
    approximations: [],
  })), [
    'r_{o} = \\infty \\; \\text{except } M_{2}',
    'r_{o2} \\text{ finite} \\; (M_{2})',
  ]);
  assert.deepEqual(Array.from(summarize({
    smallSignalModel: { elements: [{ kind: 'vccs', component: 'M1' }] },
    assumptions: ['Per-device approximation: M1 r_o → ∞.'],
    approximations: [],
  })), ['r_{o1} = \\infty \\; (M_{1})']);
  assert.deepEqual(Array.from(summarize({
    smallSignalModel: { elements: [
      { kind: 'vccs', component: 'M1' },
      { kind: 'vccs', component: 'M2' },
    ] },
    assumptions: [],
    approximations: ['Textbook approximation: M1 output resistance r_o is ignored; capacitances are omitted.'],
  })), ['r_{o1} = \\infty \\; (M_{1})']);
  assert.deepEqual(Array.from(summarize({
    smallSignalModel: { elements: [{ kind: 'vccs', component: 'M1' }] },
    assumptions: [],
    approximations: [
      'Per-device approximation: M1 g_m r_o \\gg 1.',
      'Per-device approximation: M1 g_{mb} = 0.',
    ],
  })), [
    'g_{m1}r_{o1} \\gg 1 \\; (M_{1})',
    'V_{BS} = 0 \\; (M_{1})',
  ]);
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
