import { useEffect, useRef, useState } from 'react';
import { getExercises } from './api';
import ErrorMsg from './ErrorMsg';
import { MUSCLES } from './muscles';

// shortcut: only the first 50 matches are drawn; searching narrows it down
const SHOWN = 50;

// The sheet for adding an exercise to the workout in progress
export default function ExercisePicker({ token, onPick, onClose }) {
  const ref = useRef(null);
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState('');
  const [exercises, setExercises] = useState(null); // null = still loading
  const [error, setError] = useState('');

  // StrictMode runs effects twice in development, so don't reopen an open dialog
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog.open) {
      dialog.showModal();
      return () => dialog.close();
    }
  }, []);

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
          // Keep the whole library for when there's no signal
          if (!q && !muscle) localStorage.setItem('exercises', JSON.stringify(list));
        })
        .catch((err) => {
          if (stale) return;
          // No signal: search the copy kept from the last time the whole library loaded
          const kept = JSON.parse(localStorage.getItem('exercises') ?? 'null');
          if (!kept) return setError(err.message);
          setExercises(
            kept.filter(
              (e) =>
                e.name.toLowerCase().includes(q.toLowerCase()) &&
                (!muscle || [...e.primaryMuscles, ...e.secondaryMuscles].includes(muscle)),
            ),
          );
        });
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [token, q, muscle]);

  return (
    <dialog ref={ref} className="sheet picker" aria-labelledby="picker-title" onCancel={onClose}>
      <div className="section-head">
        <h2 id="picker-title">Add exercise</h2>
        <button className="pill-btn" type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="section-head">
        <input
          className="admin-search"
          type="search"
          placeholder="Search exercises"
          aria-label="Search exercises"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="role-select status-filter"
          aria-label="Muscle"
          value={muscle}
          onChange={(e) => setMuscle(e.target.value)}
        >
          <option value="">All muscles</option>
          {MUSCLES.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </div>
      <ErrorMsg>{error}</ErrorMsg>
      {exercises === null && !error && <p className="msg">Loading exercises…</p>}
      {exercises?.length === 0 && <p className="msg">No matches</p>}
      {exercises?.length > 0 && (
        <div className="group exercise-list">
          {exercises.slice(0, SHOWN).map((e) => (
            <button className="row" type="button" key={e.id} onClick={() => onPick(e)}>
              <span className="row-text">
                {e.name}
                <span className="row-sub">
                  {[e.primaryMuscles.join(', '), e.equipment].filter(Boolean).join(' · ')}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </dialog>
  );
}
