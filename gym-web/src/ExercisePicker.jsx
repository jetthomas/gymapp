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
  const [library, setLibrary] = useState(null); // null = still loading
  const [error, setError] = useState('');

  // StrictMode runs effects twice in development, so don't reopen an open dialog
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog.open) {
      dialog.showModal();
      return () => dialog.close();
    }
  }, []);

  // The whole library once (about 900 exercises); searching then happens here, with no request per key
  useEffect(() => {
    getExercises(token)
      .then((list) => {
        setLibrary(list);
        // Kept for when there's no signal
        localStorage.setItem('exercises', JSON.stringify(list));
      })
      .catch((err) => {
        const kept = JSON.parse(localStorage.getItem('exercises') ?? 'null');
        if (kept) setLibrary(kept);
        else setError(err.message);
      });
  }, [token]);

  const words = q.trim().toLowerCase();
  const exercises = library?.filter(
    (e) =>
      e.name.toLowerCase().includes(words) &&
      (!muscle || [...e.primaryMuscles, ...e.secondaryMuscles].includes(muscle)),
  );

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
