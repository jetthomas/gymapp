import { useState } from 'react';
import LoginForm from './LoginForm';
import CreateAccountForm from './CreateAccountForm';
import ReactivateAccountForm from './ReactivateAccountForm';
import { deleteaccount } from './api';
import './index.css';
export default function App() {
  const [token, setToken] = useState(null);
  const [page, setPage] = useState('login');
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState('');
  const [deleteError, setDeleteError] = useState('');

  function backToLogin(doneEmail, doneNotice = '') {
    if (doneEmail) setEmail(doneEmail);
    setNotice(doneNotice);
    setPage('login');
  }

  async function handleDelete() {
    if (!window.confirm('Delete your account? You can reactivate it later from the login screen.')) return;
    setDeleteError('');
    try {
      await deleteaccount(token);
      setToken(null);
    } catch (err) {
      setDeleteError(
        err.status ? err.message : "Couldn't connect. Check your internet and try again.",
      );
    }
  }

  if (!token && page === 'create') {
    return <CreateAccountForm initialEmail={email} onBack={backToLogin} />;
  }
  if (!token && page === 'reactivate') {
    return <ReactivateAccountForm initialEmail={email} onBack={backToLogin} />;
  }
  if (!token) {
    return (
      <LoginForm
        initialEmail={email}
        notice={notice}
        onLoggedIn={(t) => {
          setNotice('');
          setToken(t);
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
  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Logged In!</h1>
        <button className="login-btn" onClick={() => setToken(null)}>
          Log Out
        </button>
        <button className="link-btn danger" onClick={handleDelete}>
          Delete Account
        </button>
        {deleteError && <p className="msg error" role="alert">{deleteError}</p>}
      </div>
    </div>
  );
}
