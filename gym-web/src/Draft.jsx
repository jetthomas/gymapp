// The workout in progress, kept in the browser so a refresh or a dead battery doesn't lose it.
// shortcut: one draft per browser, not per member; tag it with the user id if people share a phone
const KEY = 'workout-draft';

export function loadDraft() {
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export const saveDraft = (draft) => localStorage.setItem(KEY, JSON.stringify(draft));

export const clearDraft = () => localStorage.removeItem(KEY);

export const newDraft = () => ({
  // Sent with the save, so the server stores it once even if the request is repeated
  clientId: crypto.randomUUID(),
  name: 'Workout',
  startedAt: Date.now(),
  exercises: [],
});

// Fields are strings while typing; '' = not filled in yet
export const newSet = () => ({ weightKg: '', reps: '', rir: '', done: false });

// 754000 -> "12:34"
export function clock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
