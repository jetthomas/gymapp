import { useEffect, useState } from 'react';
import { getProgress } from './api';
import BarChart from './BarChart';
import ErrorMsg from './ErrorMsg';

// Plus: an exercise's best estimated one-rep max in each workout that had it, oldest first
export default function ProgressChart({ token, exerciseId }) {
  const [points, setPoints] = useState(null); // null = still loading
  const [error, setError] = useState('');

  useEffect(() => {
    getProgress(token, exerciseId)
      .then(setPoints)
      .catch((err) => setError(err.message));
  }, [token, exerciseId]);

  if (error) return <ErrorMsg>{error}</ErrorMsg>;
  if (!points) return <p className="msg">Loading…</p>;
  // BarChart labels its first, middle and last bar, which are only all different from 3 bars up
  if (points.length < 3) {
    return <p className="hint">Log this exercise in 3 workouts to see your trend.</p>;
  }
  // "2026-11-20" -> "11-20"
  const data = points.map((p) => ({ label: p.day.slice(5), value: Math.round(p.est1rmKg) }));
  const best = Math.max(...data.map((d) => d.value));
  return (
    <BarChart
      title="Estimated one-rep max (kg)"
      summary={`Your best set in each of the last ${points.length} workouts`}
      total={best}
      totalLabel="kg best"
      data={data}
      max={Math.ceil(best / 10) * 10}
    />
  );
}
