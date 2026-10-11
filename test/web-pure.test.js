/** The editor's pure helpers: what they compute, without a page. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { allToolCursors, toolCursorValue } from '../src/web/tool-cursor.js';
import { paddedLineBounds } from '../src/web/label-measure.js';
import { captureNetGeometry, translateNetGeometry } from '../src/web/net-geometry.js';
import { ICON_PATHS } from '../src/web/icon-paths.js';

const decode = (value) => decodeURIComponent(value.match(/url\("data:image\/svg\+xml,([^"]+)"\)/)[1]);

test('tool cursors badge the select arrow per tool, theme, and danger', () => {
  const plain = toolCursorValue(null);
  assert.match(plain, /\) 2 1, default$/); // the hotspot stays on the arrow tip
  const trash = ICON_PATHS.trash;
  assert.ok(!decode(plain).includes(trash));
  const badged = decode(toolCursorValue('trash'));
  // The glyph is drawn twice: a halo pass under the ink pass keeps it legible.
  assert.equal(badged.split(trash).length - 1, 2);
  assert.ok(!badged.includes('#c33b2e'));
  assert.ok(decode(toolCursorValue('trash', { danger: true })).includes('#c33b2e'));
  assert.notEqual(toolCursorValue('trash'), toolCursorValue('trash', { dark: true }));
  assert.equal(toolCursorValue('trash'), toolCursorValue('trash')); // cached per icon/theme
});

test('every tool cursor can be fetched up front, so a keyboard tool change paints one', () => {
  const all = new Set(allToolCursors());
  for (const dark of [false, true]) {
    for (const icon of [null, 'wire', 'wire-diagonal', 'trash', 'move', 'copy']) assert.ok(all.has(toolCursorValue(icon, { dark })), `${icon} ${dark}`);
    assert.ok(all.has(toolCursorValue('trash', { dark, danger: true })));
  }
});

test('a math label measures the same at every zoom', () => {
  for (const scale of [0.08, 0.5, 1, 2]) {
    const rect = { left: 100 * scale, top: 200 * scale, right: 400 * scale, bottom: 291 * scale, width: 300 * scale, height: 91 * scale };
    const box = paddedLineBounds([rect], { left: 6, top: 6, right: 6, bottom: 6 }, { x: scale, y: scale });
    // Back in world units (the SVG's own scale), the box is one size.
    assert.ok(Math.abs(box.width / scale - 312) < 1e-9);
    assert.ok(Math.abs(box.height / scale - 103) < 1e-9);
    assert.ok(Math.abs((box.top + box.height / 2) / scale - 245.5) < 1e-9);
  }
});

test('a multiline label measures its lines, not the width it was given', () => {
  for (const scale of [0.08, 0.590074019, 1, 2]) {
    const line = (width, top) => ({ left: 100 * scale, right: (100 + width) * scale, top: top * scale, bottom: (top + 36) * scale, width: width * scale, height: 36 * scale });
    const box = paddedLineBounds([line(209, 200), line(155, 248), line(124, 296), { width: 0, height: 0 }], { left: 6, top: 6, right: 6, bottom: 6 }, { x: scale, y: scale });
    assert.ok(Math.abs(box.width / scale - 221) < 1e-9);
    assert.ok(Math.abs(box.height / scale - 144) < 1e-9);
    assert.ok(Math.abs(box.left / scale - 94) < 1e-9);
  }
  assert.equal(paddedLineBounds([{ width: 0, height: 10 }], { left: 0, top: 0, right: 0, bottom: 0 }, { x: 1, y: 1 }), null);
});

test('a dragged net\'s snapshot puts its segment styles back with its route', () => {
  const net = {
    route: [{ x: 0, y: 0 }, { x: 0, y: 400 }],
    branches: [[{ x: 0, y: 0 }, { x: 0, y: 400 }]],
    junctions: [],
    wireStyles: { '0:1': { color: '#111', arrowhead: 'end' } },
  };
  const saved = captureNetGeometry(net);
  net.route = [{ x: 0, y: 0 }, { x: 0, y: 120 }, { x: 160, y: 120 }, { x: 160, y: 400 }];
  net.branches = [net.route];
  net.wireStyles = { '0:1': { arrowhead: 'none' }, '0:2': { arrowhead: 'none' }, '0:3': { arrowhead: 'end' } };
  translateNetGeometry(net, saved, 0, 0);
  assert.deepEqual(net.wireStyles, saved.wireStyles);
  assert.deepEqual(net.route, saved.route);
  // Moved, every point goes with it; the snapshot itself is untouched.
  translateNetGeometry(net, saved, 40, -80);
  assert.deepEqual(net.route, [{ x: 40, y: -80 }, { x: 40, y: 320 }]);
  assert.deepEqual(saved.route, [{ x: 0, y: 0 }, { x: 0, y: 400 }]);
});
