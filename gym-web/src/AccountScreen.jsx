import { useEffect, useState } from 'react';
import { deleteAccount, getProfile } from './api';
import ChangePasswordForm from './ChangePasswordForm';
import { clock } from './Draft';
import ErrorMsg from './ErrorMsg';
import { displayName, initials } from './names';
import PasswordInput from './PasswordInput';
import TwoFactorDisable from './TwoFactorDisable';
import TwoFactorSetup from './TwoFactorSetup';
import { useWaiting } from './outbox';

// Settings behind the home screen. Its state resets whenever it closes, including on logout.
export default function AccountScreen({
  token,
  isAdmin,
  has2fa,
  onTokenChanged,
  onManageUsers,
  onLogOut,
  onSignedOut,
}) {
  const [profile, setProfile] = useState(null);
  const [open, setOpen] = useState(null); // 'password', '2fa' or null: the row whose form is showing
  const [notice, setNotice] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showRir, setShowRir] = useState(() => localStorage.getItem('show-rir') === '1');
  const [restSeconds, setRestSeconds] = useState(
    () => localStorage.getItem('rest-seconds') ?? '90',
  );
  const waiting = useWaiting(token);

  useEffect(() => {
    // The card just stays hidden if this fails; nothing else on the screen needs it
    getProfile(token)
      .then(setProfile)
      .catch(() => {});
  }, [token]);

  function toggle(row) {
    setNotice('');
    setOpen(open === row ? null : row);
  }

  async function handleDelete(event) {
    event.preventDefault();
    setDeleteError('');
    try {
      await deleteAccount(token, deletePassword);
      onSignedOut();
    } catch (err) {
      setDeleteError(err.message);
    }
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
                {initials(profile)}
              </div>
              <div className="profile-name">{displayName(profile)}</div>
              <div className="profile-email">{profile.email}</div>
            </>
          )}
          {waiting > 0 && (
            <p className="hint">
              {waiting} {waiting === 1 ? 'workout is' : 'workouts are'} still waiting to upload.
              Logging out keeps them on this device until you log in here again.
            </p>
          )}
          <button className="outline-btn" type="button" onClick={onLogOut}>
            Log out
          </button>
        </aside>

        <div className="account-cards">
          <section className="card" aria-labelledby="security-title">
            <h2 id="security-title" className="card-title">
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
                    // Turning 2FA on signs out every session, this one included
                    onEnabled={() => onSignedOut('Two-factor is on. Log in again with your code.')}
                  />
                )}
              </div>
            )}
          </section>
          <section className="card" aria-labelledby="training-title">
            <h2 id="training-title" className="card-title">
              Training
            </h2>
            <p className="row-sub">Settings for logging a workout on this device.</p>
            <div className="row static">
              <label className="row-text" htmlFor="show-rir">
                Show RIR on sets
                <span className="row-sub">How many more reps you could have done.</span>
              </label>
              <input
                id="show-rir"
                type="checkbox"
                checked={showRir}
                onChange={(e) => {
                  setShowRir(e.target.checked);
                  localStorage.setItem('show-rir', e.target.checked ? '1' : '0');
                }}
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
          {isAdmin && (
            <section className="card split" aria-labelledby="team-title">
              <div>
                <h2 id="team-title" className="card-title">
                  Team
                </h2>
                <p className="row-sub">Manage users</p>
              </div>
              <button className="pill-btn filled" type="button" onClick={onManageUsers}>
                Manage users
              </button>
            </section>
          )}

          <section className="card danger" aria-labelledby="danger-title">
            <h2 id="danger-title" className="card-title">
              Danger zone
            </h2>
            <div className="row static">
              <span className="row-text">
                Delete account
                {/* Deleting only deactivates (see delete_account), so don't promise permanent removal */}
                <span className="row-sub">Deactivates your account. You can undo this.</span>
              </span>
              <button
                className="outline-btn danger"
                type="button"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete account
              </button>
            </div>
            {confirmingDelete && (
              <div className="row-panel">
                <form onSubmit={handleDelete}>
                  <p className="hint">
                    This deactivates your account. You can reactivate it from the login screen.
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
                  <ErrorMsg>{deleteError}</ErrorMsg>
                  <button className="login-btn danger" type="submit">
                    Delete account
                  </button>
                  <button
                    className="link-btn"
                    type="button"
                    onClick={() => {
                      setConfirmingDelete(false);
                      setDeletePassword('');
                      setDeleteError('');
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
