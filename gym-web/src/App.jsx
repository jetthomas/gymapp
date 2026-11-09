import { useState } from 'react';
import LoginForm from './LoginForm';
import CreateAccountForm from './CreateAccountForm';
import ReactivateAccountForm from './ReactivateAccountForm';
import AdminScreen from './AdminScreen';
import ResetPasswordForm from './ResetPasswordForm';
import TwoFactorSetup from './TwoFactorSetup';
import { deleteaccount } from './api';
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

  async function handleDelete() {
    if (!window.confirm('Delete your account? You can reactivate it later from the login screen.')) return;
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
  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Logged In!</h1>
        <button className="login-btn" onClick={logOut}>
          Log Out
        </button>
        {isAdmin && (
          <button className="link-btn" onClick={() => setPage('admin')}>
            Manage users
          </button>
        )}
        <TwoFactorSetup token={token} />
        <button className="link-btn danger" onClick={handleDelete}>
          Delete Account
        </button>
        {deleteError && <p className="msg error" role="alert">{deleteError}</p>}
      </div>
    </div>
  );
}
