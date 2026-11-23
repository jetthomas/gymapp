// The workout in progress, kept in the browser so a refresh or a dead battery doesn't lose it.
// One per member, so on a shared phone nobody else sees it or saves it as theirs
const keyFor = (userId) => `workout-draft-${userId}`;
// Where the one draft per browser lived before; whoever opens the app first takes it over
const OLD_KEY = 'workout-draft';

export function loadDraft(userId) {
  try {
    return JSON.parse(localStorage.getItem(keyFor(userId)) ?? localStorage.getItem(OLD_KEY));
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
  exercises: [],
});

// Fields are strings while typing; '' = not filled in yet
export const newSet = () => ({ weightKg: '', reps: '', rir: '', done: false });

// 754000 -> "12:34"
export function clock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
