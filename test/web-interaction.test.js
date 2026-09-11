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

test('desktop preload exposes a close command through IPC', async () => {
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
  assert.deepEqual(calls, [{ channel: 'window:close', args: [] }]);
});

test('editor shell exposes keyboard canvas and live status surfaces', () => {
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="canvas"[^>]+tabindex="0"[^>]+role="application"/);
  assert.match(html, /id="status"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(html, /id="accessibility-announcement"[^>]+aria-live="polite"/);
});

test('schematic and block pointer paths share snapped cursor conversion', () => {
  for (const documentKind of ['circuit', 'block']) {
    assert.deepEqual(worldAndCursorFromClient(50, 70, rect, view), {
      world: { x: 80, y: 120 }, cursor: { x: 80, y: 120 },
    }, documentKind);
  }
});
