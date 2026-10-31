/** Pictures follow the theme: with the setting on, a picture on a light
 *  background is inverted in the dark theme; a dark one is left alone. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { start, browserSkip } from './harness.js';
import { Circuit } from '../../src/core/model.js';

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let c = 0xffffffff;
  for (const byte of body) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE((c ^ 0xffffffff) >>> 0, 8 + data.length);
  return out;
}
/** A 16×16 PNG of `paper` with a square of `ink` in the middle. */
function png(paper, ink) {
  const size = 16;
  const rows = [];
  for (let y = 0; y < size; y++) {
    rows.push(0);
    for (let x = 0; x < size; x++) rows.push(...(x > 4 && x < 11 && y > 4 && y < 11 ? ink : paper));
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 2;
  const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

function pictures() {
  const circuit = new Circuit();
  circuit.addAnnotation('box', { x: 0, y: 0, end: { x: 400, y: 400 }, image: { src: png([255, 255, 255], [0, 0, 0]), aspect: 1 } });
  circuit.addAnnotation('box', { x: 600, y: 0, end: { x: 1000, y: 400 }, image: { src: png([20, 20, 30], [255, 200, 0]), aspect: 1 } });
  return circuit.toJSON();
}

describe('pictures follow the theme', { skip: browserSkip() }, () => {
  let h;
  before(async () => {
    h = await start({ docs: { pictures: pictures() }, width: 1400, height: 900 });
    await h.open('pictures');
  });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const filters = () => h.evaluate(`[...document.querySelectorAll('image.image-annotation')].map((el) => getComputedStyle(el).filter)`);

  test('only the light picture is marked, and inverted only in the dark theme with the setting on', async () => {
    await h.until(`document.querySelectorAll('image.image-annotation').length === 2`);
    await h.until(`document.querySelectorAll('image.light-picture').length === 1`);
    assert.equal(await h.evaluate(`document.querySelector('image.light-picture') === document.querySelector('image.image-annotation')`), true);
    assert.deepEqual(await filters(), ['none', 'none']);
    assert.equal(await h.evaluate(`document.getElementById('btn-invert-pictures').getAttribute('aria-checked')`), 'false');
    await h.evaluate(`document.getElementById('btn-invert-pictures').click()`);
    assert.equal(await h.evaluate(`document.getElementById('btn-invert-pictures').getAttribute('aria-checked')`), 'true');
    // Light theme: shown as pasted.
    const dark = () => h.evaluate(`document.documentElement.classList.contains('dark')`);
    if (await dark()) await h.key('D', { shiftKey: true });
    await h.until(`!document.documentElement.classList.contains('dark')`);
    assert.deepEqual(await filters(), ['none', 'none']);
    await h.key('D', { shiftKey: true });
    await h.until(`document.documentElement.classList.contains('dark')`);
    const [light, darkPicture] = await filters();
    assert.match(light, /invert\(0\.91\)/);
    assert.equal(darkPicture, 'none');
  });

  test('a redrawn drawing keeps the mark', async () => {
    await h.evaluate(`window.__run('add resistor R1 --at 1200 0')`);
    await h.until(`JSON.stringify(window.__circuit()).includes('"R1"')`);
    assert.equal(await h.evaluate(`document.querySelectorAll('image.light-picture').length`), 1);
  });
});
