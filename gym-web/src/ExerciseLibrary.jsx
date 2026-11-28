import { useEffect, useState } from 'react';
import {
  createExercise,
  createMyExercise,
  deleteExercise,
  deleteMyExercise,
  getExercises,
  updateExercise,
  updateMyExercise,
} from './api';
import ConfirmDialog from './ConfirmDialog';
import ErrorMsg from './ErrorMsg';
import ExerciseForm from './ExerciseForm';
import { ExerciseRows, ExerciseSearch } from './ExerciseSearch';

// Search, add, edit and delete exercises. On the Admin screen it's the shared library every member
// uses; with `mine` (Settings) it's the member's own, which only they see
export default function ExerciseLibrary({ token, mine = false }) {
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState('');
  const [exercises, setExercises] = useState(null); // null = still loading
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // null = list; {} = new exercise; an exercise = edit it
  const [deleting, setDeleting] = useState(null); // the exercise awaiting a yes
  const [saved, setSaved] = useState(0); // goes up after each change, to refetch the list
  // The shared library is long, so it starts hidden; searching or picking a muscle opens it
  const [open, setOpen] = useState(mine);
  const id = mine ? 'my-exercises' : 'exercises';

  // The whole library once, searched here like the workout's picker; loaded again after each change
  useEffect(() => {
    // An older, slower answer must not replace a newer one
    let stale = false;
    getExercises(token)
      .then((list) => {
        if (stale) return;
        // The API sends the shared ones and the member's own together; each screen keeps its half
        setExercises(list.filter((e) => e.mine === mine));
        setError('');
      })
      .catch((err) => {
        if (!stale) setError(err.message);
      });
    return () => {
      stale = true;
    };
  }, [token, saved, mine]);

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
      await (mine ? deleteMyExercise : deleteExercise)(token, e.id);
      done();
    } catch (err) {
      setError(err.message);
    }
  }

  function save(body) {
    if (editing.id) return (mine ? updateMyExercise : updateExercise)(token, editing.id, body);
    return (mine ? createMyExercise : createExercise)(token, body);
  }

  return (
    <section className="card" aria-labelledby={`${id}-title`}>
      {/* In Settings it looks like the other cards there: big heading, outline button at the right */}
      <div className={mine ? 'section-head split-head' : 'section-head'}>
        <div>
          <h2 id={`${id}-title`} className={mine ? 'section-title' : 'card-title'}>
            {mine ? 'My exercises' : 'Exercises'}
          </h2>
          <p className="row-sub">
            {mine
              ? 'Add one the library is missing, with the muscles it works. Only you see it.'
              : 'Search and manage your library.'}
          </p>
        </div>
        {!editing && (
          <>
            {/* A member's own list is short enough to show without searching */}
            {!mine && (
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
                  aria-controls={`${id}-results`}
                  onClick={() => setOpen(!open)}
                >
                  {open ? 'Hide list' : 'Show list'}
                </button>
              </>
            )}
            <button
              className={mine ? 'outline-btn' : 'pill-btn filled'}
              type="button"
              onClick={() => setEditing({})}
            >
              Add exercise
            </button>
          </>
        )}
      </div>

      {editing ? (
        <ExerciseForm
          // A new key resets the form's fields when switching between exercises
          key={editing.id ?? 'new'}
          exercise={editing.id ? editing : null}
          onSave={save}
          onSaved={done}
          onDelete={() => setDeleting(editing)}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <>
          <ErrorMsg>{error}</ErrorMsg>
          <div id={`${id}-results`} hidden={!open}>
            {exercises === null && !error && <p className="msg">Loading exercises…</p>}
            {mine && exercises?.length === 0 && (
              <p className="row-sub">You haven't added any yet.</p>
            )}
            {exercises?.length > 0 && (
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
          body={
            mine
              ? "It's removed from your list. One that's in a logged workout can't be deleted."
              : "It's removed for every member. Exercises already in a logged workout can't be deleted."
          }
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  );
}
