/** The Atlas desk and the net beams on the GPU (WebGL2): what is drawn, the
 *  match with the 2D canvas, and falling back when the GPU goes away. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, stillDesk, browserSkip } from './harness.js';
import { linkedTop, tagged, wideAmplifier } from './fixtures.js';
import { Circuit } from '../../src/core/model.js';
import { runCommand } from '../../src/core/commands.js';

const docs = () => ({ top: linkedTop(), child: tagged('C1'), amp: wideAmplifier(), other: tagged('T2') });

/** The screen's pixels in `rect`: the share of them unlike the paper, and each
 *  channel's mean; or `rgba` every one when `raw`. */
async function pixels(h, rect, raw = false) {
  const { data } = await h.send('Page.captureScreenshot', { format: 'png' });
  return h.evaluate(`(async () => {
    const image = new Image();
    image.src = 'data:image/png;base64,${data}';
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = ${Math.ceil(rect.w)};
    canvas.height = ${Math.ceil(rect.h)};
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--paper').trim();
    ctx.fillRect(0, 0, 1, 1);
    const paper = [...ctx.getImageData(0, 0, 1, 1).data];
    ctx.clearRect(0, 0, 1, 1);
    ctx.drawImage(image, ${-Math.floor(rect.x)}, ${-Math.floor(rect.y)});
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    ${raw ? 'return [...d];' : ''}
    let inked = 0;
    const sum = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - paper[0]) + Math.abs(d[i + 1] - paper[1]) + Math.abs(d[i + 2] - paper[2]) > 12) inked += 1;
      for (let c = 0; c < 3; c++) sum[c] += d[i + c];
    }
    const count = d.length / 4;
    return { ink: inked / count, mean: sum.map((s) => s / count) };
  })()`);
}

const snapshot = (h) => h.evaluate(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot())`);
const painted = (h) => h.evaluate(`(() => {
  const gpu = document.getElementById('atlas-desk-gpu');
  return { gpu: !!gpu && !gpu.hidden, canvas: !document.getElementById('atlas-desk').hidden };
})()`);

async function openDesk(h, count) {
  await h.open('amp');
  await h.click('#app-mark');
  await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !!s && !s.busy && s.tiles.length === ${count} && !s.baking; })`, 30000);
  await stillDesk(h);
}

