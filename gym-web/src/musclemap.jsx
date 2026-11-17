import { useEffect, useState } from 'react';
import { getMuscles } from './api';
import { MUSCLES } from './muscles';

// Where each muscle sits on the figure, as [x, y, width, height] boxes.
// shortcut: a figure made of rounded boxes; swap in drawn <path>s per muscle for a lifelike body
const FRONT = {
  neck: [[92, 46, 16, 12]],
  traps: [
    [72, 56, 22, 10],
    [106, 56, 22, 10],
  ],
  shoulders: [
    [48, 60, 22, 24],
    [130, 60, 22, 24],
  ],
  chest: [
    [73, 68, 26, 28],
    [101, 68, 26, 28],
  ],
  biceps: [
    [46, 88, 18, 40],
    [136, 88, 18, 40],
  ],
  forearms: [
    [40, 132, 18, 46],
    [142, 132, 18, 46],
  ],
  abdominals: [[80, 100, 40, 54]],
  abductors: [
    [62, 158, 10, 32],
    [128, 158, 10, 32],
  ],
  quadriceps: [
    [74, 160, 16, 78],
    [110, 160, 16, 78],
  ],
  adductors: [
    [92, 160, 7, 50],
    [101, 160, 7, 50],
  ],
  calves: [
    [74, 244, 16, 60],
    [110, 244, 16, 60],
  ],
};
const BACK = {
  neck: [[92, 46, 16, 12]],
  traps: [[78, 56, 44, 16]],
  shoulders: [
    [48, 60, 22, 24],
    [130, 60, 22, 24],
  ],
  'middle back': [[84, 74, 32, 26]],
  lats: [
    [72, 78, 10, 48],
    [118, 78, 10, 48],
  ],
  'lower back': [[84, 102, 32, 30]],
  triceps: [
    [46, 88, 18, 40],
    [136, 88, 18, 40],
  ],
  forearms: [
    [40, 132, 18, 46],
    [142, 132, 18, 46],
  ],
  glutes: [
    [72, 136, 27, 32],
    [101, 136, 27, 32],
  ],
  hamstrings: [
    [74, 172, 20, 66],
    [106, 172, 20, 66],
  ],
  calves: [
    [76, 244, 16, 60],
    [108, 244, 16, 60],
  ],
};

// Sets in the period -> how strongly the muscle is filled in; 40 is about 10 sets a week
const shade = (sets) => (sets >= 40 ? 1 : sets >= 20 ? 0.6 : sets > 0 ? 0.3 : 0);

function Figure({ boxes, sets, dx }) {
  return (
    <g transform={`translate(${dx})`}>
      <circle cx="100" cy="26" r="17" fill="var(--surface-2)" />
      {Object.entries(boxes).flatMap(([muscle, rects]) =>
        rects.map(([x, y, width, height]) => {
          const opacity = shade(sets[muscle] ?? 0);
          return (
            <rect
              key={`${muscle}${x}`}
              x={x}
              y={y}
              width={width}
              height={height}
              rx="5"
              fill={opacity ? 'var(--accent)' : 'var(--surface-2)'}
              fillOpacity={opacity || 1}
            />
          );
        }),
      )}
    </g>
  );
}

// A front and back body, each muscle shaded by how many sets hit it in the last 30 days
export default function MuscleMap({ token }) {
  const [sets, setSets] = useState(null); // { chest: 24, ... }; null = still loading

  useEffect(() => {
    // The card just stays hidden if this fails; the dashboard works without it
    getMuscles(token)
      .then((rows) => setSets(Object.fromEntries(rows.map((r) => [r.muscle, r.sets]))))
      .catch(() => {});
  }, [token]);

  if (!sets) return null;
  const trained = MUSCLES.filter((m) => sets[m] > 0).sort((a, b) => sets[b] - sets[a]);
  const untrained = MUSCLES.filter((m) => !sets[m]);

  return (
    <section className="card" aria-labelledby="muscles-title">
      <h2 id="muscles-title" className="card-title">
        Muscles trained
      </h2>
      <p className="row-sub">Sets in the last 30 days. Brighter means more.</p>
      <div className="muscle-map">
        {/* The figure is a picture; the list beside it carries the same numbers as text */}
        <svg viewBox="0 0 400 310" aria-hidden="true">
          <Figure boxes={FRONT} sets={sets} dx={0} />
          <Figure boxes={BACK} sets={sets} dx={200} />
        </svg>
        <div>
          {trained.length === 0 && <p className="hint">Nothing logged in the last 30 days.</p>}
          <dl className="muscle-list">
            {trained.map((m) => (
              <div key={m}>
                <dt>{m}</dt>
                <dd>{sets[m]}</dd>
              </div>
            ))}
          </dl>
          {untrained.length > 0 && trained.length > 0 && (
            <p className="hint">Not trained: {untrained.join(', ')}.</p>
          )}
        </div>
      </div>
    </section>
  );
}
