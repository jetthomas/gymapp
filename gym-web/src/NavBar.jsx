// The bar across the top of every signed-in screen
export default function NavBar({ page, isAdmin, onNavigate }) {
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
      {link('account', 'Account', 'nav-btn nav-account')}
    </header>
  );
}
