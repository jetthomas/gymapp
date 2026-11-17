import { useEffect, useState } from 'react';
import { deleteExercise, getExercises } from './api';
import ConfirmDialog from './ConfirmDialog';
import ErrorMsg from './ErrorMsg';
import ExerciseForm from './ExerciseForm';
import { MUSCLES } from './muscles';

// shortcut: only the first 100 matches are drawn; add paging if admins need to scroll the whole list
const SHOWN = 100;

// The admin screen's Exercises section: search the shared library, add, edit and delete
export default function AdminExercises({ token }) {
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState('');
  const [exercises, setExercises] = useState(null); // null = still loading
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // null = list; {} = new exercise; an exercise = edit it
  const [deleting, setDeleting] = useState(null); // the exercise awaiting a yes
  const [saved, setSaved] = useState(0); // goes up after each change, to refetch the list
  // The list is long, so it starts hidden; searching or picking a muscle opens it
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // An older, slower answer must not replace a newer one
    let stale = false;
    // Wait until typing stops, so each keystroke isn't its own request
    const timer = setTimeout(() => {
      getExercises(token, q, muscle)
        .then((list) => {
          if (stale) return;
          setExercises(list);
          setError('');
        })
        .catch((err) => {
          if (!stale) setError(err.message);
        });
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [token, q, muscle, saved]);

  function done() {
    setEditing(null);
    setSaved(saved + 1);
  }

  async function handleDelete() {
    const e = deleting;
    setDeleting(null);
    try {
      await deleteExercise(token, e.id);
      done();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="card" aria-labelledby="exercises-title">
      <div className="section-head">
        <div>
          <h2 id="exercises-title" className="card-title">
            Exercises
          </h2>
          <p className="row-sub">Search and manage your library.</p>
        </div>
        {!editing && (
          <>
            <input
              className="admin-search"
              type="search"
              placeholder="Search exercises"
              aria-label="Search exercises"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOpen(true);
              }}
            />
            <select
              className="role-select status-filter"
              aria-label="Muscle"
              value={muscle}
              onChange={(e) => {
                setMuscle(e.target.value);
                setOpen(true);
              }}
            >
              <option value="">All muscles</option>
              {MUSCLES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <button
              className="outline-btn"
              type="button"
              aria-expanded={open}
              aria-controls="exercise-results"
              onClick={() => setOpen(!open)}
            >
              {open ? 'Hide list' : 'Show list'}
            </button>
            <button className="pill-btn filled" type="button" onClick={() => setEditing({})}>
              Add exercise
            </button>
          </>
        )}
      </div>

      {editing ? (
        <ExerciseForm
          // A new key resets the form's fields when switching between exercises
          key={editing.id ?? 'new'}
          token={token}
          exercise={editing.id ? editing : null}
          onSaved={done}
          onDelete={() => setDeleting(editing)}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <>
          <ErrorMsg>{error}</ErrorMsg>
          <div id="exercise-results" hidden={!open}>
            {exercises === null && !error && <p className="msg">Loading exercises…</p>}
            {exercises?.length === 0 && <p className="msg">No matches</p>}
            {exercises?.length > 0 && (
              <>
                <div className="group exercise-list">
                  {exercises.slice(0, SHOWN).map((e) => (
                    <button className="row" type="button" key={e.id} onClick={() => setEditing(e)}>
                      <span className="row-text">
                        {e.name}
                        <span className="row-sub">
                          {[e.primaryMuscles.join(', '), e.equipment].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
                {exercises.length > SHOWN && (
                  <p className="hint">
                    Showing {SHOWN} of {exercises.length}. Search or pick a muscle to narrow it
                    down.
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          body="It's removed for every member. Exercises already in a logged workout can't be deleted."
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  );
}
