import { useEffect, useState } from 'react';
import { getWorkoutDays, getWorkouts } from './api';
import CaloriesCard from './CaloriesCard';
import ConfirmDialog from './ConfirmDialog';
import ErrorMsg from './ErrorMsg';
import MuscleCard from './MuscleCard';
import { drop, useRefused, useWaiting } from './outbox';
import { dayKey, duration, shortDate } from './week';
import WeekCard from './WeekCard';
import WorkoutCalendar from './WorkoutCalendar';
import WorkoutCard from './WorkoutCard';
import WorkoutDetail from './WorkoutDetail';
import WorkoutScreen from './WorkoutScreen';

// The member's home screen: this week, the last workout, and every workout before it
export default function HomeScreen({ token, showCalories, showWorkout, onOpenCalories, plus }) {
  const [view, setView] = useState('home'); // 'home', 'active', or the id of a workout to show
  const [workouts, setWorkouts] = useState(null); // History, a page of 200 at a time; null = still loading
  const [more, setMore] = useState(false); // there may be older workouts than History shows
  const [days, setDays] = useState(null); // when every workout started, for the streak
  const [editing, setEditing] = useState(null); // a saved workout open for editing
  const [repeat, setRepeat] = useState(null); // a new workout laid out by "Do this again"
  const [error, setError] = useState('');
  const waiting = useWaiting(token);
  const refused = useRefused(token);
  const [discarding, setDiscarding] = useState(false);
  const [calendar, setCalendar] = useState(false); // History as a month calendar instead of a list
  const [picked, setPicked] = useState(null); // the day tapped on the calendar, YYYY-MM-DD

  // Reloads when the member comes back to this screen and when a waiting workout uploads
  useEffect(() => {
    if (view !== 'home') return;
    getWorkouts(token)
      .then((list) => {
        setWorkouts(list);
        setMore(list.length === 200);
        setError('');
      })
      .catch((err) => setError(err.message));
    // Every workout, not just History's first page; if it fails (an API not updated yet) that page will do
    getWorkoutDays(token)
      .then(setDays)
      .catch(() => setDays(null));
  }, [token, view, waiting]);

  async function showOlder() {
    try {
      const page = await getWorkouts(token, workouts.length);
      // Merged by id: a workout saved meanwhile shifts the pages, which would repeat one
      setWorkouts((list) => [...list, ...page.filter((p) => !list.some((w) => w.id === p.id))]);
      setMore(page.length === 200);
    } catch (err) {
      setError(err.message);
    }
  }

  // History's rows: every workout loaded, or on the calendar only the day picked
  const shown =
    workouts && calendar ? workouts.filter((w) => dayKey(new Date(w.date)) === picked) : workouts;

  if (editing) {
    return (
      <WorkoutScreen token={token} plus={plus} saved={editing} onDone={() => setEditing(null)} />
    );
  }
  if (view === 'active') {
    return (
      <WorkoutScreen
        token={token}
        plus={plus}
        start={repeat ?? true}
        onDone={() => {
          setRepeat(null);
          setView('home');
        }}
      />
    );
  }
  if (view !== 'home') {
    return (
      <WorkoutDetail
        token={token}
        plus={plus}
        id={view}
        onBack={() => setView('home')}
        onEdit={setEditing}
        onRepeat={(draft) => {
          setRepeat(draft);
          setView('active');
        }}
      />
    );
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
          <WeekCard dates={days ?? workouts.map((w) => w.date)} />
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
                <div className="section-head split-head">
                  <h2 id="history-title" className="eyebrow">
                    History
                  </h2>
                  <button
                    className={calendar ? 'pill-btn filled' : 'pill-btn'}
                    type="button"
                    aria-pressed={calendar}
                    onClick={() => setCalendar(!calendar)}
                  >
                    Calendar
                  </button>
                </div>
                {calendar && (
                  <WorkoutCalendar
                    dates={days ?? workouts.map((w) => w.date)}
                    picked={picked}
                    onPick={setPicked}
                  />
                )}
                {calendar && picked && shown.length === 0 && (
                  <p className="hint">
                    That day is further back than History has loaded. Tap Show older workouts.
                  </p>
                )}
                <div className="list">
                  {shown.map((w) => (
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
                {more && (
                  <button className="link-btn" type="button" onClick={showOlder}>
                    Show older workouts
                  </button>
                )}
              </section>
            )}
          </div>
        </>
      )}
    </main>
  );
}
