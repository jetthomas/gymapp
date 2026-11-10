import { useRef, useState } from 'react';
import CalorieCounter from './CalorieCounter';
import WorkoutTracker from './WorkoutTracker';
import './index.css';

const SECTIONS = { calories: 'Calories', workouts: 'Workouts' };

export default function MemberScreen({ token, onAccount }) {
  const [section, setSection] = useState('calories');
  // Unsaved text in the open form, e.g. "Chicken wrap"; '' when the form is empty
  const [draft, setDraft] = useState('');
  const [leavingTo, setLeavingTo] = useState(null); // 'calories' | 'workouts' | 'account'
  const dialogRef = useRef(null);
  const keepRef = useRef(null);

  function go(to) {
    setDraft('');
    if (to === 'account') onAccount();
    else setSection(to);
  }

  function requestGo(to) {
    if (to === section) return;
    if (!draft) return go(to);
    setLeavingTo(to);
    dialogRef.current.showModal();
    keepRef.current.focus(); // the safe choice gets focus, so Enter keeps the entry
  }

  function discard() {
    dialogRef.current.close();
    go(leavingTo);
  }

  const destination = leavingTo === 'account' ? 'Opening your account' : `Switching to ${SECTIONS[leavingTo]}`;

  return (
    <div className="admin-page">
      <header className="admin-toolbar">
        <span aria-hidden="true" />
        <nav className="segmented" aria-label="Sections">
          {Object.entries(SECTIONS).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-current={section === key ? 'page' : undefined}
              onClick={() => requestGo(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <button className="toolbar-btn end" type="button" aria-label="Account" onClick={() => requestGo('account')}>
          <svg width="24" height="24" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
            <circle cx="14" cy="14" r="12" />
            <circle cx="14" cy="11.5" r="4" />
            <path d="M6.5 22.5c1.8-3 4.4-4.5 7.5-4.5s5.7 1.5 7.5 4.5" />
          </svg>
          <span className="label">Account</span>
        </button>
      </header>

      <main className="admin-content member-content">
        {section === 'calories' ? (
          <CalorieCounter token={token} onDraftChange={setDraft} />
        ) : (
          <WorkoutTracker token={token} onDraftChange={setDraft} />
        )}
      </main>

      <dialog ref={dialogRef} className="confirm-dialog" aria-labelledby="discard-title">
        <h2 id="discard-title">Discard this entry?</h2>
        <p>
          You haven't added “{draft}” yet. {destination} will clear it.
        </p>
        <div className="dialog-actions">
          <button type="button" className="pill-btn danger" onClick={discard}>
            Discard and switch
          </button>
          <button type="button" className="pill-btn filled" ref={keepRef} onClick={() => dialogRef.current.close()}>
            Keep editing
          </button>
        </div>
      </dialog>
    </div>
  );
}
