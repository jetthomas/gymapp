import { Dumbbell, Grid, Utensils } from './icons';
import { displayName, initials } from './names';
import { useWaiting } from './outbox';
import SegmentedNav from './SegmentedNav';

// The bar across the top of every signed-in screen. Until the profile loads, or if it fails,
// the account button just says Account. On a phone the tabs move to a bar at the bottom.
// Admins reach the Admin screen from Account (Manage users), so everyone sees the same tabs
export default function NavBar({ token, profile, page, showCalories, showWorkout, onNavigate }) {
  const waiting = useWaiting(token);
  const tabs = [
    { value: 'home', label: 'Dashboard', icon: <Grid /> },
    showWorkout && { value: 'workout', label: 'Workout', icon: <Dumbbell /> },
    showCalories && { value: 'calories', label: 'Calories', icon: <Utensils /> },
  ].filter(Boolean);

  return (
    <header className="nav">
      <span className="nav-brand">
        <span className="logo-mark" aria-hidden="true">
          <Dumbbell size={20} />
        </span>
        BarMetric
      </span>
      <SegmentedNav
        className="nav-links"
        label="Main"
        items={tabs}
        value={page}
        onChange={onNavigate}
      />
      <div className="nav-right">
        {waiting > 0 && (
          <span className="badge muted nav-waiting" role="status">
            {waiting} waiting to upload
          </span>
        )}
        {/* Its own track, so it looks like the tabs */}
        <div className="account-track">
          <button
            className="nav-account"
            type="button"
            aria-current={page === 'account' ? 'page' : undefined}
            onClick={() => onNavigate('account')}
          >
            {profile ? (
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
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
