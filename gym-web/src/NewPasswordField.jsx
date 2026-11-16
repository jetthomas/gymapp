import PasswordInput from './PasswordInput';

// The password rule in one place: 10+ characters with a symbol. The API checks it again.
export default function NewPasswordField({ id, label, ...props }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <PasswordInput
        id={id}
        aria-describedby={`${id}-hint`}
        autoComplete="new-password"
        minLength={10}
        pattern=".*[^A-Za-z0-9].*"
        title="At least 10 characters, including a special character (e.g. ! @ # $)"
        {...props}
      />
      <p className="hint" id={`${id}-hint`}>
        At least 10 characters, including a symbol like ! @ # $
      </p>
    </div>
  );
}
