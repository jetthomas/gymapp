import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextType, setLabel } from './setTypes.js';

const labels = (sets) => sets.map((_, j) => setLabel(sets, j));

test('warm-ups get a W and the working sets count from 1', () => {
  assert.deepEqual(labels([{ type: 'warmup' }, {}, {}, { type: 'drop' }]), ['W', '1', '2', 'D']);
});

test('both sides of a unilateral pair share a number', () => {
  const sets = [{ side: 'L' }, { side: 'R' }, { side: 'L' }, { side: 'R' }];
  assert.deepEqual(labels(sets), ['1L', '1R', '2L', '2R']);
});

test('one tap steps normal, warm-up, drop, failure, then back to normal', () => {
  assert.equal(nextType(undefined), 'warmup');
  assert.equal(nextType('warmup'), 'drop');
  assert.equal(nextType('drop'), 'failure');
  assert.equal(nextType('failure'), null);
});
