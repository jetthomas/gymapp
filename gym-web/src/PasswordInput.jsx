import { useState } from 'react';
import eyeIcon from './assets/eye.svg';
import eyeOffIcon from './assets/eye-off.svg';

// A required password box with a show/hide button and a Caps Lock warning; other props go to the <input>
export default function PasswordInput(props) {
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const capsId = `${props.id}-caps`;
  // Keep any aria-describedby passed in (the password hint) and add the Caps Lock one
  const describedBy =
    [props['aria-describedby'], caps && capsId].filter(Boolean).join(' ') || undefined;
  // A fragment, because the eye button is positioned inside .password-wrap and would move if the hint went there
  return (
    <>
      <div className="password-wrap">
        <input
          type={show ? 'text' : 'password'}
          required
          {...props}
          aria-describedby={describedBy}
          onKeyUp={(e) => setCaps(e.getModifierState('CapsLock'))}
          onBlur={() => setCaps(false)}
        />
        <button
          type="button"
          className="eye-btn"
          onClick={() => setShow(!show)}
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          <img src={show ? eyeOffIcon : eyeIcon} alt="" width={20} height={20} />
        </button>
      </div>
      {caps && (
        <p className="hint" id={capsId}>
          Caps Lock is on
        </p>
      )}
    </>
  );
}
