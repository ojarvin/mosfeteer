import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pngDataUrlBlob, writeDrawingToClipboard } from '../src/web/clipboard.js';
import { withEmbeddedMathFont } from '../src/web/drawing-export.js';

const pngUrl = 'data:image/png;base64,iVBORw0KGgo=';
class ClipboardItemStub {
  constructor(types) { this.types = types; }
}

test('image clipboard starts its write synchronously with promised PNG and SVG text', async () => {
  let payload;
  let prepared = false;
  let finishPreparation;
  const pending = new Promise((resolve) => { finishPreparation = resolve; });
  const write = writeDrawingToClipboard('<svg/>', {
    ClipboardItem: ClipboardItemStub,
    clipboard: { write(items) { payload = items[0]; return Promise.all(Object.values(payload.types)); } },
    embedFont: async (svg) => { prepared = true; await pending; return svg.replace('/>', '><style>font</style></svg>'); },
    rasterize: async (svg, scale) => {
      assert.match(svg, /<style>font/);
      assert.equal(scale, 4);
      return pngUrl;
    },
  });
  assert.ok(payload, 'write must begin before any async preparation');
  assert.equal(prepared, false);
  assert.deepEqual(Object.keys(payload.types), ['image/png', 'text/plain']);
  finishPreparation();
  await write;
  const png = await payload.types['image/png'];
  assert.equal(png.type, 'image/png');
  assert.equal(png.size, 8);
  assert.deepEqual([...new Uint8Array(await png.arrayBuffer())], [137, 80, 78, 71, 13, 10, 26, 10]);
  const text = await payload.types['text/plain'];
  assert.equal(text.type, 'text/plain');
  assert.equal(await text.text(), '<svg><style>font</style></svg>');
});

test('unsupported browsers and rejected clipboard writes expose errors', async () => {
  assert.throws(() => writeDrawingToClipboard('<svg/>', { clipboard: {}, ClipboardItem: ClipboardItemStub }), /unavailable/);
  assert.throws(() => writeDrawingToClipboard('<svg/>', { clipboard: { write() {} }, ClipboardItem: null }), /unavailable/);
  await assert.rejects(writeDrawingToClipboard('<svg/>', {
    ClipboardItem: ClipboardItemStub,
    clipboard: { write: async () => { throw new Error('permission denied'); } },
    embedFont: async (svg) => svg,
    rasterize: async () => pngUrl,
  }), /permission denied/);
});

test('rasterization failures reach the write caller, including tainted canvases', async () => {
  await assert.rejects(writeDrawingToClipboard('<svg/>', {
    ClipboardItem: ClipboardItemStub,
    clipboard: { write: async ([item]) => { await item.types['image/png']; } },
    embedFont: async (svg) => svg,
    rasterize: async () => { throw new Error('tainted canvas'); },
  }), /tainted canvas/);
  assert.throws(() => pngDataUrlBlob('data:,'), /clipboard PNG/);
});

test('standalone drawings embed the math face only when MathML is present', async (t) => {
  let fetched = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    fetched++;
    assert.equal(url, 'fonts/latinmodern-math.woff2');
    return { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  });
  const ordinary = '<svg><text>R1</text></svg>';
  assert.equal(await withEmbeddedMathFont(ordinary), ordinary);
  assert.equal(fetched, 0);
  const math = '<svg><foreignObject class="schematic-math-label"><math/></foreignObject></svg>';
  assert.match(await withEmbeddedMathFont(math), /<svg><style>@font-face.*data:font\/woff2;base64,AQID/);
  assert.equal(fetched, 1);
  await withEmbeddedMathFont(math);
  assert.equal(fetched, 1, 'cache the face across exports and clipboard writes');
});
