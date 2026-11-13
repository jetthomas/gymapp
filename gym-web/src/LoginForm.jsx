import { useState } from 'react';
import { login, verify2fa } from './api';
import PasswordInput from './PasswordInput';
import useSubmit from './useSubmit';

export default function LoginForm({
  onLoggedIn,
  onCreateAccount,
  onReactivateAccount,
  onForgotPassword,
  initialEmail = '',
  notice = '',
}) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const { loading, message, setMessage, run } = useSubmit();
  const [deactivated, setDeactivated] = useState(false);
  const [remember, setRemember] = useState(true);
  const [useRecovery, setUseRecovery] = useState(false);

  function handleLogin(event) {
    event.preventDefault();
    run(async () => {
      setDeactivated(false);
      try {
        const result = await login(email, password, remember);
        if (result.challenge) {
          setChallenge(result.challenge);
        } else {
          onLoggedIn(
            result.accessToken,
            result.isAdmin,
            false,
            result.lastLogin,
            result.failedSince,
          );
        }
      } catch (err) {
        setDeactivated(err.status === 403); // the API answers 403 only for a deactivated account
        throw err;
      }
    });
  }

  function handleCode(event) {
    event.preventDefault();
    verifyCode(code);
  }

  function verifyCode(value) {
    run(async () => {
      try {
        const result = await verify2fa(challenge, value, remember);
        onLoggedIn(result.accessToken, result.isAdmin, true, result.lastLogin, result.failedSince);
      } catch (err) {
        // 401 = the 5-minute challenge ran out, so start over from the password
        if (err.status === 401) {
          setChallenge(null);
          setCode('');
        }
        throw err; // useSubmit shows the message
      }
    });
  }

  if (challenge) {
    return (
      <div className="login-page">
        <form key="code" className="login-card" onSubmit={handleCode}>
          <h1>Enter your code</h1>
          <div className="field">
            {useRecovery ? (
              <>
                <label htmlFor="code">Recovery code</label>
                <input
                  id="code"
                  className="code-input"
                  autoComplete="off"
                  spellCheck={false}
                  minLength={11}
                  maxLength={11}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
                  required
                  autoFocus
                />
              </>
            ) : (
              <>
                <label htmlFor="code">6-digit code from your authenticator app</label>
                <input
                  id="code"
                  className="code-input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  minLength={6}
                  maxLength={6}
                  value={code}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '');
                    setCode(digits);
                    // submit as soon as the last digit lands (typed or autofilled)
                    if (digits.length === 6 && !loading) verifyCode(digits);
                  }}
                  required
                  autoFocus
                />
              </>
            )}
          </div>
          {message && (
            <p className="msg error" role="alert">
              {message}
            </p>
          )}
          <button className="login-btn" type="submit" disabled={loading}>
            {loading ? 'Checking…' : 'Continue'}
          </button>
          <button
            className="link-btn"
            type="button"
            onClick={() => {
              setUseRecovery(!useRecovery);
              setCode('');
              setMessage('');
            }}
            disabled={loading}
          >
            {useRecovery ? 'Use a code from your app' : 'Use a recovery code'}
          </button>
          <button
            className="link-btn"
            type="button"
            onClick={() => {
              setChallenge(null);
              setCode('');
              setMessage('');
              setUseRecovery(false);
            }}
            disabled={loading}
          >
            Back
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="login-page">
      <form key="password" className="login-card" onSubmit={handleLogin}>
        <h1>Log In</h1>
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
            required
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            className="link-btn"
            type="button"
            onClick={() => onForgotPassword(email)}
            disabled={loading}
          >
            Forgot password?
          </button>
        </div>

        <label className="check">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Stay signed in for 30 days
        </label>

        {message ? (
          <>
            <p className="msg error" role="alert">
              {message}
            </p>
            {deactivated && (
              <button
                className="link-btn"
                type="button"
                onClick={() => onReactivateAccount(email)}
                disabled={loading}
              >
                Reactivate account
              </button>
            )}
          </>
        ) : (
          notice && (
            <p className="msg success" role="status">
              {notice}
            </p>
          )
        )}

        <button className="login-btn" type="submit" disabled={loading}>
          {loading ? 'Logging In…' : 'Log In'}
        </button>

        <button
          className="link-btn"
          type="button"
          onClick={() => onCreateAccount(email)}
          disabled={loading}
        >
          New here? Create an account
        </button>
      </form>
    </div>
  );
}
