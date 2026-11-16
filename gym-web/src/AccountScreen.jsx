import { useState } from 'react';
import { deleteAccount } from './api';
import ChangePasswordForm from './ChangePasswordForm';
import ConfirmDialog from './ConfirmDialog';
import ErrorMsg from './ErrorMsg';
import TwoFactorDisable from './TwoFactorDisable';
import TwoFactorSetup from './TwoFactorSetup';

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
  const [changingPassword, setChangingPassword] = useState(false);
  const [notice, setNotice] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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

      <main className="admin-content">
        <div className="login-card">
          {notice && (
            <p className="msg success" role="status">
              {notice}
            </p>
          )}
          <button className="login-btn" onClick={onLogOut}>
            Log out
          </button>
          {isAdmin && (
            <button className="link-btn" onClick={onManageUsers}>
              Manage users
            </button>
          )}
          {changingPassword ? (
            <ChangePasswordForm
              token={token}
              onChanged={(t) => {
                onTokenChanged(t);
                setChangingPassword(false);
                setNotice('Password changed. Other devices have been logged out.');
              }}
              onCancel={() => setChangingPassword(false)}
            />
          ) : (
            <button
              className="link-btn"
              onClick={() => {
                setNotice('');
                setChangingPassword(true);
              }}
            >
              Change password
            </button>
          )}
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
          <button className="link-btn danger" onClick={() => setConfirmingDelete(true)}>
            Delete account
          </button>
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
        </div>
      </main>
    </div>
  );
}
