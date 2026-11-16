// One { label, value } per day for the last `days` days (oldest first), with 0 for days the API left out
export default function perDay(rows, kind, days, today = new Date()) {
  const counts = new Map(rows.filter((r) => r.kind === kind).map((r) => [r.day, r.n]));
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (days - 1 - i));
    const key = d.toLocaleDateString('en-CA'); // YYYY-MM-DD in the browser's time zone
    return {
      label: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
      value: counts.get(key) ?? 0,
    };
  });
}
