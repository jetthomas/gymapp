import { dayKey, streak, weekDays, workoutDays } from './week';

const short = { day: 'numeric', month: 'short' };

// This week with a tick on each day trained, and how many days in a row beside it
export default function WeekCard({ workouts }) {
  const trained = workoutDays(workouts);
  const week = weekDays();
  const today = dayKey(new Date());
  const inARow = streak(trained);

  return (
    <section className="card week-card" aria-labelledby="week-title">
      <div className="week">
        <h2 id="week-title" className="card-label">
          Your week
        </h2>
        <p className="row-sub">
          {week[0].toLocaleDateString(undefined, short)} –{' '}
          {week[6].toLocaleDateString(undefined, { ...short, year: 'numeric' })}
        </p>
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
                <span className={`week-tick${done ? ' done' : ''}`} aria-hidden="true">
                  {done && '✓'}
                </span>
                <span className="visually-hidden">{done ? 'trained' : 'no workout'}</span>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="streak">
        <span className="streak-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path
              d="M12 3c.5 3.5 5 5.5 5 10.5a5 5 0 0 1-10 0c0-2.4 1.2-4 2.5-5 .2 1.8 1 2.8 2 3.2-.6-2.8-.4-5.8.5-8.7Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <p className="streak-count">
          <strong>{inARow}</strong> {inARow === 1 ? 'day' : 'days'}
        </p>
        <p className="row-sub">Trained in a row</p>
      </div>
    </section>
  );
}
