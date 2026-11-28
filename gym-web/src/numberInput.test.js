import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decimal } from './numberInput.js';

// What the box would hold after typing `typed`, or null when the keystroke is refused
const typed = (value) => {
  let kept = null;
  decimal((v) => (kept = v))({ target: { value } });
  return kept;
};

test('takes a comma from a European keypad as a decimal point', () => {
  assert.equal(typed('62,5'), '62.5');
  assert.equal(typed('62.5'), '62.5');
  assert.equal(typed(''), '');
  assert.equal(typed('62.5.1'), null, 'two decimal marks');
  assert.equal(typed('6,2,5'), null, 'two commas');
  assert.equal(typed('-5'), null, 'a minus sign');
});
