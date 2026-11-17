import { useEffect, useState } from 'react';
import { getWorkouts } from './api';
import { loadDraft } from './Draft';
import ErrorMsg from './ErrorMsg';
import WorkoutDetail from './WorkoutDetail';
import WorkoutScreen from './WorkoutScreen';
import MuscleMap from './musclemap';

// The member's home screen: start or resume a workout, and look back at old ones
export default function HomeScreen({ token }) {
  const [view, setView] = useState('home'); // 'home', 'active', or the id of a workout to show
  const [workouts, setWorkouts] = useState(null); // null = still loading
  const [error, setError] = useState('');

  // Reloads whenever the member comes back to this screen, so a just-finished workout shows up
  useEffect(() => {
    if (view !== 'home') return;
    getWorkouts(token)
      .then(setWorkouts)
      .catch((err) => setError(err.message));
  }, [token, view]);

  if (view === 'active') return <WorkoutScreen token={token} onDone={() => setView('home')} />;
  if (view !== 'home') {
    return <WorkoutDetail token={token} id={view} onBack={() => setView('home')} />;
  }

  return (
    <main className="admin-content">
      <div className="page-head">
        <h1 className="page-title">Dashboard</h1>
        <button className="pill-btn filled" type="button" onClick={() => setView('active')}>
          {loadDraft() ? 'Resume workout' : 'Start workout'}
        </button>
      </div>

      <MuscleMap token={token} />

      <section aria-labelledby="history-title">
        <h2 id="history-title" className="section-title">
          History
        </h2>
        <ErrorMsg>{error}</ErrorMsg>
        {workouts === null && !error && <p className="msg">Loading workouts…</p>}
        {workouts?.length === 0 && <p className="msg">No workouts yet. Start your first one.</p>}
        {workouts?.length > 0 && (
          <div className="group exercise-list">
            {workouts.map((w) => (
              <button className="row" type="button" key={w.id} onClick={() => setView(w.id)}>
                <span className="row-text">
                  {w.name}
                  <span className="row-sub">
                    {[
                      new Date(w.date).toLocaleDateString(undefined, {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                      }),
                      `${w.sets} ${w.sets === 1 ? 'set' : 'sets'}`,
                      w.durationSec && `${Math.round(w.durationSec / 60)} min`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
