import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRID, snap, snapPoint, onGrid, cell, floorGrid, ceilGrid } from '../src/core/grid.js';

test('GRID is 40', () => {
  assert.equal(GRID, 40);
});

test('snap snaps to nearest grid multiple', () => {
  assert.equal(snap(0), 0);
  assert.equal(snap(40), 40);
  assert.equal(snap(79), 80);
  assert.equal(snap(81), 80);
  assert.equal(snap(39), 40);
  assert.equal(snap(-39), -40);
  assert.equal(snap(-41), -40);
  assert.equal(snap(20), 40);
  assert.equal(snap(19), 0);
});

test('snapPoint returns {x,y} snapped', () => {
  assert.deepEqual(snapPoint(23, 97), { x: 40, y: 80 });
  assert.deepEqual(snapPoint(0, 0), { x: 0, y: 0 });
  assert.deepEqual(snapPoint(-30, -30), { x: -40, y: -40 });
});

test('onGrid is true for multiples, false otherwise', () => {
  assert.equal(onGrid(0), true);
  assert.equal(onGrid(40), true);
  assert.equal(onGrid(120), true);
  assert.equal(onGrid(-80), true);
  assert.equal(onGrid(30), false);
  assert.equal(onGrid(20), false);
  assert.equal(onGrid(-10), false);
});

test('onGrid tolerates floating point eps', () => {
  assert.equal(onGrid(40.0000000001), true);
  assert.equal(onGrid(40.0001, 1e-3), true);
  assert.equal(onGrid(40.0001), false);
});

test('cell gives grid index', () => {
  assert.equal(cell(0), 0);
  assert.equal(cell(40), 1);
  assert.equal(cell(80), 2);
  assert.equal(cell(-40), -1);
  assert.equal(cell(19), 0);
  assert.equal(cell(21), 1);
});

test('floorGrid rounds down, ceilGrid rounds up', () => {
  assert.equal(floorGrid(0), 0);
  assert.equal(floorGrid(39), 0);
  assert.equal(floorGrid(40), 40);
  assert.equal(floorGrid(79), 40);
  assert.equal(ceilGrid(0), 0);
  assert.equal(ceilGrid(1), 40);
  assert.equal(ceilGrid(40), 40);
  assert.equal(ceilGrid(41), 80);
  assert.equal(floorGrid(-20), -40);
  assert.ok(onGrid(ceilGrid(-20)));

  // -40 is a grid multiple (covers -0 edge cases)
  assert.ok(Number.isInteger(floorGrid(-40) / GRID));
  assert.ok(Number.isInteger(ceilGrid(-40) / GRID));
});
