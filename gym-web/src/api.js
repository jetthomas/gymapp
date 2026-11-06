// Every call goes to /api/..., which Vite forwards to the Rust API
const BASE = '/api'

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  // The API sends JSON on success and plain text on errors
  const text = await res.text()
  const isJson = res.headers.get('content-type')?.includes('application/json')
  const data = text && isJson ? JSON.parse(text) : text

  if (!res.ok) {
    const error = new Error(data || res.statusText || 'request failed')
    error.status = res.status
    throw error
  }

  return data
}

export const register = (email, password) =>
  request('/auth/register', { method: 'POST', body: { email, password } })

export const login = (email, password) =>
  request('/auth/login', { method: 'POST', body: { email, password } })

export const getWorkouts = (token) =>
  request('/workouts', { token })

export const createWorkout = (token, workout) =>
  request('/workouts', { method: 'POST', body: workout, token })