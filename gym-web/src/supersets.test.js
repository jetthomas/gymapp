import assert from 'node:assert/strict';
import { test } from 'node:test';
import { supersetIds, withoutExercise } from './supersets.js';

const list = (...links) => links.map((withNext, i) => ({ name: 'ABCDE'[i], withNext }));
const names = (l) => l.map((e) => `${e.name}${e.withNext ? '+' : ''}`).join(' ');

test('linked exercises share a superset number', () => {
  assert.deepEqual(supersetIds(list(true, false, false)), [0, 0, 2]);
  assert.deepEqual(supersetIds(list(true, true, false, true, false)), [0, 0, 0, 3, 3]);
  assert.deepEqual(supersetIds(list(false, false)), [0, 1]);
  assert.deepEqual(supersetIds([]), []);
});

test('removing an exercise keeps the rest of its superset together', () => {
  assert.equal(names(withoutExercise(list(true, true, false), 1)), 'A+ C');
  assert.equal(names(withoutExercise(list(true, false, false), 1)), 'A C');
  assert.equal(names(withoutExercise(list(true, false, false), 0)), 'B C');
  assert.equal(names(withoutExercise(list(false, true, false), 2)), 'A B');
});
