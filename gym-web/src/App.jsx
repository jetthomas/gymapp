import { useEffect, useState } from 'react';
import LoginForm from './LoginForm';
import CreateAccountForm from './CreateAccountForm';
import ReactivateAccountForm from './ReactivateAccountForm';
import ForgotPasswordForm from './ForgotPasswordForm';
import AdminScreen from './AdminScreen';
import ResetPasswordForm from './ResetPasswordForm';
import TwoFactorSetup from './TwoFactorSetup';
import TwoFactorDisable from './TwoFactorDisable';
import ChangePasswordForm from './ChangePasswordForm';
import ConfirmDialog from './ConfirmDialog';
import { deleteAccount, logout, refresh, setOnSessionExpired, verifyEmail } from './api';

export default function App() {
  const [token, setToken] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  // Logging in with a code means 2FA is on, so there's no need to ask the server
  const [has2fa, setHas2fa] = useState(false);
  // Links from emails open the app as /#reset=<token> or /#verify=<token>.
  // The part after # is never sent to the server, so it stays out of access logs
  const [link] = useState(() => new URLSearchParams(window.location.hash.slice(1)));
  const resetToken = link.get('reset');
  const verifyToken = link.get('verify');
  const [page, setPage] = useState(resetToken ? 'reset' : 'login');
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [accountNotice, setAccountNotice] = useState('');
  const [lastLogin, setLastLogin] = useState(null);
  const [failedSince, setFailedSince] = useState(0);
  // True until the "Stay signed in" cookie has been tried, so the login form doesn't flash
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Drop #reset=... / #verify=... right away so the token doesn't stay in the address bar or history
    if (resetToken || verifyToken) window.history.replaceState(null, '', window.location.pathname);
    if (verifyToken)
      verifyEmail(verifyToken)
        .then(() => setNotice('Email confirmed. Log in to continue.'))
        .catch((err) => setNotice(err.message));
    refresh()
      .then((r) => {
        setToken(r.accessToken);
        setIsAdmin(r.isAdmin);
        setHas2fa(r.twoFactor);
      })
      .catch(() => {}) // no cookie, or it expired: show the login form
      .finally(() => setChecking(false));
    // When the 1-hour token runs out mid-session, try the cookie before signing out
    setOnSessionExpired(() =>
      // shortcut: the request that hit the 401 is not retried; the member just repeats it
      refresh()
        .then((r) => setToken(r.accessToken))
        .catch(() => {
          setToken(null);
          setIsAdmin(false);
          setPage('login');
          setHas2fa(false);
          setNotice('Your session expired. Log in again.');
        }),
    );
  }, [resetToken, verifyToken]);

  function backToLogin(doneEmail, doneNotice = '') {
    if (doneEmail) setEmail(doneEmail);
    setNotice(doneNotice);
    setPage('login');
  }

  function openPage(next, e) {
    setEmail(e);
    setNotice('');
    setPage(next);
  }

  function logOut() {
    setToken(null);
    setIsAdmin(false);
    setHas2fa(false);
    setLastLogin(null);
    setFailedSince(0);
    setChangingPassword(false);
    setAccountNotice('');
    setPage('login');
  }

  function handleLogOut() {
    // Tell the server so the token and the "Stay signed in" cookie stop working;
    // sign out locally even if that call fails
    logout(token).catch(() => {});
    logOut();
  }

  async function handleDelete() {
    setConfirmingDelete(false);
    setDeleteError('');
    try {
      await deleteAccount(token);
      logOut();
    } catch (err) {
      setDeleteError(err.message);
    }
  }

  if (checking) return null;

  if (!token && page === 'create') {
    return <CreateAccountForm initialEmail={email} onBack={backToLogin} />;
  }
  if (!token && page === 'reactivate') {
    return <ReactivateAccountForm initialEmail={email} onBack={backToLogin} />;
  }
  if (!token && page === 'forgot') {
    return <ForgotPasswordForm initialEmail={email} onBack={backToLogin} />;
  }
  if (!token && page === 'reset') {
    return <ResetPasswordForm token={resetToken} onBack={backToLogin} />;
  }
  if (!token) {
    return (
      <LoginForm
        initialEmail={email}
        notice={notice}
        onLoggedIn={(t, admin, usedCode, last, failed) => {
          setNotice('');
          setToken(t);
          setIsAdmin(admin);
          setHas2fa(usedCode);
          setLastLogin(last);
          setFailedSince(failed);
        }}
        onCreateAccount={(e) => openPage('create', e)}
        onReactivateAccount={(e) => openPage('reactivate', e)}
        onForgotPassword={(e) => openPage('forgot', e)}
      />
    );
  }
  if (page === 'admin') {
    return <AdminScreen token={token} onBack={() => setPage('login')} />;
  }
  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Logged In!</h1>
        {lastLogin && (
          <p className="hint" role="status">
            Last signed in{' '}
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
        {accountNotice && (
          <p className="msg success" role="status">
            {accountNotice}
          </p>
        )}
        <button className="login-btn" onClick={handleLogOut}>
          Log Out
        </button>
        {isAdmin && (
          <button className="link-btn" onClick={() => setPage('admin')}>
            Manage users
          </button>
        )}
        {changingPassword ? (
          <ChangePasswordForm
            token={token}
            onChanged={(t) => {
              setToken(t);
              setChangingPassword(false);
              setAccountNotice('Password changed. Other devices have been signed out.');
            }}
            onCancel={() => setChangingPassword(false)}
          />
        ) : (
          <button
            className="link-btn"
            onClick={() => {
              setAccountNotice('');
              setChangingPassword(true);
            }}
          >
            Change password
          </button>
        )}
        {has2fa ? (
          <TwoFactorDisable
            token={token}
            onDisabled={() => {
              // Turning 2FA off signs out every session, this one included
              logOut();
              setNotice('Two-factor is off. Log in again.');
            }}
          />
        ) : (
          <TwoFactorSetup
            token={token}
            onEnabled={() => {
              // Turning 2FA on signs out every session, this one included
              logOut();
              setNotice('Two-factor is on. Log in again with your code.');
            }}
          />
        )}
        <button className="link-btn danger" onClick={() => setConfirmingDelete(true)}>
          Delete Account
        </button>
        {deleteError && (
          <p className="msg error" role="alert">
            {deleteError}
          </p>
        )}
        {confirmingDelete && (
          <ConfirmDialog
            title="Delete your account?"
            body="You can reactivate it later from the login screen."
            confirmLabel="Delete Account"
            danger
            onConfirm={handleDelete}
            onCancel={() => setConfirmingDelete(false)}
          />
        )}
      </div>
    </div>
  );
}
