import { useEffect, useState } from 'react';
import { getWorkout } from './api';

const sets = (n) => `${n} ${n === 1 ? 'set' : 'sets'}`;

// "Today at 5:30 PM", or "Tue 17 Nov at 5:30 PM" for another day
function when(ms) {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const day =
    d.toDateString() === new Date().toDateString()
      ? 'Today'
      : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day} at ${time}`;
}

// The dashboard's Workout card: the workout in progress if there is one, else the last one logged.
// shortcut: shows a planned workout once planning exists (Feature Plan section 8)
export default function WorkoutCard({ token, draft, lastWorkout, onStart }) {
  const [last, setLast] = useState(null); // the last workout with its exercises
  // When the card appeared; elapsed time is counted from here (it remounts on each visit)
  const [now] = useState(() => Date.now());

  const lastId = lastWorkout?.id;
  useEffect(() => {
    if (draft || !lastId) return;
    // The card still shows the name and date without the exercise list, so a failure is fine
    getWorkout(token, lastId)
      .then(setLast)
      .catch(() => {});
  }, [token, draft, lastId]);

  let card;
  if (draft) {
    const exercises = draft.exercises.map((e) => ({
      name: e.name,
      done: e.sets.filter((s) => s.done).length,
      total: e.sets.length,
    }));
    const done = exercises.reduce((n, e) => n + e.done, 0);
    const total = exercises.reduce((n, e) => n + e.total, 0);
    card = {
      title: draft.name.trim() || 'Workout',
      sub: 'In progress',
      stats: [
        [exercises.length, 'Exercises'],
        [`${done} / ${total}`, 'Sets done'],
      ],
      progress: total ? done / total : 0,
      rows: exercises.map((e) => [e.name, `${e.done} of ${sets(e.total)}`]),
      whenLabel: 'Started',
      whenText: `${when(draft.startedAt)} · ${Math.round((now - draft.startedAt) / 60000)} min`,
      action: 'Resume workout',
    };
  } else if (lastWorkout) {
    // Only use the details once they belong to this workout, not one shown earlier
    const detail = last?.id === lastWorkout.id ? last : null;
    card = {
      title: lastWorkout.name,
      sub: 'Your last workout',
      stats: [
        [detail ? detail.exercises.length : '–', 'Exercises'],
        [lastWorkout.sets, 'Sets'],
      ],
      rows: detail?.exercises.map((e) => [e.name, sets(e.sets.length)]) ?? [],
      whenLabel: 'Last trained',
      whenText: [
        when(new Date(lastWorkout.date).getTime()),
        lastWorkout.durationSec && `${Math.round(lastWorkout.durationSec / 60)} min`,
      ]
        .filter(Boolean)
        .join(' · '),
      action: 'Start workout',
    };
  } else {
    // No workouts yet, or the list couldn't load (e.g. no signal)
    card = {
      title: 'Ready to train',
      sub: 'Start a workout and it will show here',
      stats: [],
      rows: [],
      action: 'Start workout',
    };
  }

  return (
    <section className="card workout-card" aria-labelledby="workout-card-title">
      <h2 id="workout-card-title" className="workout-card-label">
        Workout
      </h2>
      <div className="workout-card-head">
        <div>
          <p className="workout-card-title">{card.title}</p>
          <p className="workout-card-sub">{card.sub}</p>
        </div>
        {card.stats.length > 0 && (
          <dl className="workout-card-stats">
            {card.stats.map(([value, label]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {card.progress !== undefined && (
        <div
          className="workout-card-bar"
          role="progressbar"
          aria-label="Sets done"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(card.progress * 100)}
        >
          <div style={{ width: `${card.progress * 100}%` }} />
        </div>
      )}

      {card.rows.length > 0 && (
        <ul className="workout-card-list">
          {card.rows.map(([name, value], i) => (
            <li key={i}>
              <span>{name}</span>
              <span className="workout-card-value">{value}</span>
            </li>
          ))}
        </ul>
      )}

      {card.whenLabel && (
        <div className="workout-card-when">
          <span className="workout-card-clock" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          </span>
          <span>
            <span className="workout-card-sub">{card.whenLabel}</span>
            <strong>{card.whenText}</strong>
          </span>
        </div>
      )}

      <button className="outline-btn workout-card-action" type="button" onClick={onStart}>
        {card.action} <span aria-hidden="true">→</span>
      </button>
    </section>
  );
}
