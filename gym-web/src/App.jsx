import { useEffect, useState } from 'react';
import LoginForm from './LoginForm';
import CreateAccountForm from './CreateAccountForm';
import ReactivateAccountForm from './ReactivateAccountForm';
import AdminScreen from './AdminScreen';
import ResetPasswordForm from './ResetPasswordForm';
import TwoFactorSetup from './TwoFactorSetup';
import MemberScreen from './MemberScreen';
import { deleteaccount, logout, setOnSessionExpired } from './api';
import './index.css';

export default function App() {
  const [token, setToken] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  // The reset link opens the app as /?reset=<token>
  const [resetToken] = useState(() => new URLSearchParams(window.location.search).get('reset'));
  const [page, setPage] = useState(resetToken ? 'reset' : 'login');
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState('');
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    setOnSessionExpired(() => {
      setToken(null);
      setIsAdmin(false);
      setPage('login');
      setNotice('Your session expired. Log in again.');
    });
  }, []);

  function backToLogin(doneEmail, doneNotice = '') {
    if (doneEmail) setEmail(doneEmail);
    setNotice(doneNotice);
    setPage('login');
    // Drop ?reset=... so a refresh doesn't reopen the reset screen
    window.history.replaceState(null, '', window.location.pathname);
  }

  function logOut() {
    setToken(null);
    setIsAdmin(false);
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
      await deleteaccount(token);
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
        onLoggedIn={(t, admin) => {
          setNotice('');
          setToken(t);
          setIsAdmin(admin);
        }}
        onCreateAccount={(e) => {
          setEmail(e);
          setNotice('');
          setPage('create');
        }}
        onReactivateAccount={(e) => {
          setEmail(e);
          setNotice('');
          setPage('reactivate');
        }}
      />
    );
  }
  if (token && page === 'admin') {
    return <AdminScreen token={token} onBack={() => setPage('login')} />;
  }
  if (!isAdmin && page !== 'account') {
    return <MemberScreen token={token} onAccount={() => setPage('account')} />;
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
        {!isAdmin && (
          <button className="link-btn" onClick={() => setPage('login')}>
            Back to tracker
          </button>
        )}
        <TwoFactorSetup
          token={token}
          onEnabled={() => {
            // Turning 2FA on signs out every session, this one included
            logOut();
            setNotice('Two-factor is on. Log in again with your code.');
          }}
        />
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
