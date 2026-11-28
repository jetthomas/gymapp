import { useEffect, useState } from 'react';
import { deleteFood, getFood, getHealth } from './api';
import ErrorMsg from './ErrorMsg';
import FoodSheet from './FoodSheet';
import { ChevronLeft, ChevronRight, Sliders } from './icons';
import ProfileForm from './ProfileForm';
import targets from './targets';
import { MACROS, MEALS, total } from './meals';
import { addDays, dateText, dayKey } from './week';

const today = () => dayKey(new Date());
// P 50g · C 100g · F 20g, summed over one food or a whole meal
const macros = (foods) =>
  [
    ['P', 'proteinG', 'macro-protein'],
    ['C', 'carbsG', 'macro-carbs'],
    ['F', 'fatG', 'macro-fat'],
  ].map(([letter, field, className]) => (
    // A no-break space, so "F 22g" never splits across two lines
    <span key={field} className={className}>
      {letter}&nbsp;{Math.round(total(foods, field))}g
    </span>
  ));

// A filled bar: `value` out of `max`, full once it goes over
export function Meter({ value, max }) {
  return (
    <div className="meter" aria-hidden="true">
      <span style={{ '--v': Math.min(1, value / max) }} />
    </div>
  );
}

// A circle that fills clockwise from the top: `value` out of `max`, with `children` in the middle
export function Ring({ value, max, big, children }) {
  return (
    <div className={`ring${big ? ' big' : ''}`}>
      <svg viewBox="0 0 168 168" aria-hidden="true">
        <circle className="ring-track" cx="84" cy="84" r="78" />
        {/* Left out at 0, where its round end would still draw a dot */}
        {value > 0 && (
          <circle
            className="ring-fill"
            cx="84"
            cy="84"
            r="78"
            pathLength="100"
            style={{ '--v': Math.min(1, value / max) }}
          />
        )}
      </svg>
      <div className="ring-label">{children}</div>
    </div>
  );
}

// The ring with what's left in the middle, and the goal and what's eaten beside it.
// One copy for the Calories page (big) and the dashboard's card, so their words can't drift apart
export function RingSummary({ eaten, goal, big }) {
  return (
    <div className="ring-summary">
      <Ring value={eaten} max={goal} big={big}>
        <span className="ring-value">{Math.abs(goal - eaten).toLocaleString()}</span>
        <span className="eyebrow">{eaten > goal ? 'kcal over' : 'kcal left'}</span>
      </Ring>
      <dl className="figures">
        <div>
          <dt className="eyebrow">Goal</dt>
          <dd>{goal.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="eyebrow">Eaten</dt>
          <dd>{eaten.toLocaleString()}</dd>
        </div>
      </dl>
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
  const sum = (field) => total(entries ?? [], field);
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
          className="ghost-btn back-btn"
          type="button"
          // Editing goes back to the day it came from; a first visit has no day yet, so the page before
          onClick={() => (target ? setEditing(false) : window.history.back())}
        >
          <ChevronLeft size={18} /> Back
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

  const isToday = date === today();

  return (
    <main className="admin-content calories">
      <div className="page-head">
        <div>
          <p className="eyebrow">
            {dateText(`${date}T12:00:00`, { weekday: 'short', day: 'numeric', month: 'short' })}
          </p>
          <h1 className="page-title">{isToday ? 'Today' : 'Calories'}</h1>
        </div>
        <div className="head-actions">
          <button
            className="outline-btn icon"
            type="button"
            aria-label="Previous day"
            onClick={() => setDate(addDays(date, -1))}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="outline-btn icon"
            type="button"
            aria-label="Next day"
            disabled={isToday}
            onClick={() => setDate(addDays(date, 1))}
          >
            <ChevronRight size={18} />
          </button>
          <button className="outline-btn" type="button" onClick={() => setEditing(true)}>
            <Sliders size={18} />
            Edit target
          </button>
        </div>
      </div>
      <ErrorMsg>{error}</ErrorMsg>

      <section className="card" aria-label="Summary">
        <RingSummary eaten={eaten} goal={target.kcal} big />
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
              <div className="panel-head">
                <h2 className="card-title">{label}</h2>
                <span className="row-sub">
                  {total(foods, 'kcal')} kcal · {macros(foods)}
                </span>
              </div>
              {foods.length > 0 && (
                <ul className="list">
                  {foods.map((f) => (
                    <li className="food-row" key={f.id}>
                      <span className="row-text">
                        {f.name}
                        <span className="row-sub">
                          {f.kcal} kcal · {macros([f])}
                        </span>
                      </span>
                      <button
                        className="ghost-btn"
                        type="button"
                        aria-label={`Edit ${f.name}`}
                        onClick={() => setEditingFood(f)}
                      >
                        Edit
                      </button>
                      <button
                        className="ghost-btn danger"
                        type="button"
                        aria-label={`Remove ${f.name}`}
                        onClick={() => remove(f.id)}
                        disabled={removing !== null}
                      >
                        {removing === f.id ? 'Removing…' : 'Remove'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button className="add-btn" type="button" onClick={() => setAddingTo(meal)}>
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
