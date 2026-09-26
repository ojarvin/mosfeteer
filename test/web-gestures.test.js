import { editorSource, functionSource } from './helpers/editor-source.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { getSymbol } from '../src/core/components/index.js';
import { applyTransform } from '../src/core/geometry.js';
import {
  arrivalDirection, easeOutCubic, isPinDragCandidate, knifeCrossings, lerpView, quickAddPlacement,
  radialRingRadius, radialSector, segmentsIntersect, spliceCandidate, wheelIntent,
} from '../src/web/gestures.js';

const def = (type) => getSymbol(type);

test('pin drags wire only from multi-terminal parts', () => {
  assert.equal(isPinDragCandidate(def('resistor')), true);
  assert.equal(isPinDragCandidate(def('nmos')), true);
  assert.equal(isPinDragCandidate(def('ground')), false);
  assert.equal(isPinDragCandidate(def('port')), false);
  assert.equal(isPinDragCandidate(null), false);
});

test('arrival direction skips zero-length tail segments', () => {
  assert.deepEqual(arrivalDirection([{ x: 0, y: 0 }, { x: 0, y: 80 }, { x: 0, y: 80 }]), { x: 0, y: 1 });
  assert.equal(arrivalDirection([{ x: 1, y: 1 }]), null);
});

test('quick-add lands the chosen terminal on the drop point, body continuing the wire', () => {
  const point = { x: 400, y: 200 };
  const landed = (type, direction) => {
    const placement = quickAddPlacement(def(type), point, direction);
    const t = def(type).terminals.find((terminal) => terminal.name === placement.terminal);
    const world = applyTransform({ x: placement.x, y: placement.y, rotation: placement.rotation,
      mirrorX: placement.mirrorX, mirrorY: placement.mirrorY }, t.x, t.y);
    return { placement, world };
  };
  // A wire arriving rightwards meets a resistor's a terminal in its default pose.
  let { placement, world } = landed('resistor', { x: 1, y: 0 });
  assert.deepEqual(world, point);
  assert.equal(placement.rotation, 0);
  assert.equal(placement.terminal, 'a');
  assert.equal(placement.x, 480);
  // Arriving downwards, the resistor turns vertical and hangs below the point.
  ({ placement, world } = landed('resistor', { x: 0, y: 1 }));
  assert.deepEqual(world, point);
  assert.equal(placement.x, 400);
  assert.equal(placement.y, 280);
  // A MOS gate is the natural landing for a rightward wire.
  ({ placement, world } = landed('nmos', { x: 1, y: 0 }));
  assert.equal(placement.terminal, 'g');
  assert.deepEqual(world, point);
  // Markers keep their only pose and sit on the point.
  ({ placement } = landed('ground', { x: 1, y: 0 }));
  assert.deepEqual({ x: placement.x, y: placement.y, rotation: placement.rotation }, { x: 400, y: 200, rotation: 0 });
  // PMOS honours its default mirror while scoring.
  ({ world } = landed('pmos', { x: 0, y: -1 }));
  assert.deepEqual(world, point);
});