async function pick(h, name) {
  const tiles = (await snapshot(h)).tiles.length;
  for (let i = 0; i <= tiles; i++) {
    if ((await snapshot(h)).tiles.find((t) => t.name === name).selected) break;
    await h.evaluate(`document.getElementById('atlas').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))`);
    await h.settle();
  }
  await h.until(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot().tiles.find((t) => t.name === '${name}').lift > 0.99)`, 10000);
  await stillDesk(h);
}

const tileRect = async (h, name) => (await snapshot(h)).tiles.find((t) => t.name === name).screen;

describe('the Atlas desk on the GPU', { skip: browserSkip() }, () => {
  let h;
  before(async () => {
    h = await start({ docs: docs(), gpu: true });
    await openDesk(h, 4);
  });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  test('draws every design, in place of the 2D canvas', async () => {
    assert.deepEqual(await painted(h), { gpu: true, canvas: false });
    for (const { screen } of (await snapshot(h)).tiles) assert.ok((await pixels(h, screen)).ink > 0.002, JSON.stringify(screen));
  });

  test('a pick casts its shadow and sends its beam', async () => {
    await pick(h, 'top');
    const s = await snapshot(h);
    const card = s.beams[0].card;
    const end = s.beams[0].end;
    const beside = await pixels(h, { x: card.x + card.w / 2 - 20, y: card.y + card.h + 8, w: 40, h: 8 });
    assert.ok(beside.ink > 0.5, `the shadow under the card: ${JSON.stringify(beside)}`);
    const landing = await pixels(h, { x: end.x - 12, y: end.y - 12, w: 24, h: 24 });
    assert.ok(landing.ink > 0.05, `the beam at its landing: ${JSON.stringify(landing)}`);
  });

  test('a lost context falls back to the 2D canvas, and a restored one returns', async () => {
    const rect = await tileRect(h, 'amp');
    await h.evaluate(`window.__lost = document.getElementById('atlas-desk-gpu').getContext('webgl2').getExtension('WEBGL_lose_context'); window.__lost.loseContext()`);
    await h.until(`!document.getElementById('atlas-desk').hidden`);
    await h.until(`${h.module('atlas.js')}.then((m) => !m.atlasSnapshot().baking)`, 15000);
    await stillDesk(h);
    assert.deepEqual(await painted(h), { gpu: false, canvas: true });
    assert.ok((await pixels(h, rect)).ink > 0.002, 'redrawn on the 2D canvas');
    await h.evaluate(`window.__lost.restoreContext()`);
    await h.until(`document.getElementById('atlas-desk').hidden`);
    await stillDesk(h);
    assert.deepEqual(await painted(h), { gpu: true, canvas: false });
    assert.ok((await pixels(h, rect)).ink > 0.002, 'redrawn on the GPU');
  });
});

describe('the two painters', { skip: browserSkip() }, () => {
  test('a software renderer stays on the 2D canvas, and looks the same as the GPU', async () => {
    const shots = [];
    const levels = [];
    for (const gpu of [false, true]) {
      const h = await start({ docs: docs(), gpu });
      try {
        await openDesk(h, 4);
        assert.deepEqual(await painted(h), { gpu, canvas: !gpu });
        await pick(h, 'top');
        // The bottom of a headless capture is not the page's.
        shots.push(await pixels(h, { x: 0, y: 44, w: 1400, h: 800 }, true));
        levels.push(Object.fromEntries((await snapshot(h)).tiles.map((t) => [t.name, t.image])));
        assert.deepEqual(h.exceptions(), []);
      } finally {
        await h.stop();
      }
    }
    let total = 0;
    for (let i = 0; i < shots[0].length; i += 4) total += Math.abs(shots[0][i] - shots[1][i]) + Math.abs(shots[0][i + 1] - shots[1][i + 1]) + Math.abs(shots[0][i + 2] - shots[1][i + 2]);
    assert.ok(total / (shots[0].length / 4) < 3, `mean difference ${total / (shots[0].length / 4)}`);
    // The GPU draws each design from a larger image: finer wherever there is a finer one.
    const order = ['small', 'medium', 'large'];
    for (const name of Object.keys(levels[0])) assert.ok(order.indexOf(levels[1][name]) >= order.indexOf(levels[0][name]), JSON.stringify(levels));
    assert.ok(Object.keys(levels[0]).some((name) => order.indexOf(levels[1][name]) > order.indexOf(levels[0][name])), JSON.stringify(levels));
  });
});

describe('the desk\'s effects, drawn directly', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: docs(), gpu: true }); await h.open('amp'); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  /** Runs `body` on a 200 by 200 desk with `desk`, `at(x, y)` (a pixel's RGBA, red only here), and `tile` (a black texture, its right half clear). */
  const scene = (body) => h.evaluate(`Promise.all([${h.module('gpu.js')}, ${h.module('atlas-paint-gpu.js')}]).then(async ([g, p]) => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 200, height: 200 });
    const gl = g.gpuContext(canvas, { alpha: false, preserveDrawingBuffer: true });
    const desk = p.createGpuDesk(canvas, gl);
    const begin = () => desk.begin({ w: 200, h: 200, dpr: 1, paper: '#fff' });
    const at = (x, y) => { const o = new Uint8Array(4); gl.readPixels(x, 199 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, o); return o[0]; };
    const source = Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
    source.getContext('2d').fillRect(0, 0, 128, 256);
    const half = await createImageBitmap(source, { premultiplyAlpha: 'premultiply' });
    begin();
    desk.ready('half', half);
    const solid = Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
    solid.getContext('2d').fillRect(0, 0, 256, 256);
    desk.ready('solid', await createImageBitmap(solid, { premultiplyAlpha: 'premultiply' }));
    ${body}
  })`);
  const spine = `Array.from({ length: 41 }, (_, i) => ({ x: 20 + i * 4, y: 100, nx: 0, ny: 1, half: 10 }))`;
  const beam = `{ spine: ${spine}, from: { x: 20, y: 100 }, to: { x: 180, y: 100 }, color: '#000', band: { stops: [0.5, 0.5, 0.5], mid: 0.5 }, core: { stops: [0, 0, 0], mid: 0.5 }, coreWidth: 1 }`;

  test('a design\'s ink comes up from its middle', async () => {
    const r = await scene(`const rect = { x: 0, y: 0, w: 200, h: 200 };
      begin(); desk.image('solid', rect, 1, { reveal: 0.4, seed: 0 }); const part = [at(100, 100), at(4, 4)];
      begin(); desk.image('solid', rect, 1, { reveal: 1 }); return [...part, at(4, 4)];`);
    assert.ok(r[0] < 10, `the middle is inked: ${r}`);
    assert.ok(r[1] > 245, `the corner is not yet: ${r}`);
    assert.ok(r[2] < 10, `at the end the corner is: ${r}`);
  });

  test('out of focus, an edge softens', async () => {
    const r = await scene(`const rect = { x: 0, y: 0, w: 100, h: 100 };
      begin(); desk.image('half', rect, 1, {}); const sharp = [at(47, 50), at(53, 50)];
      begin(); desk.image('half', rect, 1, { blur: 2.5 }); return [...sharp, at(47, 50), at(53, 50)];`);
    assert.ok(r[2] > r[0] + 20 && r[3] < r[1] - 20, `soft out of focus: ${r}`);
  });

  test('zoomed far out, a thin line keeps more ink than an average would leave it', async () => {
    const r = await scene(`const line = Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
      const c = line.getContext('2d'); c.fillRect(0, 100, 256, 2);
      desk.ready('line', await createImageBitmap(line, { premultiplyAlpha: 'premultiply' }));
      begin(); desk.image('line', { x: 0, y: 0, w: 32, h: 32 }, 1, {});
      return Math.min(...Array.from({ length: 8 }, (_, i) => at(16, 9 + i)));`);
    // A line 2 pixels in 256, averaged down to 32, would be at best a quarter ink.
    assert.ok(r < 195, `the darkest row: ${r}`);
  });

  test('a beam reaches only as far as it has grown, and its pulse is brighter', async () => {
    const r = await scene(`begin(); desk.beam({ ...${beam}, reach: 0.5 }); const grown = [at(50, 100), at(150, 100)];
      begin(); desk.beam(${beam}); const plain = at(100, 100);
      begin(); desk.beam({ ...${beam}, pulse: 0.5 }); return [...grown, plain, at(100, 100), at(160, 100)];`);
    assert.ok(r[0] < 200 && r[1] > 250, `cut where it has grown to: ${r}`);
    assert.ok(r[3] < r[2] - 30, `the pulse is brighter: ${r}`);
    assert.ok(Math.abs(r[4] - r[2]) < 6, `and only where it is: ${r}`);
  });

  test('the light on a rim is only where it has got to', async () => {
    const r = await scene(`begin(); desk.box({ rect: { x: 50, y: 50, w: 100, h: 100 }, stroke: '#000', strokeWidth: 3, sweep: { angle: -Math.PI / 2, width: 0.5 } });
      return [at(100, 50), at(100, 150)];`);
    assert.ok(r[0] < 60, `at the top: ${r}`);
    assert.ok(r[1] > 245, `not at the bottom: ${r}`);
  });
});

describe('the zoom box', { skip: browserSkip() }, () => {
  test('follows the pointer at once, with no repaint of the desk', async () => {
    const h = await start({ docs: docs(), gpu: true });
    try {
      await openDesk(h, 4);
      const before = (await snapshot(h)).view;
      await h.evaluate(`window.__clears = 0; (() => { const gl = document.getElementById('atlas-desk-gpu').getContext('webgl2'); const clear = gl.clear; gl.clear = function (...args) { window.__clears += 1; return clear.apply(this, args); }; })()`);
      await h.mouse('mouseMoved', 300, 300, { button: 'none', buttons: 0 });
      await h.settle();
      await h.evaluate(`window.__clears = 0`);
      await h.mouse('mousePressed', 300, 300, { button: 'right', buttons: 2, clickCount: 1 });
      for (const [x, y] of [[360, 340], [480, 420], [600, 520]]) {
        await h.mouse('mouseMoved', x, y, { button: 'right', buttons: 2 });
        const box = await h.evaluate(`(() => { const r = document.getElementById('atlas-zoom-box').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })()`);
        assert.deepEqual(box, [300, 300, x, y]);
      }
      assert.equal(await h.evaluate(`window.__clears`), 0, 'the desk was not repainted');
      await h.mouse('mouseReleased', 600, 520, { button: 'right', buttons: 0, clickCount: 1 });
      await h.until(`document.getElementById('atlas-zoom-box').getAttribute('display') === 'none'`);
      await stillDesk(h);
      assert.notDeepEqual((await snapshot(h)).view, before, 'and zooms to it');
      assert.deepEqual(h.exceptions(), []);
    } finally {
      await h.stop();
    }
  });
});

describe('the desk in motion', { skip: browserSkip() }, () => {
  test('a design flies off and back on the GPU, with every effect running', async () => {
    const h = await start({ docs: docs(), gpu: true });
    try {
      await h.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
      await openDesk(h, 4);
      await pick(h, 'top');
      await h.click('#app-mark');
      await h.until(`${h.module('atlas.js')}.then((m) => !m.atlasSnapshot())`, 15000);
      await h.click('#app-mark');
      await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !!s && !s.busy; })`, 15000);
      await stillDesk(h);
      assert.deepEqual(await painted(h), { gpu: true, canvas: false });
      assert.ok((await pixels(h, await tileRect(h, 'amp'))).ink > 0.002);
      assert.deepEqual(h.exceptions(), []);
    } finally {
      await h.stop();
    }
  });
});

