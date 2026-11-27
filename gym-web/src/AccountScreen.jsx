import { useEffect, useState } from 'react';
import { deleteAccount, deleteAvatar, eraseAccount, getExport, openPortal, putAvatar } from './api';
import { toAvatar } from './avatar';
import ChangePasswordForm from './ChangePasswordForm';
import { clock } from './Draft';
import ErrorMsg from './ErrorMsg';
import toCsv from './exportCsv';
import { Check, LogOut } from './icons';
import UpgradeDialog from './UpgradeDialog';
import { displayName, initials } from './names';
import PasswordInput from './PasswordInput';
import TwoFactorDisable from './TwoFactorDisable';
import TwoFactorSetup from './TwoFactorSetup';
import { useWaiting } from './outbox';
import useSubmit from './useSubmit';
import { dayKey } from './week';

// Settings behind the home screen. Its state resets whenever it closes, including on logout.
export default function AccountScreen({
  token,
  isAdmin,
  has2fa,
  plus,
  profile, // null until App has loaded it
  onProfileChanged,
  onTokenChanged,
  onManageUsers,
  onViewProgress,
  showCalories,
  onShowCaloriesChanged,
  showWorkout,
  onShowWorkoutChanged,
  onLogOut,
  onSignedOut,
}) {
  const [open, setOpen] = useState(null); // 'password', '2fa' or null: the row whose form is showing
  const [notice, setNotice] = useState('');
  const deleting = useSubmit();
  const billing = useSubmit();
  const [upgrading, setUpgrading] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [confirming, setConfirming] = useState(null); // 'deactivate', 'delete' or null: the danger zone's open form
  const exporting = useSubmit();
  const [showRir, setShowRir] = useState(() => localStorage.getItem('show-rir') === '1');
  const [restSeconds, setRestSeconds] = useState(
    () => localStorage.getItem('rest-seconds') ?? '90',
  );
  const waiting = useWaiting(token);
  const photo = useSubmit();
  const [photoSavedAt, setPhotoSavedAt] = useState(0); // a new value restarts the 3 s timer

  useEffect(() => {
    if (!photoSavedAt) return;
    const timer = setTimeout(() => setPhotoSavedAt(0), 3000);
    return () => clearTimeout(timer);
  }, [photoSavedAt]);

  // Mirrors can_join in billing.rs: only these can start a new subscription; the rest manage theirs
  const status = profile?.membershipStatus;
  const canJoin = !status || status === 'canceled' || status === 'incomplete_expired';
  // Paid up: the card says Purchased. past_due still has Plus but must fix their card
  const purchased = plus && !isAdmin && status !== 'past_due';
  const until = profile?.membershipEndsAt
    ? new Date(profile.membershipEndsAt).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
      })
    : '';
  const plusLine = isAdmin
    ? 'Included free for admins.'
    : status === 'past_due'
      ? 'Your last payment failed. Update your card to keep Plus.'
      : status === 'trialing'
        ? `Free trial until ${until}`
        : plus
          ? `Paid until ${until}`
          : 'Barcode scanner, progress charts and a year of muscle history.';

  // Sends the browser to Stripe's Customer Portal to change card or cancel
  function manage() {
    billing.run(async () => {
      const { url } = await openPortal(token);
      window.location.assign(url);
    });
  }

  function toggle(row) {
    setNotice('');
    setOpen(open === row ? null : row);
  }

  function handleDelete(event) {
    event.preventDefault();
    deleting.run(async () => {
      if (confirming === 'delete') {
        await eraseAccount(token, deletePassword);
        onSignedOut('Your account and all its data are deleted.');
      } else {
        await deleteAccount(token, deletePassword);
        onSignedOut();
      }
    });
  }

  // Saves the last 30 days as a CSV file
  function handleExport() {
    exporting.run(async () => {
      const data = await getExport(token);
      const link = document.createElement('a');
      // The byte-order mark tells Excel the file is UTF-8, so names like "Crème brûlée" stay readable
      link.href = URL.createObjectURL(
        new Blob(['﻿', toCsv(data)], { type: 'text/csv;charset=utf-8' }),
      );
      link.download = `barmetric-export-${dayKey(new Date())}.csv`;
      link.click();
    });
  }

  return (
    <main className="admin-content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Account</h1>
          <p className="admin-subtitle">
            {isAdmin ? 'Manage your security and team access.' : 'Manage your security.'}
          </p>
        </div>
      </div>
      {notice && (
        <p className="msg success" role="status">
          {notice}
        </p>
      )}

      <div className="account">
        <aside className="card profile-card">
          {profile && (
            <>
              <div className="profile-avatar" aria-hidden="true">
                {profile.avatar ? (
                  <img src={`data:image/jpeg;base64,${profile.avatar}`} alt="" />
                ) : (
                  initials(profile)
                )}
              </div>
              <div className="profile-name">{displayName(profile)}</div>
              <div className="profile-email">{profile.email}</div>
              <div className="profile-links">
                <label className="link-btn">
                  Change photo
                  {/* Hidden from view but not from the keyboard, so Tab reaches it */}
                  <input
                    type="file"
                    accept="image/*"
                    className="visually-hidden"
                    onChange={(e) => {
                      const file = e.target.files[0];
                      // Cleared so the same photo can be picked again; a cancelled pick has no file
                      e.target.value = '';
                      if (!file) return;
                      photo.run(async () => {
                        const image = await toAvatar(file);
                        await putAvatar(token, image);
                        onProfileChanged((p) => ({ ...p, avatar: image }));
                        setPhotoSavedAt(Date.now());
                      });
                    }}
                  />
                </label>
                {profile.avatar && (
                  <button
                    className="link-btn danger"
                    type="button"
                    disabled={photo.loading}
                    onClick={() =>
                      photo.run(async () => {
                        await deleteAvatar(token);
                        onProfileChanged((p) => ({ ...p, avatar: null }));
                      })
                    }
                  >
                    Remove photo
                  </button>
                )}
              </div>
              {photoSavedAt > 0 && (
                <p key={photoSavedAt} className="msg success photo-saved" role="status">
                  Photo saved.
                </p>
              )}
              <ErrorMsg>{photo.message}</ErrorMsg>
            </>
          )}
          {waiting > 0 && (
            <p className="hint">
              {waiting} {waiting === 1 ? 'workout is' : 'workouts are'} still waiting to upload.
              Logging out keeps them on this device until you log in here again.
            </p>
          )}
          <button className="outline-btn wide" type="button" onClick={onLogOut}>
            <LogOut size={18} />
            Log out
          </button>
        </aside>

        <div className="account-cards">
          <section className="card" aria-labelledby="security-title">
            <h2 id="security-title" className="section-title">
              Security
            </h2>
            <p className="row-sub">Keep your account protected.</p>
            <div className="row static">
              <span className="row-text">Password</span>
              <button
                className="outline-btn"
                type="button"
                aria-expanded={open === 'password'}
                onClick={() => toggle('password')}
              >
                Change password
              </button>
            </div>
            {open === 'password' && (
              <div className="row-panel">
                <ChangePasswordForm
                  token={token}
                  onChanged={(t) => {
                    onTokenChanged(t);
                    setOpen(null);
                    setNotice('Password changed. Other devices have been logged out.');
                  }}
                  onCancel={() => setOpen(null)}
                />
              </div>
            )}
            <div className="row static">
              <span className="row-text">
                Two-factor authentication
                <span className="row-sub">Authenticator app</span>
              </span>
              <span className={`status${has2fa ? ' on' : ''}`}>{has2fa ? 'On' : 'Off'}</span>
              <button
                className="outline-btn"
                type="button"
                aria-expanded={open === '2fa'}
                aria-label="Manage two-factor authentication"
                onClick={() => toggle('2fa')}
              >
                Manage
              </button>
            </div>
            {open === '2fa' && (
              <div className="row-panel">
                {has2fa ? (
                  <TwoFactorDisable
                    token={token}
                    // Turning 2FA off signs out every session, this one included
                    onDisabled={() => onSignedOut('Two-factor is off. Log in again.')}
                  />
                ) : (
                  <TwoFactorSetup
                    token={token}
                    onTokenChanged={onTokenChanged}
                    // Turning 2FA on signs out every session, this one included
                    onEnabled={() => onSignedOut('Two-factor is on. Log in again with your code.')}
                  />
                )}
              </div>
            )}
          </section>
          <section className="card" aria-labelledby="training-title">
            <h2 id="training-title" className="section-title">
              Training
            </h2>
            <p className="row-sub">Settings for this device.</p>
            <div className="row static">
              <label className="row-text" htmlFor="show-rir">
                Show RIR on sets
                <span className="row-sub">How many more reps you could have done.</span>
              </label>
              <input
                id="show-rir"
                type="checkbox"
                className="switch"
                role="switch"
                checked={showRir}
                onChange={(e) => {
                  setShowRir(e.target.checked);
                  localStorage.setItem('show-rir', e.target.checked ? '1' : '0');
                }}
              />
            </div>
            <div className="row static">
              <label className="row-text" htmlFor="show-calories">
                Show Calories
                <span className="row-sub">
                  Off hides the Calories tab and card. Your entries are kept; to delete them, use
                  Calories → Edit target.
                </span>
              </label>
              <input
                id="show-calories"
                type="checkbox"
                className="switch"
                role="switch"
                checked={showCalories}
                onChange={(e) => onShowCaloriesChanged(e.target.checked)}
              />
            </div>
            <div className="row static">
              <label className="row-text" htmlFor="show-workout">
                Show Workout
                <span className="row-sub">
                  Off hides the Workout tab and card. Your past workouts stay in History.
                </span>
              </label>
              <input
                id="show-workout"
                type="checkbox"
                className="switch"
                role="switch"
                checked={showWorkout}
                onChange={(e) => onShowWorkoutChanged(e.target.checked)}
              />
            </div>
            <div className="row static">
              <label className="row-text" htmlFor="rest-seconds">
                Rest timer
                <span className="row-sub">Starts when you tick a set.</span>
              </label>
              <select
                id="rest-seconds"
                className="role-select"
                value={restSeconds}
                onChange={(e) => {
                  setRestSeconds(e.target.value);
                  localStorage.setItem('rest-seconds', e.target.value);
                }}
              >
                {[60, 90, 120, 180, 240, 300].map((s) => (
                  <option key={s} value={s}>
                    {clock(s * 1000)}
                  </option>
                ))}
              </select>
            </div>
          </section>
          <section className="card split plus" aria-labelledby="plus-title">
            <div>
              <h2 id="plus-title" className="section-title">
                BarMetric Plus
              </h2>
              <p className="row-sub">{plusLine}</p>
              {purchased && (
                <button
                  className="link-btn inline"
                  type="button"
                  disabled={billing.loading}
                  onClick={manage}
                >
                  {billing.loading ? 'Opening…' : 'Manage membership'}
                </button>
              )}
              <ErrorMsg>{billing.message}</ErrorMsg>
            </div>
            {!isAdmin &&
              profile &&
              (purchased ? (
                <button className="pill-btn filled" type="button" disabled>
                  <Check size={16} />
                  Purchased
                </button>
              ) : canJoin ? (
                <button
                  className="pill-btn filled"
                  type="button"
                  onClick={() => setUpgrading(true)}
                >
                  Upgrade
                </button>
              ) : (
                <button
                  className="outline-btn"
                  type="button"
                  disabled={billing.loading}
                  onClick={manage}
                >
                  {billing.loading ? 'Opening…' : 'Manage membership'}
                </button>
              ))}
          </section>
          {upgrading && <UpgradeDialog token={token} onClose={() => setUpgrading(false)} />}
          <section className="card split" aria-labelledby="progress-title">
            <div>
              <h2 id="progress-title" className="section-title">
                Progress
              </h2>
              <p className="row-sub">Muscles trained in the last 30 days</p>
            </div>
            <button className="outline-btn" type="button" onClick={onViewProgress}>
              View progress
            </button>
          </section>
          {isAdmin && (
            <section className="card split" aria-labelledby="team-title">
              <div>
                <h2 id="team-title" className="section-title">
                  Team
                </h2>
                <p className="row-sub">Manage users</p>
              </div>
              <button className="pill-btn filled" type="button" onClick={onManageUsers}>
                Manage users
              </button>
            </section>
          )}

          <section className="card split" aria-labelledby="export-title">
            <div>
              <h2 id="export-title" className="section-title">
                Your data
              </h2>
              <p className="row-sub">
                Your workouts, food log and weigh-ins from the last 30 days, as a spreadsheet (CSV).
              </p>
              <ErrorMsg>{exporting.message}</ErrorMsg>
            </div>
            <button
              className="outline-btn"
              type="button"
              disabled={exporting.loading}
              onClick={handleExport}
            >
              {exporting.loading ? 'Exporting…' : 'Export data'}
            </button>
          </section>

          <section className="card danger" aria-labelledby="danger-title">
            <h2 id="danger-title" className="section-title">
              Danger zone
            </h2>
            <div className="row static">
              <span className="row-text">
                Deactivate or delete account
                <span className="row-sub">
                  Deactivating can be undone. Deleting removes your account and all its data for
                  good.
                </span>
              </span>
              <div className="head-actions">
                <button
                  className="outline-btn danger"
                  type="button"
                  aria-expanded={confirming === 'deactivate'}
                  onClick={() => setConfirming('deactivate')}
                >
                  Deactivate
                </button>
                <button
                  className="outline-btn danger"
                  type="button"
                  aria-expanded={confirming === 'delete'}
                  onClick={() => setConfirming('delete')}
                >
                  Delete
                </button>
              </div>
            </div>
            {confirming && (
              <div className="row-panel">
                <form onSubmit={handleDelete}>
                  <p className="hint">
                    {confirming === 'delete'
                      ? 'This deletes your account, workouts, food log and weigh-ins for good. It can’t be undone, so export your data first if you want a copy.'
                      : 'This deactivates your account. You can reactivate it from the login screen.'}
                  </p>
                  <div className="field">
                    <label htmlFor="delete-password">Password</label>
                    <PasswordInput
                      id="delete-password"
                      autoComplete="current-password"
                      value={deletePassword}
                      onChange={(e) => setDeletePassword(e.target.value)}
                    />
                  </div>
                  <ErrorMsg>{deleting.message}</ErrorMsg>
                  <button className="login-btn danger" type="submit" disabled={deleting.loading}>
                    {confirming === 'delete' ? 'Delete account forever' : 'Deactivate account'}
                  </button>
                  <button
                    className="link-btn"
                    type="button"
                    disabled={deleting.loading}
                    onClick={() => {
                      setConfirming(null);
                      setDeletePassword('');
                      deleting.setMessage('');
                    }}
                  >
                    Cancel
                  </button>
                </form>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
