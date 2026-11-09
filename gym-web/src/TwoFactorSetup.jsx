import { useState } from 'react';
import { setup2fa, confirm2fa } from './api';

export default function TwoFactorSetup({ token }) {
  const [setup, setSetup] = useState(null); // { qr, secret } once started
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function run(action) {
    setLoading(true);
    setMessage('');
    try {
      await action();
    } catch (err) {
      setMessage(err.status ? err.message : "Couldn't connect. Check your internet and try again.");
    } finally {
      setLoading(false);
    }
  }

  function start() {
    run(async () => setSetup(await setup2fa(token)));
  }

  function confirm(event) {
    event.preventDefault();
    run(async () => {
      await confirm2fa(token, code);
      setDone(true);
    });
  }

  function cancel() {
    setSetup(null);
    setCode('');
    setMessage('');
  }

  if (done) return <p className="msg success" role="status">Two-factor is on.</p>;

  if (!setup) {
    return (
      <>
        <button className="link-btn" type="button" onClick={start} disabled={loading}>
          {loading ? 'Starting…' : 'Turn on two-factor'}
        </button>
        {message && <p className="msg error" role="alert">{message}</p>}
      </>
    );
  }

  return (
    <form onSubmit={confirm}>
      <p className="hint">Scan this with your authenticator app, then enter the 6-digit code it shows.</p>
      <img
        className="qr"
        src={`data:image/png;base64,${setup.qr}`}
        alt="QR code for your authenticator app"
        width="200"
        height="200"
      />
      <p className="hint">
        Can't scan? Enter this key:{' '}
        {/* groups of 4 are easier to type; authenticator apps ignore the spaces */}
        <span className="secret-key">{setup.secret.match(/.{1,4}/g).join(' ')}</span>
      </p>
      <div className="field">
        <label htmlFor="setup-code">6-digit code</label>
        <input
          id="setup-code"
          className="code-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          required
        />
      </div>
      {message && <p className="msg error" role="alert">{message}</p>}
      <button className="login-btn" type="submit" disabled={loading}>
        {loading ? 'Checking…' : 'Turn on two-factor'}
      </button>
      <button className="link-btn" type="button" onClick={cancel} disabled={loading}>
        Cancel
      </button>
    </form>
  );
}
