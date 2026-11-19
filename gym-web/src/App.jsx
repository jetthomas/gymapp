import { useEffect, useState } from 'react';
import LoginForm from './LoginForm';
import CreateAccountForm from './CreateAccountForm';
import ReactivateAccountForm from './ReactivateAccountForm';
import ForgotPasswordForm from './ForgotPasswordForm';
import AdminScreen from './AdminScreen';
import AccountScreen from './AccountScreen';
import CaloriesScreen from './CaloriesScreen';
import HomeScreen from './HomeScreen';
import MuscleMap from './musclemap';
import NavBar from './NavBar';
import ResetPasswordForm from './ResetPasswordForm';
import { logout, refresh, setOnSessionExpired, verifyEmail } from './api';
import { flush } from './outbox';

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
  const [lastLogin, setLastLogin] = useState(null);
  const [failedSince, setFailedSince] = useState(0);
  // True until the "Stay logged in" cookie has been tried, so the login form doesn't flash
  const [checking, setChecking] = useState(true);
  const [visit, setVisit] = useState(0);

  // On unless the member turned it off in Account; the nav, dashboard and Calories page all read it
  const [showCalories, setShowCalories] = useState(
    () => localStorage.getItem('show-calories') !== '0',
  );

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

  useEffect(() => {
    if (!token) return;
    flush(token);
    const onOnline = () => flush(token);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [token]);

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
    setPage('login');
  }

  function handleLogOut() {
    // Tell the server so the token and the "Stay logged in" cookie stop working;
    // sign out locally even if that call fails
    logout(token).catch(() => {});
    logOut();
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
  return (
    <div className="admin-page">
      <NavBar
        token={token}
        // Signed in, the login and reset pages show the dashboard
        page={page === 'login' || page === 'reset' ? 'home' : page}
        isAdmin={isAdmin}
        showCalories={showCalories}
        onNavigate={(next) => {
          setPage(next);
          setVisit((v) => v + 1);
        }}
      />
      {page === 'admin' ? (
        <AdminScreen token={token} lastLogin={lastLogin} failedSince={failedSince} />
      ) : page === 'account' ? (
        <AccountScreen
          token={token}
          isAdmin={isAdmin}
          has2fa={has2fa}
          onTokenChanged={setToken}
          onManageUsers={() => setPage('admin')}
          onViewProgress={() => setPage('progress')}
          showCalories={showCalories}
          onShowCaloriesChanged={(on) => {
            setShowCalories(on);
            localStorage.setItem('show-calories', on ? '1' : '0');
          }}
          onLogOut={handleLogOut}
          onSignedOut={(doneNotice = '') => {
            logOut();
            setNotice(doneNotice);
          }}
        />
      ) : page === 'progress' ? (
        <main className="admin-content">
          <button className="outline-btn back-btn" type="button" onClick={() => setPage('account')}>
            <span aria-hidden="true">‹</span> Account
          </button>
          <div className="page-head">
            <h1 className="page-title">Progress</h1>
          </div>
          <MuscleMap token={token} />
        </main>
      ) : page === 'calories' && showCalories ? (
        <CaloriesScreen token={token} />
      ) : (
        <HomeScreen
          key={visit}
          token={token}
          showCalories={showCalories}
          onOpenCalories={() => setPage('calories')}
        />
      )}
    </div>
  );
}
