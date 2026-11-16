// The member's home screen; a placeholder until the dashboard is built
export default function HomeScreen({ onAccount }) {
  return (
    <div className="admin-page">
      <header className="admin-toolbar">
        <span />
        <h1 className="toolbar-title">Gym App</h1>
        <button className="toolbar-btn end" type="button" onClick={onAccount} aria-label="Account">
          {/* currentColor, so the icon takes the toolbar's accent colour in light and dark mode */}
          <svg
            width="24"
            height="24"
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
        </button>
      </header>

      <main className="admin-content">
        <p className="msg">Your dashboard is coming soon.</p>
      </main>
    </div>
  );
}
