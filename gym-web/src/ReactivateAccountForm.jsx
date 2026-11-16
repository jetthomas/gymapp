import { useState } from 'react';
import { reactivateAccount } from './api';
import EmailField from './EmailField';
import ErrorMsg from './ErrorMsg';
import PasswordInput from './PasswordInput';
import useSubmit from './useSubmit';

export default function ReactivateAccountForm({ onBack, initialEmail = '' }) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const { loading, message, run } = useSubmit();

  function handleSubmit(event) {
    event.preventDefault();
    run(async () => {
      await reactivateAccount(email, password);
      onBack(email, 'Account reactivated. Log in to continue.');
    });
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Reactivate account</h1>

        <EmailField value={email} onChange={(e) => setEmail(e.target.value)} />

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

        <ErrorMsg>{message}</ErrorMsg>

        <button className="login-btn" type="submit" disabled={loading}>
          {loading ? 'Reactivating…' : 'Reactivate account'}
        </button>

        <button className="link-btn" type="button" onClick={() => onBack()} disabled={loading}>
          Back to login
        </button>
      </form>
    </div>
  );
}
