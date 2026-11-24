import { useEffect, useState } from 'react';
import { deleteAccount, deleteAvatar, openPortal, putAvatar } from './api';
import { toAvatar } from './avatar';
import ChangePasswordForm from './ChangePasswordForm';
import { clock } from './Draft';
import ErrorMsg from './ErrorMsg';
import UpgradeDialog from './UpgradeDialog';
import { displayName, initials } from './names';
import PasswordInput from './PasswordInput';
import TwoFactorDisable from './TwoFactorDisable';
import TwoFactorSetup from './TwoFactorSetup';
import { useWaiting } from './outbox';
import useSubmit from './useSubmit';

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
  onLogOut,
  onSignedOut,
}) {
  const [open, setOpen] = useState(null); // 'password', '2fa' or null: the row whose form is showing
  const [notice, setNotice] = useState('');
  const deleting = useSubmit();
  const billing = useSubmit();
  const [upgrading, setUpgrading] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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
  // Paid up: the card dims and says Purchased. past_due still has Plus but must fix their card
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
      await deleteAccount(token, deletePassword);
      onSignedOut();
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
              <div className="profile-photo">
                <div className="profile-avatar" aria-hidden="true">
                  {profile.avatar ? (
                    <img src={`data:image/jpeg;base64,${profile.avatar}`} alt="" />
                  ) : (
                    initials(profile)
                  )}
                </div>
                <label className="link-btn">
                  Change photo
                  <input
                    type="file"
                    accept="image/*"
                    hidden
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
            <p className="row-sub">Settings for this device.</p>
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
                checked={showCalories}
                onChange={(e) => onShowCaloriesChanged(e.target.checked)}
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
          <section
            className={`card split${purchased ? ' purchased' : ''}`}
            aria-labelledby="plus-title"
          >
            <div>
              <h2 id="plus-title" className="card-title">
                Gym App Plus
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
                <button className="pill-btn" type="button" disabled>
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
              <h2 id="progress-title" className="card-title">
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
                Deactivate account
                {/* delete_account only deactivates, so the label doesn't promise permanent removal */}
                <span className="row-sub">Deactivates your account. You can undo this.</span>
              </span>
              <button
                className="outline-btn danger"
                type="button"
                onClick={() => setConfirmingDelete(true)}
              >
                Deactivate account
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
                  <ErrorMsg>{deleting.message}</ErrorMsg>
                  <button className="login-btn danger" type="submit" disabled={deleting.loading}>
                    Deactivate account
                  </button>
                  <button
                    className="link-btn"
                    type="button"
                    disabled={deleting.loading}
                    onClick={() => {
                      setConfirmingDelete(false);
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
