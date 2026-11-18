import assert from 'node:assert/strict';
import { test } from 'node:test';
import plates from './plates.js';

test('loads the heaviest plates first', () => {
  assert.deepEqual(plates(100), { side: [25, 15], total: 100 });
  assert.deepEqual(plates(62.5), { side: [20, 1.25], total: 62.5 });
});

test('the bar alone, or less, needs no plates', () => {
  assert.deepEqual(plates(20), { side: [], total: 20 });
  assert.deepEqual(plates(10), { side: [], total: 20 });
});

test('a weight that cannot be made gives the nearest one below it', () => {
  assert.deepEqual(plates(61), { side: [20], total: 60 });
});

test('a lighter bar changes the plates', () => {
  assert.deepEqual(plates(60, 15), { side: [20, 2.5], total: 60 });
});

test('only uses the plates the gym has', () => {
  assert.deepEqual(plates(100, 20, [20, 15, 10, 5, 2.5, 1.25]), { side: [20, 20], total: 100 });
  assert.deepEqual(plates(100, 20, [10, 5]), { side: [10, 10, 10, 10], total: 100 });
});

test('finds a fit that heaviest-first would miss', () => {
  assert.deepEqual(plates(100, 20, [25, 20]), { side: [20, 20], total: 100 });
});

test('with no plates, just the bar', () => {
  assert.deepEqual(plates(100, 20, []), { side: [], total: 20 });
});

test('the picked plate is the biggest used, smaller ones fill the gap', () => {
  const upTo = (top) => [25, 20, 15, 10, 5, 2.5, 1.25].filter((p) => p <= top);
  assert.deepEqual(plates(100, 20, upTo(25)).side, [25, 15]);
  assert.deepEqual(plates(100, 20, upTo(20)).side, [20, 20]);
  assert.deepEqual(plates(100, 20, upTo(15)).side, [15, 15, 10]);
  assert.deepEqual(plates(100, 20, upTo(10)).side, [10, 10, 10, 10]);
});
