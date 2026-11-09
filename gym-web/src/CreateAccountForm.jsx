import { useState } from 'react';
import { register } from './api';
import './index.css';
import eyeIcon from './assets/eye.svg';
import eyeOffIcon from './assets/eye-off.svg';

export default function CreateAccountForm({ onBack, initialEmail = '' }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      await register(firstName, lastName, email, password);
      onBack(email, 'Account created. Log in to continue.');
    } catch (err) {
      setMessage(err.status ? err.message : "Couldn't connect. Check your internet and try again.");
    } finally {
      setLoading(false);
    }
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
            onChange={(e) => setEmail(e.target.value)}
            pattern="[^@\s]+@[^@\s]+\.[^@\s]+"
            title="Enter an email like name@example.com"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <div className="password-wrap">
            <input
              id="password"
              name="password"
              autoComplete="new-password"
              type={showPassword ? 'text' : 'password'}
              aria-describedby="password-hint"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={10}
              pattern=".*[^A-Za-z0-9].*"
              title="At least 10 characters, including a special character (e.g. ! @ #$)"
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
          {loading ? 'Creating Account…' : 'Create Account'}
        </button>

        <button className="link-btn" type="button" onClick={() => onBack()} disabled={loading}>
          Back to Log In
        </button>
      </form>
    </div>
  );
}
