import { Link } from './icons';

// Between two exercises: links them as a superset, or unlinks them. With no onChange it only
// shows that they are one (a finished workout)
export default function SupersetLink({ on, first, second, onChange }) {
  if (!onChange) {
    return (
      <p className="superset-link on">
        <Link size={14} /> Superset
      </p>
    );
  }
  return (
    <button
      className={`superset-link${on ? ' on' : ''}`}
      type="button"
      aria-pressed={on}
      aria-label={`Superset ${first} with ${second}`}
      onClick={() => onChange(!on)}
    >
      <Link size={14} /> {on ? 'Superset' : 'Make superset'}
    </button>
  );
}
