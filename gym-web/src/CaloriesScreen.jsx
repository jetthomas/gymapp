import { useEffect, useState } from 'react';
import { deleteFood, getFood, getHealth } from './api';
import ErrorMsg from './ErrorMsg';
import FoodSheet from './FoodSheet';
import ProfileForm from './ProfileForm';
import targets from './targets';
import { MACROS, MEALS } from './meals';
import { addDays, dayKey } from './week';

const today = () => dayKey(new Date());
// P 50g · C 100g · F 20g in the macro tile colours, summed over one food or a whole meal
const macros = (foods) =>
  [
    ['P', 'proteinG', 'macro-protein'],
    ['C', 'carbsG', 'macro-carbs'],
    ['F', 'fatG', 'macro-fat'],
  ].map(([letter, field, className]) => (
    <span key={field} className={className}>
      {letter} {Math.round(foods.reduce((t, f) => t + f[field], 0))}g
    </span>
  ));

// A filled bar: `value` out of `max`, amber once it goes over
export function Meter({ value, max }) {
  return (
    <div className={`meter${value > max ? ' over' : ''}`} aria-hidden="true">
      <span style={{ '--v': Math.min(1, value / max) }} />
    </div>
  );
}

// Today's calories: what's left, the macros, then each meal
export default function CaloriesScreen({ token, plus }) {
  const [profile, setProfile] = useState(undefined); // undefined = loading; null = nothing saved yet
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(today);
  const [day, setDay] = useState(null); // { date, entries } for the day last loaded
  const [addingTo, setAddingTo] = useState(null); // the meal the food sheet is open for
  const [editingFood, setEditingFood] = useState(null); // the logged food the sheet is editing
  const [error, setError] = useState('');
  const [changes, setChanges] = useState(0); // goes up after each save, to load again
  const [removing, setRemoving] = useState(null); // the entry being deleted

  useEffect(() => {
    getHealth(token)
      .then(setProfile)
      .catch((err) => setError(err.message));
  }, [token, changes]);

  useEffect(() => {
    // An older, slower answer (from before a delete) must not replace a newer one
    let stale = false;
    getFood(token, date)
      .then((entries) => {
        if (stale) return;
        setDay({ date, entries });
        setError('');
      })
      .catch((err) => {
        if (!stale) setError(err.message);
      });
    return () => {
      stale = true;
    };
  }, [token, date, changes]);

  const target = profile && targets(profile);
  // Another day's entries are not shown while this day's are loading
  const entries = day?.date === date ? day.entries : null;
  const sum = (field) => (entries ?? []).reduce((total, e) => total + e[field], 0);
  const eaten = sum('kcal');

  async function remove(id) {
    setRemoving(id);
    try {
      await deleteFood(token, id);
      // c + 1, not changes + 1: two removes started from the same render would both count as one
      setChanges((c) => c + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setRemoving(null);
    }
  }

  if (profile === undefined) {
    return (
      <main className="admin-content">
        <ErrorMsg>{error}</ErrorMsg>
        {!error && <p className="msg">Loading…</p>}
      </main>
    );
  }

  if (!target || editing) {
    return (
      <main className="admin-content calories">
        <button
          className="outline-btn back-btn"
          type="button"
          // Editing goes back to the day it came from; a first visit has no day yet, so the page before
          onClick={() => (target ? setEditing(false) : window.history.back())}
        >
          <span aria-hidden="true">‹</span> Back
        </button>
        <div className="page-head">
          <h1 className="page-title">Calories</h1>
        </div>
        <ProfileForm
          token={token}
          profile={profile}
          today={today()}
          onSaved={() => {
            setEditing(false);
            setChanges(changes + 1);
          }}
          onCancel={() => setEditing(false)}
        />
      </main>
    );
  }

  return (
    <main className="admin-content calories">
      <div className="page-head">
        <div>
          <h1 className="page-title">{date === today() ? 'Today' : 'Calories'}</h1>
          <p className="admin-subtitle">
            {new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            })}
          </p>
        </div>
        <div className="day-switch">
          <button
            className="outline-btn"
            type="button"
            aria-label="Previous day"
            onClick={() => setDate(addDays(date, -1))}
          >
            ‹
          </button>
          <button
            className="outline-btn"
            type="button"
            aria-label="Next day"
            disabled={date === today()}
            onClick={() => setDate(addDays(date, 1))}
          >
            ›
          </button>
        </div>
      </div>
      <ErrorMsg>{error}</ErrorMsg>

      <section className="card" aria-label="Summary">
        <div className="section-head">
          <p className="kcal-left">
            {eaten > target.kcal
              ? `${(eaten - target.kcal).toLocaleString()} over`
              : `${(target.kcal - eaten).toLocaleString()} left`}
          </p>
          <button className="link-btn" type="button" onClick={() => setEditing(true)}>
            Edit target
          </button>
        </div>
        <Meter value={eaten} max={target.kcal} />
        <div className="meter-ends">
          <span>{eaten.toLocaleString()} eaten</span>
          <span>{target.kcal.toLocaleString()} target</span>
        </div>
        <dl className="macros">
          {MACROS.map(([label, field]) => (
            <div key={field}>
              <dt>{label}</dt>
              <Meter value={sum(field)} max={target[field]} />
              <dd>
                {Math.round(sum(field))} / {target[field]} g
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {entries === null && !error && <p className="msg">Loading…</p>}
      {entries &&
        MEALS.map(([meal, label]) => {
          const foods = entries.filter((e) => e.meal === meal);
          return (
            <section className="card" key={meal} aria-label={label}>
              <div className="food-row">
                <h2 className="card-title">{label}</h2>
                <span className="row-sub">
                  {foods.reduce((t, f) => t + f.kcal, 0)} cal · {macros(foods)}
                </span>
              </div>
              {foods.map((f) => (
                <div className="food-row" key={f.id}>
                  <span>{f.name}</span>
                  <span className="row-sub">
                    {f.kcal} cal · {macros([f])}
                  </span>
                  <button
                    className="link-btn"
                    type="button"
                    aria-label={`Edit ${f.name}`}
                    onClick={() => setEditingFood(f)}
                  >
                    Edit
                  </button>
                  <button
                    className="link-btn danger"
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => remove(f.id)}
                    disabled={removing !== null}
                  >
                    {removing === f.id ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              ))}
              <button className="link-btn" type="button" onClick={() => setAddingTo(meal)}>
                + Add food
              </button>
            </section>
          );
        })}

      {(addingTo || editingFood) && (
        <FoodSheet
          token={token}
          plus={plus}
          date={date}
          meal={editingFood?.meal ?? addingTo}
          food={editingFood}
          onAdded={() => {
            setAddingTo(null);
            setEditingFood(null);
            setChanges(changes + 1);
          }}
          onClose={() => {
            setAddingTo(null);
            setEditingFood(null);
          }}
        />
      )}
    </main>
  );
}
