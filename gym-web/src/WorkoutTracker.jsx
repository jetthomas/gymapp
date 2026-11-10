import { useEffect, useRef, useState } from 'react';
import { getWorkouts, createWorkout, getExercises } from './api';

// Keys for exercise blocks; crypto.randomUUID() would only work on https or localhost
let nextKey = 0;
const digits = (v) => v.replace(/\D/g, '').slice(0, 4);
// Keeps one decimal point, so 62.5 kg works
const decimal = (v) => v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1').slice(0, 6);

export default function WorkoutTracker({ token, onDraftChange }) {
  const [workouts, setWorkouts] = useState(null); // null = still loading
  const [library, setLibrary] = useState([]);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  // The workout being built: [{ key, exerciseId, name, muscleGroup, sets: [{ kg, reps }] }]
  const [plan, setPlan] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const pickerRef = useRef(null);

  useEffect(() => {
    getWorkouts(token)
      .then(setWorkouts)
      .catch((err) => setError(err.message));
    getExercises(token)
      .then(setLibrary)
      .catch((err) => setError(err.message));
  }, [token]);

  useEffect(() => {
    onDraftChange(name.trim() || (plan.length ? 'this workout' : notes.trim() ? 'your notes' : ''));
  }, [name, notes, plan, onDraftChange]);

  function addExercises(picked) {
    const blocks = picked.map((ex) => ({
      key: nextKey++,
      exerciseId: ex.id,
      name: ex.name,
      muscleGroup: ex.muscleGroup,
      sets: [{ kg: '', reps: '' }],
    }));
    setPlan((p) => [...p, ...blocks]);
  }

  // Applies change() to one exercise block and leaves the others alone
  function updateBlock(key, change) {
    setPlan((p) => p.map((b) => (b.key === key ? change(b) : b)));
  }

  function setValue(key, index, field, value) {
    updateBlock(key, (b) => ({ ...b, sets: b.sets.map((s, i) => (i === index ? { ...s, [field]: value } : s)) }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await createWorkout(token, {
        name: name.trim(),
        notes: notes.trim() || null,
        date: new Date().toISOString(),
        exercises: plan.map((b) => ({
          exerciseId: b.exerciseId,
          sets: b.sets.map((s) => ({ reps: Number(s.reps), weightKg: s.kg === '' ? null : Number(s.kg) })),
        })),
      });
      // Clear first: the workout is saved even if the reload below fails, so it must not be sent twice
      setName('');
      setNotes('');
      setPlan([]);
      setWorkouts(await getWorkouts(token));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const valid =
    name.trim() !== '' && plan.length > 0 && plan.every((b) => b.sets.every((s) => Number(s.reps) >= 1));
  const count = workouts?.length ?? 0;

  return (
    <>
      <h1 className="admin-title">Workouts</h1>
      <p className="admin-subtitle">{count === 1 ? '1 workout logged' : `${count} workouts logged`}</p>

      <div className="member-grid">
        <form className="card" onSubmit={handleSave} aria-labelledby="new-title">
          <h2 id="new-title">New workout</h2>
          <div className="field">
            <label htmlFor="workout-name">Name</label>
            <input id="workout-name" placeholder="Push day" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoComplete="off" required />
          </div>

          {plan.map((b) => (
            <section key={b.key} className="exercise-block" aria-label={b.name}>
              <div className="exercise-head">
                <div>
                  <div className="entry-name">{b.name}</div>
                  <div className="entry-sub">{b.muscleGroup}</div>
                </div>
                <button type="button" className="icon-btn" aria-label={`Remove ${b.name}`} onClick={() => setPlan((p) => p.filter((x) => x.key !== b.key))}>
                  ×
                </button>
              </div>
              <div className="set-grid set-labels" aria-hidden="true">
                <span>Set</span>
                <span>kg</span>
                <span>Reps</span>
                <span />
              </div>
              {b.sets.map((s, i) => (
                <div key={i} className="set-grid">
                  <span className="set-num">{i + 1}</span>
                  <input className="set-input" inputMode="decimal" placeholder="–" aria-label={`${b.name} set ${i + 1} weight in kg`} value={s.kg} onChange={(e) => setValue(b.key, i, 'kg', decimal(e.target.value))} />
                  <input className="set-input" inputMode="numeric" placeholder="0" aria-label={`${b.name} set ${i + 1} reps`} value={s.reps} onChange={(e) => setValue(b.key, i, 'reps', digits(e.target.value))} />
                  <button type="button" className="icon-btn" aria-label={`Remove set ${i + 1}`} disabled={b.sets.length === 1} onClick={() => updateBlock(b.key, (x) => ({ ...x, sets: x.sets.filter((_, j) => j !== i) }))}>
                    ×
                  </button>
                </div>
              ))}
              {/* A new set starts as a copy of the last one, so 4 x 8 at 60 kg is typed once */}
              <button type="button" className="pill-btn" onClick={() => updateBlock(b.key, (x) => ({ ...x, sets: [...x.sets, { ...x.sets.at(-1) }] }))}>
                + Add set
              </button>
            </section>
          ))}

          <button type="button" className="pill-btn add-exercise" onClick={() => pickerRef.current.showModal()}>
            + Add exercise
          </button>

          <div className="field">
            <label htmlFor="workout-notes">Notes (optional)</label>
            <textarea id="workout-notes" rows={3} placeholder="How it felt" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
          </div>
          {error && <p className="msg error" role="alert">{error}</p>}
          <button className="login-btn" type="submit" disabled={saving || !valid}>
            {saving ? 'Saving…' : 'Save workout'}
          </button>
        </form>

        <section className="card" aria-labelledby="history-title">
          <h2 id="history-title">History</h2>
          {workouts === null && !error && <p className="admin-subtitle">Loading…</p>}
          {workouts?.length === 0 && <p className="admin-subtitle">No workouts yet. Save your first one and it shows up here.</p>}
          {count > 0 && (
            <ul className="entry-list">
              {workouts.map((w) => (
                <li key={w.id}>
                  <div>
                    <div className="entry-name">{w.name}</div>
                    {w.exercises.map((ex, i) => (
                      <div key={i} className="entry-sub">
                        {ex.sets.length} {ex.sets.length === 1 ? 'set' : 'sets'} · {ex.name}
                      </div>
                    ))}
                    {w.notes && <div className="entry-sub">{w.notes}</div>}
                  </div>
                  <span className="entry-meta">
                    {new Date(w.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ExercisePicker dialogRef={pickerRef} library={library} onAdd={addExercises} />
    </>
  );
}

function ExercisePicker({ dialogRef, library, onAdd }) {
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState('All');
  const [picked, setPicked] = useState([]); // exercises, in the order they were tapped

  const muscles = ['All', ...new Set(library.map((ex) => ex.muscleGroup))];
  const q = query.trim().toLowerCase();
  const shown = library.filter((ex) => (muscle === 'All' || ex.muscleGroup === muscle) && ex.name.toLowerCase().includes(q));
  const isPicked = (ex) => picked.some((p) => p.id === ex.id);

  function toggle(ex) {
    setPicked((list) => (isPicked(ex) ? list.filter((p) => p.id !== ex.id) : [...list, ex]));
  }

  // Runs on every close (Add, Cancel or Esc), so the picker always opens fresh
  function reset() {
    setQuery('');
    setMuscle('All');
    setPicked([]);
  }

  return (
    <dialog ref={dialogRef} className="picker-dialog" aria-labelledby="picker-title" onClose={reset}>
      <div className="picker-head">
        <h2 id="picker-title">Add exercises</h2>
        <button type="button" className="link-btn" onClick={() => dialogRef.current.close()}>
          Cancel
        </button>
      </div>
      <input className="admin-search" type="search" placeholder={`Search ${library.length} exercises`} aria-label="Search exercises" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="chips" role="group" aria-label="Muscle group">
        {muscles.map((m) => (
          <button key={m} type="button" className="chip" aria-pressed={muscle === m} onClick={() => setMuscle(m)}>
            {m}
          </button>
        ))}
      </div>
      <ul className="picker-list">
        {shown.map((ex) => (
          <li key={ex.id}>
            <button type="button" aria-pressed={isPicked(ex)} onClick={() => toggle(ex)}>
              <span>
                <span className="entry-name">{ex.name}</span>
                <span className="entry-sub" style={{ display: 'block' }}>
                  {ex.muscleGroup} · {ex.equipment}
                </span>
              </span>
              <span className="check" aria-hidden="true" />
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="admin-subtitle">No exercises match</li>}
      </ul>
      <button
        type="button"
        className="login-btn"
        disabled={picked.length === 0}
        onClick={() => {
          onAdd(picked);
          dialogRef.current.close();
        }}
      >
        {picked.length ? `Add ${picked.length} ${picked.length === 1 ? 'exercise' : 'exercises'}` : 'Add exercises'}
      </button>
    </dialog>
  );
}
