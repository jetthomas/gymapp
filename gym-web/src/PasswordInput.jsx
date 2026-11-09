import { useState } from 'react';
import eyeIcon from './assets/eye.svg';
import eyeOffIcon from './assets/eye-off.svg';

// A required password box with a show/hide button; other props go to the <input>
export default function PasswordInput(props) {
  const [show, setShow] = useState(false);
  return (
    <div className="password-wrap">
      <input type={show ? 'text' : 'password'} required {...props} />
      <button
        type="button"
        className="eye-btn"
        onClick={() => setShow(!show)}
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        <img src={show ? eyeOffIcon : eyeIcon} alt="" width={20} height={20} />
      </button>
    </div>
  );
}
