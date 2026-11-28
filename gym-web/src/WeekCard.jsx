import { Check, Flame } from './icons';
import { dayKey, streak, weekDays, workoutDays } from './week';

const short = { day: 'numeric', month: 'short' };

// This week with a tick on each day trained, and how many days in a row beside it.
// `dates` is when each workout started, every one the member has logged
export default function WeekCard({ dates }) {
  const trained = workoutDays(dates);
  const week = weekDays();
  const today = dayKey(new Date());
  const inARow = streak(trained);

  return (
    <section aria-labelledby="week-title">
      <div className="week-head">
        <div>
          <h2 id="week-title" className="eyebrow">
            Your week
          </h2>
          <p className="row-sub">
            {week[0].toLocaleDateString(undefined, short)} –{' '}
            {week[6].toLocaleDateString(undefined, { ...short, year: 'numeric' })}
          </p>
        </div>
        <div className="streak">
          <span className="streak-icon" aria-hidden="true">
            <Flame size={18} />
          </span>
          <div>
            <p className="streak-count">
              <strong>{inARow}</strong> {inARow === 1 ? 'day' : 'days'}
            </p>
            <p className="row-sub">Trained in a row</p>
          </div>
        </div>
      </div>
      <ol className="week-days">
        {week.map((d) => {
          const key = dayKey(d);
          const done = trained.has(key);
          return (
            <li
              key={key}
              className={key === today ? 'today' : undefined}
              aria-current={key === today ? 'date' : undefined}
            >
              <span className="week-name">
                {d.toLocaleDateString(undefined, { weekday: 'short' })}
              </span>
              <span className="week-date">{d.getDate()}</span>
              {/* Always there, so every tile is the same height */}
              <span className={`week-tick${done ? ' done' : ''}`} aria-hidden="true">
                {done && <Check size={12} />}
              </span>
              <span className="visually-hidden">{done ? 'trained' : 'no workout'}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
