import { useEffect, useRef, useState } from 'react';
import { addFood, getRecentFood } from './api';
import ErrorMsg from './ErrorMsg';
import useSubmit from './useSubmit';

// Adds one food to a meal: type it in, or tap one logged before
export default function FoodSheet({ token, date, meal, onAdded, onClose }) {
  const ref = useRef(null);
  const [name, setName] = useState('');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [recent, setRecent] = useState([]);
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

  const digits = (set) => (e) => /^\d*$/.test(e.target.value) && set(e.target.value);
  const macros = [
    ['food-protein', 'Protein (g)', protein, setProtein],
    ['food-carbs', 'Carbs (g)', carbs, setCarbs],
    ['food-fat', 'Fat (g)', fat, setFat],
  ];

  return (
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
        <ErrorMsg>{message}</ErrorMsg>
        <div className="sheet-actions">
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
  );
}
