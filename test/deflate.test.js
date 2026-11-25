import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { deflateRaw, fromBase64, inflateRaw, packText, toBase64, unpackText } from '../src/core/deflate.js';

/** A deterministic pseudo-random source. */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

test('deflateRaw writes what zlib reads, and inflateRaw reads what zlib writes', () => {
  const next = random(7);
  const samples = [
    '', 'a', 'ab', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    JSON.stringify({ components: Array.from({ length: 400 }, (_, i) => ({ refdes: `M${i}`, x: i * 40, y: 0, mirror: false })) }, null, 1),
    Array.from({ length: 70000 }, () => String.fromCharCode(32 + Math.floor(next() * 95))).join(''),
    'ünïcödé φ₁ ∑ 😀 '.repeat(200),
  ];
  for (const text of samples) {
    const bytes = new TextEncoder().encode(text);
    assert.deepEqual(new Uint8Array(inflateRawSync(deflateRaw(bytes))), bytes);
    for (const level of [0, 1, 9]) assert.deepEqual(inflateRaw(new Uint8Array(deflateRawSync(bytes, { level }))), bytes);
    assert.equal(unpackText(packText(text)), text);
  }
});

test('base64 matches the standard encoding', () => {
  for (const text of ['', 'a', 'ab', 'abc', 'abcd', 'ÿ\u0000x']) {
    const bytes = new TextEncoder().encode(text);
    assert.equal(toBase64(bytes), Buffer.from(bytes).toString('base64'));
    assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
  }
});

test('broken compressed data throws rather than reads', () => {
  const packed = packText('the drawing as it was written '.repeat(50));
  assert.throws(() => unpackText(packed.slice(0, packed.length / 2)));
  assert.throws(() => unpackText('not base64!'));
});
