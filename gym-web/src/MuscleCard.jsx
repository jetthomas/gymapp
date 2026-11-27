import { useEffect, useState } from 'react';
import { getMuscles } from './api';
import { Meter } from './CaloriesScreen';

// Sets per muscle over the last 30 days, most trained first; the Progress page has the body map
export default function MuscleCard({ token }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    // The dashboard works without this card, so a failure just leaves it out
    getMuscles(token, 30)
      .then((list) => setRows(list.filter((r) => r.sets > 0).sort((a, b) => b.sets - a.sets)))
      .catch(() => {});
  }, [token]);

  if (!rows) return null;
  const most = rows[0]?.sets;

  return (
    <section className="card" aria-labelledby="muscles-card-title">
      <h2 id="muscles-card-title" className="eyebrow">
        Progress
      </h2>
      <p className="panel-title">Muscles trained in the last 30 days</p>
      {rows.length === 0 && <p className="hint">Nothing logged in the last 30 days.</p>}
      <dl className="bar-list">
        {rows.map((r) => (
          <div key={r.muscle}>
            <dt>{r.muscle}</dt>
            <dd>
              <Meter value={r.sets} max={most} />
            </dd>
            <dd>{r.sets}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
