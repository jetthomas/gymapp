import { useState } from 'react';
import { resetPassword } from './api';
import PasswordInput from './PasswordInput';
import useSubmit from './useSubmit';

export default function ResetPasswordForm({ token, onBack }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  // A "Forgot password?" link on a 2FA account also needs the current code
  const [needCode, setNeedCode] = useState(false);
  const { loading, message, run } = useSubmit();

  function handleSubmit(event) {
    event.preventDefault();
    run(async () => {
      try {
        await resetPassword(token, password, needCode ? code : undefined);
      } catch (err) {
        if (err.status === 401) setNeedCode(true);
        throw err;
      }
      onBack(undefined, 'Password updated. Log in with your new password.');
    });
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>New password</h1>

        <div className="field">
          <label htmlFor="password">New password</label>
          <PasswordInput
            id="password"
            aria-describedby="password-hint"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={10}
            pattern=".*[^A-Za-z0-9].*"
            title="At least 10 characters, including a special character (e.g. ! @ #$)"
          />
          <p className="hint" id="password-hint">
            At least 10 characters, including a symbol like ! @ # $
          </p>
        </div>

        {needCode && (
          <div className="field">
            <label htmlFor="code">6-digit code from your authenticator app</label>
            <input
              id="code"
              className="code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              minLength={6}
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              required
              autoFocus
            />
          </div>
        )}

        {message && (
          <p className="msg error" role="alert">
            {message}
          </p>
        )}

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
