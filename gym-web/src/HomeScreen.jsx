import { useEffect, useState } from 'react';
import { getWorkouts } from './api';
import CaloriesCard from './CaloriesCard';
import ConfirmDialog from './ConfirmDialog';
import ErrorMsg from './ErrorMsg';
import MuscleCard from './MuscleCard';
import { drop, useRefused, useWaiting } from './outbox';
import { duration, shortDate } from './week';
import WeekCard from './WeekCard';
import WorkoutCard from './WorkoutCard';
import WorkoutDetail from './WorkoutDetail';
import WorkoutScreen from './WorkoutScreen';

// The member's home screen: this week, the last workout, and every workout before it
export default function HomeScreen({ token, showCalories, showWorkout, onOpenCalories, plus }) {
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

  if (view === 'active')
    return <WorkoutScreen token={token} start onDone={() => setView('home')} />;
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
        <>
          <WeekCard workouts={workouts} />
          <div className="dash">
            {showWorkout && (
              <WorkoutCard
                token={token}
                last={workouts[0]}
                onStart={() => setView('active')}
                onOpen={setView}
              />
            )}
            {showCalories && <CaloriesCard token={token} onOpen={onOpenCalories} />}
            <MuscleCard token={token} />
            {workouts.length > 0 && (
              <section className="card" aria-labelledby="history-title">
                <h2 id="history-title" className="eyebrow">
                  History
                </h2>
                <div className="list">
                  {workouts.map((w) => (
                    <button className="row" type="button" key={w.id} onClick={() => setView(w.id)}>
                      <span className="row-text">
                        {w.name}
                        <span className="row-sub">{shortDate(w.date)}</span>
                      </span>
                      <span className="row-end">
                        {[
                          `${w.sets} ${w.sets === 1 ? 'set' : 'sets'}`,
                          w.durationSec && duration(w.durationSec),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        </>
      )}
    </main>
  );
}
