// YYYY-MM-DD in the browser's time zone
export const dayKey = (d) => d.toLocaleDateString('en-CA');

// Monday to Sunday of the week `today` falls in, each at noon so a daylight-saving change can't shift the day
export function weekDays(today = new Date()) {
  const sinceMonday = (today.getDay() + 6) % 7; // getDay() is 0 on Sunday
  return Array.from(
    { length: 7 },
    (_, i) =>
      new Date(today.getFullYear(), today.getMonth(), today.getDate() - sinceMonday + i, 12),
  );
}

// The days (YYYY-MM-DD) with at least one workout
export const workoutDays = (workouts) => new Set(workouts.map((w) => dayKey(new Date(w.date))));

// Days in a row with a workout. Today only breaks the run once it's over, so the morning doesn't show 0.
// shortcut: sees only the newest 200 workouts the API sends; work it out on the server if streaks get that long
export function streak(days, today = new Date()) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(dayKey(d))) {
    n += 1;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
