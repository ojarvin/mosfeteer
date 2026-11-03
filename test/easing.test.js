import test from 'node:test';
import assert from 'node:assert/strict';
import { EASE_OUT, cssEase, cubicBezier, easeIn, easeInOut, easeOut, easeSpring } from '../src/web/easing.js';

test('each curve starts at 0, ends at 1, and clamps outside', () => {
  for (const ease of [easeOut, easeIn, easeInOut, easeSpring]) {
    assert.equal(ease(0), 0);
    assert.equal(ease(1), 1);
    assert.equal(ease(-1), 0);
    assert.equal(ease(2), 1);
  }
});

test('out is quick then soft, in its mirror, in-out halfway at half, spring past the end', () => {
  assert.ok(easeOut(0.2) > 0.6, `out is most of the way early: ${easeOut(0.2)}`);
  assert.ok(easeIn(0.2) < 0.05, `in barely moves early: ${easeIn(0.2)}`);
  assert.ok(Math.abs(easeInOut(0.5) - 0.5) < 1e-4);
  const peak = Math.max(...Array.from({ length: 101 }, (_, i) => easeSpring(i / 100)));
  assert.ok(peak > 1 && peak < 1.15, `spring overshoots a little: ${peak}`);
});

test('a curve is the CSS cubic-bezier: linear control points give linear progress', () => {
  const linear = cubicBezier([1 / 3, 1 / 3, 2 / 3, 2 / 3]);
  for (const t of [0.1, 0.37, 0.5, 0.9]) assert.ok(Math.abs(linear(t) - t) < 1e-6);
  assert.equal(cssEase(EASE_OUT), 'cubic-bezier(0.16, 1, 0.3, 1)');
});

test('an out curve is monotone: the view never steps back as it settles', () => {
  let last = 0;
  for (let i = 1; i <= 200; i++) {
    const y = easeOut(i / 200);
    assert.ok(y >= last - 1e-9, `at ${i / 200}`);
    last = y;
  }
});
