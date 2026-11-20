import { useEffect, useRef, useState } from 'react';
import plates, { PLATES } from './plates';

// Shows which plates go on each side of the bar for a weight
export default function PlateSheet({ weightKg, onClose }) {
  const ref = useRef(null);
  const [target, setTarget] = useState(weightKg);
  const [bar, setBar] = useState(20);
  // The biggest plate to load, remembered on this device; smaller plates fill the gap
  const [top, setTop] = useState(() => Number(localStorage.getItem('top-plate')) || PLATES[0]);
  const { side, total } = plates(
    Number(target) || 0,
    bar,
    PLATES.filter((p) => p <= top),
  );

  function pick(p) {
    setTop(p);
    localStorage.setItem('top-plate', p);
  }

  // StrictMode runs effects twice in development, so don't reopen an open dialog
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog.open) {
      dialog.showModal();
      return () => dialog.close();
    }
  }, []);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="plates-title"
      // Tapping outside closes it; closedby does that natively, the onClick is for Safari, which lacks it
      closedby="any"
      onCancel={onClose}
      onClick={(e) => {
        if ('closedBy' in HTMLDialogElement.prototype || e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
          onClose();
      }}
    >
      <h2 id="plates-title">Plates</h2>
      <div className="plate-inputs">
        <div className="field">
          <label htmlFor="plate-target">Weight (kg)</label>
          <input
            id="plate-target"
            inputMode="decimal"
            value={target}
            onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setTarget(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="plate-bar">Bar</label>
          <select
            id="plate-bar"
            className="role-select"
            value={bar}
            onChange={(e) => setBar(Number(e.target.value))}
          >
            <option value={20}>20 kg</option>
            <option value={15}>15 kg</option>
          </select>
        </div>
      </div>
      <div className="plate-have">
        <span id="plate-have">Biggest plate</span>
        <div className="chips" role="group" aria-labelledby="plate-have">
          {PLATES.map((p) => (
            <button
              key={p}
              className="chip"
              type="button"
              aria-pressed={p === top}
              onClick={() => pick(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      {/* The picture repeats the sentence under it, so it is hidden from screen readers */}
      <div className="plates" aria-hidden="true">
        {side.map((p, i) => (
          <span key={i} style={{ '--size': p / 25 }}>
            {p}
          </span>
        ))}
      </div>
      <p role="status">
        {side.length ? `Each side: ${side.join(', ')}` : 'Just the bar.'}
        {total !== Number(target) && ` That makes ${total} kg, the closest these plates get.`}
      </p>
      <div className="sheet-actions">
        <button className="pill-btn filled" type="button" onClick={onClose}>
          Done
        </button>
      </div>
    </dialog>
  );
}
