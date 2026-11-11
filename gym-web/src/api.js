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

export const login = (email, password) =>
  request('/auth/login', { method: 'POST', body: { email, password } });

export const logout = (token) => request('/auth/logout', { method: 'POST', token });

export const deleteaccount = (token) => request('/auth/delete', { method: 'DELETE', token });

export const reactivateaccount = (email, password) =>
  request('/auth/reactivate', { method: 'POST', body: { email, password } });

export const getWorkouts = (token) => request('/workouts', { token });

export const createWorkout = (token, workout) =>
  request('/workouts', { method: 'POST', body: workout, token });
export const getUsers = (token) => request('/admin/users', { token });

export const createResetLink = (token, userId) =>
  request(`/admin/users/${userId}/reset-link`, { method: 'POST', token });

export const makeAdmin = (token, userId) =>
  request(`/admin/users/${userId}/make-admin`, { method: 'POST', token });

export const removeAdmin = (token, userId) =>
  request(`/admin/users/${userId}/remove-admin`, { method: 'POST', token });

export const resetPassword = (resetToken, password) =>
  request('/auth/reset', { method: 'POST', body: { token: resetToken, password } });

export const setup2fa = (token) => request('/auth/2fa/setup', { method: 'POST', token });

export const confirm2fa = (token, code) =>
  request('/auth/2fa/confirm', { method: 'POST', token, body: { code } });

export const verify2fa = (challenge, code) =>
  request('/auth/2fa/verify', { method: 'POST', body: { challenge, code } });
