// Plus: the weight to try today, from last time's sets, as Boostcamp's auto progression does.
// If every working set reached the target reps (the routine's, else the first set's) and none was
// all-out (RIR 0, or marked as to failure): one step up from the heaviest. Otherwise stay at it.
// Returns { kg, up }, or null when there's nothing to go on
export function suggest(previous, targetReps, stepKg) {
  const working = previous.filter((s) => s.type !== 'warmup');
  if (!working.length || !stepKg) return null;
  const target = targetReps ?? working[0].reps;
  const top = Math.max(...working.map((s) => s.weightKg));
  const hard = working.some((s) => s.rir === 0 || s.type === 'failure');
  const up = !hard && working.every((s) => s.reps >= target);
  return { kg: up ? Math.round((top + stepKg) * 1000) / 1000 : top, up };
}

const NO_WEIGHT = ['body only', 'bands', 'exercise ball', 'foam roll', 'medicine ball'];

// One step up, in kg: 2 kg for dumbbells and kettlebells, 2.5 kg for the rest, or 5 lb in lb.
// 0 for exercises without a weight to add (bodyweight, bands), which get no suggestion
export function stepKg(equipment, unit) {
  if (NO_WEIGHT.includes(equipment)) return 0;
  if (unit === 'lb') return 5 * 0.45359237;
  return ['dumbbell', 'kettlebells'].includes(equipment) ? 2 : 2.5;
}

// The estimated one-rep max of a set (Epley), the same as the API's for PRs and progress charts
export const e1rm = (kg, reps) => kg * (1 + reps / 30);
