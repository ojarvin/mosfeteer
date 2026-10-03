import test from 'node:test';
import assert from 'node:assert/strict';
import { PER_DECADE, indexE24, stepE24 } from '../src/web/e-series.js';

test('the Bode sliders step through E24, 24 values a decade, both ways from 1', () => {
  assert.equal(PER_DECADE, 24);
  assert.deepEqual([0, 1, 2, 7, 23, 24, 25].map(stepE24), [1, 1.1, 1.2, 2, 9.1, 10, 11]);
  assert.deepEqual([-1, -24, -25, -48].map(stepE24), [0.91, 0.1, 0.091, 0.01]);
  assert.equal(stepE24(2 * PER_DECADE + 11), 300);
});

test('a value finds its nearest E24 step, so saved values land back on a notch', () => {
  for (let i = -72; i <= 96; i++) assert.equal(indexE24(stepE24(i)), i, `step ${i}`);
  // The 1-2-3 values of the old steps are in E24; a 5 snaps to the nearest, 5.1.
  for (const value of [1, 2, 3, 30, 200, 0.002]) assert.equal(stepE24(indexE24(value)), value);
  assert.equal(stepE24(indexE24(5)), 5.1);
  assert.equal(stepE24(indexE24(500)), 510);
  assert.equal(stepE24(indexE24(9.7)), 10);
  assert.equal(stepE24(indexE24(1.04)), 1);
});
