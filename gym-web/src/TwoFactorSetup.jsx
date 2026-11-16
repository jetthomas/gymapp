import { useMemo, useState } from 'react';
import { setup2fa, confirm2fa } from './api';
import CodeInput from './CodeInput';
import ErrorMsg from './ErrorMsg';
import useSubmit from './useSubmit';

export default function TwoFactorSetup({ token, onEnabled }) {
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null); // recovery codes, shown once after turning 2FA on
  const { loading, message, setMessage, run } = useSubmit();
  // useMemo stops a new download URL being made on every render
  const downloadUrl = useMemo(
    () => codes && URL.createObjectURL(new Blob([codes.join('\n')], { type: 'text/plain' })),
    [codes],
  );

  function start() {
    run(async () => setSetup(await setup2fa(token)));
  }

  // Takes the value directly: in onChange, the `code` state still holds the previous digits
  function confirmCode(value) {
    run(async () => {
      const result = await confirm2fa(token, value);
      // Not onEnabled() yet: it signs the member out before they've saved the codes
      setCodes(result.codes);
    });
  }

  function confirm(event) {
    event.preventDefault();
    confirmCode(code);
  }

  function cancel() {
    setSetup(null);
    setCode('');
    setMessage('');
  }

  if (codes) {
    return (
      <div className="recovery-codes">
        <p className="hint">Save these codes. Each one gets you in once if you lose your phone.</p>
        <pre className="secret-key">{codes.join('\n')}</pre>
        <a className="link-btn" download="gym-app-recovery-codes.txt" href={downloadUrl}>
          Download
        </a>
        <button className="login-btn" type="button" onClick={onEnabled}>
          I've saved them
        </button>
      </div>
    );
  }

  if (!setup) {
    return (
      <>
        <button className="link-btn" type="button" onClick={start} disabled={loading}>
          {loading ? 'Starting…' : 'Turn on two-factor'}
        </button>
        <ErrorMsg>{message}</ErrorMsg>
      </>
    );
  }

  return (
    <form onSubmit={confirm}>
      <p className="hint">
        Scan this with your authenticator app, then enter the 6-digit code it shows.
      </p>
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
        <CodeInput
          id="setup-code"
          value={code}
          onChange={(digits) => {
            setCode(digits);
            // submit as soon as the last digit lands (typed or autofilled)
            if (digits.length === 6 && !loading) confirmCode(digits);
          }}
        />
      </div>
      <ErrorMsg>{message}</ErrorMsg>
      <button className="login-btn" type="submit" disabled={loading}>
        {loading ? 'Checking…' : 'Turn on two-factor'}
      </button>
      <button className="link-btn" type="button" onClick={cancel} disabled={loading}>
        Cancel
      </button>
    </form>
  );
}
