import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, duration, shortDate, streak, weekDays, workoutDays } from './week.js';

test('a workout under half a minute says so instead of "0 min"', () => {
  assert.equal(duration(20), 'under 1 min');
  assert.equal(duration(30), '1 min');
  assert.equal(duration(3720), '62 min');
});

// When a workout at 6 pm on day `d` of November 2026 started, as /me/workout-days sends it
const at = (d) => new Date(2026, 10, d, 18).toISOString();
const today = new Date(2026, 10, 18, 9); // Wednesday 18 November, 9 am

test('the week runs Monday to Sunday', () => {
  assert.deepEqual(
    weekDays(today).map((d) => d.getDate()),
    [16, 17, 18, 19, 20, 21, 22],
  );
  // A Sunday belongs to the week that started the Monday before
  assert.equal(weekDays(new Date(2026, 10, 22))[0].getDate(), 16);
});

test('counts the days in a row up to today', () => {
  assert.equal(streak(workoutDays([at(16), at(17), at(18)]), today), 3);
});

test('today with nothing logged yet does not break the run', () => {
  assert.equal(streak(workoutDays([at(16), at(17)]), today), 2);
});

test('a missed day ends the run', () => {
  assert.equal(streak(workoutDays([at(14), at(15), at(17)]), today), 1);
  assert.equal(streak(workoutDays([]), today), 0);
});

test('two workouts on one day count once', () => {
  assert.equal(streak(workoutDays([at(17), at(17)]), today), 1);
});

test('days move across months and daylight saving', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-11-19', -29), '2026-10-21');
  // Sydney's clocks went forward on 4 October 2026
  assert.equal(addDays('2026-10-03', 2), '2026-10-05');
});

test('a date from another year shows its year; this year it goes without', () => {
  const year = String(new Date().getFullYear());
  assert.match(shortDate('2020-03-01T12:00:00'), /2020/);
  assert.doesNotMatch(shortDate(new Date().toISOString()), new RegExp(year));
});
