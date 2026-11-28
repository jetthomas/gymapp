import { test } from 'node:test';
import assert from 'node:assert/strict';
import toCsv from './exportCsv.js';

const empty = { workouts: [], food: [], bodyWeights: [] };
const lines = (data) => toCsv({ ...empty, ...data }).split('\r\n');

test('a section each for workouts, calories and body weight, with their own headings', () => {
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
              { weightKg: 80, reps: 8, rir: 2, side: null, type: 'warmup' },
              { weightKg: 80, reps: 7, rir: null, side: null, type: null },
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
  assert.deepEqual(out, [
    'Workouts',
    'Date,Workout,Exercise,Set,Set type,Side,Weight (kg),Reps,RIR',
    '2026-11-20,Push day,Bench press,1,Warm-up,,80,8,2',
    '2026-11-20,Push day,Bench press,2,,,80,7,',
    '',
    'Calories',
    'Date,Meal,Food,kcal,Protein (g),Carbs (g),Fat (g)',
    '2026-11-19,Breakfast,Oats,420,18,62,10',
    '',
    'Body weight',
    'Date,Weight (kg)',
    '2026-11-21,80.5',
  ]);
  // Nothing logged still gives every section its headings
  assert.equal(lines({}).length, 8);
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
  const out = lines({
    food: [food('Rice, beans'), food('5" sub'), food('=HYPERLINK("x")')],
  });
  const [comma, quote, formula] = out.slice(out.indexOf('Calories') + 2);
  assert.match(comma, /,"Rice, beans",/);
  assert.match(quote, /,"5"" sub",/);
  assert.match(formula, /,"'=HYPERLINK\(""x""\)",/);
});
