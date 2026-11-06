import { useState } from 'react'
import { login, register } from './api'
import './index.css'
import eyeIcon from './assets/eye.svg'
import eyeOffIcon from './assets/eye-off.svg'


export default function LoginForm({ onLoggedIn }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(true)
  const [loading, setLoading] = useState(false)

  async function run(action) {
    setLoading(true)
    setMessage('')
    try {
      await action()
    } catch (err) {
      setIsError(true)
      setMessage(err.status ? `Failed: ${err.message}` : `Network error: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  function handleLogin(event) {
    event.preventDefault()
    run(async () => {
      const result = await login(email, password)
      onLoggedIn(result.accessToken)
    })
  }

  function handleRegister(event) {
    if (!event.currentTarget.form.reportValidity()) return
    run(async () => {
      await register(email, password)
      setIsError(false)
      setMessage('Registered! Now log in.')
    })
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleLogin}>
        <h1>Login</h1>

        <div className="field">
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            placeholder="Email address"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <div className="password-wrap">
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Password"
              aria-label="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
            <button
              type="button"
              className="eye-btn"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              <img src={showPassword ? eyeOffIcon : eyeIcon} alt="" />
            </button>
          </div>
        </div>

        <button className="login-btn" type="submit" disabled={loading}>
          Login
        </button>

        <button className="link-btn" type="button" onClick={handleRegister} disabled={loading}>
          Create account
        </button>

        {message && <p className={isError ? 'msg error' : 'msg success'}>{message}</p>}
      </form>
    </div>
  )
}