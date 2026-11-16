import { useState } from 'react';
import { forgotPassword } from './api';
import EmailField from './EmailField';
import ErrorMsg from './ErrorMsg';
import useSubmit from './useSubmit';

export default function ForgotPasswordForm({ onBack, initialEmail = '' }) {
  const [email, setEmail] = useState(initialEmail);
  const { loading, message, run } = useSubmit();

  function handleSubmit(event) {
    event.preventDefault();
    run(async () => {
      await forgotPassword(email);
      // The API answers the same whether or not the email has an account
      onBack(email, "If that email has an account, we've sent a reset link.");
    });
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Forgot password</h1>

        <EmailField value={email} onChange={(e) => setEmail(e.target.value)} />

        <ErrorMsg>{message}</ErrorMsg>

        <button className="login-btn" type="submit" disabled={loading}>
          {loading ? 'Sending…' : 'Send reset link'}
        </button>

        <button className="link-btn" type="button" onClick={() => onBack()} disabled={loading}>
          Back to login
        </button>
      </form>
    </div>
  );
}
