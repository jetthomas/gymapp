import { useEffect, useState } from 'react';
import { getLastSets } from './api';
import ConfirmDialog from './ConfirmDialog';
import { clearDraft, clock, loadDraft, newDraft, newSet, saveDraft } from './Draft';
import ErrorMsg from './ErrorMsg';
import ExercisePicker from './ExercisePicker';
import PlateSheet from './PlateSheet';
import { flush, queue } from './outbox';

const REST_SECONDS = 90;

// The workout in progress: one card per exercise, one row per set
export default function WorkoutScreen({ token, onDone }) {
  const [draft, setDraft] = useState(() => loadDraft() ?? newDraft());
  const [now, setNow] = useState(() => Date.now());
  const [restEnds, setRestEnds] = useState(0); // a time in ms; 0 = not resting
  const [picking, setPicking] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [message, setMessage] = useState('');
  const [plateWeight, setPlateWeight] = useState(null);
  // Set on the Account screen
  const showRir = localStorage.getItem('show-rir') === '1';

  useEffect(() => saveDraft(draft), [draft]);

  // One tick a second drives both the workout clock and the rest countdown
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  function changeExercise(i, change) {
    setDraft((d) => ({ ...d, exercises: d.exercises.map((e, k) => (k === i ? change(e) : e)) }));
  }

  function changeSet(i, j, patch) {
    changeExercise(i, (e) => ({
      ...e,
      sets: e.sets.map((s, k) => (k === j ? { ...s, ...patch } : s)),
    }));
  }

  // Last time's set goes too, so the rows below keep their own "previous"
  function removeSet(i, j) {
    changeExercise(i, (e) => ({
      ...e,
      sets: e.sets.filter((_, k) => k !== j),
      previous: e.previous.filter((_, k) => k !== j),
    }));
  }

  async function addExercise(exercise) {
    setPicking(false);
    // No history (or no signal) just means an empty "previous" column
    const previous = await getLastSets(token, exercise.id).catch(() => []);
    setDraft((d) => ({
      ...d,
      exercises: [
        ...d.exercises,
        {
          id: exercise.id,
          name: exercise.name,
          equipment: exercise.equipment,
          previous,
          // Start with as many rows as last time
          sets: previous.length ? previous.map(newSet) : [newSet()],
        },
      ],
    }));
  }

  // What ticking a set would log: what was typed, or last time's numbers when left blank
  function filled(exercise, j) {
    const set = exercise.sets[j];
    const prev = exercise.previous[j];
    return {
      weightKg: set.weightKg !== '' ? set.weightKg : String(prev?.weightKg ?? ''),
      reps: set.reps !== '' ? set.reps : String(prev?.reps ?? ''),
    };
  }

  function tick(i, j) {
    const exercise = draft.exercises[i];
    if (exercise.sets[j].done) {
      changeSet(i, j, { done: false });
      return;
    }
    changeSet(i, j, { ...filled(exercise, j), done: true });
    setRestEnds(Date.now() + REST_SECONDS * 1000);
  }

  function finish() {
    const exercises = draft.exercises
      .map((e) => ({
        exerciseId: e.id,
        sets: e.sets
          .filter((s) => s.done)
          .map((s) => ({
            weightKg: Number(s.weightKg),
            reps: Number(s.reps),
            rir: s.rir === '' ? null : Number(s.rir),
          })),
      }))
      .filter((e) => e.sets.length > 0);
    if (exercises.length === 0) {
      setMessage('Tick at least one set before finishing.');
      return;
    }
    queue(token, {
      clientId: draft.clientId,
      name: draft.name.trim() || 'Workout',
      date: new Date(draft.startedAt).toISOString(),
      // The API allows up to a day
      durationSec: Math.min(86400, Math.round((Date.now() - draft.startedAt) / 1000)),
      exercises,
    });
    clearDraft();
    flush(token);
    onDone();
  }

  const rest = restEnds - now;

  return (
    <main className="admin-content workout">
      <div className="workout-bar">
        <div>
          <input
            className="workout-name"
            aria-label="Workout name"
            maxLength={200}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <div className="row-sub" role="timer" aria-label="Workout time">
            {clock(now - draft.startedAt)}
          </div>
        </div>
        <button className="pill-btn filled" type="button" onClick={finish}>
          Finish
        </button>
      </div>
      <ErrorMsg>{message}</ErrorMsg>

      {draft.exercises.map((e, i) => (
        // Exercises are only added at the end or removed, and the same one can be added twice
        <section className="card" key={i} aria-label={e.name}>
          <div className="section-head">
            <h2 className="card-title">{e.name}</h2>
            <button
              className="link-btn danger"
              type="button"
              aria-label={`Remove ${e.name}`}
              onClick={() =>
                setDraft({ ...draft, exercises: draft.exercises.filter((_, k) => k !== i) })
              }
            >
              Remove
            </button>
          </div>
          <table className="set-table">
            <thead>
              <tr>
                <th scope="col">Set</th>
                <th scope="col">Previous</th>
                <th scope="col">kg</th>
                <th scope="col">Reps</th>
                {showRir && <th scope="col">RIR</th>}
                {e.equipment === 'barbell' && (
                  <th scope="col">
                    <span className="visually-hidden">Plates</span>
                  </th>
                )}
                <th scope="col">
                  <span className="visually-hidden">Done</span>
                </th>
                <th scope="col">
                  <span className="visually-hidden">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {e.sets.map((s, j) => {
                const prev = e.previous[j];
                const ready = filled(e, j);
                return (
                  <tr key={j} className={s.done ? 'done' : ''}>
                    <th scope="row">{j + 1}</th>
                    <td className="prev">{prev ? `${prev.weightKg} × ${prev.reps}` : '–'}</td>
                    <td>
                      <input
                        inputMode="decimal"
                        aria-label={`Set ${j + 1} weight in kg`}
                        placeholder={prev?.weightKg ?? ''}
                        value={s.weightKg}
                        readOnly={s.done}
                        onChange={(ev) =>
                          // Digits with at most one decimal point
                          /^\d*\.?\d*$/.test(ev.target.value) &&
                          changeSet(i, j, { weightKg: ev.target.value })
                        }
                      />
                    </td>
                    <td>
                      <input
                        inputMode="numeric"
                        aria-label={`Set ${j + 1} reps`}
                        placeholder={prev?.reps ?? ''}
                        value={s.reps}
                        readOnly={s.done}
                        onChange={(ev) =>
                          /^\d*$/.test(ev.target.value) &&
                          changeSet(i, j, { reps: ev.target.value })
                        }
                      />
                    </td>
                    {showRir && (
                      <td>
                        <input
                          inputMode="numeric"
                          aria-label={`Set ${j + 1} reps in reserve`}
                          value={s.rir}
                          readOnly={s.done}
                          onChange={(ev) =>
                            /^(10|\d)?$/.test(ev.target.value) &&
                            changeSet(i, j, { rir: ev.target.value })
                          }
                        />
                      </td>
                    )}
                    {e.equipment === 'barbell' && (
                      <td>
                        <button
                          className="tick plate-btn"
                          type="button"
                          aria-label={`Plates for set ${j + 1}`}
                          disabled={ready.weightKg === ''}
                          onClick={() => setPlateWeight(ready.weightKg)}
                        >
                          {/* A bar with two plates each side */}
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path
                              d="M2 12h20"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                            />
                            <rect x="5" y="6" width="3" height="12" rx="1" />
                            <rect x="9" y="8" width="2.5" height="8" rx="1" />
                            <rect x="12.5" y="8" width="2.5" height="8" rx="1" />
                            <rect x="16" y="6" width="3" height="12" rx="1" />
                          </svg>
                        </button>
                      </td>
                    )}
                    <td>
                      <button
                        className="tick"
                        type="button"
                        aria-pressed={s.done}
                        aria-label={`Set ${j + 1} done`}
                        // Nothing to log until there's a weight and at least 1 rep
                        disabled={!s.done && (ready.weightKg === '' || !(Number(ready.reps) > 0))}
                        onClick={() => tick(i, j)}
                      >
                        ✓
                      </button>
                    </td>
                    <td>
                      <button
                        className="remove-set"
                        type="button"
                        aria-label={`Remove set ${j + 1}`}
                        // The card's Remove takes the whole exercise
                        disabled={e.sets.length === 1}
                        onClick={() => removeSet(i, j)}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button
            className="link-btn"
            type="button"
            onClick={() => changeExercise(i, (x) => ({ ...x, sets: [...x.sets, newSet()] }))}
          >
            + Add set
          </button>
        </section>
      ))}

      <button className="outline-btn wide" type="button" onClick={() => setPicking(true)}>
        Add exercise
      </button>
      <button className="link-btn danger" type="button" onClick={() => setDiscarding(true)}>
        Discard workout
      </button>

      {rest > 0 && (
        <div className="rest-bar">
          <span role="timer" aria-label="Rest time left">
            Rest {clock(rest)}
          </span>
          <button className="outline-btn" type="button" onClick={() => setRestEnds(0)}>
            Skip
          </button>
        </div>
      )}
      {picking && (
        <ExercisePicker token={token} onPick={addExercise} onClose={() => setPicking(false)} />
      )}
      {plateWeight !== null && (
        <PlateSheet weightKg={plateWeight} onClose={() => setPlateWeight(null)} />
      )}
      {discarding && (
        <ConfirmDialog
          title="Discard this workout?"
          body="Everything logged in it is deleted."
          confirmLabel="Discard"
          danger
          onConfirm={() => {
            clearDraft();
            onDone();
          }}
          onCancel={() => setDiscarding(false)}
        />
      )}
    </main>
  );
}
