import { useEffect, useState } from 'react';
import { deleteRoutine, getRoutines } from './api';
import ConfirmDialog from './ConfirmDialog';
import { plannedDraft } from './Draft';
import ErrorMsg from './ErrorMsg';
import PlusLock from './PlusLock';
import RoutineEditor from './RoutineEditor';

// Free members keep this many routines; the API checks it too
const FREE_ROUTINES = 3;

// The Workout tab's routines, shown while no workout is running: start one in a tap, or make,
// change and delete them. Starting lays out a new workout and hands it to `onStart`
export default function RoutineList({ token, plus, onStart }) {
  const [routines, setRoutines] = useState(null); // null = still loading
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // null = the list; {} = a new one; a routine = edit it
  const [deleting, setDeleting] = useState(null); // the routine awaiting a yes
  const [starting, setStarting] = useState(null); // the id of the routine being laid out
  const [saved, setSaved] = useState(0); // goes up after each change, to load the list again

  useEffect(() => {
    getRoutines(token)
      .then((list) => {
        setRoutines(list);
        setError('');
      })
      .catch((err) => setError(err.message));
  }, [token, saved]);

  async function start(routine) {
    setStarting(routine.id);
    onStart(
      await plannedDraft(
        token,
        routine.name,
        routine.exercises.map((e) => ({
          id: e.exerciseId,
          name: e.name,
          equipment: e.equipment,
          reps: e.reps,
          sets: Array.from({ length: e.sets }, () => ({})),
        })),
      ),
    );
  }

  function done() {
    setEditing(null);
    setSaved((s) => s + 1);
  }

  async function remove() {
    const r = deleting;
    setDeleting(null);
    try {
      await deleteRoutine(token, r.id);
      done();
    } catch (err) {
      setError(err.message);
    }
  }

  if (editing) {
    return (
      <>
        <RoutineEditor
          token={token}
          routine={editing.id ? editing : null}
          onSaved={done}
          onDelete={() => setDeleting(editing)}
          onCancel={() => setEditing(null)}
        />
        {deleting && (
          <ConfirmDialog
            title={`Delete ${deleting.name}?`}
            body="The routine goes; workouts you did from it stay in your history."
            confirmLabel="Delete"
            danger
            onConfirm={remove}
            onCancel={() => setDeleting(null)}
          />
        )}
      </>
    );
  }

  const full = !plus && routines?.length >= FREE_ROUTINES;
  return (
    <section className="card" aria-labelledby="routines-title">
      <div className="section-head split-head">
        <div>
          <h2 id="routines-title" className="section-title">
            Routines
          </h2>
          <p className="row-sub">Your own workout plans, started in one tap.</p>
        </div>
        {routines && !full && (
          <button className="outline-btn" type="button" onClick={() => setEditing({})}>
            New routine
          </button>
        )}
      </div>
      <ErrorMsg>{error}</ErrorMsg>
      {routines === null && !error && <p className="msg">Loading routines…</p>}
      {routines?.length === 0 && (
        <p className="row-sub">
          None yet. Make one here, or open a past workout and save it as one.
        </p>
      )}
      {routines?.map((r) => (
        <div className="row static" key={r.id}>
          <span className="row-text">
            {r.name}
            <span className="row-sub">
              {r.exercises.map((e) => e.name).join(', ') || 'Its exercises were deleted.'}
            </span>
          </span>
          <button
            className="ghost-btn"
            type="button"
            aria-label={`Edit ${r.name}`}
            onClick={() => setEditing(r)}
          >
            Edit
          </button>
          <button
            className="pill-btn filled"
            type="button"
            disabled={starting !== null || r.exercises.length === 0}
            onClick={() => start(r)}
          >
            {starting === r.id ? 'Starting…' : 'Start'}
          </button>
        </div>
      ))}
      {full && <PlusLock token={token} feature="Keeping more than 3 routines" />}
    </section>
  );
}
