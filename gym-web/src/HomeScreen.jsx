import { useEffect, useState } from 'react';
import { getWorkouts } from './api';
import CaloriesCard from './CaloriesCard';
import ConfirmDialog from './ConfirmDialog';
import ErrorMsg from './ErrorMsg';
import { drop, useRefused, useWaiting } from './outbox';
import WeekCard from './WeekCard';
import WorkoutCard from './WorkoutCard';
import WorkoutDetail from './WorkoutDetail';
import WorkoutScreen from './WorkoutScreen';

// The member's home screen: this week, the last workout, and every workout before it
export default function HomeScreen({ token, showCalories, onOpenCalories, plus }) {
  const [view, setView] = useState('home'); // 'home', 'active', or the id of a workout to show
  const [workouts, setWorkouts] = useState(null); // null = still loading
  const [error, setError] = useState('');
  const waiting = useWaiting(token);
  const refused = useRefused(token);
  const [discarding, setDiscarding] = useState(false);

  // Reloads when the member comes back to this screen and when a waiting workout uploads
  useEffect(() => {
    if (view !== 'home') return;
    getWorkouts(token)
      .then((list) => {
        setWorkouts(list);
        setError('');
      })
      .catch((err) => setError(err.message));
  }, [token, view, waiting]);

  if (view === 'active') return <WorkoutScreen token={token} onDone={() => setView('home')} />;
  if (view !== 'home') {
    return <WorkoutDetail token={token} plus={plus} id={view} onBack={() => setView('home')} />;
  }

  return (
    <main className="admin-content">
      <div className="page-head">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1 className="page-title today-title">Today</h1>
        </div>
        <p className="row-sub">
          {new Date().toLocaleDateString(undefined, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </p>
      </div>
      {waiting > 0 && (
        <p className="hint" role="status">
          {waiting} {waiting === 1 ? 'workout is' : 'workouts are'} saved on this device and will
          upload when you're back online.
        </p>
      )}
      <ErrorMsg>{refused && `A workout couldn't be saved: ${refused}`}</ErrorMsg>
      {refused && (
        <button className="link-btn danger" type="button" onClick={() => setDiscarding(true)}>
          Discard it
        </button>
      )}
      {discarding && (
        <ConfirmDialog
          title="Discard this workout?"
          body="The server refused it, so it can't be saved. Discarding deletes it from this phone."
          confirmLabel="Discard"
          danger
          onConfirm={() => {
            drop(token);
            setDiscarding(false);
          }}
          onCancel={() => setDiscarding(false)}
        />
      )}
      <ErrorMsg>{error}</ErrorMsg>
      {workouts === null && !error && <p className="msg">Loading…</p>}

      {workouts && (
        <div className="dash">
          <WeekCard workouts={workouts} />
          {showCalories && <CaloriesCard token={token} onOpen={onOpenCalories} />}
          <WorkoutCard
            token={token}
            last={workouts[0]}
            onStart={() => setView('active')}
            onOpen={setView}
          />
        </div>
      )}

      {workouts?.length > 0 && (
        <section aria-labelledby="history-title">
          <h2 id="history-title" className="section-title">
            History
          </h2>
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
        </section>
      )}
    </main>
  );
}
