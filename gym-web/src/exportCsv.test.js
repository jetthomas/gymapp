import { test } from 'node:test';
import assert from 'node:assert/strict';
import toCsv from './exportCsv.js';

const empty = { workouts: [], food: [], bodyWeights: [] };
const lines = (data) => toCsv({ ...empty, ...data }).split('\r\n');

test('a header, then a row per set, food and weigh-in, oldest first', () => {
  const out = lines({
    // Midday UTC, so the local date is the same in any timezone within ±11 h
    workouts: [
      {
        name: 'Push day',
        date: '2026-11-20T12:00:00Z',
        exercises: [
          {
            name: 'Bench press',
            sets: [
              { weightKg: 80, reps: 8, rir: 2, side: null },
              { weightKg: 80, reps: 7, rir: null, side: null },
            ],
          },
        ],
      },
    ],
    food: [
      {
        date: '2026-11-19',
        meal: 'breakfast',
        name: 'Oats',
        kcal: 420,
        proteinG: 18,
        carbsG: 62,
        fatG: 10,
      },
    ],
    bodyWeights: [{ date: '2026-11-21', kg: 80.5 }],
  });
  assert.equal(out.length, 5);
  assert.match(
    out[0],
    /^Type,Date,Workout,Exercise,Set,Side,Weight \(kg\),Reps,RIR,Meal,Food,kcal,/,
  );
  assert.equal(out[1], 'Food,2026-11-19,,,,,,,,Breakfast,Oats,420,18,62,10,');
  assert.equal(out[2], 'Set,2026-11-20,Push day,Bench press,1,,80,8,2,,,,,,,');
  assert.equal(out[3], 'Set,2026-11-20,Push day,Bench press,2,,80,7,,,,,,,,');
  assert.equal(out[4], 'Weigh-in,2026-11-21,,,,,,,,,,,,,,80.5');
});

test('quotes commas and quotes, and stops text being read as a formula', () => {
  const food = (name) => ({
    date: '2026-11-19',
    meal: 'lunch',
    name,
    kcal: 1,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
  });
  const [, comma, quote, formula] = lines({
    food: [food('Rice, beans'), food('5" sub'), food('=HYPERLINK("x")')],
  });
  assert.match(comma, /,"Rice, beans",/);
  assert.match(quote, /,"5"" sub",/);
  assert.match(formula, /,"'=HYPERLINK\(""x""\)",/);
});
