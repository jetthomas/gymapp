import { useState } from 'react';
import { changePassword } from './api';
import ErrorMsg from './ErrorMsg';
import NewPasswordField from './NewPasswordField';
import PasswordInput from './PasswordInput';
import useSubmit from './useSubmit';

export default function ChangePasswordForm({ token, onChanged, onCancel }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const { loading, message, run } = useSubmit();

  function handleSubmit(event) {
    event.preventDefault();
    run(async () => {
      // Every other device is signed out; this one gets a new token back
      const result = await changePassword(token, current, next);
      onChanged(result.accessToken);
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor="current-password">Current password</label>
        <PasswordInput
          id="current-password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>
      <NewPasswordField
        id="new-password"
        label="New password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
      />
      <ErrorMsg>{message}</ErrorMsg>
      <button className="login-btn" type="submit" disabled={loading}>
        {loading ? 'Saving…' : 'Change password'}
      </button>
      <button className="link-btn" type="button" onClick={onCancel} disabled={loading}>
        Cancel
      </button>
    </form>
  );
}
