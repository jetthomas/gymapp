import { useState } from 'react'
import { reactivateaccount } from './api'
import './index.css'
import eyeIcon from './assets/eye.svg'
import eyeOffIcon from './assets/eye-off.svg'

export default function ReactivateAccountForm({ onBack }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(true)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setLoading(true)
    setMessage('')
    try {
      await reactivateaccount(email, password)
      setIsError(false)
      setMessage('Account reactivated! Now log in.')
    } catch (err) {
      setIsError(true)
      setMessage(err.status ? `Failed: ${err.message}` : `Network error: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Reactivate account</h1>

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
          Reactivate account
        </button>

        <button className="link-btn" type="button" onClick={onBack} disabled={loading}>
          Back to login
        </button>

        {message && <p className={isError ? 'msg error' : 'msg success'}>{message}</p>}
      </form>
    </div>
  )
}
