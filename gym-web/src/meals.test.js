import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mealName } from './meals.js';

const foods = (...names) => names.map((name) => ({ name }));

test('a saved meal is named after its foods', () => {
  assert.equal(mealName(foods('Oats')), 'Oats');
  assert.equal(mealName(foods('Oats', 'Banana', 'Milk')), 'Oats, Banana, Milk');
});

test('the name stops at the last food that fits in 100 characters', () => {
  const long = 'x'.repeat(95);
  assert.equal(mealName(foods(long, 'Eggs', 'Toast')), long);
  assert.equal(mealName(foods('Oats', long)), 'Oats');
});
