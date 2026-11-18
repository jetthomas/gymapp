import { useEffect, useState } from 'react';
import { getMuscles } from './api';
import { MUSCLES } from './muscles';

// One half of each figure (x <= 100), as polygons per muscle; Figure draws each one again mirrored at x = 200 - x
// prettier-ignore
const FRONT = {
  neck: [[[92, 42], [100, 48], [100, 58], [88, 55]]],
  traps: [[[88, 50], [89, 57], [72, 61], [78, 55]]],
  shoulders: [[[72, 60], [61, 61], [53, 70], [54, 87], [62, 80], [68, 68]]],
  chest: [[[99, 61], [75, 62], [68, 70], [70, 87], [84, 94], [99, 92]]],
  biceps: [[[55, 89], [63, 82], [67, 90], [65, 115], [57, 121], [51, 109]]],
  forearms: [[[51, 123], [58, 122], [63, 128], [57, 158], [51, 170], [45, 168], [43, 148]]],
  abdominals: [
    [[87, 96], [99, 95], [99, 110], [86, 111]],
    [[86, 113], [99, 112], [99, 127], [86, 127]],
    [[86, 129], [99, 129], [99, 143], [87, 143]],
    [[87, 145], [99, 145], [99, 166], [92, 160]],
    // the obliques
    [[71, 95], [84, 97], [84, 139], [75, 135], [69, 115]],
  ],
  abductors: [[[66, 140], [74, 137], [75, 146], [69, 176], [64, 160]]],
  quadriceps: [
    [[69, 176], [75, 146], [81, 170], [77, 229], [71, 225], [66, 204]],
    [[81, 170], [75, 146], [86, 152], [92, 176], [90, 220], [83, 234], [77, 229]],
  ],
  adductors: [[[87, 152], [98, 164], [96, 184], [92, 196], [92, 176]]],
  calves: [
    [[71, 244], [79, 241], [80, 276], [75, 282], [69, 262]],
    [[79, 241], [86, 246], [87, 262], [82, 284], [80, 276]],
  ],
};
// prettier-ignore
const BACK = {
  neck: [[[93, 42], [100, 44], [100, 52], [91, 52]]],
  traps: [[[100, 46], [92, 52], [73, 60], [85, 68], [100, 90]]],
  shoulders: [[[72, 60], [61, 61], [53, 70], [54, 87], [64, 80], [71, 68]]],
  'middle back': [[[73, 62], [85, 68], [100, 90], [100, 100], [88, 98], [70, 88], [66, 74]]],
  lats: [[[66, 77], [70, 89], [88, 100], [88, 118], [80, 131], [72, 123], [66, 101]]],
  'lower back': [[[90, 103], [100, 103], [100, 134], [90, 136], [88, 118]]],
  triceps: [[[55, 89], [64, 82], [67, 92], [65, 115], [57, 121], [51, 108]]],
  forearms: [[[51, 123], [58, 122], [63, 128], [57, 158], [51, 170], [45, 168], [43, 148]]],
  glutes: [[[74, 135], [90, 137], [100, 139], [100, 166], [88, 172], [74, 168], [68, 152]]],
  hamstrings: [
    [[70, 173], [82, 175], [80, 231], [74, 227], [68, 200]],
    [[82, 175], [96, 173], [94, 200], [90, 227], [82, 234], [80, 231]],
  ],
  calves: [
    [[72, 243], [81, 240], [80, 274], [74, 268], [70, 255]],
    [[81, 240], [88, 244], [88, 262], [82, 280], [80, 274]],
  ],
};
// Head, hands, knees and feet: never shaded
// prettier-ignore
const BODY = [
  [[100, 6], [89, 10], [85, 24], [89, 37], [96, 43], [100, 44]],
  [[45, 170], [51, 172], [50, 188], [43, 185], [41, 176]],
  [[71, 227], [77, 231], [83, 236], [82, 240], [71, 242]],
  [[74, 284], [82, 286], [86, 300], [84, 306], [70, 306]],
];

// Sets in the period -> how strongly the muscle is filled in; 40 is about 10 sets a week
const shade = (sets) => (sets >= 40 ? 1 : sets >= 20 ? 0.7 : sets > 0 ? 0.4 : 0);

// A shape and its mirror image, as SVG points strings
const halves = (shape) => [shape, shape.map(([x, y]) => [200 - x, y])].map((h) => h.join(' '));

function Figure({ shapes, sets, dx, label, hovered, onHover }) {
  return (
    // The card colour as the outline is what cuts the body into facets
    <g
      transform={`translate(${dx})`}
      stroke="var(--surface)"
      strokeWidth="1.5"
      strokeLinejoin="round"
    >
      {BODY.flatMap(halves).map((points) => (
        <polygon key={points} points={points} fill="var(--border)" />
      ))}
      {Object.entries(shapes).map(([muscle, list]) => {
        const opacity = shade(sets[muscle] ?? 0);
        return (
          // A light outline marks the muscle under the pointer, on both figures
          <g
            key={muscle}
            stroke={muscle === hovered ? 'var(--text)' : undefined}
            onMouseEnter={() => onHover(muscle)}
            onMouseLeave={() => onHover(null)}
          >
            {list.flatMap(halves).map((points) => (
              <g key={points}>
                <polygon points={points} fill="var(--input-border)" />
                {opacity > 0 && (
                  <polygon points={points} fill="var(--accent)" fillOpacity={opacity} />
                )}
              </g>
            ))}
          </g>
        );
      })}
      <text x="100" y="324" textAnchor="middle" className="muscle-figure-label">
        {label}
      </text>
    </g>
  );
}

// A front and back body, each muscle shaded by how many sets hit it in the last 30 days
export default function MuscleMap({ token }) {
  const [sets, setSets] = useState(null); // { chest: 24, ... }; null = still loading
  const [hovered, setHovered] = useState(null); // the muscle under the pointer

  useEffect(() => {
    // The card just stays hidden if this fails
    getMuscles(token)
      .then((rows) => setSets(Object.fromEntries(rows.map((r) => [r.muscle, r.sets]))))
      .catch(() => {});
  }, [token]);

  if (!sets) return null;
  const trained = MUSCLES.filter((m) => sets[m] > 0).sort((a, b) => sets[b] - sets[a]);
  const untrained = MUSCLES.filter((m) => !sets[m]);
  const hoveredSets = sets[hovered] ?? 0;

  return (
    <section className="card" aria-labelledby="muscles-title">
      <h2 id="muscles-title" className="card-title">
        Muscles trained
      </h2>
      <p className="row-sub">Sets in the last 30 days. Brighter means more.</p>
      <div className="muscle-map">
        {/* The figure is a picture; the list beside it carries the same numbers as text */}
        <div className="muscle-figure" aria-hidden="true">
          <svg viewBox="36 0 278 332">
            <Figure
              shapes={FRONT}
              sets={sets}
              dx={0}
              label="Front"
              hovered={hovered}
              onHover={setHovered}
            />
            <Figure
              shapes={BACK}
              sets={sets}
              dx={150}
              label="Back"
              hovered={hovered}
              onHover={setHovered}
            />
          </svg>
          <p className="muscle-hover">
            {hovered ? (
              <>
                <strong>{hovered}</strong> ·{' '}
                {hoveredSets
                  ? `${hoveredSets} ${hoveredSets === 1 ? 'set' : 'sets'}`
                  : 'not trained'}
              </>
            ) : (
              'Point at a muscle to see its name'
            )}
          </p>
        </div>
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
