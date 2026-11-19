import { test } from 'node:test';
import assert from 'node:assert/strict';
import perDay from './perDay.js';

test('fills missing days with 0 and keeps the order', () => {
  const rows = [
    { day: '2026-11-10', kind: 'login', n: 4 },
    { day: '2026-11-10', kind: 'workout', n: 9 },
  ];
  const out = perDay(rows, 'login', '2026-11-09', '2026-11-11');
  assert.deepEqual(
    out.map((d) => d.value),
    [0, 4, 0],
  );
});

test('one day, and a month boundary', () => {
  assert.equal(perDay([], 'login', '2026-11-19', '2026-11-19').length, 1);
  assert.equal(perDay([], 'login', '2026-10-30', '2026-11-02').length, 4);
});
