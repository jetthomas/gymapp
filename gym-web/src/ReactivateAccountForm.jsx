import { useState } from 'react'
import { reactivateaccount } from './api'
import './index.css'
import PasswordInput from './PasswordInput'

export default function ReactivateAccountForm({ onBack, initialEmail = '' }) {
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setLoading(true)
    setMessage('')
    try {
      await reactivateaccount(email, password)
      onBack(email, 'Account reactivated. Log in to continue.')
    } catch (err) {
      setMessage(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Reactivate Account</h1>

        <div className="field">
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            name="email"
            placeholder="name@example.com"
            type="email"
            autoComplete="email"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {message && <p className="msg error" role="alert">{message}</p>}

        <button className="login-btn" type="submit" disabled={loading}>
          {loading ? 'Reactivating…' : 'Reactivate Account'}
        </button>

        <button className="link-btn" type="button" onClick={() => onBack()} disabled={loading}>
          Back to Log In
        </button>
      </form>
    </div>
  )
}
