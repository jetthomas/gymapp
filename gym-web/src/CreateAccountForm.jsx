import { useState } from 'react';
import { register } from './api';
import PasswordInput from './PasswordInput';
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
        <h1>Create Account</h1>

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
            maxLength={256}
            onChange={(e) => setEmail(e.target.value)}
            pattern="[^@\s]+@[^@\s]+\.[^@\s]+"
            title="Enter an email like name@example.com"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            aria-describedby="password-hint"
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

        {message && (
          <p className="msg error" role="alert">
            {message}
          </p>
        )}

        <button className="login-btn" type="submit" disabled={loading}>
          {loading ? 'Creating Account…' : 'Create Account'}
        </button>

        <button className="link-btn" type="button" onClick={() => onBack()} disabled={loading}>
          Back to Log In
        </button>
      </form>
    </div>
  );
}
