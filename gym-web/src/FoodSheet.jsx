import { useEffect, useRef, useState } from 'react';
import { addFood, getRecentFood, lookupBarcode } from './api';
import BarcodeScanner from './BarcodeScanner';
import ErrorMsg from './ErrorMsg';
import UpgradeDialog from './UpgradeDialog';
import useSubmit from './useSubmit';

// Adds one food to a meal: type it in, or tap one logged before
export default function FoodSheet({ token, plus, date, meal, onAdded, onClose }) {
  const ref = useRef(null);
  const [name, setName] = useState('');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [recent, setRecent] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const { loading, message, run } = useSubmit();

  // StrictMode runs effects twice in development, so don't reopen an open dialog
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog.open) {
      dialog.showModal();
      return () => dialog.close();
    }
  }, []);

  useEffect(() => {
    // The list is a shortcut; the form works without it
    getRecentFood(token)
      .then(setRecent)
      .catch(() => {});
  }, [token]);

  function add(food) {
    run(async () => {
      await addFood(token, { date, meal, ...food });
      onAdded();
    });
  }

  function handleSubmit(event) {
    event.preventDefault();
    add({
      name,
      kcal: Number(kcal),
      proteinG: Number(protein),
      carbsG: Number(carbs),
      fatG: Number(fat),
    });
  }

  // Fills the form from a scanned packet; the member checks it (it's per 100 g) and taps Add
  function scanned(code) {
    setScanning(false);
    run(async () => {
      const food = await lookupBarcode(token, code);
      setName(food.name);
      setKcal(String(food.kcal));
      // The inputs take whole grams
      setProtein(String(Math.round(food.proteinG)));
      setCarbs(String(Math.round(food.carbsG)));
      setFat(String(Math.round(food.fatG)));
    });
  }

  const digits = (set) => (e) => /^\d*$/.test(e.target.value) && set(e.target.value);
  const macros = [
    ['food-protein', 'Protein (g)', protein, setProtein],
    ['food-carbs', 'Carbs (g)', carbs, setCarbs],
    ['food-fat', 'Fat (g)', fat, setFat],
  ];

  return (
    <>
      <dialog ref={ref} className="sheet picker" aria-labelledby="food-title" onCancel={onClose}>
        <form onSubmit={handleSubmit}>
          <h2 id="food-title">Add food</h2>
          <div className="field">
            <label htmlFor="food-name">Food</label>
            <input
              id="food-name"
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="food-kcal">Calories</label>
            <input
              id="food-kcal"
              required
              inputMode="numeric"
              value={kcal}
              onChange={digits(setKcal)}
            />
          </div>
          <div className="field-pair">
            {macros.map(([id, label, value, set]) => (
              <div className="field" key={id}>
                <label htmlFor={id}>{label}</label>
                <input id={id} inputMode="numeric" value={value} onChange={digits(set)} />
              </div>
            ))}
          </div>
          {scanning && <BarcodeScanner onCode={scanned} />}
          <ErrorMsg>{message}</ErrorMsg>
          <div className="sheet-actions">
            {plus ? (
              <button
                className="pill-btn scan-btn"
                type="button"
                aria-expanded={scanning}
                onClick={() => setScanning(!scanning)}
              >
                {scanning ? 'Stop scanning' : 'Scan barcode'}
              </button>
            ) : (
              <button
                className="pill-btn scan-btn locked"
                type="button"
                aria-describedby="scan-tip"
                onClick={() => setUpgrading(true)}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor" />
                  <path
                    d="M8 11V7a4 4 0 0 1 8 0v4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                </svg>
                Scan barcode
                <span id="scan-tip" className="tip" role="tooltip">
                  Subscribe to Gym App Plus to scan barcodes
                </span>
              </button>
            )}
            <button className="pill-btn" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="pill-btn filled" type="submit" disabled={loading}>
              {loading ? 'Adding…' : 'Add'}
            </button>
          </div>
        </form>
        {recent.length > 0 && (
          <>
            <h3 className="group-title">Recent</h3>
            <div className="group">
              {recent.map((f) => (
                <button
                  className="row"
                  type="button"
                  key={`${f.name}${f.kcal}${f.proteinG}${f.carbsG}${f.fatG}`}
                  disabled={loading}
                  onClick={() => add(f)}
                >
                  <span className="row-text">
                    {f.name}
                    <span className="row-sub">{f.kcal} kcal</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </dialog>
      {/* Beside the sheet, not inside it, so closing the pop-up with Esc doesn't close the sheet too */}
      {upgrading && <UpgradeDialog token={token} onClose={() => setUpgrading(false)} />}
    </>
  );
}
