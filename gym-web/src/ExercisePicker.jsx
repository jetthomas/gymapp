import { useEffect, useState } from 'react';
import { getExercises } from './api';
import ErrorMsg from './ErrorMsg';
import { ExerciseRows, ExerciseSearch } from './ExerciseSearch';
import useModal, { closeOnBackdrop } from './useModal';

// The sheet for adding an exercise to the workout in progress
export default function ExercisePicker({ token, onPick, onClose }) {
  const ref = useModal();
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState('');
  const [library, setLibrary] = useState(null); // null = still loading
  const [error, setError] = useState('');

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

  return (
    <dialog
      ref={ref}
      className="sheet picker"
      aria-labelledby="picker-title"
      // Tapping outside closes it
      closedby="any"
      onCancel={onClose}
      onClick={closeOnBackdrop(onClose)}
    >
      <div className="section-head">
        <h2 id="picker-title">Add exercise</h2>
        <button className="pill-btn" type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <search className="section-head">
        <ExerciseSearch q={q} muscle={muscle} onSearch={setQ} onMuscle={setMuscle} />
      </search>
      <ErrorMsg>{error}</ErrorMsg>
      {library === null && !error && <p className="msg">Loading exercises…</p>}
      {library && (
        <ExerciseRows library={library} q={q} muscle={muscle} shown={50} onPick={onPick} />
      )}
    </dialog>
  );
}
