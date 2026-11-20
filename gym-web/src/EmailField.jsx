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
        // "username", not "email": password managers save and fill the password against it
        autoComplete="username"
        spellCheck={false}
        required
        {...props}
      />
    </div>
  );
}