test('quick-add ports face along the wire and parts inherit the source pose', () => {
  const point = { x: 400, y: 200 };
  const pose = (placement) => ({ rotation: placement.rotation, mirrorX: placement.mirrorX, mirrorY: placement.mirrorY });
  // An input port on a leftward wire keeps its textbook pose, with its pin on the point.
  let placement = quickAddPlacement(def('input'), point, { x: -1, y: 0 });
  assert.deepEqual(pose(placement), { rotation: 0, mirrorX: false, mirrorY: false });
  assert.deepEqual({ x: placement.x, y: placement.y }, point);
  // From a mirrored MOS gate the wire runs right: the port mirrors instead of turning.
  placement = quickAddPlacement(def('input'), point, { x: 1, y: 0 });
  assert.deepEqual(pose(placement), { rotation: 0, mirrorX: true, mirrorY: false });
  // Output ports already face right by default and flip for a leftward wire.
  assert.equal(quickAddPlacement(def('output'), point, { x: 1, y: 0 }).mirrorX, true);
  assert.equal(quickAddPlacement(def('output'), point, { x: -1, y: 0 }).mirrorX, false);
  // A vertical wire turns the port so its body continues the wire.
  placement = quickAddPlacement(def('port'), point, { x: 0, y: 1 });
  const body = applyTransform({ x: 0, y: 0, ...pose(placement) }, -40, 0);
  assert.ok(body.y > 0 && body.x === 0);
  // Ground keeps its only pose whatever the source.
  assert.deepEqual(pose(quickAddPlacement(def('ground'), point, { x: 1, y: 0 }, { rotation: 0, mirrorX: true })),
    { rotation: 0, mirrorX: false, mirrorY: false });
  // Stacking on a mirrored NMOS drain inherits the mirror; PMOS keeps its default Y mirror.
  const mirroredNmos = { rotation: 0, mirrorX: true, mirrorY: false };
  assert.deepEqual(pose(quickAddPlacement(def('nmos'), point, { x: 0, y: -1 }, mirroredNmos)), { rotation: 0, mirrorX: true, mirrorY: false });
  assert.deepEqual(pose(quickAddPlacement(def('pmos'), point, { x: 0, y: -1 }, mirroredNmos)), { rotation: 0, mirrorX: true, mirrorY: true });
  // An unmirrored source keeps the defaults.
  assert.deepEqual(pose(quickAddPlacement(def('nmos'), point, { x: 0, y: -1 }, { rotation: 0 })), { rotation: 0, mirrorX: false, mirrorY: false });
  // A MOS added on a mirrored gate's wire lands upright, gate to gate.
  placement = quickAddPlacement(def('nmos'), point, { x: 1, y: 0 }, mirroredNmos);
  assert.equal(placement.terminal, 'g');
  assert.deepEqual(pose(placement), { rotation: 0, mirrorX: false, mirrorY: false });
});

test('radial sectors start at the top and run clockwise, with a dead zone', () => {
  assert.equal(radialSector(0, -50, 4), 0);
  assert.equal(radialSector(50, 0, 4), 1);
  assert.equal(radialSector(0, 50, 4), 2);
  assert.equal(radialSector(-50, 0, 4), 3);
  assert.equal(radialSector(35, -35, 8), 1);
  assert.equal(radialSector(3, 3, 4), -1);
  assert.equal(radialSector(10, 10, 0), -1);
});

test('segment intersection covers crossings, touches, and misses', () => {
  const p = (x, y) => ({ x, y });
  assert.equal(segmentsIntersect(p(0, 0), p(10, 10), p(0, 10), p(10, 0)), true);
  assert.equal(segmentsIntersect(p(0, 0), p(10, 0), p(10, 0), p(10, 10)), true);
  assert.equal(segmentsIntersect(p(0, 0), p(10, 0), p(0, 5), p(10, 5)), false);
  assert.equal(segmentsIntersect(p(0, 0), p(10, 0), p(5, 0), p(20, 0)), true);
});

test('knife crossings report each crossed segment once as a wire key', () => {
  const paths = [
    { netId: 'N1', branch: 0, pts: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }] },
    { netId: 'N2', branch: 0, pts: [{ x: 0, y: 400 }, { x: 200, y: 400 }] },
  ];
  assert.deepEqual(knifeCrossings([{ x: 100, y: -50 }, { x: 100, y: 50 }, { x: 250, y: 100 }], paths).sort(), ['N1:0:1', 'N1:0:2']);
  assert.deepEqual(knifeCrossings([{ x: 100, y: 300 }], paths), []);
});

test('splice needs both terminals on one straight segment', () => {
  const paths = [{ netId: 'N1', branch: 0, pts: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 200 }] }];
  const hit = spliceCandidate([{ x: 80, y: 0 }, { x: 240, y: 0 }], paths);
  assert.equal(hit.netId, 'N1');
  assert.equal(hit.segment, 1);
  assert.equal(spliceCandidate([{ x: 320, y: 0 }, { x: 480, y: 0 }], paths), null);
  assert.equal(spliceCandidate([{ x: 400, y: 40 }, { x: 400, y: 200 }], paths).segment, 2);
  assert.equal(spliceCandidate([{ x: 0, y: 0 }], paths), null);
});

