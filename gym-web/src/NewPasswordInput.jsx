import PasswordInput from './PasswordInput';

// Keep in step with check_password in gym-api/src/main.rs
export default function NewPasswordInput(props) {
  return (
    <>
      <PasswordInput
        autoComplete="new-password"
        aria-describedby="password-hint"
        minLength={10}
        pattern=".*[^A-Za-z0-9].*"
        title="At least 10 characters, including a special character (e.g. ! @ # $)"
        {...props}
      />
      <p className="hint" id="password-hint">
        At least 10 characters, including a symbol like ! @ # $
      </p>
    </>
  );
}
