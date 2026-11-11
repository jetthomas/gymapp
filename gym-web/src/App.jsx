import { useEffect, useState } from 'react';
import LoginForm from './LoginForm';
import CreateAccountForm from './CreateAccountForm';
import ReactivateAccountForm from './ReactivateAccountForm';
import AdminScreen from './AdminScreen';
import ResetPasswordForm from './ResetPasswordForm';
import TwoFactorSetup from './TwoFactorSetup';
import { deleteAccount, logout, setOnSessionExpired } from './api';

export default function App() {
  const [token, setToken] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  // Logging in with a code means 2FA is on, so there's no need to ask the server
  const [has2fa, setHas2fa] = useState(false);
  // The reset link opens the app as /?reset=<token>
  const [resetToken] = useState(() => new URLSearchParams(window.location.search).get('reset'));
  const [page, setPage] = useState(resetToken ? 'reset' : 'login');
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState('');
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    // Drop ?reset=... right away so the token doesn't stay in the address bar or history
    if (resetToken) window.history.replaceState(null, '', window.location.pathname);
    setOnSessionExpired(() => {
      setToken(null);
      setIsAdmin(false);
      setPage('login');
      setNotice('Your session expired. Log in again.');
    });
  }, [resetToken]);

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
    setPage('login');
  }

  function handleLogOut() {
    // Tell the server so the token stops working; sign out locally even if that call fails
    logout(token).catch(() => {});
    logOut();
  }

  async function handleDelete() {
    if (!window.confirm('Delete your account? You can reactivate it later from the login screen.'))
      return;
    setDeleteError('');
    try {
      await deleteAccount(token);
      logOut();
    } catch (err) {
      setDeleteError(err.message);
    }
  }

  if (!token && page === 'create') {
    return <CreateAccountForm initialEmail={email} onBack={backToLogin} />;
  }
  if (!token && page === 'reactivate') {
    return <ReactivateAccountForm initialEmail={email} onBack={backToLogin} />;
  }
  if (!token && page === 'reset') {
    return <ResetPasswordForm token={resetToken} onBack={backToLogin} />;
  }
  if (!token) {
    return (
      <LoginForm
        initialEmail={email}
        notice={notice}
        onLoggedIn={(t, admin, usedCode = false) => {
          setNotice('');
          setToken(t);
          setIsAdmin(admin);
          setHas2fa(usedCode);
        }}
        onCreateAccount={(e) => openPage('create', e)}
        onReactivateAccount={(e) => openPage('reactivate', e)}
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
        <button className="login-btn" onClick={handleLogOut}>
          Log Out
        </button>
        {isAdmin && (
          <button className="link-btn" onClick={() => setPage('admin')}>
            Manage users
          </button>
        )}
        {!has2fa && (
          <TwoFactorSetup
            token={token}
            onEnabled={() => {
              // Turning 2FA on signs out every session, this one included
              logOut();
              setNotice('Two-factor is on. Log in again with your code.');
            }}
          />
        )}
        <button className="link-btn danger" onClick={handleDelete}>
          Delete Account
        </button>
        {deleteError && (
          <p className="msg error" role="alert">
            {deleteError}
          </p>
        )}
      </div>
    </div>
  );
}
