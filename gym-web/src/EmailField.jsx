// The email box every form shares; extra props (value, onChange, maxLength…) go to the <input>
export default function EmailField(props) {
  return (
    <div className="field">
      <label htmlFor="email">Email address</label>
      <input
        id="email"
        name="email"
        type="email"
        placeholder="name@example.com"
        autoComplete="email"
        spellCheck={false}
        required
        {...props}
      />
    </div>
  );
}
