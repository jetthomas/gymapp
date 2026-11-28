import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validSet } from './setLimits.js';

test('a set the API would accept can be ticked', () => {
  assert.ok(validSet({ weight: '62.5', reps: '8' }));
  assert.ok(validSet({ weight: '0', reps: '12' }), 'bodyweight');
  assert.ok(validSet({ weight: '1000', reps: '1000' }), 'the limits themselves');
});

test('a set the API would refuse cannot', () => {
  for (const [weight, reps, why] of [
    ['', '8', 'no weight'],
    ['.', '8', 'just a dot is NaN'],
    ['6255', '8', 'typo over 1000 kg'],
    ['60', '', 'no reps'],
    ['60', '0', 'zero reps'],
    ['60', '5000', 'over 1000 reps'],
  ]) {
    assert.ok(!validSet({ weight, reps }), why);
  }
});
