import { useEffect, useState } from 'react';
import { getFood, getHealth } from './api';
import { Meter, Ring } from './CaloriesScreen';
import targets from './targets';
import { MACROS, MEALS } from './meals';
import { dayKey } from './week';

const total = (entries, field) => entries.reduce((sum, e) => sum + e[field], 0);

// Today's calories at a glance, and the last food logged; the Calories page has the detail
export default function CaloriesCard({ token, onOpen }) {
  const [profile, setProfile] = useState(undefined); // undefined = loading; null = nothing saved yet
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    // The dashboard works without this card, so a failure just leaves it out
    getHealth(token)
      .then(setProfile)
      .catch(() => {});
    getFood(token, dayKey(new Date()))
      .then(setEntries)
      .catch(() => {});
  }, [token]);

  if (profile === undefined || !entries) return null;

  const target = profile && targets(profile);
  if (!target) {
    return (
      <section className="card" aria-labelledby="calories-title">
        <h2 id="calories-title" className="eyebrow">
          Calories
        </h2>
        <p className="hint">Set a goal to see how much is left to eat each day.</p>
        <div className="card-actions">
          <button className="pill-btn filled" type="button" onClick={onOpen}>
            Set up calories
          </button>
        </div>
      </section>
    );
  }

  const eaten = total(entries, 'kcal');
  const left = target.kcal - eaten;
  // The newest entry has the highest id
  const last = entries.reduce((a, e) => (!a || e.id > a.id ? e : a), null);

  return (
    <>
      <section className="card" aria-labelledby="calories-title">
        <h2 id="calories-title" className="eyebrow">
          Calories
        </h2>
        <div className="ring-summary">
          <Ring value={eaten} max={target.kcal}>
            <span className="ring-value">{Math.abs(left).toLocaleString()}</span>
            <span className="eyebrow">{left < 0 ? 'kcal over' : 'kcal remaining'}</span>
          </Ring>
          <dl className="figures">
            <div>
              <dt className="eyebrow">Goal</dt>
              <dd>{target.kcal.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="eyebrow">Eaten</dt>
              <dd>{eaten.toLocaleString()}</dd>
            </div>
          </dl>
        </div>
        <ul className="list card-rows">
          {MEALS.map(([meal, label]) => {
            const kcal = total(
              entries.filter((e) => e.meal === meal),
              'kcal',
            );
            return (
              <li key={meal}>
                {label}
                <span className="row-sub">{kcal.toLocaleString()} kcal</span>
              </li>
            );
          })}
        </ul>
        <dl className="macro-tiles">
          {MACROS.map(([label, field]) => (
            <div key={field}>
              <dt>{label}</dt>
              <dd>
                <strong>{Math.round(total(entries, field))}</strong> / {target[field]} g
              </dd>
              <Meter value={total(entries, field)} max={target[field]} />
            </div>
          ))}
        </dl>
        <button className="outline-btn wide" type="button" onClick={onOpen}>
          + Log a meal
        </button>
      </section>

      {last && (
        <section className="card last-entry" aria-labelledby="last-entry-title">
          <div>
            <h2 id="last-entry-title" className="eyebrow">
              Last entry · {Object.fromEntries(MEALS)[last.meal]}
            </h2>
            <p>
              <strong>{last.name}</strong> <span className="row-sub">· {last.kcal} kcal</span>
            </p>
          </div>
          <button className="link-btn" type="button" onClick={onOpen}>
            View daily log <span aria-hidden="true">→</span>
          </button>
        </section>
      )}
    </>
  );
}
