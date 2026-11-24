import { displayName, initials } from './names';
import { useWaiting } from './outbox';

// The bar across the top of every signed-in screen. Until the profile loads, or if it fails,
// the account button just says Account
export default function NavBar({ token, profile, page, isAdmin, showCalories, onNavigate }) {
  const waiting = useWaiting(token);

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
                {profile.avatar ? (
                  <img src={`data:image/jpeg;base64,${profile.avatar}`} alt="" />
                ) : (
                  initials(profile)
                )}
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
