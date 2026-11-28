import { test } from 'node:test';
import assert from 'node:assert/strict';
import { e1rm, stepKg, suggest } from './progression.js';

const set = (weightKg, reps, extra = {}) => ({ weightKg, reps, rir: null, type: null, ...extra });

test('every set hit its reps: one step up from the heaviest', () => {
  assert.deepEqual(suggest([set(80, 8), set(80, 8), set(80, 8)], null, 2.5), {
    kg: 82.5,
    up: true,
  });
});

test('a set short of the reps, or all-out, stays at the same weight', () => {
  assert.deepEqual(suggest([set(80, 8), set(80, 6)], null, 2.5), { kg: 80, up: false });
  assert.deepEqual(suggest([set(80, 8, { rir: 0 })], null, 2.5), { kg: 80, up: false });
  assert.deepEqual(suggest([set(80, 8, { type: 'failure' })], null, 2.5), { kg: 80, up: false });
});

test("a routine's target reps decide, and warm-ups don't count", () => {
  const sets = [set(40, 10, { type: 'warmup' }), set(80, 8), set(80, 8)];
  assert.deepEqual(suggest(sets, 10, 2.5), { kg: 80, up: false }, 'short of the 10 aimed for');
  assert.deepEqual(suggest(sets, 8, 2.5), { kg: 82.5, up: true });
});

test('nothing to go on, or no weight to add: no suggestion', () => {
  assert.equal(suggest([], null, 2.5), null);
  assert.equal(suggest([set(40, 10, { type: 'warmup' })], null, 2.5), null);
  assert.equal(suggest([set(0, 12)], null, stepKg('body only', 'kg')), null);
});

test('steps: 2 kg dumbbells, 2.5 kg otherwise, 5 lb in lb', () => {
  assert.equal(stepKg('dumbbell', 'kg'), 2);
  assert.equal(stepKg('barbell', 'kg'), 2.5);
  assert.equal(Math.round(stepKg('barbell', 'lb') * 1000) / 1000, 2.268);
});

test('one-rep max estimate', () => {
  assert.equal(e1rm(100, 5), 100 * (1 + 5 / 30));
  assert.ok(e1rm(100, 5) > e1rm(100, 4), 'one more rep at the same weight is a PR');
});
