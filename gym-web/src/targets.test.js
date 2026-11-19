import assert from 'node:assert/strict';
import { test } from 'node:test';
import targets, { age } from './targets.js';

const today = new Date(2026, 10, 17); // 17 Nov 2026
const member = {
  goal: 'maintain',
  birthDate: '1996-11-17',
  sex: 'male',
  heightCm: 180,
  weightKg: 80,
  activity: 3,
};

test('age counts whole years, and the birthday itself counts', () => {
  assert.equal(age('1996-11-17', today), 30);
  assert.equal(age('1996-11-18', today), 29);
});

test('works out calories and macros from the profile', () => {
  // resting = 800 + 1125 - 150 + 5 = 1780; x 1.55 = 2759 -> 2760
  assert.deepEqual(targets(member, today), { kcal: 2760, proteinG: 160, carbsG: 357, fatG: 77 });
});

test('the goal moves the calories', () => {
  assert.equal(targets({ ...member, goal: 'lose' }, today).kcal, 2260);
  assert.equal(targets({ ...member, goal: 'bulk' }, today).kcal, 3260);
});

test("the member's own target wins, even with nothing else filled in", () => {
  assert.equal(targets({ ...member, kcalTarget: 2000 }, today).kcal, 2000);
  assert.deepEqual(targets({ kcalTarget: 2000 }, today), {
    kcal: 2000,
    proteinG: 150,
    carbsG: 224,
    fatG: 56,
  });
});

test('not enough to go on gives null', () => {
  assert.equal(targets({ ...member, weightKg: null }, today), null);
});