function outs() {
  const circuit = new Circuit();
  for (const line of [
    'add resistor R1 --at 0 0', 'add resistor R2 --at 400 0', 'connect R1.b R2.a --name OUT',
    'add resistor R3 --at 0 800', 'add resistor R4 --at 400 800', 'connect R3.b R4.a --name OUT',
    'add resistor R7 --at 1200 0', 'add resistor R8 --at 1600 0', 'connect R7.b R8.a --name OTHER',
  ]) runCommand(circuit, line);
  return circuit.toJSON();
}

describe('net beams on the GPU', { skip: browserSkip() }, () => {
  let h;
  before(async () => {
    h = await start({ docs: { outs: outs() }, gpu: true, width: 1400, height: 900 });
    await h.open('outs');
    await h.evaluate(`document.getElementById('btn-net-beams').click()`);
  });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const hover = async (x, y) => {
    const p = await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.worldToClient(${x}, ${y}))`);
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
  };
  const count = () => `document.querySelector('.net-beams-gpu')?.dataset.beams`;
  // The middle of the beam from (200, 0) to the wire below, on screen now.
  const middle = () => h.evaluate(`Promise.all([${h.module('canvas-view.js')}, ${h.module('../core/net-beams.js')}]).then(([view, beams]) => {
    const shape = beams.beamShape({ x: 200, y: 0 }, { x: 200, y: 800 }, { narrow: 4, wide: 12 });
    const p = shape.spine[16];
    return view.worldToClient(p.x, p.y);
  })`);
  const around = (p) => ({ x: p.x - 3, y: p.y - 3, w: 6, h: 6 });

  test('a shader draws them, the SVG layer stays empty, and they leave with the pointer', async () => {
    await hover(200, 0);
    await h.until(`${count()} === '1'`);
    await h.settle();
    assert.equal(await h.evaluate(`document.querySelectorAll('.net-beams .net-beam').length`), 0);
    assert.ok((await pixels(h, around(await middle()))).ink > 0.5);
    await hover(800, 400);
    await h.until(`${count()} === '0'`);
    await h.settle();
    assert.equal((await pixels(h, around(await middle()))).ink < 0.5, true);
  });

  test('follow the view', async () => {
    await hover(200, 0);
    await h.until(`${count()} === '1'`);
    await h.evaluate(`${h.module('editor-state.js')}.then(async (m) => { m.editor.view = { ...m.editor.view, x: m.editor.view.x - 120 }; (await ${h.module('main.js')}).render(); })`);
    await h.settle();
    assert.ok((await pixels(h, around(await middle()))).ink > 0.5);
  });
});
