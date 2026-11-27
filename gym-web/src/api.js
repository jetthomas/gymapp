// Every call goes to /api/..., which Vite forwards to the Rust API
// The iPhone app has no Vite to forward /api, so it calls the API directly
const BASE = import.meta.env.VITE_API_URL ?? '/api';
// App sets this so a dead token sends the user back to the login screen
let onSessionExpired = () => {};
export const setOnSessionExpired = (fn) => {
  onSessionExpired = fn;
};
async function request(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      // Weak gym signal can leave a request hanging for minutes; give up so it can be tried again
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    // fetch only throws when the server can't be reached at all (or took too long)
    throw new Error("Couldn't connect. Check your internet and try again.");
  }

  // The API sends JSON on success and plain text on errors
  const text = await res.text();
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = text && isJson ? JSON.parse(text) : text;

  if (!res.ok) {
    if (res.status === 401 && token) onSessionExpired();
    const error = new Error(data || res.statusText || 'request failed');
    error.status = res.status;
    throw error;
  }

  return data;
}

export const changePassword = (token, current, next) =>
  request('/auth/password', { method: 'POST', token, body: { current, new: next } });

export const confirm2fa = (token, code) =>
  request('/auth/2fa/confirm', { method: 'POST', token, body: { code } });

export const createExercise = (token, exercise) =>
  request('/admin/exercises', { method: 'POST', token, body: exercise });

export const createResetLink = (token, userId) =>
  request(`/admin/users/${userId}/reset-link`, { method: 'POST', token });

export const createWorkout = (token, workout) =>
  request('/workouts', { method: 'POST', body: workout, token });

// Only deactivates; eraseAccount deletes for good
export const deleteAccount = (token, password) =>
  request('/auth/delete', { method: 'DELETE', token, body: { password } });

export const deleteAvatar = (token) => request('/account/avatar', { method: 'DELETE', token });

export const deleteExercise = (token, id) =>
  request(`/admin/exercises/${id}`, { method: 'DELETE', token });

export const disable2fa = (token, password, code) =>
  request('/auth/2fa/disable', { method: 'POST', token, body: { password, code } });

// Deletes the account, its workouts, food log and profile; there's no undo
export const eraseAccount = (token, password) =>
  request('/auth/erase', { method: 'DELETE', token, body: { password } });

// { workouts, food, bodyWeights } from the last 30 days, for the Account screen's Export
export const getExport = (token) => request('/me/export', { token });

export const forgotPassword = (email) =>
  request('/auth/forgot', { method: 'POST', body: { email } });

export const getExercises = (token, q = '', muscle = '') =>
  request(`/exercises?q=${encodeURIComponent(q)}&muscle=${encodeURIComponent(muscle)}`, { token });

// The sets from the last time the member did this exercise
export const getLastSets = (token, exerciseId) =>
  request(`/exercises/${exerciseId}/last`, { token });

// [{ muscle, sets }] for the muscles trained in the last `days` days
export const getMuscles = (token, days = 30) => request(`/me/muscles?days=${days}`, { token });

export const getProfile = (token) => request('/account', { token });

// Login counts per day from `from` to `to` (YYYY-MM-DD, both included)
export const getStats = (token, from, to) =>
  request(`/admin/stats?from=${from}&to=${to}`, { token });

export const getUsers = (token) => request('/admin/users', { token });

export const getWorkout = (token, id) => request(`/workouts/${id}`, { token });

export const getWorkouts = (token) => request('/workouts', { token });

export const login = (email, password, remember) =>
  request('/auth/login', { method: 'POST', body: { email, password, remember } });

export const logout = (token) => request('/auth/logout', { method: 'POST', token });

export const putAvatar = (token, image) =>
  request('/account/avatar', { method: 'PUT', token, body: { image } });

export const reactivateAccount = (email, password) =>
  request('/auth/reactivate', { method: 'POST', body: { email, password } });

export const reactivateUser = (token, userId) =>
  request(`/admin/users/${userId}/reactivate`, { method: 'POST', token });

// Uses the "Stay logged in" cookie; fetch sends same-origin cookies by default
export const refresh = () => request('/auth/refresh', { method: 'POST' });

export const register = (firstName, lastName, email, password) =>
  request('/auth/register', { method: 'POST', body: { firstName, lastName, email, password } });

export const resetPassword = (resetToken, password, code) =>
  request('/auth/reset', { method: 'POST', body: { token: resetToken, password, code } });

export const setAdmin = (token, userId, isAdmin) =>
  request(`/admin/users/${userId}/admin`, { method: 'PUT', token, body: { isAdmin } });

export const setup2fa = (token, password) =>
  request('/auth/2fa/setup', { method: 'POST', token, body: { password } });

export const updateExercise = (token, id, exercise) =>
  request(`/admin/exercises/${id}`, { method: 'PUT', token, body: exercise });

export const verify2fa = (challenge, code, remember) =>
  request('/auth/2fa/verify', { method: 'POST', body: { challenge, code, remember } });

export const verifyEmail = (token) => request('/auth/verify', { method: 'POST', body: { token } });

// The Calories screen. All of it is the member's own data; the server never takes a user id here
export const addFood = (token, food) => request('/me/food', { method: 'POST', token, body: food });
export const deleteFood = (token, id) => request(`/me/food/${id}`, { method: 'DELETE', token });
export const deleteHealth = (token) => request('/me/health', { method: 'DELETE', token });
export const getFood = (token, date) => request(`/me/food?date=${date}`, { token });
export const getHealth = (token) => request('/me/health', { token });
// Plus only: [{ day, est1rmKg }] for an exercise, oldest first
export const getProgress = (token, exerciseId) =>
  request(`/exercises/${exerciseId}/progress`, { token });
export const getRecentFood = (token) => request('/me/food/recent', { token });
// Plus only: { name, kcal, proteinG, carbsG, fatG } per 100 g
export const lookupBarcode = (token, code) =>
  request(`/food/barcode/${encodeURIComponent(code)}`, { token });
export const openPortal = (token) => request('/billing/portal', { method: 'POST', token });
export const saveHealth = (token, profile) =>
  request('/me/health', { method: 'PUT', token, body: profile });
export const startCheckout = (token) => request('/billing/checkout', { method: 'POST', token });
export const updateFood = (token, id, food) =>
  request(`/me/food/${id}`, { method: 'PUT', token, body: food });
