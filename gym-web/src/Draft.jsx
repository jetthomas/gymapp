import { getBest, getLastSets } from './api';
import { fromKg, weightUnit } from './units';

// The workout in progress, kept in the browser so a refresh or a dead battery doesn't lose it.
// One per member, so on a shared phone nobody else sees it or saves it as theirs
const keyFor = (userId) => `workout-draft-${userId}`;
// Where the one draft per browser lived before; whoever opens the app first takes it over
const OLD_KEY = 'workout-draft';

export function loadDraft(userId) {
  try {
    const draft = JSON.parse(localStorage.getItem(keyFor(userId)) ?? localStorage.getItem(OLD_KEY));
    // A draft saved before lb existed: kg, in a field called weightKg
    return (
      draft && {
        unit: 'kg',
        ...draft,
        exercises: draft.exercises.map((e) => ({
          ...e,
          sets: e.sets.map(({ weightKg, ...s }) => ({ weight: weightKg ?? '', ...s })),
        })),
      }
    );
  } catch {
    return null;
  }
}

export const saveDraft = (userId, draft) =>
  localStorage.setItem(keyFor(userId), JSON.stringify(draft));

export function clearDraft(userId) {
  localStorage.removeItem(keyFor(userId));
  localStorage.removeItem(OLD_KEY);
}

export const newDraft = () => ({
  // Sent with the save, so the server stores it once even if the request is repeated
  clientId: crypto.randomUUID(),
  // "Tuesday workout", so History isn't a list of identical names; the member can rename it
  name: `${new Date().toLocaleDateString(undefined, { weekday: 'long' })} workout`,
  startedAt: Date.now(),
  // Weights are typed in this unit for the whole workout, even if Settings changes halfway
  unit: weightUnit(),
  exercises: [],
});

// A workout done earlier and typed in afterwards: a date and a length instead of a running clock
export const newPastDraft = () => ({
  ...newDraft(),
  past: true,
  startedAt: Date.now() - 60 * 60 * 1000,
  minutes: '60',
});

// A saved workout opened for editing: every set already ticked, in the member's unit.
// Kept out of localStorage (editingId), so it never replaces a workout in progress
export const editDraft = (workout, unit) => ({
  editingId: workout.id,
  past: true,
  name: workout.name,
  startedAt: new Date(workout.date).getTime(),
  minutes: workout.durationSec ? String(Math.round(workout.durationSec / 60)) : '',
  unit,
  exercises: workout.exercises.map((e) => ({
    id: e.exerciseId,
    name: e.name,
    equipment: e.equipment,
    previous: [],
    unilateral: e.sets.some((s) => s.side),
    sets: e.sets.map((s) => ({
      weight: String(fromKg(s.weightKg, unit)),
      kg: s.weightKg, // saved back unchanged unless the weight is edited (setKg)
      reps: String(s.reps),
      rir: s.rir == null ? '' : String(s.rir),
      side: s.side,
      type: s.type,
      done: true,
    })),
  })),
});

// What an exercise added to a workout needs from the server: last time's sets (the grey
// "previous" column) and the best set so far (for PRs). No signal just means neither
export async function lastAndBest(token, exerciseId) {
  const [previous, best] = await Promise.all([
    getLastSets(token, exerciseId).catch(() => []),
    getBest(token, exerciseId)
      .then((b) => b.e1rmKg)
      .catch(() => null),
  ]);
  return { previous, best };
}

// A new workout laid out from a plan: a routine, or a past workout to do again.
// plan: [{ id, name, equipment, reps (to aim for, or null), sets: [{ type, side }] }]
export async function plannedDraft(token, name, plan) {
  const exercises = await Promise.all(
    plan.map(async (p) => ({
      id: p.id,
      name: p.name,
      equipment: p.equipment,
      targetReps: p.reps ?? null,
      unilateral: p.sets.some((s) => s.side),
      ...(await lastAndBest(token, p.id)),
      sets: p.sets.map((s) => ({ ...newSet(), type: s.type, side: s.side })),
    })),
  );
  return { ...newDraft(), name, exercises };
}

// Fields are strings while typing; '' = not filled in yet. `weight` is in the draft's unit
export const newSet = () => ({ weight: '', reps: '', rir: '', done: false });

// A time as a datetime-local box shows it, "2026-11-28T18:30", in the phone's own time zone
export function toLocalInput(ms) {
  const d = new Date(ms);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// The rest timer's length in seconds, set on the Account screen; 90 until the member picks another
export const restSeconds = () => Number(localStorage.getItem('rest-seconds')) || 90;

// 754000 -> "12:34"
export function clock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