test('wheel intent follows the scroll scheme; pinch always zooms', () => {
  assert.equal(wheelIntent({ ctrlKey: false }, 'mouse'), 'zoom');
  assert.equal(wheelIntent({ ctrlKey: false }, 'trackpad'), 'pan');
  assert.equal(wheelIntent({ ctrlKey: true }, 'trackpad'), 'zoom');
});

test('view easing interpolates and clamps', () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.equal(easeOutCubic(2), 1);
  const mid = lerpView({ x: 0, y: 0, w: 100, h: 50 }, { x: 100, y: 100, w: 200, h: 100 }, 0.5);
  assert.ok(mid.x > 50 && mid.x < 100);
  assert.deepEqual(lerpView({ x: 0, y: 0, w: 1, h: 1 }, { x: 5, y: 6, w: 7, h: 8 }, 1), { x: 5, y: 6, w: 7, h: 8 });
});

test('editor gestures are wired through the shared draft, history, and menus', async () => {
  const main = editorSource();
  // A pin press stays a component click until it moves; then it is a wire draft.
  assert.match(main, /isPinDragCandidate\(componentHit\?\.def\)\) \{\s*drag\.pinGrab = /);
  assert.match(main, /drag\.mode === 'move' && drag\.pinGrab && !drag\.moved && movedOut\) \{\s*beginPinWire\(drag, w\);/);
  // Quick-add places and wires the part as one history entry.
  const pick = functionSource('pickQuickAdd', main);
  assert.match(pick, /const before = snapshot\(\);/);
  assert.match(pick, /connectWireToTerminal\(\{ refdes: comp\.refdes, term: placement\.terminal[^)]*\}, before\)/);
  assert.match(pick, /applyJson\(before\)/);
  assert.match(main, /function connectTwo\(src, dst, points, before = snapshot\(\)\)/);
  // Splicing applies to placement and to a single-part drop.
  assert.match(main, /if \(placed\.length === 1\) spliceIfOnWire\(placed\[0\]\);/);
  assert.match(main, /if \(!moveDrag\.detached && refs\.length === 1\) spliceIfOnWire\(/);
  // The context menu waits for the release while a right press is undecided.
  assert.match(main, /if \(drag\?\.mode === 'radialpending' \|\| drag\?\.mode === 'radial'\) return;/);
  assert.match(main, /drag\.mode === 'radialpending'\) \{\s*window\.clearTimeout\(drag\.holdTimer\);\s*drag = null;\s*suppressContextMenuUntil/);
  // Ctrl/Cmd-drag copies preview inside a transaction and keep the clipboard.
  assert.match(main, /const savedClipboard = clipboard;[\s\S]{0,300}pasteClipboard\(\{ recordHistory: false, connect: false \}\);[\s\S]{0,40}clipboard = savedClipboard;/);
  assert.match(main, /beginPreviewTransaction\(startSnapshot\);\n\s*const componentRefs/);
  // Live drags accept transforms without their own history entry.
  assert.match(main, /if \(drag\.modal && !drag\.committed\) \{\s*recordHistoryEntry/);
  // Knife, corner flip, double-click insert, Space pan, trackpad scheme.
  assert.match(main, /knife: ev\.shiftKey \? \[/);
  assert.match(main, /cutAlong\(\[\.\.\.drag\.knife/);
  assert.match(main, /key === '\/'\) \{[\s\S]{0,120}wire\.flipCorner = !wire\.flipCorner;/);
  assert.match(main, /if \(draft\.flipCorner && i === endpoints\.length - 1\) leg = flippedCornerLeg\(leg, route\) \|\| leg;/);
  assert.match(main, /Double-clicking empty paper opens the insert menu right there\.\s*cursor = snappedWorld\(w\);\s*activatePlace\(\);/);
  assert.match(main, /if \(b === 1 \|\| \(b === 0 && spaceHeld\)\)/);
  assert.match(main, /if \(wheelIntent\(ev, scrollScheme\) === 'pan'\)/);
  assert.match(main, /localStorage\.setItem\('mosfeteer\.scrollScheme', scrollScheme\)/);
});

test('named-net shorts share one name picker; scripted commands never prompt', async () => {
  const main = editorSource();
  // Every recorded edit checks for a new merged-name conflict.
  assert.match(main, /queueCommitFeedback\(startSnapshot, feedback\);\s*askNameForNewNetNameConflict\(startSnapshot\);/);
  // Solder, wire, and reference-rail shorts go through the same picker.
  assert.equal((main.match(/askNetNameChoice\(\{/g) || []).length, 3);
  // A commit that joins an unnamed ground/supply/VCM marker to a named net
  // asks to take the rail name; the picker's cancel reverts the edit.
  assert.match(main, /if \(askForNewNetNameWarning\(startSnapshot\)\) return;\s*askForNewReferenceShort\(startSnapshot\);/);
  assert.match(main, /heading: 'Rename net to',\s*names: \[conflict\.railName\]/);
  // Command-line edits keep the model's name instead of prompting.
  assert.match(main, /suppressNetNameChoice = true;\s*try \{ recordHistoryEntry\(before\); \} finally \{ suppressNetNameChoice = false; \}/);
});

test('rail tools hand keyboard focus back to the canvas after a pointer click', async () => {
  const { readFileSync } = await import('node:fs');
  const main = editorSource();
  assert.match(main, /querySelectorAll\('\.mode-toolbar, \.rail-flyout'\)[\s\S]{0,200}ev\.detail > 0 && ev\.target\.closest\('button'\)\) canvasEl\.focus/);
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  // Wire shapes live in a flyout like the annotation tools; box select is key-only.
  assert.match(html, /id="btn-mode-wire" class="mode-control rail-flyout-proxy"[^>]*aria-controls="wire-flyout"/);
  assert.match(html, /id="wire-flyout" class="rail-flyout glass"/);
  assert.doesNotMatch(html, /id="btn-mode-visual"/);
});

test('hover previews: net hovers glow markers and ports; part bodies light their panel row', async () => {
  const main = editorSource();
  // Selected and hovered nets share one marker/port lookup.
  assert.match(main, /const netMarkers = netMarkerRefs\(nets\);/);
  assert.match(main, /netMarkerRefs\(hoverTarget\.ids\.map\(/);
  // A canvas hover over a part body targets that part's row.
  assert.match(main, /body && body\.type !== 'solder' \? \{ kind: 'component', refdes: body\.refdes \}/);
});

test('knife strokes cross rectangles and polylines', async () => {
  const { strokeCrossesRect, strokeCrossesPolyline } = await import('../src/web/gestures.js');
  const rect = { x: 0, y: 0, w: 100, h: 60 };
  assert.equal(strokeCrossesRect([{ x: -20, y: 30 }, { x: 120, y: 30 }], rect), true); // passes through
  assert.equal(strokeCrossesRect([{ x: 20, y: 20 }, { x: 40, y: 40 }], rect), true); // entirely inside
  assert.equal(strokeCrossesRect([{ x: -20, y: -20 }, { x: 120, y: -20 }], rect), false); // passes above
  assert.equal(strokeCrossesRect([{ x: 0, y: 0 }], rect), true);
  assert.equal(strokeCrossesRect([{ x: 0, y: 0 }, { x: 10, y: 10 }], { x: 0, y: 0, w: 0, h: 0 }), false);
  const line = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }];
  assert.equal(strokeCrossesPolyline([{ x: 100, y: -20 }, { x: 100, y: 20 }], line), true);
  assert.equal(strokeCrossesPolyline([{ x: 100, y: 20 }, { x: 180, y: 180 }], line), false);
});

test('the knife deletes every object kind it cuts through one delete', async () => {
  const main = editorSource();
  const cut = main.slice(main.indexOf('function knifeTargets('), main.indexOf('/** Gesture feedback appended'));
  assert.match(cut, /if \(c\.type === 'solder'\) continue;/);
  assert.match(cut, /if \(label\.owner \|\| label\.selectable === false\) continue;/);
  assert.match(cut, /setSelection\(refs\);\s*setLabelSelection\(labelIds\);[\s\S]*selectedWires = new Set\(wires\);[\s\S]*deleteSelection\(\);/);
  assert.match(main, /cutAlong\(\[\.\.\.drag\.knife, \{ x: releaseWorld\.x, y: releaseWorld\.y \}\]\);/);
});

test('radial menu tools act on their part at the release point', async () => {
  const main = editorSource();
  const radial = main.slice(main.indexOf('const RADIAL_ITEMS = ['), main.indexOf('const RADIAL_RADIUS'));
  for (const label of ['Rotate', 'Mirror H', 'Mirror V', 'Delete', 'Copy', 'Detach move', 'Move']) assert.match(radial, new RegExp(`label: '${label}'`));
  assert.match(radial, /radialMove\(radial, at, 'detached'\)/);
  assert.match(radial, /armModalMove\(\{ refdes: radial\.refdes \}, at\.world, at\.client\)/);
  assert.match(radial, /if \(copyMode\) beginCopySource\(at\.world, at\.client\)/);
  // Space's wire stubs, on the part the menu selected.
  assert.match(radial, /label: 'Wire stubs', icon: 'stub', run: \(\) => stubSelection\(\)/);
  assert.match(main, /finishRadialMenu\(radial, \{ x: ev\.clientX, y: ev\.clientY \}\);/);
});

test('Ctrl+A selects nets that join touching pins without any wire', async () => {
  const main = editorSource();
  assert.match(main, /selectedNets = new Set\(selectAllNetIds\(circuit\)\);/);
  const body = main.slice(main.indexOf('export function selectAllNetIds('), main.indexOf('export function deriveInteractionState('));
  // Rebuild the pure helper and exercise it on a real model.
  const { Circuit } = await import('../src/core/model.js');
  const selectAllNetIds = new Function(`${body.replace('export ', '')}; return selectAllNetIds;`)();
  const circuit = new Circuit();
  circuit.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  circuit.addComponent('resistor', { refdes: 'R2', x: 160, y: 0 });
  assert.equal(circuit.nets.size, 1);
  assert.deepEqual(selectAllNetIds(circuit), [...circuit.nets.keys()]);
});

test('small windows: rail follows canvas height, one-row toolbar, drawer panel', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../src/web/style.css', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  const main = editorSource();
  // The rail turns horizontal by canvas height, not window width.
  assert.match(css, /container: canvas-pane \/ size;/);
  assert.match(css, /@container canvas-pane \(max-height: 380px\) \{\s*\.mode-toolbar \{\s*width: max-content;/);
  // The toolbar never wraps; narrow windows fold buttons into More as proxies.
  assert.match(css, /^\.toolbar \{\s*flex-wrap: nowrap;/m);
  for (const id of ['btn-new-document', 'btn-export', 'btn-grid', 'btn-guides', 'btn-crosshair', 'btn-theme']) {
    assert.match(html, new RegExp(`class="fold-only"[^>]*data-proxy-for="${id}"`));
  }
  // The panel toggle works at every size: collapse when docked, drawer when narrow.
  assert.match(html, /id="btn-side-panel"[^>]*aria-controls="side-panel"/);
  assert.match(css, /body\.side-panel-collapsed \.side-panel \{\s*display: none;/);
  assert.match(css, /body\.side-panel-open \.side-panel \{\s*transform: none;/);
  assert.match(main, /else if \(key === 'P'\) toggleSidePanel\(\);[\s\S]{0,120}else if \(key === 'S'\) toggleAnalysisDock\(\{ focus: false \}\);/);
  assert.match(main, /window\.matchMedia\('\(max-width: 600px\)'\)/);
  // Ctrl+F reveals a hidden panel before focusing its filter; inert fields take no focus.
  const findUi = readFileSync(new URL('../src/web/find-replace-ui.js', import.meta.url), 'utf8');
  assert.match(findUi, /export function openFind\(\) \{\s*if \(!sidePanelVisible\(\)\) setSidePanelVisible\(true\);\s*filterEl\.focus\(\);/);
});

test('the panel filter finds label text and Ctrl+H opens replace beside it', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  const main = editorSource();
  const filter = html.slice(html.indexOf('class="panel-filter"'), html.indexOf('data-panel="components"'));
  for (const id of ['panel-replace-toggle', 'panel-replace-input', 'panel-replace-case', 'panel-replace-all', 'text-matches-list']) {
    assert.match(filter, new RegExp(`id="${id}"`));
  }
  assert.match(filter, /id="panel-replace"[^>]*hidden/);
  assert.match(main, /ev\.key\.toLowerCase\(\) === 'h' && !inlineInput\) \{[\s\S]{0,160}openReplace\(\);/);
  assert.match(main, /renderTextMatches\(\);\s*renderComponents\(\);/);
  // A replace goes through the core, previewed first, as one undo step.
  assert.match(main, /replaceInLabels\(circuit, find, replacement, \{ \.\.\.options, dryRun: true \}\)/);
  assert.match(main, /commit\(\(\) => \{ result = replaceInLabels\(circuit, find, replacement, options\); \}\);/);
  // One Escape anywhere in the find area ends a replace: both fields clear.
  assert.match(main, /if \(ev\.key !== 'Escape' \|\| !replaceOpen\(\)\) return;[\s\S]{0,80}endFindReplace\(\);\s*\}, \{ capture: true \}\);/);
  assert.match(main, /function endFindReplace\(\) \{\s*replaceEl\.value = '';[\s\S]{0,200}filterEl\.value = '';/);
});

test('Design check runs from its panel section and an always-visible status chip', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  const main = editorSource();
  const toolbar = html.slice(html.indexOf('<header class="toolbar">'), html.indexOf('</header>'));
  assert.doesNotMatch(toolbar, /id="btn-check"/);
  const section = html.slice(html.indexOf('id="check-summary"'), html.indexOf('id="check-summary-body"'));
  assert.match(section, /id="btn-check"[^>]*data-action="check"/);
  assert.match(section, /id="btn-clear-check"[^>]*hidden/);
  assert.doesNotMatch(html, /id="status-check"[^>]*hidden/);
  // The chip runs a check when there is no report and opens it otherwise.
  assert.match(main, /statusCheckEl\?\.addEventListener\('click', \(\) => \{\s*if \(lastCheckReport\) focusCheckSummary\(\);\s*else runCheck\(\);/);
  assert.match(main, /function focusCheckSummary\(\) \{\s*if \(!sidePanelVisible\(\)\) setSidePanelVisible\(true\);/);
});

test('pin handles scale with the drawing within a screen-size band', async () => {
  const { pinHandleRadius } = await import('../src/web/gestures.js');
  // Mid zoom: the world radius (6 units) wins.
  assert.equal(pinHandleRadius(1.5), 6);
  // Zoomed in (0.5 units/px): capped at 4.5 px on screen.
  assert.equal(pinHandleRadius(0.5) / 0.5, 4.5);
  // Zoomed far out (6 units/px): kept at 2 px so it stays visible.
  assert.equal(pinHandleRadius(6) / 6, 2);
  assert.equal(pinHandleRadius(0), 4.5);
});

test('radial tiles on the ring are separated by the same gap', () => {
  for (const count of [3, 5, 7, 8]) {
    const radius = radialRingRadius(count, 64, 10);
    const chord = 2 * radius * Math.sin(Math.PI / count);
    assert.ok(chord - 64 >= 10 && chord - 64 < 12, `count ${count}: gap ${chord - 64}`);
  }
  assert.equal(radialRingRadius(1, 64, 10), 0);
});
