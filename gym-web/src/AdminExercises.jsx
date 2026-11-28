import { useEffect, useState } from 'react';
import { deleteExercise, getExercises } from './api';
import ConfirmDialog from './ConfirmDialog';
import ErrorMsg from './ErrorMsg';
import ExerciseForm from './ExerciseForm';
import { ExerciseRows, ExerciseSearch } from './ExerciseSearch';

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

  // The whole library once, searched here like the workout's picker; loaded again after each change
  useEffect(() => {
    // An older, slower answer must not replace a newer one
    let stale = false;
    getExercises(token)
      .then((list) => {
        if (stale) return;
        setExercises(list);
        setError('');
      })
      .catch((err) => {
        if (!stale) setError(err.message);
      });
    return () => {
      stale = true;
    };
  }, [token, saved]);

  function done() {
    setEditing(null);
    // s + 1: a save and a delete finishing from the same render must both reload
    setSaved((s) => s + 1);
  }

  async function handleDelete() {
    const e = deleting;
    setDeleting(null);
    // Back to the list first: its Delete button can't be pressed twice, and the list is where errors show
    setEditing(null);
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
            <ExerciseSearch
              q={q}
              muscle={muscle}
              onSearch={(v) => {
                setQ(v);
                setOpen(true);
              }}
              onMuscle={(v) => {
                setMuscle(v);
                setOpen(true);
              }}
            />
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
            {exercises && (
              <ExerciseRows
                library={exercises}
                q={q}
                muscle={muscle}
                shown={100}
                onPick={setEditing}
              />
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
