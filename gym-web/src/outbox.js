import { useSyncExternalStore } from 'react';
import { createWorkout } from './api.js';

// Finished workouts that haven't reached the server yet. They stay in this browser until they do,
// so a workout finished with no signal is never lost.
// shortcut: localStorage (about 5 MB, plenty for workouts); move to IndexedDB if saves ever get big
const KEY = 'outbox';

// The member's id, read from the login token: its middle part is base64url JSON
const userIdOf = (token) =>
  JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub;

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? [];
  } catch {
    return [];
  }
}

function write(items) {
  localStorage.setItem(KEY, JSON.stringify(items));
  // Tells useWaiting (below) to count again
  window.dispatchEvent(new Event('outbox'));
}

const mine = (token) => read().filter((i) => i.userId === userIdOf(token));

// Each save is tagged with who made it, so a shared phone can't upload it to someone else's account
export function queue(token, workout) {
  write([...read(), { userId: userIdOf(token), workout }]);
}

let flushing = false;

// Sends this member's waiting workouts, oldest first. Safe to call as often as you like:
// the server stores each clientId once, however many times it arrives
export async function flush(token, send = createWorkout) {
  if (flushing) return;
  flushing = true;
  try {
    for (const item of mine(token).filter((i) => !i.error)) {
      const { clientId } = item.workout;
      try {
        await send(token, item.workout);
        write(read().filter((i) => i.workout.clientId !== clientId));
      } catch (err) {
        // No signal, a server error, an expired login or too many tries: these can heal,
        // so leave everything for the next try
        if (!err.status || err.status >= 500 || err.status === 401 || err.status === 429) return;
        // Any other 4xx (400, 422) = the server will never accept it, so stop retrying but keep it.
        // 400 = the server will never accept it, so stop retrying but keep it.
        // shortcut: it then sits here with its error; add a way to fix or drop it if this ever happens
        write(
          read().map((i) => (i.workout.clientId === clientId ? { ...i, error: err.message } : i)),
        );
      }
    }
  } finally {
    flushing = false;
  }
}

const subscribe = (onChange) => {
  window.addEventListener('outbox', onChange);
  return () => window.removeEventListener('outbox', onChange);
};

// How many of this member's workouts are still waiting; re-renders the component when that changes
export const useWaiting = (token) => useSyncExternalStore(subscribe, () => mine(token).length);

// Why the server refused a waiting workout, or '' when none was refused
export const useRefused = (token) =>
  useSyncExternalStore(subscribe, () => mine(token).find((i) => i.error)?.error ?? '');
