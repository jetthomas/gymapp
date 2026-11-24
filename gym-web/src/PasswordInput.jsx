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

  // Check Caps Lock state safely across Keyboard and Mouse events
  const checkCaps = (e) => {
    if (typeof e.getModifierState === 'function') {
      setCaps(e.getModifierState('CapsLock'));
    }
  };

  return (
    <>
      <div className="password-wrap">
        <input
          type={show ? 'text' : 'password'}
          required
          {...props}
          aria-describedby={describedBy}
          onKeyDown={(e) => {
            checkCaps(e);
            props.onKeyDown?.(e);
          }}
          onKeyUp={(e) => {
            checkCaps(e);
            props.onKeyUp?.(e);
          }}
          onMouseDown={(e) => {
            checkCaps(e);
            props.onMouseDown?.(e);
          }}
          onBlur={(e) => {
            setCaps(false);
            props.onBlur?.(e);
          }}
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
        <p className="caps-lock" id={capsId} role="status">
          Caps Lock is on
        </p>
      )}
    </>
  );
}
