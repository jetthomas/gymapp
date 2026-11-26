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
import { getProfile, logout, refresh, setOnSessionExpired, verifyEmail } from './api';
import { flush, userIdOf } from './outbox';
import WorkoutScreen from './WorkoutScreen';

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
  // Stripe sends members back to /?membership=done (paid) or /?membership=cancelled
  const [membership] = useState(() =>
    new URLSearchParams(window.location.search).get('membership'),
  );
  const [page, setPage] = useState(resetToken ? 'reset' : membership ? 'account' : 'login');
  // Who is signed in: name, photo and membership, shared by the nav bar and the Account screen
  const [profile, setProfile] = useState(null);
  // Gym App Plus: paid, or an admin. The server checks it again on every Plus request
  const plus = profile?.plus ?? false;
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState('');
  const [lastLogin, setLastLogin] = useState(null);
  const [failedSince, setFailedSince] = useState(0);
  // True until the "Stay logged in" cookie has been tried, so the login form doesn't flash
  const [checking, setChecking] = useState(true);
  const [visit, setVisit] = useState(0);
  // Opened with no signal by a member who stayed logged in: only the workout screen, saving to this phone
  const [offline, setOffline] = useState(false);
  const [offlineDone, setOfflineDone] = useState(false);

  // On unless the member turned it off in Account; the nav, dashboard and Calories page all read it
  const [showCalories, setShowCalories] = useState(
    () => localStorage.getItem('show-calories') !== '0',
  );

  // Same as Calories: the nav tab, the dashboard card and the Workout page
  const [showWorkout, setShowWorkout] = useState(
    () => localStorage.getItem('show-workout') !== '0',
  );

  // A refresh only works with a "Stay logged in" cookie, so remember who it was for offline mode
  function signedInWithCookie(r) {
    setToken(r.accessToken);
    setIsAdmin(r.isAdmin);
    setHas2fa(r.twoFactor);
    localStorage.setItem('user-id', userIdOf(r.accessToken));
  }

  useEffect(() => {
    // Drop #reset=... / #verify=... right away so the token doesn't stay in the address bar or history
    if (resetToken || verifyToken || membership)
      window.history.replaceState(null, '', window.location.pathname);
    if (verifyToken)
      verifyEmail(verifyToken)
        .then(() => setNotice('Email confirmed. Log in to continue.'))
        .catch((err) => setNotice(err.message));
    refresh()
      .then(signedInWithCookie)
      .catch((err) => {
        // No status = no signal, so the cookie may still be good
        if (!err.status && localStorage.getItem('user-id')) setOffline(true);
        // No cookie, or it expired: show the login form
        else if (err.status === 401) localStorage.removeItem('user-id');
      })
      .finally(() => setChecking(false));
    // When the 1-hour token runs out mid-session, try the cookie before signing out
    setOnSessionExpired(() =>
      // shortcut: the request that hit the 401 is not retried; the member just repeats it
      refresh()
        .then((r) => setToken(r.accessToken))
        .catch(() => {
          // logOut only calls setters, so this first render's copy is safe to keep
          logOut();
          setNotice('Your session expired. Log in again.');
        }),
    );
  }, [resetToken, verifyToken, membership]);
  // Right after paying, the webhook may still be on its way, so ask again every 2 s for up to 10 s
  useEffect(() => {
    if (!token) return;
    let tries = membership === 'done' ? 5 : 1;
    let timer;
    const check = () => {
      clearTimeout(timer);
      getProfile(token)
        .then((p) => {
          setProfile(p);
          tries -= 1;
          if (!p.plus && tries > 0) timer = setTimeout(check, 2000);
        })
        .catch(() => {});
    };
    check();
    // The home-screen app opens Stripe in a separate browser view, so check again when it's back on screen
    const onShow = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onShow);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [token, membership]);

  // Offline mode: sign in properly as soon as there's signal again
  useEffect(() => {
    if (!offline) return;
    const retry = () =>
      refresh()
        .then((r) => {
          signedInWithCookie(r);
          // Mid-workout, stay on the workout screen; Finish then goes to the dashboard
          if (offlineDone) setOffline(false);
        })
        .catch(() => {});
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [offline, offlineDone]);

  // The phone's back gesture goes to the previous page instead of closing the app
  useEffect(() => {
    const onBack = (e) => {
      setPage(e.state?.page ?? 'home');
      setVisit((v) => v + 1);
    };
    window.addEventListener('popstate', onBack);
    return () => window.removeEventListener('popstate', onBack);
  }, []);

  function go(next) {
    window.history.pushState({ page: next }, '');
    setPage(next);
    setVisit((v) => v + 1);
  }

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
    localStorage.removeItem('user-id');
    setToken(null);
    setProfile(null);
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

  if (offline) {
    return (
      <div className="admin-page">
        {offlineDone ? (
          <main className="admin-content">
            <p className="hint" role="status">
              No signal. Your workout is saved on this phone and will upload when you&apos;re back
              online.
            </p>
          </main>
        ) : (
          <WorkoutScreen
            token={token}
            onDone={() => (token ? setOffline(false) : setOfflineDone(true))}
          />
        )}
      </div>
    );
  }

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
        onLoggedIn={(t, admin, usedCode, last, failed, remember) => {
          if (remember) localStorage.setItem('user-id', userIdOf(t));
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
        profile={profile}
        // Signed in, the login and reset pages show the dashboard
        page={page === 'login' || page === 'reset' ? 'home' : page}
        isAdmin={isAdmin}
        showCalories={showCalories}
        showWorkout={showWorkout}
        onNavigate={go}
      />
      {page === 'admin' ? (
        <AdminScreen token={token} lastLogin={lastLogin} failedSince={failedSince} />
      ) : page === 'account' ? (
        <AccountScreen
          token={token}
          isAdmin={isAdmin}
          has2fa={has2fa}
          onTokenChanged={setToken}
          onManageUsers={() => go('admin')}
          onViewProgress={() => go('progress')}
          showCalories={showCalories}
          showWorkout={showWorkout}
          plus={plus}
          profile={profile}
          onProfileChanged={setProfile}
          onShowCaloriesChanged={(on) => {
            setShowCalories(on);
            localStorage.setItem('show-calories', on ? '1' : '0');
          }}
          onShowWorkoutChanged={(on) => {
            setShowWorkout(on);
            localStorage.setItem('show-workout', on ? '1' : '0');
          }}
          onLogOut={handleLogOut}
          onSignedOut={(doneNotice = '') => {
            logOut();
            setNotice(doneNotice);
          }}
        />
      ) : page === 'progress' ? (
        <main className="admin-content">
          <button className="outline-btn back-btn" type="button" onClick={() => go('account')}>
            <span aria-hidden="true">‹</span> Account
          </button>
          <div className="page-head">
            <h1 className="page-title">Progress</h1>
          </div>
          <MuscleMap token={token} plus={plus} />
        </main>
      ) : page === 'calories' && showCalories ? (
        <CaloriesScreen token={token} plus={plus} />
      ) : page === 'workout' && showWorkout ? (
        <WorkoutScreen token={token} onDone={() => go('home')} />
      ) : (
        <HomeScreen
          key={visit}
          token={token}
          showCalories={showCalories}
          showWorkout={showWorkout}
          onOpenCalories={() => go('calories')}
          plus={plus}
        />
      )}
    </div>
  );
}
