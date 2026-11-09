import { useEffect, useState } from 'react';
import { getUsers, createResetLink } from './api';
import './index.css';

function displayName(u) {
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;
}

function initials(u) {
  const parts = [u.firstName, u.lastName].filter(Boolean);
  return (parts.length ? parts.map((p) => p[0]).join('') : u.email[0]).toUpperCase();
}

export default function AdminScreen({ token, onBack }) {
  const [users, setUsers] = useState(null); // null = still loading
  const [error, setError] = useState('');
  const [reset, setReset] = useState(null); // { userId, link } once a link is made
  const [copied, setCopied] = useState(false);
  const [creatingFor, setCreatingFor] = useState(null); // userId while a link is being made
  const [query, setQuery] = useState('');

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

  const q = query.trim().toLowerCase();
  const shown = users?.filter((u) => `${displayName(u)} ${u.email}`.toLowerCase().includes(q));
  const activeCount = users?.filter((u) => u.active).length ?? 0;

  return (
    <div className="admin-page">
      <header className="admin-toolbar">
        <button className="toolbar-btn" type="button" onClick={onBack}>
          <span aria-hidden="true">‹</span> Back
        </button>
        <span className="toolbar-title">Admin</span>
      </header>

      <main className="admin-content">
        <h1 className="admin-title">Users</h1>
        {users && (
          <p className="admin-subtitle">
            {users.length} {users.length === 1 ? 'account' : 'accounts'} · {activeCount} active
          </p>
        )}

        <input
          className="admin-search"
          type="search"
          placeholder="Search by name or email"
          aria-label="Search users"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {error && <p className="msg error" role="alert">{error}</p>}
        {users === null && !error && <p className="msg">Loading users…</p>}
        {users?.length === 0 && <p className="msg">No users yet</p>}
        {users?.length > 0 && shown.length === 0 && <p className="msg">No matches</p>}

        {shown?.length > 0 && (
          <ul className="user-list">
            {shown.map((u) => (
              <li key={u.id} className="user-row">
                <div className={`avatar${u.active ? '' : ' inactive'}`} aria-hidden="true">
                  {initials(u)}
                </div>
                <div className="user-info">
                  <div className="user-name">
                    {displayName(u)}
                    {!u.active && <span className="badge">Deactivated</span>}
                  </div>
                  <div className="user-email">{u.email}</div>
                </div>
                <div className="row-actions">
                  <span className={`badge ${u.active ? 'success' : 'muted'}`}>
                    {u.active ? 'Active' : 'Inactive'}
                  </span>
                  <button
                    className="pill-btn"
                    type="button"
                    onClick={() => handleReset(u.id)}
                    disabled={creatingFor === u.id}
                  >
                    {creatingFor === u.id ? 'Creating…' : 'Reset link'}
                  </button>
                </div>

                {reset?.userId === u.id && (
                  <div className="reset-panel">
                    <div className="reset-field">
                      <input
                        readOnly
                        value={reset.link}
                        aria-label={`Reset link for ${displayName(u)}`}
                        onFocus={(e) => e.target.select()}
                      />
                      <button className="pill-btn filled" type="button" onClick={handleCopy}>
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <p className="hint">Works once, for 15 minutes.</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
