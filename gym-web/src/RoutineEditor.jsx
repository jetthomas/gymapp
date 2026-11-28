import { useState } from 'react';
import { createRoutine, updateRoutine } from './api';
import ErrorMsg from './ErrorMsg';
import ExercisePicker from './ExercisePicker';
import { decimal } from './numberInput';
import { rirShown } from './Draft';
import { setKg, weightField, weightUnit } from './units';
import useSubmit from './useSubmit';

// Makes a routine, or changes `routine`: a name, and exercises in order, each with how many sets
// and the reps, weight and RIR to aim for (blank = no target). RIR shows only with "Show RIR" on;
// a hidden RIR is kept as it was
export default function RoutineEditor({ token, routine, onSaved, onDelete, onCancel }) {
  const unit = weightUnit();
  const showRir = rirShown();
  const [name, setName] = useState(routine?.name ?? '');
  const [items, setItems] = useState(() =>
    (routine?.exercises ?? []).map((e) => ({
      exerciseId: e.exerciseId,
      name: e.name,
      sets: String(e.sets),
      reps: e.reps == null ? '' : String(e.reps),
      ...weightField(e.weightKg, unit), // saved back unchanged unless the weight is edited
      rir: e.rir == null ? '' : String(e.rir),
    })),
  );
  const [picking, setPicking] = useState(false);
  const { loading, message, run } = useSubmit();

  const change = (i, patch) => setItems(items.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  // Whole numbers only, up to `max` digits; the API checks the range
  const digits = (i, field, max) => (e) =>
    new RegExp(`^\\d{0,${max}}$`).test(e.target.value) && change(i, { [field]: e.target.value });

  function handleSubmit(event) {
    event.preventDefault();
    run(async () => {
      if (items.length === 0) throw new Error('Add at least one exercise.');
      const body = {
        name,
        exercises: items.map((it) => ({
          exerciseId: it.exerciseId,
          sets: Number(it.sets) || 1,
          reps: it.reps === '' ? null : Number(it.reps),
          weightKg: it.weight === '' ? null : setKg(it, unit),
          rir: it.rir === '' ? null : Number(it.rir),
        })),
      };
      if (routine) await updateRoutine(token, routine.id, body);
      else await createRoutine(token, body);
      onSaved();
    });
  }

  return (
    <section className="card" aria-labelledby="routine-title">
      <form onSubmit={handleSubmit}>
        <h2 id="routine-title" className="section-title">
          {routine ? 'Edit routine' : 'New routine'}
        </h2>
        <div className="field routine-name">
          <label htmlFor="routine-name">Name</label>
          <input
            id="routine-name"
            required
            maxLength={200}
            placeholder="Push day"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {items.map((it, i) => (
          // The same exercise can be in a routine twice, so rows are keyed by position
          <div className="row static routine-item" key={i}>
            <span className="row-text">{it.name}</span>
            <label className="routine-num">
              Sets
              <input inputMode="numeric" value={it.sets} onChange={digits(i, 'sets', 2)} />
            </label>
            <label className="routine-num">
              Reps
              <input
                inputMode="numeric"
                placeholder="any"
                value={it.reps}
                onChange={digits(i, 'reps', 4)}
              />
            </label>
            <label className="routine-num">
              {unit}
              <input
                inputMode="decimal"
                placeholder="any"
                value={it.weight}
                onChange={decimal((v) => change(i, { weight: v }))}
              />
            </label>
            {showRir && (
              <label className="routine-num">
                RIR
                <input
                  inputMode="numeric"
                  placeholder="any"
                  value={it.rir}
                  onChange={digits(i, 'rir', 2)}
                />
              </label>
            )}
            <button
              className="remove-set"
              type="button"
              aria-label={`Remove ${it.name}`}
              onClick={() => setItems(items.filter((_, k) => k !== i))}
            >
              ×
            </button>
          </div>
        ))}
        <button className="add-btn" type="button" onClick={() => setPicking(true)}>
          + Add exercise
        </button>
        <ErrorMsg>{message}</ErrorMsg>
        <button className="login-btn" type="submit" disabled={loading}>
          {loading ? 'Saving…' : routine ? 'Save changes' : 'Save routine'}
        </button>
        {routine && (
          <button className="link-btn danger" type="button" onClick={onDelete} disabled={loading}>
            Delete routine
          </button>
        )}
        <button className="link-btn" type="button" onClick={onCancel} disabled={loading}>
          Cancel
        </button>
      </form>
      {picking && (
        <ExercisePicker
          token={token}
          onPick={(e) => {
            setItems([
              ...items,
              { exerciseId: e.id, name: e.name, sets: '3', reps: '', weight: '', rir: '' },
            ]);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </section>
  );
}
