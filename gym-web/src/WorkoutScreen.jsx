import { useEffect, useState } from 'react';
import { getLastSets, updateWorkout } from './api';
import { Ring } from './CaloriesScreen';
import ConfirmDialog from './ConfirmDialog';
import {
  clearDraft,
  clock,
  editDraft,
  loadDraft,
  newDraft,
  newPastDraft,
  newSet,
  restSeconds,
  saveDraft,
  toLocalInput,
} from './Draft';
import ErrorMsg from './ErrorMsg';
import ExercisePicker from './ExercisePicker';
import { Check, Dumbbell, Play, Timer } from './icons';
import { decimal } from './numberInput';
import PlateSheet from './PlateSheet';
import { flush, queue, userIdOf } from './outbox';
import { validSet } from './setLimits';
import { nextType, setLabel, typeName } from './setTypes';
import { fromKg, setKg, weightUnit } from './units';
import useSubmit from './useSubmit';

// The workout in progress: one card per exercise, one row per set.
// With no draft it waits for Start, unless `start` (the dashboard's Start button) says begin now.
// `saved` opens a finished workout for editing instead; saving replaces it on the server
export default function WorkoutScreen({ token, start, saved, onDone }) {
  const userId = userIdOf(token);
  const [draft, setDraft] = useState(() =>
    saved ? editDraft(saved, weightUnit()) : (loadDraft(userId) ?? (start ? newDraft() : null)),
  );
  const saving = useSubmit();
  const [now, setNow] = useState(() => Date.now());
  const [restEnds, setRestEnds] = useState(0); // a time in ms; 0 = not resting
  const [restFrom, setRestFrom] = useState(0); // when this rest began: the ring is full there
  const [picking, setPicking] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [message, setMessage] = useState('');
  const [plateWeight, setPlateWeight] = useState(null);
  const [confirmingFinish, setConfirmingFinish] = useState(false);
  const showRir = localStorage.getItem('show-rir') === '1';
  const [removing, setRemoving] = useState(null); // the exercise waiting to be removed

  useEffect(() => {
    // An edit lives only on this screen, so it never replaces a workout in progress
    if (draft && !draft.editingId) saveDraft(userId, draft);
  }, [userId, draft]);

  // One tick a second drives both the workout clock and the rest countdown
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!draft) {
    return (
      <main className="admin-content workout">
        <section className="card empty-state">
          <span className="icon-badge" aria-hidden="true">
            <Dumbbell size={28} />
          </span>
          <p className="headline">No workout in progress.</p>
          <button className="login-btn" type="button" onClick={() => setDraft(newDraft())}>
            <Play size={18} />
            Start workout
          </button>
          <button className="link-btn" type="button" onClick={() => setDraft(newPastDraft())}>
            Log a past workout
          </button>
        </section>
      </main>
    );
  }

  const unit = draft.unit;

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

  // Each row becomes a left and a right row, or each pair goes back to one row.
  // Locked once a set is ticked, so nothing logged is lost
  function setUnilateral(i, on) {
    const pair = (r) => [
      { ...r, side: 'L' },
      { ...r, side: 'R' },
    ];
    const single = (rows) => rows.filter((r) => r.side !== 'R').map((r) => ({ ...r, side: null }));
    changeExercise(i, (e) => ({
      ...e,
      unilateral: on,
      sets: on ? e.sets.flatMap(pair) : single(e.sets),
      previous: on ? e.previous.flatMap(pair) : single(e.previous),
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
          // Unilateral last time opens as L/R rows again
          unilateral: previous.some((p) => p.side),
          // Start with as many rows as last time, warm-ups where they were
          sets: previous.length
            ? previous.map((p) => ({ ...newSet(), side: p.side, type: p.type }))
            : [newSet()],
        },
      ],
    }));
  }

  // What ticking a set would log: what was typed, or last time's numbers when left blank.
  // Last time's weight keeps its exact kg too, so it's logged unchanged whatever unit shows it
  function filled(exercise, j) {
    const set = exercise.sets[j];
    const prev = exercise.previous[j];
    const weight =
      set.weight !== ''
        ? { weight: set.weight }
        : prev
          ? { weight: String(fromKg(prev.weightKg, unit)), kg: prev.weightKg }
          : { weight: '' };
    return { ...weight, reps: set.reps !== '' ? set.reps : String(prev?.reps ?? '') };
  }

  function tick(i, j) {
    const exercise = draft.exercises[i];
    if (exercise.sets[j].done) {
      changeSet(i, j, { done: false });
      return;
    }
    // doneAt: the workout's length runs to its last ticked set, not to when Finish is tapped
    changeSet(i, j, { ...filled(exercise, j), done: true, doneAt: Date.now() });
    // A workout typed in afterwards has no rests to time
    if (draft.past) return;
    setRestFrom(Date.now());
    setRestEnds(Date.now() + restSeconds() * 1000);
  }

  function removeExercise(i) {
    setDraft({ ...draft, exercises: draft.exercises.filter((_, k) => k !== i) });
  }

  const unticked = draft.exercises
    .flatMap((e) => e.sets)
    .filter((s) => !s.done && (s.weight !== '' || s.reps !== '')).length;

  function finish(checked = false) {
    const exercises = draft.exercises
      .map((e) => ({
        exerciseId: e.id,
        sets: e.sets
          .filter((s) => s.done)
          .map((s) => ({
            weightKg: setKg(s, unit),
            reps: Number(s.reps),
            rir: s.rir === '' ? null : Number(s.rir),
            side: s.side ?? null,
            type: s.type ?? null,
          })),
      }))
      .filter((e) => e.sets.length > 0);
    // Typed but not ticked sets would be lost, so ask first, whether or not others are ticked
    if (unticked > 0 && !checked) {
      setConfirmingFinish(true);
      return;
    }
    if (exercises.length === 0) {
      setMessage('Tick at least one set before finishing.');
      return;
    }
    // Sets ticked before this change have no doneAt; they count as now
    const lastTick = Math.max(
      ...draft.exercises.flatMap((e) =>
        e.sets.filter((s) => s.done).map((s) => s.doneAt ?? Date.now()),
      ),
    );
    // Typed in afterwards: the minutes given, or unknown when blank. Live: up to the last ticked set
    const seconds = draft.past
      ? draft.minutes && Number(draft.minutes) * 60
      : Math.round((lastTick - draft.startedAt) / 1000);
    const workout = {
      name: draft.name.trim() || 'Workout',
      date: new Date(draft.startedAt).toISOString(),
      // The API allows up to a day
      durationSec: seconds ? Math.min(86400, seconds) : null,
      exercises,
    };
    if (draft.editingId) {
      // Straight to the server, not the outbox: it changes a saved workout, so it needs signal
      saving.run(async () => {
        await updateWorkout(token, draft.editingId, workout);
        onDone();
      });
      return;
    }
    queue(token, { clientId: draft.clientId, ...workout });
    clearDraft(userId);
    flush(token);
    onDone();
  }

  const rest = restEnds - now;

  return (
    <main className="admin-content workout">
      <div className="page-head workout-head">
        <div>
          <input
            className="page-title workout-name"
            aria-label="Workout name"
            maxLength={200}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        {!draft.past && (
          <div className="page-title workout-clock" role="timer" aria-label="Workout time">
            {clock(now - draft.startedAt)}
          </div>
        )}
      </div>
      {/* Typed in afterwards, or a saved one being edited: when it was and how long, not a clock */}
      {draft.past && (
        <div className="field-pair">
          <div className="field past-when">
            <label htmlFor="past-date">When</label>
            <input
              id="past-date"
              type="datetime-local"
              max={toLocalInput(now)}
              value={toLocalInput(draft.startedAt)}
              onChange={(e) =>
                e.target.value &&
                setDraft({ ...draft, startedAt: new Date(e.target.value).getTime() })
              }
            />
          </div>
          <div className="field">
            <label htmlFor="past-minutes">Minutes</label>
            <input
              id="past-minutes"
              inputMode="numeric"
              value={draft.minutes}
              onChange={(e) =>
                /^\d{0,4}$/.test(e.target.value) && setDraft({ ...draft, minutes: e.target.value })
              }
            />
          </div>
        </div>
      )}

      {draft.exercises.map((e, i) => (
        // Exercises are only added at the end or removed, and the same one can be added twice
        <section className="card" key={i} aria-label={e.name}>
          <div className="exercise-head">
            <h2 className="card-title">{e.name}</h2>
            {e.equipment !== 'barbell' && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={!!e.unilateral}
                  disabled={e.sets.some((s) => s.done)}
                  onChange={(ev) => setUnilateral(i, ev.target.checked)}
                />
                Unilateral
              </label>
            )}
            <button
              className="ghost-btn danger"
              type="button"
              aria-label={`Remove ${e.name}`}
              // Only asks when it would throw away ticked sets
              onClick={() => (e.sets.some((s) => s.done) ? setRemoving(i) : removeExercise(i))}
            >
              Remove
            </button>
          </div>
          <table className="set-table">
            <thead>
              <tr>
                <th scope="col">Set</th>
                <th scope="col">Previous</th>
                <th scope="col">{unit}</th>
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
                const prevWeight = prev ? fromKg(prev.weightKg, unit) : '';
                const ready = filled(e, j);
                const label = setLabel(e.sets, j);
                return (
                  <tr key={j} className={s.done ? 'done' : ''}>
                    <th scope="row">
                      {/* One tap steps the set through normal, warm-up, drop and failure */}
                      <button
                        className={`set-type ${s.type ?? ''}`}
                        type="button"
                        aria-label={`Set ${label}: ${typeName(s.type)}. Change set type`}
                        onClick={() => changeSet(i, j, { type: nextType(s.type) })}
                      >
                        {label}
                      </button>
                    </th>
                    <td className="prev">{prev ? `${prevWeight} × ${prev.reps}` : '–'}</td>
                    <td>
                      <input
                        inputMode="decimal"
                        enterKeyHint="next"
                        aria-label={`Set ${label} weight in ${unit}`}
                        placeholder={prevWeight}
                        value={s.weight}
                        readOnly={s.done}
                        onChange={decimal((v) => changeSet(i, j, { weight: v }))}
                      />
                    </td>
                    <td>
                      <input
                        inputMode="numeric"
                        enterKeyHint="next"
                        aria-label={`Set ${label} reps`}
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
                          enterKeyHint="next"
                          aria-label={`Set ${label} reps in reserve`}
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
                          aria-label={`Plates for set ${label}`}
                          disabled={ready.weight === '' || isNaN(ready.weight)}
                          onClick={() => setPlateWeight(ready.weight)}
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
                        aria-label={`Set ${label} done`}
                        // Nothing to log until there's a weight and at least 1 rep
                        disabled={!s.done && !validSet(ready)}
                        onClick={() => tick(i, j)}
                      >
                        <Check size={18} />
                      </button>
                    </td>
                    <td>
                      <button
                        className="remove-set"
                        type="button"
                        aria-label={`Remove set ${label}`}
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
            className="add-btn"
            type="button"
            onClick={() =>
              changeExercise(i, (x) => ({
                ...x,
                sets: [
                  ...x.sets,
                  ...(x.unilateral
                    ? [
                        { ...newSet(), side: 'L' },
                        { ...newSet(), side: 'R' },
                      ]
                    : [newSet()]),
                ],
              }))
            }
          >
            + Add set
          </button>
        </section>
      ))}

      <button className="outline-btn wide" type="button" onClick={() => setPicking(true)}>
        Add exercise
      </button>
      <ErrorMsg>{message || saving.message}</ErrorMsg>
      {draft.editingId ? (
        <div className="finish-row">
          <button
            className="login-btn"
            type="button"
            disabled={saving.loading}
            onClick={() => finish()}
          >
            {saving.loading ? 'Saving…' : 'Save changes'}
          </button>
          <button className="outline-btn" type="button" onClick={onDone}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="finish-row">
          <button className="login-btn" type="button" onClick={() => finish()}>
            Finish
          </button>
          <button className="outline-btn danger" type="button" onClick={() => setDiscarding(true)}>
            Discard workout
          </button>
        </div>
      )}

      {rest > 0 && (
        <div className="rest-bar">
          <Timer size={18} />
          {/* Phones show this ring, emptying as the rest runs down, in place of the icon and the time.
              ±15 s moves restEnds, so the share left stays right */}
          <Ring value={rest} max={restEnds - restFrom} />
          <span className="rest-label">Rest</span>
          <span className="rest-time" role="timer" aria-label="Rest time left">
            {clock(rest)}
          </span>
          {/* Dropping below zero just ends the rest, like Skip */}
          <button
            className="rest-btn"
            type="button"
            aria-label="15 seconds less"
            onClick={() => setRestEnds(restEnds - 15000)}
          >
            −15s
          </button>
          <button
            className="rest-btn"
            type="button"
            aria-label="15 seconds more"
            onClick={() => setRestEnds(restEnds + 15000)}
          >
            +15s
          </button>
          <button className="rest-btn" type="button" onClick={() => setRestEnds(0)}>
            Skip
          </button>
        </div>
      )}
      {picking && (
        <ExercisePicker token={token} onPick={addExercise} onClose={() => setPicking(false)} />
      )}
      {plateWeight !== null && (
        <PlateSheet weight={plateWeight} unit={unit} onClose={() => setPlateWeight(null)} />
      )}
      {confirmingFinish && (
        <ConfirmDialog
          title="Finish with unticked sets?"
          body={`${unticked} ${unticked === 1 ? 'set has numbers but isn’t' : 'sets have numbers but aren’t'} ticked, so ${unticked === 1 ? 'it won’t' : 'they won’t'} be saved.`}
          confirmLabel="Finish anyway"
          onConfirm={() => {
            setConfirmingFinish(false);
            finish(true);
          }}
          onCancel={() => setConfirmingFinish(false)}
        />
      )}
      {removing !== null && (
        <ConfirmDialog
          title={`Remove ${draft.exercises[removing].name}?`}
          body="Its ticked sets are removed too."
          confirmLabel="Remove"
          danger
          onConfirm={() => {
            removeExercise(removing);
            setRemoving(null);
          }}
          onCancel={() => setRemoving(null)}
        />
      )}
      {discarding && (
        <ConfirmDialog
          title="Discard this workout?"
          body="Everything logged in it is deleted."
          confirmLabel="Discard"
          danger
          onConfirm={() => {
            clearDraft(userId);
            onDone();
          }}
          onCancel={() => setDiscarding(false)}
        />
      )}
    </main>
  );
}
