import { Fragment, useEffect, useState } from 'react';
import { getUsers, getStats, createResetLink, reactivateUser, setAdmin } from './api';
import AdminExercises from './AdminExercises';
import BarChart from './BarChart';
import ConfirmDialog from './ConfirmDialog';
import ErrorMsg from './ErrorMsg';
import { ChevronLeft } from './icons';
import { displayName, initials } from './names';
import perDay from './perDay';
import { addDays, dayKey } from './week';

const total = (data) => data.reduce((s, d) => s + d.value, 0);

// The last `n` days, ending today, as YYYY-MM-DD
function lastDays(n) {
  const to = dayKey(new Date());
  return { from: addDays(to, 1 - n), to };
}

// On, Off, or a warning for an admin who has no second factor
function TwoFactor({ user }) {
  if (user.totpEnabled) return <span className="tfa on">2FA On</span>;
  if (user.isAdmin && user.active)
    return (
      <span className="tfa warn" title="Admins should turn on two-factor">
        2FA Off
        <span className="visually-hidden"> (recommended for admins)</span>
      </span>
    );
  return <span className="tfa">2FA Off</span>;
}

export default function AdminScreen({ token, lastLogin, failedSince }) {
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
  // Its own error, so a stats answer can't clear a failed users load
  const [statsError, setStatsError] = useState('');
  const [range, setRange] = useState(() => lastDays(30)); // the days the Activity screen covers
  const [view, setView] = useState('users'); // 'users' or 'activity'

  // Runs once when the screen opens (and again only if token changes)
  useEffect(() => {
    getUsers(token)
      .then(setUsers)
      .catch((err) => setError(err.message));
  }, [token]);

  useEffect(() => {
    getStats(token, range.from, range.to)
      .then((rows) => {
        setStats(rows);
        setStatsError('');
      })
      .catch((err) => setStatsError(err.message));
  }, [token, range]);

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
        { title: 'Logins per day', data: perDay(stats, 'login', range.from, range.to) },
        // Orange normally; a day over 20 turns red
        {
          title: 'Failed logins per day',
          data: perDay(stats, 'login_failed', range.from, range.to),
          tone: 'warn',
          alertAt: 20,
        },
      ]
    : [];
  // Rounded up to even, so the middle gridline is a whole number
  const chartMax =
    2 * Math.ceil(Math.max(1, ...charts.flatMap((c) => c.data.map((d) => d.value))) / 2);
  const tiles = [
    ['Accounts', users?.length],
    ['Active', users?.filter((u) => u.active).length],
    ['Logins, last 30 days', charts[0] && total(charts[0].data)],
    ['Failed logins, last 30 days', charts[1] && total(charts[1].data)],
  ];
  const change = confirming && pendingChange(confirming);

  return (
    <main className="admin-content">
      <p role="status" className="visually-hidden">
        {announce}
      </p>
      {view === 'activity' ? (
        <>
          <button
            className="ghost-btn back-btn"
            type="button"
            onClick={() => {
              setView('users');
              // The Admin tiles say "last 30 days", so they go back to that
              setRange(lastDays(30));
            }}
          >
            <ChevronLeft size={18} /> Back to Admin
          </button>
          <div className="page-head">
            <div>
              <h1 className="page-title">Activity</h1>
              <p className="admin-subtitle">Account sign-ins at a glance.</p>
            </div>
          </div>
          <div className="range-picker">
            <label>
              From
              <input
                type="date"
                value={range.from}
                max={range.to}
                // Clearing the field gives '', which isn't a day
                onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={range.to}
                min={range.from}
                max={dayKey(new Date())}
                onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })}
              />
            </label>
            {[7, 30, 90].map((n) => (
              <button
                key={n}
                className="outline-btn"
                type="button"
                onClick={() => setRange(lastDays(n))}
              >
                {n} days
              </button>
            ))}
          </div>
          <ErrorMsg>{statsError}</ErrorMsg>
          {!stats && !statsError && <p className="msg">Loading activity…</p>}
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
                  total={total(data)}
                  summary={
                    peak.value
                      ? `Busiest day: ${peak.label}, with ${peak.value}.`
                      : 'None in these days.'
                  }
                />
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className="page-head">
            <div>
              <h1 className="page-title">Admin</h1>
              <p className="admin-subtitle">Manage people, access, and your exercise library.</p>
            </div>
            <button className="outline-btn" type="button" onClick={() => setView('activity')}>
              View activity
            </button>
          </div>
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
              <div>
                <h2 id="users-title" className="section-title">
                  Users
                </h2>
                {users && (
                  <p className="admin-subtitle">
                    {users.length} accounts · {users.filter((u) => u.active).length} active
                  </p>
                )}
              </div>
              <input
                className="admin-search"
                type="search"
                placeholder="Search by name or email"
                aria-label="Search users"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
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
                      <th scope="col">Access</th>
                      <th scope="col">Activity</th>
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
                            <div className="access-cell">
                              {u.active ? (
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
                              ) : (
                                <span className="role-select muted">
                                  {u.isAdmin ? 'Admin' : 'Member'}
                                </span>
                              )}
                              <TwoFactor user={u} />
                            </div>
                          </td>
                          <td>
                            {u.logins} {u.logins === 1 ? 'login' : 'logins'} · {u.workouts}{' '}
                            {u.workouts === 1 ? 'workout' : 'workouts'}
                            <div className="user-email">
                              {u.lastLogin
                                ? `Last login ${new Date(u.lastLogin).toLocaleDateString(
                                    undefined,
                                    {
                                      day: 'numeric',
                                      month: 'short',
                                    },
                                  )}`
                                : 'Never logged in'}
                            </div>
                          </td>
                          <td className="actions">
                            {u.active ? (
                              <button
                                aria-label={`Send reset link to ${displayName(u)}`}
                                className="outline-btn"
                                type="button"
                                onClick={() => handleReset(u.id)}
                                disabled={creatingFor === u.id}
                              >
                                {creatingFor === u.id ? 'Creating…' : 'Send reset link'}
                              </button>
                            ) : (
                              <button
                                aria-label={`Reactivate ${displayName(u)}`}
                                className="outline-btn"
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
                            <td colSpan={4}>
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

          <AdminExercises token={token} />
        </>
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
  );
}
