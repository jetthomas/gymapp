import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  importId,
  matchExercises,
  parseCsv,
  parseDate,
  parseDuration,
  readWorkouts,
  workoutBody,
} from './importCsv.js';

const TITLE_CASE = [
  'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE',
  '2026-05-11 18:30:00,Upper A,1h 5m,Bench Press (Barbell),W,60,10,,,,Felt strong,',
  '2026-05-11 18:30:00,Upper A,1h 5m,Bench Press (Barbell),1,"82,5",8,,,,Felt strong,8',
  '2026-05-11 18:30:00,Upper A,1h 5m,Plank,1,0,0,,60,,Felt strong,',
  '2026-05-11 18:30:00,Upper A,1h 5m,Pull Up,1,,12,,,,Felt strong,',
  '2026-05-09 07:00:00,Legs,45m,Squat (Barbell),1,100,5,,,,,9.5',
].join('\n');

const SNAKE_CASE = [
  'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_lbs,reps,distance_miles,duration_seconds,rpe',
  'Push,"15 Jan 2026, 08:30","15 Jan 2026, 09:40",,Bench Press (Barbell),0,,0,warmup,95,10,,,',
  'Push,"15 Jan 2026, 08:30","15 Jan 2026, 09:40",,Bench Press (Barbell),0,,1,normal,185,8,,,',
  'Push,"15 Jan 2026, 08:30","15 Jan 2026, 09:40",,Bicep Curl (Dumbbell),0,,0,dropset,30,12,,,',
  'Push,"15 Jan 2026, 08:30","15 Jan 2026, 09:40",,Lateral Raise (Dumbbell),,,0,failure,20,15,,,',
].join('\r\n');

test('CSV cells: quotes, doubled quotes, line breaks inside quotes, semicolons', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\n'), [
    ['a', 'b'],
    ['x, y', 'say "hi"'],
  ]);
  assert.deepEqual(parseCsv('a;b\n"two\nlines";2,5'), [
    ['a', 'b'],
    ['two\nlines', '2,5'],
  ]);
  assert.deepEqual(parseCsv('﻿a\n\n'), [['a']]);
});

test('dates and lengths in the forms exports use', () => {
  assert.equal(parseDate('2026-05-11 18:30:00'), new Date(2026, 4, 11, 18, 30).getTime());
  assert.equal(parseDate('2026-05-11T18:30'), new Date(2026, 4, 11, 18, 30).getTime());
  assert.equal(parseDate('15 Jan 2026, 08:30'), new Date(2026, 0, 15, 8, 30).getTime());
  assert.equal(parseDate('2026-05-11T18:30:00Z'), Date.UTC(2026, 4, 11, 18, 30));
  assert.ok(Number.isNaN(parseDate('soon')));
  assert.equal(parseDuration('1h 5m'), 3900);
  assert.equal(parseDuration('45m'), 2700);
  assert.equal(parseDuration('01:02:00'), 3720);
  assert.equal(parseDuration(''), null);
});

test('a Title Case file: workouts by date and name, set types from Set Order, RPE as RIR', () => {
  const { workouts, unit, skipped } = readWorkouts(TITLE_CASE);
  assert.equal(unit, null, 'its weights have no unit, so the member is asked');
  assert.equal(skipped, 1, 'the plank has no reps');
  assert.deepEqual(
    workouts.map((w) => w.name),
    ['Legs', 'Upper A'],
    'oldest first',
  );
  const upper = workouts[1];
  assert.equal(upper.durationSec, 3900);
  assert.equal(upper.notes, 'Felt strong');
  assert.deepEqual(
    upper.exercises.map((e) => e.name),
    ['Bench Press (Barbell)', 'Pull Up'],
  );
  assert.deepEqual(upper.exercises[0].sets, [
    { weight: 60, reps: 10, type: 'warmup', rir: null },
    { weight: 82.5, reps: 8, type: null, rir: 2 },
  ]);
  assert.equal(upper.exercises[1].sets[0].weight, 0, 'a blank weight is bodyweight');
  assert.equal(workouts[0].exercises[0].sets[0].rir, 1, 'RPE 9.5 rounds to RIR 1');
});

test('a snake_case file: the unit from its weight column, set types and supersets', () => {
  const { workouts, unit } = readWorkouts(SNAKE_CASE);
  assert.equal(unit, 'lb');
  assert.equal(workouts.length, 1);
  const [push] = workouts;
  assert.equal(push.start, new Date(2026, 0, 15, 8, 30).getTime());
  assert.equal(push.durationSec, 70 * 60);
  assert.deepEqual(
    push.exercises.map((e) => [e.name, e.superset, e.sets.map((s) => s.type)]),
    [
      ['Bench Press (Barbell)', '0', ['warmup', null]],
      ['Bicep Curl (Dumbbell)', '0', ['drop']],
      ['Lateral Raise (Dumbbell)', '', ['failure']],
    ],
  );
});

test('a file with other columns is refused with a reason', () => {
  assert.throws(() => readWorkouts('Name,Calories\nOats,300'), /can't read this file/);
  assert.throws(
    () => readWorkouts('Date,Exercise Name,Reps\nlast tuesday,Squat,5'),
    /date on row 2/,
  );
});

test('names match the library exercise with the same words and the fewest others', () => {
  const library = [
    { id: 1, name: 'Barbell Bench Press - Medium Grip' },
    { id: 2, name: 'Barbell Incline Bench Press - Medium Grip' },
    { id: 3, name: 'Barbell Squat' },
    { id: 4, name: 'Barbell Full Squat' },
    { id: 5, name: 'Dumbbell Bicep Curl' },
  ];
  const found = matchExercises(
    ['Bench Press (Barbell)', 'Squat (Barbell)', 'Bicep Curls (Dumbbell)', 'Pull Up'],
    library,
  );
  assert.equal(found.get('Bench Press (Barbell)').id, 1);
  assert.equal(found.get('Squat (Barbell)').id, 3);
  assert.equal(found.get('Bicep Curls (Dumbbell)').id, 5, 'plurals match');
  assert.equal(found.get('Pull Up'), null);
});

test('a workout body: kg from the file unit, skipped exercises out, supersets kept', () => {
  const [push] = readWorkouts(SNAKE_CASE).workouts;
  const ids = new Map([
    ['Bench Press (Barbell)', 1],
    ['Bicep Curl (Dumbbell)', 5],
  ]);
  const body = workoutBody(push, 'lb', ids);
  assert.equal(body.name, 'Push');
  assert.equal(body.durationSec, 4200);
  assert.deepEqual(
    body.exercises.map((e) => [e.exerciseId, e.supersetWithNext, e.sets.length]),
    [
      [1, true, 2],
      [5, false, 1],
    ],
    'Lateral Raise was skipped; bench and curl share superset 0',
  );
  assert.equal(body.exercises[0].sets[1].weightKg, 83.915, '185 lb');
  assert.equal(workoutBody(push, 'lb', new Map()), null, 'nothing left to save');
});

test('an imported workout gets the same clientId every time, shaped like a UUID', async () => {
  const w = { start: 1, name: 'Push' };
  const id = await importId(w);
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(await importId({ ...w }), id);
  assert.notEqual(await importId({ ...w, name: 'Pull' }), id);
});
