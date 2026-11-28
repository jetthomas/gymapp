import { useEffect, useState } from 'react';
import { getWorkout } from './api';
import ErrorMsg from './ErrorMsg';
import { ChevronLeft } from './icons';
import PlusLock from './PlusLock';
import ProgressChart from './ProgressChart';
import { duration } from './week';

// One finished workout: its totals, then every set
export default function WorkoutDetail({ token, plus, id, onBack }) {
  const [workout, setWorkout] = useState(null);
  const [error, setError] = useState('');
  const [charting, setCharting] = useState(null); // the exercise whose progress is showing

  useEffect(() => {
    getWorkout(token, id)
      .then(setWorkout)
      .catch((err) => setError(err.message));
  }, [token, id]);

  // Total weight moved: weight × reps over every set
  const volume = workout?.exercises
    .flatMap((e) => e.sets)
    .reduce((sum, s) => sum + s.weightKg * s.reps, 0);

  return (
    <main className="admin-content">
      <button className="ghost-btn back-btn" type="button" onClick={onBack}>
        <ChevronLeft size={18} /> Back
      </button>
      <ErrorMsg>{error}</ErrorMsg>
      {!workout && !error && <p className="msg">Loading workout…</p>}
      {workout && (
        <>
          <div className="page-head">
            <div>
              <p className="eyebrow">
                {new Date(workout.date).toLocaleDateString(undefined, {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
              </p>
              <h1 className="page-title">{workout.name}</h1>
            </div>
          </div>
          <dl className="stat-grid">
            {[
              ['Duration', workout.durationSec ? duration(workout.durationSec) : '–'],
              ['Sets', workout.sets],
              ['Volume', `${Math.round(volume).toLocaleString()} kg`],
            ].map(([label, value]) => (
              <div key={label} className="stat">
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="account-cards">
            {workout.exercises.map((e, i) => (
              <section className="card" key={i}>
                <div className="section-head">
                  <h2 className="card-title">{e.name}</h2>
                  <button
                    className="pill-btn"
                    type="button"
                    aria-expanded={charting === i}
                    onClick={() => setCharting(charting === i ? null : i)}
                  >
                    Progress
                  </button>
                </div>
                {charting === i &&
                  (plus ? (
                    <ProgressChart token={token} exerciseId={e.exerciseId} />
                  ) : (
                    <PlusLock token={token} feature="Progress charts" />
                  ))}
                <ol className="set-list">
                  {e.sets.map((s, j) => (
                    <li key={j}>
                      {s.side && `${s.side} · `}
                      {s.weightKg} kg × {s.reps}
                      {s.rir != null && <span className="row-sub"> · RIR {s.rir}</span>}
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
