import { Fragment, useEffect, useState } from 'react';
import { getUsers, getStats, createResetLink, reactivateUser, setAdmin } from './api';
import BarChart from './BarChart';
import ConfirmDialog from './ConfirmDialog';
import ErrorMsg from './ErrorMsg';
import { displayName, initials } from './names';
import perDay from './perDay';

const total = (data) => data.reduce((s, d) => s + d.value, 0);

// A small stroked icon in the text's own colour
function Icon({ d }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

// On, Off, or a warning for an admin who has no second factor
function TwoFactor({ user }) {
  if (user.totpEnabled)
    return (
      <span className="tfa on">
        <Icon d="M5 12l5 5 9-10" /> On
      </span>
    );
  if (user.isAdmin && user.active)
    return (
      <span className="tfa warn" title="Admins should turn on two-factor">
        <Icon d="M12 3L2 20h20L12 3zM12 10v4M12 17v.5" /> Off
        <span className="visually-hidden"> (recommended for admins)</span>
      </span>
    );
  return <span className="tfa">Off</span>;
}

export default function AdminScreen({ token, lastLogin, failedSince, onBack }) {
  const [users, setUsers] = useState(null); // null = still loading
  const [error, setError] = useState('');
  const [rowError, setRowError] = useState(null); // { userId, message }
  const [reset, setReset] = useState(null); // { userId, link } once a link is made
  const [copied, setCopied] = useState(false);
  const [creatingFor, setCreatingFor] = useState(null); // userId while a link is being made
  const [savingId, setSavingId] = useState(null); // userId while their role or active flag is being saved
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all'); // 'all', 'active' or 'inactive'
  const [announce, setAnnounce] = useState('');
  const [confirming, setConfirming] = useState(null); // { user, kind: 'role' | 'reactivate' } awaiting a yes
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
    setRowError(null);
    setCopied(false);
    setCreatingFor(userId);
    try {
      const { link } = await createResetLink(token, userId);
      setReset({ userId, link });
    } catch (err) {
      setRowError({ userId, message: err.message });
    } finally {
      setCreatingFor(null);
    }
  }

  // Runs a confirmed change, then updates that user's row and tells screen readers
  async function save(user, call, patch, message) {
    setRowError(null);
    setSavingId(user.id);
    try {
      await call();
      setUsers((list) => list.map((u) => (u.id === user.id ? { ...u, ...patch } : u)));
      setAnnounce(message);
    } catch (err) {
      setRowError({ userId: user.id, message: err.message });
    } finally {
      setSavingId(null);
    }
  }

  // What the confirm dialog says and does for the change that's waiting
  function pendingChange({ user, kind }) {
    const name = displayName(user);
    if (kind === 'reactivate')
      return {
        title: `Reactivate ${name}?`,
        body: "They will be able to log in again, and we'll email them to say so.",
        confirmLabel: 'Reactivate',
        run: () =>
          save(
            user,
            () => reactivateUser(token, user.id),
            { active: true },
            `${name} is active again`,
          ),
      };
    return {
      title: user.isAdmin ? `Remove admin from ${name}?` : `Make ${name} an admin?`,
      body: user.isAdmin
        ? 'They will no longer see every account or create reset links.'
        : 'They will see every account and can create reset links.',
      confirmLabel: user.isAdmin ? 'Remove admin' : 'Make admin',
      danger: user.isAdmin,
      run: () =>
        save(
          user,
          () => setAdmin(token, user.id, !user.isAdmin),
          { isAdmin: !user.isAdmin },
          `${name} is ${user.isAdmin ? 'no longer' : 'now'} an admin`,
        ),
    };
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(reset.link);
      setCopied(true);
    } catch {
      setRowError({
        userId: reset.userId,
        message: "Couldn't copy. Select the link and copy it yourself.",
      });
    }
  }

  const q = query.trim().toLowerCase();
  const shown = users?.filter(
    (u) =>
      (status === 'all' || u.active === (status === 'active')) &&
      `${displayName(u)} ${u.email}`.toLowerCase().includes(q),
  );
  const charts = stats
    ? [
        { title: 'Logins per day', data: perDay(stats, 'login', 30) },
        // Orange normally; a day over 20 turns red
        {
          title: 'Failed logins per day',
          data: perDay(stats, 'login_failed', 30),
          tone: 'warn',
          alertAt: 20,
        },
      ]
    : [];
  const chartMax = Math.max(1, ...charts.flatMap((c) => c.data.map((d) => d.value)));
  const tiles = [
    ['Accounts', users?.length],
    ['Active', users?.filter((u) => u.active).length],
    ['Logins, last 30 days', charts[0] && total(charts[0].data)],
    ['Failed logins, last 30 days', charts[1] && total(charts[1].data)],
  ];
  const change = confirming && pendingChange(confirming);

  return (
    <div className="admin-page">
      <header className="admin-toolbar">
        <button className="toolbar-btn" type="button" onClick={onBack}>
          <span aria-hidden="true">‹</span> Back
        </button>
        <h1 className="toolbar-title">Admin</h1>
      </header>

      <main className="admin-content wide">
        <p role="status" className="visually-hidden">
          {announce}
        </p>
        {lastLogin && (
          <p className="hint last-login" role="status">
            Last logged in{' '}
            {new Date(lastLogin).toLocaleString(undefined, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              hour: 'numeric',
              minute: '2-digit',
            })}
            .
            {failedSince > 0 &&
              ` ${failedSince} failed ${failedSince === 1 ? 'attempt' : 'attempts'} since then. If that wasn't you, change your password.`}
          </p>
        )}

        <dl className="stat-grid">
          {tiles.map(([label, value]) => (
            <div key={label} className="stat">
              <dt>{label}</dt>
              <dd>{value ?? '–'}</dd>
            </div>
          ))}
        </dl>

        <section aria-labelledby="users-title">
          <div className="section-head">
            <h2 id="users-title" className="section-title">
              Users
            </h2>
            <select
              className="role-select status-filter"
              aria-label="Show users"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">All users</option>
              <option value="active">Active</option>
              <option value="inactive">Deactivated</option>
            </select>
            <input
              className="admin-search"
              type="search"
              placeholder="Search by name or email"
              aria-label="Search users"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <ErrorMsg>{error}</ErrorMsg>
          {users === null && !error && <p className="msg">Loading users…</p>}
          {users?.length === 0 && <p className="msg">No users yet</p>}
          {users?.length > 0 && shown.length === 0 && <p className="msg">No matches</p>}

          {shown?.length > 0 && (
            // Scrolls sideways on a phone rather than hiding columns
            <div className="table-wrap">
              <table className="user-table">
                <thead>
                  <tr>
                    <th scope="col">User</th>
                    <th scope="col">Role</th>
                    <th scope="col">2FA</th>
                    <th scope="col" className="num">
                      Logins
                    </th>
                    <th scope="col">Last login</th>
                    <th scope="col" className="num">
                      Workouts
                    </th>
                    <th scope="col" className="actions">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((u) => (
                    <Fragment key={u.id}>
                      <tr className={u.active ? '' : 'inactive'}>
                        <th scope="row">
                          <div className="user-cell">
                            <div
                              className={`avatar${u.active ? '' : ' inactive'}`}
                              aria-hidden="true"
                            >
                              {initials(u)}
                            </div>
                            <div>
                              <div className="user-name">
                                {displayName(u)}
                                {u.isYou && <span className="you">(you)</span>}
                                {!u.active && <span className="badge muted">Deactivated</span>}
                                {u.failedLast7d >= 5 && (
                                  <span className="badge danger">
                                    {u.failedLast7d} failed logins this week
                                  </span>
                                )}
                              </div>
                              <div className="user-email">{u.email}</div>
                            </div>
                          </div>
                        </th>
                        <td>
                          {/* Stays on the saved role until the confirm dialog's change goes through */}
                          <select
                            className="role-select"
                            aria-label={`Role for ${displayName(u)}`}
                            value={u.isAdmin ? 'admin' : 'member'}
                            onChange={() => setConfirming({ user: u, kind: 'role' })}
                            disabled={savingId === u.id}
                          >
                            <option value="admin">Admin</option>
                            <option value="member">Member</option>
                          </select>
                        </td>
                        <td>
                          <TwoFactor user={u} />
                        </td>
                        <td className="num">{u.logins}</td>
                        <td>
                          {u.lastLogin
                            ? new Date(u.lastLogin).toLocaleDateString(undefined, {
                                day: 'numeric',
                                month: 'short',
                              })
                            : 'Never'}
                        </td>
                        <td className="num">{u.workouts}</td>
                        <td className="actions">
                          {u.active ? (
                            <button
                              aria-label={`Send reset link to ${displayName(u)}`}
                              className="text-btn"
                              type="button"
                              onClick={() => handleReset(u.id)}
                              disabled={creatingFor === u.id}
                            >
                              {creatingFor === u.id ? 'Creating…' : 'Send reset link'}
                            </button>
                          ) : (
                            <button
                              aria-label={`Reactivate ${displayName(u)}`}
                              className="text-btn"
                              type="button"
                              onClick={() => setConfirming({ user: u, kind: 'reactivate' })}
                              disabled={savingId === u.id}
                            >
                              {savingId === u.id ? 'Reactivating…' : 'Reactivate'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {(reset?.userId === u.id || rowError?.userId === u.id) && (
                        <tr className="detail-row">
                          <td colSpan={7}>
                            {reset?.userId === u.id && (
                              <>
                                <div className="reset-field">
                                  <input
                                    readOnly
                                    value={reset.link}
                                    aria-label={`Reset link for ${displayName(u)}`}
                                    onFocus={(e) => e.target.select()}
                                  />
                                  <button
                                    className="pill-btn filled"
                                    type="button"
                                    onClick={handleCopy}
                                  >
                                    {copied ? 'Copied' : 'Copy'}
                                  </button>
                                </div>
                                <p className="hint">
                                  Copy this and send it to them. It works once, for 15 minutes.
                                </p>
                              </>
                            )}
                            {rowError?.userId === u.id && (
                              <p className="msg error row-error" role="alert">
                                {rowError.message}
                              </p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {stats && (
          <section aria-labelledby="activity-title">
            <div className="section-head">
              <h2 id="activity-title" className="section-title">
                Activity
              </h2>
              <p className="admin-subtitle">Last 30 days</p>
            </div>
            <div className="chart-grid">
              {charts.map(({ title, data, tone, alertAt }) => {
                const peak = data.reduce((a, b) => (b.value > a.value ? b : a));
                return (
                  <BarChart
                    key={title}
                    title={title}
                    data={data}
                    max={chartMax}
                    tone={tone}
                    alertAt={alertAt}
                    summary={
                      peak.value
                        ? `${total(data)} total. Busiest day: ${peak.label}, with ${peak.value}.`
                        : 'None in the last 30 days.'
                    }
                  />
                );
              })}
            </div>
          </section>
        )}

        {change && (
          <ConfirmDialog
            title={change.title}
            body={change.body}
            confirmLabel={change.confirmLabel}
            danger={change.danger}
            onConfirm={() => {
              setConfirming(null);
              change.run();
            }}
            onCancel={() => setConfirming(null)}
          />
        )}
      </main>
    </div>
  );
}
