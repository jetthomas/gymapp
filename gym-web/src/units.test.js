import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromKg, setKg, toKg } from './units.js';

test('a weight typed in lb comes back as the same lb', () => {
  for (const lb of [45, 135, 137.5, 225, 2.5]) assert.equal(fromKg(toKg(lb, 'lb'), 'lb'), lb);
  assert.equal(toKg(100, 'lb'), 45.359);
});

test('kg pass straight through, shown to 0.01', () => {
  assert.equal(toKg(62.5, 'kg'), 62.5);
  assert.equal(fromKg(62.5, 'kg'), 62.5);
  assert.equal(fromKg(61.235, 'kg'), 61.24, 'a set logged in lb');
});

test('an untouched weight keeps its exact kg, a changed one is converted', () => {
  assert.equal(setKg({ weight: '176.4', kg: 80 }, 'lb'), 80, 'viewed in lb, not changed');
  assert.equal(setKg({ weight: '61.24', kg: 61.235 }, 'kg'), 61.235, 'lb set viewed in kg');
  assert.equal(setKg({ weight: '180', kg: 80 }, 'lb'), 81.647, 'changed');
  assert.equal(setKg({ weight: '82.5' }, 'kg'), 82.5, 'typed, no kg');
});
