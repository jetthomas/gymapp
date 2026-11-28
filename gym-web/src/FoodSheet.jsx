import { useEffect, useRef, useState } from 'react';
import {
  addFood,
  addFoods,
  deleteSavedMeal,
  getRecentFood,
  getSavedMeals,
  lookupBarcode,
  saveMeal,
  updateFood,
} from './api';
import BarcodeScanner from './BarcodeScanner';
import ErrorMsg from './ErrorMsg';
import { total } from './meals';
import UpgradeDialog from './UpgradeDialog';
import useModal from './useModal';
import useSubmit from './useSubmit';

// Adds one food to a meal (type it in, or tap a saved one or one logged before), or edits `food`,
// one already logged
export default function FoodSheet({ token, plus, date, meal, onAdded, onClose, food }) {
  const ref = useModal();
  const [recent, setRecent] = useState([]);
  const [saved, setSaved] = useState([]); // My foods: saved meals, and single foods kept with the tick box
  const [keep, setKeep] = useState(false); // "Save to My foods"
  const kept = useRef(false); // already saved, so a retry after the add failed doesn't save it twice
  const [scanning, setScanning] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const { loading, message, run } = useSubmit();
  const [name, setName] = useState(food?.name ?? '');
  const [kcal, setKcal] = useState(food ? String(food.kcal) : '');
  const [protein, setProtein] = useState(food ? String(Math.round(food.proteinG)) : '');
  const [carbs, setCarbs] = useState(food ? String(Math.round(food.carbsG)) : '');
  const [fat, setFat] = useState(food ? String(Math.round(food.fatG)) : '');
  const [kcalTyped, setKcalTyped] = useState(Boolean(food));

  const setMacro = (set, field) =>
    digits((value) => {
      set(value);
      if (kcalTyped) return;
      const g = { protein, carbs, fat, [field]: value };
      const total = 4 * Number(g.protein) + 4 * Number(g.carbs) + 9 * Number(g.fat);
      setKcal(total ? String(total) : '');
    });
  useEffect(() => {
    // The list is a shortcut; the form works without it
    getRecentFood(token)
      .then(setRecent)
      .catch(() => {});
    getSavedMeals(token)
      .then(setSaved)
      .catch(() => {});
  }, [token]);

  function add(f, keepIt = false) {
    run(async () => {
      if (keepIt && !kept.current) {
        await saveMeal(token, { name: f.name, foods: [f] });
        kept.current = true;
      }
      if (food) await updateFood(token, food.id, { date, meal, ...f });
      else await addFood(token, { date, meal, ...f });
      onAdded();
    });
  }

  function handleSubmit(event) {
    event.preventDefault();
    add(
      {
        name,
        kcal: Number(kcal),
        proteinG: Number(protein),
        carbsG: Number(carbs),
        fatG: Number(fat),
      },
      keep,
    );
  }

  // Every food in a saved meal, into this meal in one go
  function addSaved(m) {
    run(async () => {
      await addFoods(token, { date, meal, foods: m.foods });
      onAdded();
    });
  }

  function removeSaved(id) {
    run(async () => {
      await deleteSavedMeal(token, id);
      setSaved((list) => list.filter((m) => m.id !== id));
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
    ['food-protein', 'Protein (g)', protein, setProtein, 'protein'],
    ['food-carbs', 'Carbs (g)', carbs, setCarbs, 'carbs'],
    ['food-fat', 'Fat (g)', fat, setFat, 'fat'],
  ];

  return (
    <>
      <dialog ref={ref} className="sheet picker" aria-labelledby="food-title" onCancel={onClose}>
        <form onSubmit={handleSubmit}>
          <h2 id="food-title">{food ? 'Edit food' : 'Add food'}</h2>
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
              onChange={digits((v) => {
                setKcal(v);
                setKcalTyped(v !== '');
              })}
            />
          </div>
          <div className="field-pair">
            {macros.map(([id, label, value, set, field]) => (
              <div className="field" key={id}>
                <label htmlFor={id}>{label}</label>
                <input id={id} inputMode="numeric" value={value} onChange={setMacro(set, field)} />
              </div>
            ))}
          </div>
          {!food && (
            <label className="check">
              <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
              Save to My foods
            </label>
          )}
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
                  Subscribe to BarMetric Plus to scan barcodes
                </span>
              </button>
            )}
            <button className="pill-btn" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="pill-btn filled" type="submit" disabled={loading}>
              {loading ? 'Saving…' : food ? 'Save' : 'Add'}
            </button>
          </div>
        </form>
        {/* Not while editing: Add would log new foods instead of changing the one being edited */}
        {!food && saved.length > 0 && (
          <>
            <h3 className="group-title">My foods</h3>
            <div className="group">
              {saved.map((m) => (
                <div className="row static" key={m.id}>
                  <span className="row-text">
                    {m.name}
                    <span className="row-sub">
                      {total(m.foods, 'kcal')} kcal
                      {m.foods.length > 1 && ` · ${m.foods.length} foods`}
                    </span>
                  </span>
                  <button
                    className="ghost-btn"
                    type="button"
                    aria-label={`Add ${m.name}`}
                    disabled={loading}
                    onClick={() => addSaved(m)}
                  >
                    Add
                  </button>
                  <button
                    className="ghost-btn danger"
                    type="button"
                    aria-label={`Remove ${m.name} from My foods`}
                    disabled={loading}
                    onClick={() => removeSaved(m.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        {/* Not while editing: one tap would turn the food being edited into this one */}
        {!food && recent.length > 0 && (
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
