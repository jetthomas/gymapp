import { useState } from 'react';
import { register } from './api';
import EmailField from './EmailField';
import ErrorMsg from './ErrorMsg';
import NewPasswordField from './NewPasswordField';
import useSubmit from './useSubmit';

export default function CreateAccountForm({ onBack, initialEmail = '' }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const { loading, message, run } = useSubmit();

  function handleSubmit(event) {
    event.preventDefault();
    run(async () => {
      await register(firstName, lastName, email, password);
      // The API answers the same for an email that's already registered, so don't claim a new account
      onBack(
        email,
        "You're all set. Log in to continue. If you already had an account, use its password.",
      );
    });
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Create account</h1>

        <div className="field">
          <label htmlFor="firstName">First name</label>
          <input
            id="firstName"
            name="firstName"
            autoComplete="given-name"
            value={firstName}
            maxLength={100}
            onChange={(e) => setFirstName(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="lastName">Last name</label>
          <input
            id="lastName"
            name="lastName"
            autoComplete="family-name"
            value={lastName}
            maxLength={100}
            onChange={(e) => setLastName(e.target.value)}
            required
          />
        </div>

        <EmailField
          value={email}
          maxLength={256}
          onChange={(e) => setEmail(e.target.value)}
          pattern="[^@\s]+@[^@\s]+\.[^@\s]+"
          title="Enter an email like name@example.com"
        />

        <NewPasswordField
          id="password"
          label="Password"
          name="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <ErrorMsg>{message}</ErrorMsg>

        <button className="login-btn" type="submit" disabled={loading}>
          {loading ? 'Creating account…' : 'Create account'}
        </button>

        <button className="link-btn" type="button" onClick={() => onBack()} disabled={loading}>
          Back to login
        </button>
      </form>
    </div>
  );
}
