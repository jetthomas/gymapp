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

// The days (YYYY-MM-DD) with at least one workout, from when each one started
export const workoutDays = (dates) => new Set(dates.map((d) => dayKey(new Date(d))));

// A date as text, with the year only when it isn't this one: "Tue, 24 Nov", "Sun, 2 Jan 2028"
export function dateText(date, options) {
  const d = new Date(date);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? options : { ...options, year: 'numeric' });
}

// "Tue, 24 Nov": a workout's day in History and on the dashboard's Workout card
export const shortDate = (date) =>
  dateText(date, { weekday: 'short', day: 'numeric', month: 'short' });

// A workout's length. Under half a minute would round to "0 min"
export const duration = (sec) => (sec < 30 ? 'under 1 min' : `${Math.round(sec / 60)} min`);

// Days in a row with a workout. Today only breaks the run once it's over, so the morning doesn't show 0
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

// A month as a calendar shows it: its days at noon in rows of 7, Monday first, with null in the
// gaps before the 1st and after the last day. `month` is any day in it
export function monthDays(month) {
  const y = month.getFullYear();
  const m = month.getMonth();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7; // getDay() is 0 on Sunday
  const count = new Date(y, m + 1, 0).getDate(); // day 0 of next month = this month's last day
  const days = [
    ...Array(lead).fill(null),
    ...Array.from({ length: count }, (_, i) => new Date(y, m, i + 1, 12)),
  ];
  while (days.length % 7) days.push(null);
  return days;
}
