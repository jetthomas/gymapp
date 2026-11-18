import { useWaiting } from './outbox';

// The bar across the top of every signed-in screen
export default function NavBar({ token, page, isAdmin, onNavigate }) {
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
      <span className="nav-brand">GYM APP</span>
      <nav className="nav-links">
        {link('home', 'Dashboard')}
        {isAdmin && link('admin', 'Admin')}
      </nav>
      {waiting > 0 && (
        <span className="badge muted nav-waiting" role="status">
          {waiting} waiting to upload
        </span>
      )}
      {link(
        'account',
        <>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <span className="visually-hidden">Account</span>
        </>,
        'nav-btn nav-account',
      )}
    </header>
  );
}
