import { test } from 'node:test';
import assert from 'node:assert/strict';
import perDay from './perDay.js';

test('fills missing days with 0 and keeps the order', () => {
  const rows = [
    { day: '2026-11-10', kind: 'login', n: 4 },
    { day: '2026-11-10', kind: 'workout', n: 9 },
  ];
  const out = perDay(rows, 'login', 3, new Date(2026, 10, 11));
  assert.deepEqual(
    out.map((d) => d.value),
    [0, 4, 0],
  );
});
