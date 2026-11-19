import { addDays } from './week.js';

// One { label, value } per day from `from` to `to` (YYYY-MM-DD, both included), with 0 for days the API left out
export default function perDay(rows, kind, from, to) {
  const counts = new Map(rows.filter((r) => r.kind === kind).map((r) => [r.day, r.n]));
  const out = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    out.push({
      label: new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
      }),
      value: counts.get(day) ?? 0,
    });
  }
  return out;
}
