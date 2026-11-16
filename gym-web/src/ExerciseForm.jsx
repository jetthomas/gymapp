import { useState } from 'react';
import { createExercise, updateExercise } from './api';
import ErrorMsg from './ErrorMsg';
import { MUSCLES } from './muscles';
import useSubmit from './useSubmit';

// Every equipment value in the library, so editing a library exercise keeps its own
const EQUIPMENT = [
  'bands',
  'barbell',
  'body only',
  'cable',
  'dumbbell',
  'e-z curl bar',
  'exercise ball',
  'foam roll',
  'kettlebells',
  'machine',
  'medicine ball',
  'other',
];

// One group of 17 checkboxes; a muscle ticked in the other group is disabled here,
// because the API accepts each muscle once per exercise
function MuscleBoxes({ legend, picked, taken, onChange }) {
  return (
    <fieldset className="muscle-boxes">
      <legend>{legend}</legend>
      {MUSCLES.map((m) => (
        <label className="check" key={m}>
          <input
            type="checkbox"
            checked={picked.includes(m)}
            disabled={taken.includes(m)}
            onChange={() =>
              onChange(picked.includes(m) ? picked.filter((x) => x !== m) : [...picked, m])
            }
          />
          {m}
        </label>
      ))}
    </fieldset>
  );
}

// Adds an exercise, or edits `exercise` when one is given
export default function ExerciseForm({ token, exercise, onSaved, onDelete, onCancel }) {
  const [name, setName] = useState(exercise?.name ?? '');
  const [equipment, setEquipment] = useState(exercise?.equipment ?? '');
  const [primary, setPrimary] = useState(exercise?.primaryMuscles ?? []);
  const [secondary, setSecondary] = useState(exercise?.secondaryMuscles ?? []);
  const { loading, message, run } = useSubmit();

  function handleSubmit(event) {
    event.preventDefault();
    run(async () => {
      const body = {
        name,
        equipment: equipment || null,
        primaryMuscles: primary,
        secondaryMuscles: secondary,
      };
      if (exercise) await updateExercise(token, exercise.id, body);
      else await createExercise(token, body);
      onSaved();
    });
  }

  return (
    <form className="exercise-form" onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor="exercise-name">Name</label>
        <input
          id="exercise-name"
          maxLength={100}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="exercise-equipment">Equipment</label>
        <select
          id="exercise-equipment"
          className="role-select"
          value={equipment}
          onChange={(e) => setEquipment(e.target.value)}
        >
          <option value="">None</option>
          {EQUIPMENT.map((q) => (
            <option key={q}>{q}</option>
          ))}
        </select>
      </div>
      <MuscleBoxes legend="Main muscles" picked={primary} taken={secondary} onChange={setPrimary} />
      <MuscleBoxes
        legend="Secondary muscles"
        picked={secondary}
        taken={primary}
        onChange={setSecondary}
      />
      <ErrorMsg>{message}</ErrorMsg>
      <button className="login-btn" type="submit" disabled={loading}>
        {loading ? 'Saving…' : exercise ? 'Save changes' : 'Add exercise'}
      </button>
      {exercise && (
        <button className="link-btn danger" type="button" onClick={onDelete} disabled={loading}>
          Delete exercise
        </button>
      )}
      <button className="link-btn" type="button" onClick={onCancel} disabled={loading}>
        Cancel
      </button>
    </form>
  );
}
