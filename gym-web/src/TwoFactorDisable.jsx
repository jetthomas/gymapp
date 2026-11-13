import { useState } from 'react';
import { disable2fa } from './api';
import PasswordInput from './PasswordInput';
import useSubmit from './useSubmit';

export default function TwoFactorDisable({ token, onDisabled }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const { loading, message, setMessage, run } = useSubmit();

  function handleSubmit(event) {
    event.preventDefault();
    run(async () => {
      await disable2fa(token, password, code);
      // Turning 2FA off signs out every session, this one included
      onDisabled();
    });
  }

  function cancel() {
    setOpen(false);
    setPassword('');
    setCode('');
    setMessage('');
  }

  if (!open) {
    return (
      <button className="link-btn" type="button" onClick={() => setOpen(true)}>
        Turn off two-factor
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor="disable-password">Password</label>
        <PasswordInput
          id="disable-password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="disable-code">6-digit code from your authenticator app</label>
        <input
          id="disable-code"
          className="code-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          minLength={6}
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          required
        />
      </div>
      {message && (
        <p className="msg error" role="alert">
          {message}
        </p>
      )}
      <button className="login-btn" type="submit" disabled={loading}>
        {loading ? 'Checking…' : 'Turn off two-factor'}
      </button>
      <button className="link-btn" type="button" onClick={cancel} disabled={loading}>
        Cancel
      </button>
    </form>
  );
}
