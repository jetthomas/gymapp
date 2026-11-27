import { useState } from 'react';
import { deleteHealth, saveHealth } from './api';
import ConfirmDialog from './ConfirmDialog';
import ErrorMsg from './ErrorMsg';
import targets from './targets';
import useSubmit from './useSubmit';

// '' -> null, '80' -> 80
const number = (text) => (text === '' ? null : Number(text));

const GOALS = [
  ['lose', 'Lose weight'],
  ['maintain', 'Maintain'],
  ['lean_bulk', 'Lean bulk'],
  ['bulk', 'Bulk'],
];

// The questions behind the calorie target. Every one can be left blank
export default function ProfileForm({ token, profile, today, onSaved, onCancel }) {
  const [goal, setGoal] = useState(profile?.goal ?? 'maintain');
  const [birthDate, setBirthDate] = useState(profile?.birthDate ?? '');
  const [sex, setSex] = useState(profile?.sex ?? '');
  const [height, setHeight] = useState(String(profile?.heightCm ?? ''));
  const [weight, setWeight] = useState(String(profile?.weightKg ?? ''));
  const [activity, setActivity] = useState(String(profile?.activity ?? ''));
  const [own, setOwn] = useState(String(profile?.kcalTarget ?? ''));
  const [deleting, setDeleting] = useState(false);
  const { loading, message, run } = useSubmit();

  const answers = {
    goal,
    birthDate: birthDate || null,
    sex: sex || null,
    heightCm: number(height),
    weightKg: number(weight),
    activity: number(activity),
    kcalTarget: number(own),
  };
  const target = targets(answers);

  function handleSubmit(event) {
    event.preventDefault();
    run(async () => {
      // `today` files the weight under the member's own date
      await saveHealth(token, { ...answers, today });
      onSaved();
    });
  }

  // Digits with at most one decimal point
  const decimal = (set) => (e) => /^\d*\.?\d*$/.test(e.target.value) && set(e.target.value);

  return (
    <form className="card profile-form" onSubmit={handleSubmit}>
      <h2 className="card-title">Your calorie target</h2>
      <p className="row-sub">
        Used only to estimate your calories. Admins can't see any of it, and every answer is
        optional.
      </p>
      <div className="form-grid">
        {/* Radio buttons drawn as one segmented bar */}
        <fieldset className="field span-2">
          <legend>Goal</legend>
          <div className="segmented">
            {GOALS.map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="goal"
                  value={value}
                  checked={goal === value}
                  onChange={() => setGoal(value)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="weight">Weight (kg)</label>
          <input id="weight" inputMode="decimal" value={weight} onChange={decimal(setWeight)} />
        </div>
        <div className="field">
          <label htmlFor="height">Height (cm)</label>
          <input id="height" inputMode="decimal" value={height} onChange={decimal(setHeight)} />
        </div>
        <div className="field">
          <label htmlFor="birth-date">Date of birth</label>
          <input
            id="birth-date"
            type="date"
            max={today}
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="sex">Sex</label>
          <select
            id="sex"
            className="role-select"
            value={sex}
            onChange={(e) => setSex(e.target.value)}
          >
            <option value="">Prefer not to say</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
        </div>
        <div className="field span-2">
          <label htmlFor="activity">Activity level</label>
          <select
            id="activity"
            className="role-select"
            value={activity}
            onChange={(e) => setActivity(e.target.value)}
          >
            <option value="">Choose…</option>
            <option value="1">Sedentary: desk job, little exercise</option>
            <option value="2">Light: exercise 1 to 3 days a week</option>
            <option value="3">Moderate: exercise 3 to 5 days a week</option>
            <option value="4">Active: exercise 6 to 7 days a week</option>
            <option value="5">Very active: physical job plus training</option>
          </select>
        </div>
        <div className="field span-2">
          <label htmlFor="own-target">Or set your own daily calories</label>
          <input
            id="own-target"
            inputMode="numeric"
            value={own}
            onChange={(e) => /^\d*$/.test(e.target.value) && setOwn(e.target.value)}
          />
        </div>
      </div>
      <div className="estimate" role="status">
        {target ? (
          <>
            <p className="eyebrow">Your target</p>
            <p className="estimate-value">
              {target.kcal.toLocaleString()} <span>kcal a day.</span>
            </p>
            <p className="row-sub">
              {own
                ? 'Your own number.'
                : 'An estimate; adjust it if your weight is not moving the way you want.'}
            </p>
          </>
        ) : (
          <p className="row-sub">
            Fill in weight, height, date of birth and activity level for an estimate, or type your
            own number.
          </p>
        )}
      </div>
      <ErrorMsg>{message}</ErrorMsg>
      <div className="form-buttons">
        {profile && (
          <button className="outline-btn wide" type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="login-btn" type="submit" disabled={loading || !target}>
          {loading ? 'Saving…' : 'Save'}
        </button>
      </div>
      {profile && (
        <div className="form-danger">
          <button
            className="outline-btn danger"
            type="button"
            onClick={() => setDeleting(true)}
            disabled={loading}
          >
            Delete my health data
          </button>
        </div>
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete your health data?"
          body="Your answers, your weight log and every food entry are deleted for good."
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            setDeleting(false);
            run(async () => {
              await deleteHealth(token);
              onSaved();
            });
          }}
          onCancel={() => setDeleting(false)}
        />
      )}
    </form>
  );
}
