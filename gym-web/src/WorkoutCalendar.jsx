import { useState } from 'react';
import { ChevronLeft, ChevronRight } from './icons';
import { dayKey, monthDays, shortDate, weekDays, workoutDays } from './week';

// One month with every day trained filled in. Tapping a trained day picks it (`onPick` gets its
// YYYY-MM-DD, or null to unpick), and History under the calendar shows that day's workouts.
// `dates` is when each workout started, every one the member has logged
export default function WorkoutCalendar({ dates, picked, onPick }) {
  const [month, setMonth] = useState(() => new Date());
  const trained = workoutDays(dates);
  const days = monthDays(month);
  const today = dayKey(new Date());
  const thisMonth = new Date();
  const isThisMonth =
    month.getFullYear() === thisMonth.getFullYear() && month.getMonth() === thisMonth.getMonth();
  const count = days.filter((d) => d && trained.has(dayKey(d))).length;
  // The 15th, so stepping a month from the 31st can't skip one
  const step = (n) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 15));
  const weeks = Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7));

  return (
    <div className="calendar">
      <div className="calendar-head">
        <button
          className="outline-btn icon"
          type="button"
          aria-label="Previous month"
          onClick={() => step(-1)}
        >
          <ChevronLeft size={18} />
        </button>
        <p className="calendar-title" aria-live="polite">
          {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          <span className="row-sub">
            {count} {count === 1 ? 'day' : 'days'} trained
          </span>
        </p>
        <button
          className="outline-btn icon"
          type="button"
          aria-label="Next month"
          disabled={isThisMonth}
          onClick={() => step(1)}
        >
          <ChevronRight size={18} />
        </button>
      </div>
      <table className="calendar-grid">
        <thead>
          <tr>
            {weekDays().map((d) => (
              <th key={d.getDay()} scope="col">
                <abbr title={d.toLocaleDateString(undefined, { weekday: 'long' })}>
                  {d.toLocaleDateString(undefined, { weekday: 'narrow' })}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, i) => (
            <tr key={i}>
              {week.map((d, j) => {
                if (!d) return <td key={j} />;
                const key = dayKey(d);
                const isToday = key === today ? ' today' : '';
                return (
                  <td key={j}>
                    {trained.has(key) ? (
                      <button
                        className={`cal-day trained${isToday}`}
                        type="button"
                        aria-pressed={picked === key}
                        aria-label={`${shortDate(d)}, trained`}
                        onClick={() => onPick(picked === key ? null : key)}
                      >
                        {d.getDate()}
                      </button>
                    ) : (
                      <span className={`cal-day${isToday}`}>{d.getDate()}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
