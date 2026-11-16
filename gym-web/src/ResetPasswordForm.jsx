import { useState } from 'react';
import { resetPassword } from './api';
import CodeInput from './CodeInput';
import ErrorMsg from './ErrorMsg';
import NewPasswordField from './NewPasswordField';
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

        <NewPasswordField
          id="password"
          label="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {needCode && (
          <div className="field">
            <label htmlFor="code">6-digit code from your authenticator app</label>
            <CodeInput id="code" value={code} onChange={setCode} autoFocus />
          </div>
        )}

        <ErrorMsg>{message}</ErrorMsg>

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
