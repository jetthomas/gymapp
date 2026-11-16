// A 6-digit authenticator code box; onChange gets the digits, not the event
export default function CodeInput({ onChange, ...props }) {
  return (
    <input
      className="code-input"
      inputMode="numeric"
      autoComplete="one-time-code"
      minLength={6}
      maxLength={6}
      required
      {...props}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
    />
  );
}
