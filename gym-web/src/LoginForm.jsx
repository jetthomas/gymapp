import { useState } from 'react';
import { login, verify2fa } from './api';
import './index.css';
import PasswordInput from './PasswordInput';

export default function LoginForm({
  onLoggedIn,
  onCreateAccount,
  onReactivateAccount,
  initialEmail = '',
  notice = '',
}) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');

  async function run(action) {
    setLoading(true);
    setMessage('');
    try {
      await action();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleLogin(event) {
    event.preventDefault();
    run(async () => {
      const result = await login(email, password);
      if (result.needsCode) {
        setChallenge(result.challenge);
      } else {
        onLoggedIn(result.accessToken, result.isAdmin);
      }
    });
  }

  function handleCode(event) {
    event.preventDefault();
    run(async () => {
      const result = await verify2fa(challenge, code);
      onLoggedIn(result.accessToken, result.isAdmin);
    });
  }

  if (challenge) {
    return (
      <div className="login-page">
        <form className="login-card" onSubmit={handleCode}>
          <h1>Enter your code</h1>
          <div className="field">
            <label htmlFor="code">6-digit code from your authenticator app</label>
            <input
              id="code"
              className="code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              required
              autoFocus
            />
          </div>
          {message && <p className="msg error" role="alert">{message}</p>}
          <button className="login-btn" type="submit" disabled={loading}>
            {loading ? 'Checking…' : 'Continue'}
          </button>
          <button
            className="link-btn"
            type="button"
            onClick={() => {
              setChallenge(null);
              setCode('');
              setMessage('');
            }}
            disabled={loading}
          >
            Back
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleLogin}>
        <h1>Log In</h1>

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

        {message ? (
          <p className="msg error" role="alert">{message}</p>
        ) : (
          notice && <p className="msg success" role="status">{notice}</p>
        )}

        <button className="login-btn" type="submit" disabled={loading}>
          {loading ? 'Logging In…' : 'Log In'}
        </button>

        <button
          className="link-btn"
          type="button"
          onClick={() => onCreateAccount(email)}
          disabled={loading}
        >
          New here? Create an account
        </button>

        <button
          className="link-btn"
          type="button"
          onClick={() => onReactivateAccount(email)}
          disabled={loading}
        >
          Reactivate Account
        </button>
      </form>
    </div>
  );
}
