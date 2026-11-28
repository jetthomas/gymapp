import { MUSCLES } from './muscles';

// The search box and muscle filter over the exercise library, for the workout's picker and the
// admin screen. Two elements, so each screen lays them out in its own row
export function ExerciseSearch({ q, muscle, onSearch, onMuscle }) {
  return (
    <>
      <input
        className="admin-search"
        type="search"
        enterKeyHint="search"
        autoCorrect="off"
        placeholder="Search exercises"
        aria-label="Search exercises"
        value={q}
        onChange={(e) => onSearch(e.target.value)}
      />
      <select
        className="role-select status-filter"
        aria-label="Muscle"
        value={muscle}
        onChange={(e) => onMuscle(e.target.value)}
      >
        <option value="">All muscles</option>
        {MUSCLES.map((m) => (
          <option key={m}>{m}</option>
        ))}
      </select>
    </>
  );
}

// The library's exercises whose name holds `q` and that work `muscle`, one button each.
// Searched here, not on the server, so typing makes no requests and works with no signal.
// Only the first `shown` are drawn, so a long list stays quick
export function ExerciseRows({ library, q, muscle, shown, onPick }) {
  const words = q.trim().toLowerCase();
  const matches = library.filter(
    (e) =>
      e.name.toLowerCase().includes(words) &&
      (!muscle || [...e.primaryMuscles, ...e.secondaryMuscles].includes(muscle)),
  );
  if (matches.length === 0) return <p className="msg">No matches</p>;
  return (
    <>
      <div className="group exercise-list">
        {matches.slice(0, shown).map((e) => (
          <button className="row" type="button" key={e.id} onClick={() => onPick(e)}>
            <span className="row-text">
              {e.name}
              <span className="row-sub">
                {[e.primaryMuscles.join(', '), e.equipment].filter(Boolean).join(' · ')}
              </span>
            </span>
          </button>
        ))}
      </div>
      {matches.length > shown && (
        <p className="hint">
          Showing {shown} of {matches.length}. Search or pick a muscle to narrow it down.
        </p>
      )}
    </>
  );
}
