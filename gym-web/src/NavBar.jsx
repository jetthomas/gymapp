import { useEffect, useState } from 'react';
import { getProfile } from './api';
import { displayName, initials } from './names';
import { useWaiting } from './outbox';

// The bar across the top of every signed-in screen
export default function NavBar({ token, page, isAdmin, showCalories, onNavigate }) {
  const waiting = useWaiting(token);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    // Until this loads, or if it fails, the button just says Account
    getProfile(token)
      .then(setProfile)
      .catch(() => {});
  }, [token]);

  function link(to, label, className = 'nav-btn') {
    return (
      <button
        className={className}
        type="button"
        aria-current={page === to ? 'page' : undefined}
        onClick={() => onNavigate(to)}
      >
        {label}
      </button>
    );
  }

  return (
    <header className="nav">
      <nav className="nav-links">
        {link('home', 'Dashboard')}
        {showCalories && link('calories', 'Calories')}
        {isAdmin && link('admin', 'Admin')}
      </nav>
      <span className="nav-brand">GYM APP</span>
      <div className="nav-right">
        {waiting > 0 && (
          <span className="badge muted nav-waiting" role="status">
            {waiting} waiting to upload
          </span>
        )}
        {link(
          'account',
          profile ? (
            <>
              <span className="visually-hidden">Account: </span>
              <span className="nav-name">{profile.firstName || displayName(profile)}</span>
              <span className="avatar" aria-hidden="true">
                {initials(profile)}
              </span>
            </>
          ) : (
            'Account'
          ),
          'nav-btn nav-account',
        )}
      </div>
    </header>
  );
}
