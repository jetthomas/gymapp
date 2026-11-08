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

  if (!token && page === 'create') {
    return <CreateAccountForm initialEmail={email} onBack={() => setPage('login')} />;
  }
  if (!token && page === 'reactivate') {
    return <ReactivateAccountForm onBack={() => setPage('login')} />;
  }
  if (!token) {
    return (
      <LoginForm
        onLoggedIn={setToken}
        onCreateAccount={(e) => {
          setEmail(e);
          setPage('create');
        }}
        onReactivateAccount={() => setPage('reactivate')}
      />
    );
  }
  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Logged in!</h1>
        <button className="login-btn" onClick={() => setToken(null)}>
          Log out
        </button>
        <button
          className="outline-btn-danger"
          onClick={async () => {
            await deleteaccount(token);
            setToken(null);
          }}
        >
          Delete Account
        </button>
      </div>
    </div>
  );
}
