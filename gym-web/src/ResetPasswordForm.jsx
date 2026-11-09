import { useState } from 'react';
import { resetPassword } from './api';
import './index.css';
import eyeIcon from './assets/eye.svg';
import eyeOffIcon from './assets/eye-off.svg';

export default function ResetPasswordForm({ token, onBack }) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      await resetPassword(token, password);
      onBack(undefined, 'Password updated. Log in with your new password.');
    } catch (err) {
      setMessage(err.status ? err.message : "Couldn't connect. Check your internet and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>New password</h1>

        <div className="field">
          <label htmlFor="password">New password</label>
          <div className="password-wrap">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              aria-describedby="password-hint"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={10}
              required
            />
            <button
              type="button"
              className="eye-btn"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              <img src={showPassword ? eyeOffIcon : eyeIcon} alt="" width={20} height={20} />
            </button>
          </div>
          <p className="hint" id="password-hint">
            At least 10 characters, including a symbol like ! @ # $
          </p>
        </div>

        {message && <p className="msg error" role="alert">{message}</p>}

        <button className="login-btn" type="submit" disabled={loading}>
          {loading ? 'Saving…' : 'Save new password'}
        </button>

        <button className="link-btn" type="button" onClick={() => onBack()} disabled={loading}>
          Back to login
        </button>
      </form>
    </div>
  );
}
