import { useEffect, useState } from 'react';
import { getUsers, getStats, createResetLink, setAdmin } from './api';
import BarChart from './BarChart';
import ConfirmDialog from './ConfirmDialog';
import perDay from './perDay';

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
  const [savingId, setSavingId] = useState(null); // userId while their admin flag is being saved
  const [query, setQuery] = useState('');
  const [announce, setAnnounce] = useState('');
  const [confirming, setConfirming] = useState(null); // the user whose admin flag is about to change
  const [stats, setStats] = useState(null);

  // Runs once when the screen opens (and again only if token changes)
  useEffect(() => {
    getUsers(token)
      .then(setUsers)
      .catch((err) => setError(err.message));
    getStats(token)
      .then(setStats)
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

  // Runs once the confirm dialog's button is pressed
  async function handleSetAdmin(user) {
    setError('');
    setSavingId(user.id);
    try {
      await setAdmin(token, user.id, !user.isAdmin);
      setUsers((list) =>
        list.map((u) => (u.id === user.id ? { ...u, isAdmin: !user.isAdmin } : u)),
      );
      setAnnounce(`${displayName(user)} is ${user.isAdmin ? 'no longer' : 'now'} an admin`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId(null);
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
        <p role="status" className="visually-hidden">
          {announce}
        </p>
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

        {error && (
          <p className="msg error" role="alert">
            {error}
          </p>
        )}
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
                    {u.isAdmin && <span className="badge">Admin</span>}
                    {!u.active && <span className="badge muted">Deactivated</span>}
                  </div>
                  <div className="user-email">{u.email}</div>
                  <div className="user-stats">
                    {u.logins} logins · last{' '}
                    {u.lastLogin
                      ? new Date(u.lastLogin).toLocaleDateString(undefined, {
                          day: 'numeric',
                          month: 'short',
                        })
                      : 'never'}{' '}
                    · {u.workouts} workouts
                    {u.failedLast7d >= 5 && (
                      <span className="badge danger">
                        {u.failedLast7d} failed sign-ins this week
                      </span>
                    )}
                  </div>
                </div>
                <div className="row-actions">
                  <button
                    aria-label={`Reset link for ${displayName(u)}`}
                    className="pill-btn"
                    type="button"
                    onClick={() => handleReset(u.id)}
                    disabled={creatingFor === u.id}
                  >
                    {creatingFor === u.id ? 'Creating…' : 'Reset link'}
                  </button>
                  <button
                    aria-label={`${u.isAdmin ? 'Remove admin' : 'Make admin'}: ${displayName(u)}`}
                    className="pill-btn"
                    type="button"
                    onClick={() => setConfirming(u)}
                    disabled={savingId === u.id}
                  >
                    {savingId === u.id
                      ? u.isAdmin
                        ? 'Removing…'
                        : 'Promoting…'
                      : u.isAdmin
                        ? 'Remove admin'
                        : 'Make admin'}
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
        {confirming && (
          <ConfirmDialog
            title={
              confirming.isAdmin
                ? `Remove admin from ${displayName(confirming)}?`
                : `Make ${displayName(confirming)} an admin?`
            }
            body={
              confirming.isAdmin
                ? 'They will no longer see every account or create reset links.'
                : 'They will see every account and can create reset links.'
            }
            confirmLabel={confirming.isAdmin ? 'Remove admin' : 'Make admin'}
            danger={confirming.isAdmin}
            onConfirm={() => {
              setConfirming(null);
              handleSetAdmin(confirming);
            }}
            onCancel={() => setConfirming(null)}
          />
        )}

        {stats && (
          <section aria-labelledby="activity-title">
            <h2 id="activity-title" className="admin-subtitle">
              Activity, last 30 days
            </h2>
            <div className="chart-grid">
              {[
                { kind: 'login', title: 'Sign-ins per day' },
                { kind: 'login_failed', title: 'Failed sign-ins per day', alertAt: 20 },
                { kind: 'workout', title: 'Workouts logged per day' },
              ].map(({ kind, title, alertAt }) => {
                const data = perDay(stats, kind, 30);
                const total = data.reduce((s, d) => s + d.value, 0);
                const peak = data.reduce((a, b) => (b.value > a.value ? b : a));
                return (
                  <BarChart
                    key={kind}
                    title={title}
                    data={data}
                    alertAt={alertAt}
                    isAlert={(d) => alertAt != null && d.value > alertAt}
                    summary={`${total} in 30 days. Busiest: ${peak.label} (${peak.value}).`}
                  />
                );
              })}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
