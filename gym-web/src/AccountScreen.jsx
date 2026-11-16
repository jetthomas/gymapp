import { useEffect, useState } from 'react';
import { deleteAccount, getProfile } from './api';
import ChangePasswordForm from './ChangePasswordForm';
import ConfirmDialog from './ConfirmDialog';
import ErrorMsg from './ErrorMsg';
import { displayName, initials } from './names';
import TwoFactorDisable from './TwoFactorDisable';
import TwoFactorSetup from './TwoFactorSetup';

// Points right when closed, down when its row is open
function Chevron() {
  return (
    <svg
      className="row-chevron"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

// Settings behind the home screen. Its state resets whenever it closes, including on logout.
export default function AccountScreen({
  token,
  isAdmin,
  has2fa,
  onBack,
  onTokenChanged,
  onManageUsers,
  onLogOut,
  onSignedOut,
}) {
  const [profile, setProfile] = useState(null);
  const [open, setOpen] = useState(null); // 'password', '2fa' or null: the row whose form is showing
  const [notice, setNotice] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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

  async function handleDelete() {
    setConfirmingDelete(false);
    setDeleteError('');
    try {
      await deleteAccount(token);
      onSignedOut();
    } catch (err) {
      setDeleteError(err.message);
    }
  }

  return (
    <div className="admin-page">
      <header className="admin-toolbar">
        <button className="toolbar-btn" type="button" onClick={onBack}>
          <span aria-hidden="true">‹</span> Back
        </button>
        <h1 className="toolbar-title">Account</h1>
      </header>

      <main className="admin-content account">
        {profile && (
          <div className="profile-card">
            <div className="profile-avatar" aria-hidden="true">
              {initials(profile)}
            </div>
            <div className="profile-text">
              <div className="profile-name">{displayName(profile)}</div>
              <div className="profile-email">{profile.email}</div>
            </div>
          </div>
        )}
        {notice && (
          <p className="msg success" role="status">
            {notice}
          </p>
        )}

        <h2 className="group-label">Security</h2>
        <div className="group">
          <button
            className="row"
            type="button"
            aria-expanded={open === 'password'}
            onClick={() => toggle('password')}
          >
            <span className="row-text">Change password</span>
            <Chevron />
          </button>
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
          <button
            className="row"
            type="button"
            aria-expanded={open === '2fa'}
            onClick={() => toggle('2fa')}
          >
            <span className="row-text">
              Two-factor authentication
              <span className="row-sub">Authenticator app</span>
            </span>
            <span className={`status${has2fa ? ' on' : ''}`}>{has2fa ? 'On' : 'Off'}</span>
            <Chevron />
          </button>
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
        </div>

        {isAdmin && (
          <>
            <h2 className="group-label">Team</h2>
            <div className="group">
              <button className="row" type="button" onClick={onManageUsers}>
                <span className="row-text">Manage users</span>
                <Chevron />
              </button>
            </div>
          </>
        )}

        <button className="outline-btn" type="button" onClick={onLogOut}>
          Log out
        </button>

        <h2 className="group-label">Danger zone</h2>
        <div className="group danger">
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
        </div>
        <ErrorMsg>{deleteError}</ErrorMsg>
        {confirmingDelete && (
          <ConfirmDialog
            title="Delete your account?"
            body="You can reactivate it later from the login screen."
            confirmLabel="Delete account"
            danger
            onConfirm={handleDelete}
            onCancel={() => setConfirmingDelete(false)}
          />
        )}
      </main>
    </div>
  );
}
