import { useEffect, useState } from 'react';
import { getUsers, createResetLink } from './api';
import './index.css';

export default function AdminScreen({ token, onBack }) {
  const [users, setUsers] = useState(null); // null = still loading
  const [error, setError] = useState('');
  const [reset, setReset] = useState(null); // { userId, link } once a link is made
  const [copied, setCopied] = useState(false);
  const [creatingFor, setCreatingFor] = useState(null); // userId while a link is being made

  // Runs once when the screen opens (and again only if token changes)
  useEffect(() => {
    getUsers(token)
      .then(setUsers)
      .catch((err) => setError(err.message));
  }, [token]);

  async function handleReset(userId) {
    setError('');
    setCopied(false);
    setCreatingFor(userId);
    try {
      const { link } = await createResetLink(token, userId);
      setReset({ userId, link });
    } catch (err) {
      setError(err.message);
    } finally {
      setCreatingFor(null);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(reset.link);
      setCopied(true);
    } catch {
      setError("Couldn't copy. Select the link and copy it yourself.");
    }
  }

  return (
    <div className="login-page">
      <div className="login-card admin-card">
        <h1>Users</h1>

        {error && <p className="msg error" role="alert">{error}</p>}
        {users === null && !error && <p className="msg">Loading users…</p>}
        {users?.length === 0 && <p className="msg">No users yet</p>}

        {users?.map((u) => (
          <div key={u.id} className="user-row">
            <div className="user-name">
              {[u.firstName, u.lastName].filter(Boolean).join(' ') || u.email}
              {!u.active && ' (deactivated)'}
            </div>
            <div className="user-email">{u.email}</div>

            <button
              className="link-btn"
              type="button"
              onClick={() => handleReset(u.id)}
              disabled={creatingFor === u.id}
            >
              {creatingFor === u.id ? 'Creating…' : 'Create reset link'}
            </button>

            {reset?.userId === u.id && (
              <div className="field">
                <input readOnly value={reset.link} aria-label="Reset link" onFocus={(e) => e.target.select()} />
                <p className="hint">Works once, for 15 minutes.</p>
                <button className="link-btn" type="button" onClick={handleCopy}>
                  {copied ? 'Copied' : 'Copy link'}
                </button>
              </div>
            )}
          </div>
        ))}

        <button className="link-btn" type="button" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
