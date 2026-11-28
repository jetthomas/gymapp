import { useEffect, useState } from 'react';
import { getWeights, logWeight } from './api';
import ErrorMsg from './ErrorMsg';
import { decimal } from './numberInput';
import { fromKg, toKg, weightUnit } from './units';
import useSubmit from './useSubmit';
import { dateText, shortDate } from './week';

const noon = (day) => `${day}T12:00:00`;
// To 0.1, for the trend text: "Down 1.2 kg"
const tenth = (n) => Math.round(n * 10) / 10;

// A quick weigh-in for `date`, and the trend of the last 90 weigh-ins under it
export default function WeightCard({ token, date, isToday, onLogged }) {
  const unit = weightUnit();
  const [weights, setWeights] = useState(null); // null = loading
  const [error, setError] = useState('');
  const [weight, setWeight] = useState('');
  const [changes, setChanges] = useState(0);
  const { loading, message, run } = useSubmit();

  useEffect(() => {
    getWeights(token)
      .then(setWeights)
      .catch((err) => setError(err.message));
  }, [token, changes]);

  const logged = weights?.find((w) => w.date === date);
  // '.' alone is NaN, which fails this too
  const valid = Number(weight) > 0;

  function handleSubmit(event) {
    event.preventDefault();
    run(async () => {
      await logWeight(token, date, toKg(Number(weight), unit));
      setWeight('');
      setChanges((c) => c + 1);
      // The calorie target is worked out from the latest weight
      onLogged();
    });
  }

  let trend = null;
  if (weights?.length >= 2) {
    const change = tenth(fromKg(weights.at(-1).kg - weights[0].kg, unit));
    const since = dateText(noon(weights[0].date), { day: 'numeric', month: 'short' });
    trend =
      change === 0
        ? `No change since ${since}`
        : `${change < 0 ? 'Down' : 'Up'} ${Math.abs(change)} ${unit} since ${since}`;
  }

  return (
    <section className="card" aria-labelledby="weight-title">
      <h2 id="weight-title" className="card-title">
        Weight
      </h2>
      <form className="weigh-in" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="weigh-in">
            {isToday ? "Today's weight" : `Weight on ${shortDate(noon(date))}`} ({unit})
          </label>
          <input
            id="weigh-in"
            inputMode="decimal"
            // The day's weigh-in, if there is one; typing a new one replaces it
            placeholder={logged ? String(fromKg(logged.kg, unit)) : ''}
            value={weight}
            onChange={decimal(setWeight)}
          />
        </div>
        <button className="outline-btn" type="submit" disabled={loading || !valid}>
          {loading ? 'Saving…' : logged ? 'Update' : 'Log'}
        </button>
      </form>
      <ErrorMsg>{message || error}</ErrorMsg>
      {trend && (
        <>
          <p className="row-sub">{trend}</p>
          <WeightTrend weights={weights} unit={unit} />
        </>
      )}
      {weights?.length < 2 && (
        <p className="hint">Log your weight on two different days to see your trend.</p>
      )}
    </section>
  );
}

// shortcut: hand-drawn SVG line, like BarChart's CSS bars; use a chart library if it needs zoom or ranges
// The weigh-ins over time, oldest at the left and spaced by date. Pointing at it (or dragging a
// finger across it) reads out the nearest weigh-in; otherwise the readout is the latest
function WeightTrend({ weights, unit }) {
  const [at, setAt] = useState(null); // index of the weigh-in pointed at; null = none
  const time = (w) => new Date(noon(w.date)).getTime();
  const start = time(weights[0]);
  const span = time(weights.at(-1)) - start; // > 0: two weigh-ins are on two different days
  const values = weights.map((w) => fromKg(w.kg, unit));
  const low = Math.min(...values);
  const high = Math.max(...values);
  // At least 1 kg (or lb) top to bottom, so a day's water weight doesn't look like a cliff
  const pad = Math.max(0, 1 - (high - low)) / 2;
  const lo = Math.floor(low - pad);
  const hi = Math.ceil(high + pad);
  // 0 to 100 on both axes; y = 0 is the top
  const points = weights.map((w, i) => ({
    x: ((time(w) - start) / span) * 100,
    y: ((hi - values[i]) / (hi - lo)) * 100,
  }));
  const shown = at ?? points.length - 1;

  function point(event) {
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * 100;
    let nearest = 0;
    points.forEach((p, i) => {
      if (Math.abs(p.x - x) < Math.abs(points[nearest].x - x)) nearest = i;
    });
    setAt(nearest);
  }

  return (
    <figure className="weight-trend">
      <p className="trend-readout" aria-hidden="true">
        <strong>
          {values[shown]} {unit}
        </strong>{' '}
        · {shortDate(noon(weights[shown].date))}
      </p>
      <div
        className="trend-plot"
        aria-hidden="true"
        onPointerDown={point}
        onPointerMove={point}
        onPointerLeave={() => setAt(null)}
      >
        <span className="trend-label top">{hi}</span>
        <span className="trend-label bottom">{lo}</span>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          {at !== null && (
            <line className="trend-cursor" x1={points[at].x} x2={points[at].x} y1="0" y2="100" />
          )}
          <path
            className="trend-line"
            d={points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')}
          />
        </svg>
        {/* HTML, not SVG: the plot stretches to fit, which would squash a circle */}
        <span
          className="trend-dot"
          style={{ left: `${points[shown].x}%`, top: `${points[shown].y}%` }}
        />
      </div>
      <div className="bar-axis" aria-hidden="true">
        <span>{shortDate(noon(weights[0].date))}</span>
        <span>{shortDate(noon(weights.at(-1).date))}</span>
      </div>
      {/* The line is a picture; a screen reader gets the exact numbers from this table */}
      <div className="visually-hidden">
        <table>
          <caption>Weight ({unit})</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Weight</th>
            </tr>
          </thead>
          <tbody>
            {weights.map((w, i) => (
              <tr key={w.date}>
                <td>{shortDate(noon(w.date))}</td>
                <td>{values[i]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
