import { useState } from 'react';
import { disable2fa } from './api';
import CodeInput from './CodeInput';
import ErrorMsg from './ErrorMsg';
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
        <CodeInput id="disable-code" value={code} onChange={setCode} />
      </div>
      <ErrorMsg>{message}</ErrorMsg>
      <button className="login-btn" type="submit" disabled={loading}>
        {loading ? 'Checking…' : 'Turn off two-factor'}
      </button>
      <button className="link-btn" type="button" onClick={cancel} disabled={loading}>
        Cancel
      </button>
    </form>
  );
}
