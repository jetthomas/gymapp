import { useRef, useState } from 'react';
import { createWorkout, getExercises } from './api';
import ErrorMsg from './ErrorMsg';
import ExercisePicker from './ExercisePicker';
import { importId, matchExercises, readWorkouts, workoutBody } from './importCsv';
import { weightUnit } from './units';
import { shortDate } from './week';

// Account: brings in workout history from another app's CSV export. The member checks which
// library exercise each name in the file is (or skips it), then each workout is saved like a new one
export default function ImportCard({ token }) {
  const input = useRef(null);
  const [file, setFile] = useState(null); // what readWorkouts found in the file; null = none chosen
  const [choices, setChoices] = useState(new Map()); // each name in the file -> its exercise, null = skip
  const [unit, setUnit] = useState(weightUnit);
  const [picking, setPicking] = useState(null); // the name whose exercise is being picked
  const [progress, setProgress] = useState(null); // { done, total } while saving
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function read(event) {
    const chosen = event.target.files[0];
    event.target.value = ''; // so picking the same file again still reads it
    if (!chosen) return;
    setError('');
    setNotice('');
    try {
      const found = readWorkouts(await chosen.text());
      if (found.workouts.length === 0) throw new Error('This file has no sets to import.');
      const sets = new Map();
      for (const e of found.workouts.flatMap((w) => w.exercises)) {
        sets.set(e.name, (sets.get(e.name) ?? 0) + e.sets.length);
      }
      setChoices(matchExercises([...sets.keys()], await getExercises(token)));
      setFile({ ...found, sets });
      if (found.unit) setUnit(found.unit);
    } catch (err) {
      setError(err.message);
    }
  }

  async function save() {
    const ids = new Map([...choices].filter(([, e]) => e).map(([name, e]) => [name, e.id]));
    // The API refuses a workout in the future
    const todo = file.workouts
      .map((w) => [w, workoutBody(w, unit, ids)])
      .filter(([, body]) => body && Date.parse(body.date) <= Date.now());
    setError('');
    let done = 0;
    setProgress({ done, total: todo.length });
    try {
      for (const [w, body] of todo) {
        await createWorkout(token, { clientId: await importId(w), ...body });
        done += 1;
        setProgress({ done, total: todo.length });
      }
      setNotice(`Done: ${todo.length} workouts from the file are in your history.`);
      setFile(null);
    } catch (err) {
      setError(
        `Stopped after ${done} of ${todo.length}: ${err.message} Importing the file again skips the ones already saved.`,
      );
    } finally {
      setProgress(null);
    }
  }

  const choose = (name, exercise) => setChoices(new Map(choices).set(name, exercise));
  // Ones with no match first: they're the ones to look at
  const names = file
    ? [...file.sets.keys()].sort(
        (a, b) => !!choices.get(a) - !!choices.get(b) || file.sets.get(b) - file.sets.get(a),
      )
    : [];
  const unmatched = names.filter((n) => !choices.get(n)).length;

  return (
    <section className={file ? 'card' : 'card split'} aria-labelledby="import-title">
      <div>
        <h2 id="import-title" className="section-title">
          Import workouts
        </h2>
        <p className="row-sub">
          {file
            ? `${file.workouts.length} workouts, ${shortDate(file.workouts[0].start)} to ${shortDate(file.workouts.at(-1).start)}.`
            : 'Bring your history from another app: export it there as a CSV file, then choose it here.'}
        </p>
        <ErrorMsg>{error}</ErrorMsg>
        {notice && (
          <p className="msg success" role="status">
            {notice}
          </p>
        )}
      </div>
      {/* Hidden, opened by the button: a file box can't be styled like the other buttons */}
      <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={read} />
      {!file && (
        <button className="outline-btn" type="button" onClick={() => input.current.click()}>
          Choose file
        </button>
      )}

      {file && (
        <>
          {file.skipped > 0 && (
            <p className="hint">
              {file.skipped} timed or distance {file.skipped === 1 ? 'set has' : 'sets have'} no
              reps, so {file.skipped === 1 ? 'it’s' : 'they’re'} left out.
            </p>
          )}
          {/* The file says its unit only in some layouts */}
          {!file.unit && (
            <fieldset className="field import-unit">
              <legend>Weights in this file are in</legend>
              <div className="segmented">
                {['kg', 'lb'].map((u) => (
                  <label key={u}>
                    <input
                      type="radio"
                      name="import-unit"
                      value={u}
                      checked={unit === u}
                      onChange={() => setUnit(u)}
                    />
                    {u}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <h3 className="group-title">
            Exercises
            {unmatched > 0 && <span className="row-sub"> · {unmatched} to pick or skip</span>}
          </h3>
          <div className="group">
            {names.map((name) => {
              const exercise = choices.get(name);
              return (
                <div className="row static" key={name}>
                  <span className="row-text">
                    {name}
                    <span className="row-sub">
                      {exercise ? `Saved as ${exercise.name}` : 'Skipped'} · {file.sets.get(name)}{' '}
                      {file.sets.get(name) === 1 ? 'set' : 'sets'}
                    </span>
                  </span>
                  <button
                    className="ghost-btn"
                    type="button"
                    aria-label={`Pick the exercise for ${name}`}
                    disabled={!!progress}
                    onClick={() => setPicking(name)}
                  >
                    {exercise ? 'Change' : 'Pick'}
                  </button>
                  {exercise && (
                    <button
                      className="ghost-btn"
                      type="button"
                      aria-label={`Skip ${name}`}
                      disabled={!!progress}
                      onClick={() => choose(name, null)}
                    >
                      Skip
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="form-buttons">
            <button
              className="outline-btn wide"
              type="button"
              disabled={!!progress}
              onClick={() => setFile(null)}
            >
              Cancel
            </button>
            <button className="login-btn" type="button" disabled={!!progress} onClick={save}>
              {progress ? `Saving ${progress.done} of ${progress.total}…` : 'Import'}
            </button>
          </div>
        </>
      )}
      {picking && (
        <ExercisePicker
          token={token}
          title={`Save “${picking}” as`}
          onPick={(e) => {
            choose(picking, e);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </section>
  );
}
