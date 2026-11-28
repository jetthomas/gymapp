import { useState } from 'react';
import { decimal } from './numberInput';
import plates, { LB_PLATES, PLATES } from './plates';
import useModal, { closeOnBackdrop } from './useModal';

// The plates and bars in each unit, and where this device remembers the biggest plate to load
const KIT = {
  kg: { plates: PLATES, bars: [20, 15], key: 'top-plate' },
  lb: { plates: LB_PLATES, bars: [45, 35], key: 'top-plate-lb' },
};

// Shows which plates go on each side of the bar for a weight, in the workout's unit
export default function PlateSheet({ weight, unit, onClose }) {
  const kit = KIT[unit];
  const ref = useModal();
  const [target, setTarget] = useState(weight);
  const [bar, setBar] = useState(kit.bars[0]);
  // The biggest plate to load, remembered on this device; smaller plates fill the gap
  const [top, setTop] = useState(() => Number(localStorage.getItem(kit.key)) || kit.plates[0]);
  const { side, total } = plates(
    Number(target) || 0,
    bar,
    kit.plates.filter((p) => p <= top),
  );

  function pick(p) {
    setTop(p);
    localStorage.setItem(kit.key, p);
  }

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="plates-title"
      // Tapping outside closes it
      closedby="any"
      onCancel={onClose}
      onClick={closeOnBackdrop(onClose)}
    >
      <h2 id="plates-title">Plates</h2>
      <div className="plate-inputs">
        <div className="field">
          <label htmlFor="plate-target">Weight ({unit})</label>
          <input
            id="plate-target"
            inputMode="decimal"
            value={target}
            onChange={decimal(setTarget)}
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
            {kit.bars.map((b) => (
              <option key={b} value={b}>
                {b} {unit}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="plate-have">
        <span id="plate-have">Biggest plate</span>
        <div className="chips" role="group" aria-labelledby="plate-have">
          {kit.plates.map((p) => (
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
          <span key={i} style={{ '--size': p / kit.plates[0] }}>
            {p}
          </span>
        ))}
      </div>
      <p role="status">
        {side.length ? `Each side: ${side.join(', ')}` : 'Just the bar.'}
        {total !== Number(target) && ` That makes ${total} ${unit}, the closest these plates get.`}
      </p>
      <div className="sheet-actions">
        <button className="pill-btn filled" type="button" onClick={onClose}>
          Done
        </button>
      </div>
    </dialog>
  );
}
