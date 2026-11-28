// YYYY-MM-DD in the browser's time zone
export const dayKey = (d) => d.toLocaleDateString('en-CA');

// A YYYY-MM-DD day moved by `n` days, at noon so a daylight-saving change can't land it on the wrong day
export function addDays(day, n) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

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

// "Tue, 24 Nov": a workout's day in History and on the dashboard's Workout card
export const shortDate = (date) =>
  new Date(date).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

// A workout's length. Under half a minute would round to "0 min"
export const duration = (sec) => (sec < 30 ? 'under 1 min' : `${Math.round(sec / 60)} min`);

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
