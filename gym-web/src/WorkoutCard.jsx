import { useEffect, useState } from 'react';
import { getWorkout } from './api';
import { loadDraft } from './Draft';
import { Play } from './icons';
import { userIdOf } from './outbox';
import { duration, shortDate } from './week';

// The last workout and what was in it; a workout planner would show today's plan here instead
export default function WorkoutCard({ token, last, onStart, onOpen }) {
  const [detail, setDetail] = useState(null);
  const id = last?.id;

  useEffect(() => {
    if (!id) return;
    // Without this the card still shows the name and set count
    getWorkout(token, id)
      .then(setDetail)
      .catch(() => {});
  }, [token, id]);

  // Ignores the exercises of a workout that's no longer the last one
  const exercises = id && detail?.id === id ? detail.exercises : null;

  return (
    <section className="card" aria-labelledby="workout-title">
      <h2 id="workout-title" className="eyebrow">
        Workout
      </h2>
      {!last && <p className="hint">No workouts yet. Start your first one.</p>}
      {last && (
        <>
          <div className="card-top">
            <div>
              <p className="headline">{last.name}</p>
              <p className="row-sub">
                {[
                  'Last workout',
                  shortDate(last.date),
                  last.durationSec && duration(last.durationSec),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <dl className="card-stats">
              {exercises && (
                <div>
                  <dt>Exercises</dt>
                  <dd>{exercises.length}</dd>
                </div>
              )}
              <div>
                <dt>Sets</dt>
                <dd>{last.sets}</dd>
              </div>
            </dl>
          </div>
          {exercises?.length > 0 && (
            <ul className="list card-rows">
              {exercises.map((e, i) => (
                <li key={i}>
                  {e.name}
                  <span className="row-sub">
                    {e.sets.length} {e.sets.length === 1 ? 'set' : 'sets'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <div className="card-actions">
        {last && (
          <button className="outline-btn" type="button" onClick={() => onOpen(last.id)}>
            View workout
          </button>
        )}
        <button className="pill-btn filled" type="button" onClick={onStart}>
          <Play size={16} />
          {loadDraft(userIdOf(token)) ? 'Resume workout' : 'Start workout'}
        </button>
      </div>
    </section>
  );
}
