// Every call goes to /api/..., which Vite forwards to the Rust API
const BASE = '/api';
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
    });
  } catch {
    // fetch only throws when the server can't be reached at all
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

export const register = (firstName, lastName, email, password) =>
  request('/auth/register', { method: 'POST', body: { firstName, lastName, email, password } });

export const login = (email, password, remember) =>
  request('/auth/login', { method: 'POST', body: { email, password, remember } });

// Uses the "Stay logged in" cookie; fetch sends same-origin cookies by default
export const refresh = () => request('/auth/refresh', { method: 'POST' });

export const logout = (token) => request('/auth/logout', { method: 'POST', token });

export const deleteAccount = (token, password) =>
  request('/auth/delete', { method: 'DELETE', token, body: { password } });

export const getExercises = (token, q = '', muscle = '') =>
  request(`/exercises?q=${encodeURIComponent(q)}&muscle=${encodeURIComponent(muscle)}`, { token });
export const createExercise = (token, exercise) =>
  request('/admin/exercises', { method: 'POST', token, body: exercise });
export const updateExercise = (token, id, exercise) =>
  request(`/admin/exercises/${id}`, { method: 'PUT', token, body: exercise });
export const deleteExercise = (token, id) =>
  request(`/admin/exercises/${id}`, { method: 'DELETE', token });

export const getProfile = (token) => request('/account', { token });

export const reactivateAccount = (email, password) =>
  request('/auth/reactivate', { method: 'POST', body: { email, password } });

export const getWorkouts = (token) => request('/workouts', { token });

export const createWorkout = (token, workout) =>
  request('/workouts', { method: 'POST', body: workout, token });
export const getUsers = (token) => request('/admin/users', { token });

export const getStats = (token, days = 30) => request(`/admin/stats?days=${days}`, { token });

export const createResetLink = (token, userId) =>
  request(`/admin/users/${userId}/reset-link`, { method: 'POST', token });

export const reactivateUser = (token, userId) =>
  request(`/admin/users/${userId}/reactivate`, { method: 'POST', token });

export const setAdmin = (token, userId, isAdmin) =>
  request(`/admin/users/${userId}/admin`, { method: 'PUT', token, body: { isAdmin } });

export const resetPassword = (resetToken, password, code) =>
  request('/auth/reset', { method: 'POST', body: { token: resetToken, password, code } });

export const forgotPassword = (email) =>
  request('/auth/forgot', { method: 'POST', body: { email } });

export const verifyEmail = (token) => request('/auth/verify', { method: 'POST', body: { token } });

export const changePassword = (token, current, next) =>
  request('/auth/password', { method: 'POST', token, body: { current, new: next } });

export const setup2fa = (token, password) =>
  request('/auth/2fa/setup', { method: 'POST', token, body: { password } });

export const confirm2fa = (token, code) =>
  request('/auth/2fa/confirm', { method: 'POST', token, body: { code } });

export const verify2fa = (challenge, code, remember) =>
  request('/auth/2fa/verify', { method: 'POST', body: { challenge, code, remember } });

export const disable2fa = (token, password, code) =>
  request('/auth/2fa/disable', { method: 'POST', token, body: { password, code } });
