import { useEffect, useState } from 'react';
import { getFood, addFood, lookupBarcode } from './api';
import BarcodeScanner from './BarcodeScanner';

// 'en-CA' formats as YYYY-MM-DD in the user's own time zone
const today = () => new Date().toLocaleDateString('en-CA');
const digits = (v, max) => v.replace(/\D/g, '').slice(0, max);

const MACROS = [
  { key: 'protein', field: 'proteinG', label: 'Protein', kcalPerGram: 4 },
  { key: 'carbs', field: 'carbsG', label: 'Carbs', kcalPerGram: 4 },
  { key: 'fat', field: 'fatG', label: 'Fat', kcalPerGram: 9 },
];

export default function CalorieCounter({ token, onDraftChange }) {
  const [entries, setEntries] = useState(null); // null = still loading
  const [name, setName] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [looking, setLooking] = useState(false);
  const [product, setProduct] = useState(null); // per-100 g numbers from a scan
  const [amount, setAmount] = useState('');

  useEffect(() => {
    getFood(token, today())
      .then(setEntries)
      .catch((err) => setError(err.message));
  }, [token]);

  // Tells MemberScreen what would be lost on a switch
  useEffect(() => {
    onDraftChange(name.trim() || ([calories, protein, carbs, fat].some(Boolean) ? 'this food' : ''));
  }, [name, calories, protein, carbs, fat, onDraftChange]);

  // Scales a scanned product's per-100 g numbers to the amount eaten
  function applyAmount(p, grams) {
    const scale = Number(grams) / 100;
    const round = (per100) => String(Math.round(per100 * scale));
    setAmount(grams);
    setCalories(round(p.kcal));
    setProtein(round(p.proteinG));
    setCarbs(round(p.carbsG));
    setFat(round(p.fatG));
  }

  async function handleScan(barcode) {
    setScanning(false);
    setError('');
    setLooking(true);
    try {
      const p = await lookupBarcode(token, barcode);
      setProduct(p);
      setName((p.brand ? `${p.name} (${p.brand})` : p.name).slice(0, 200));
      applyAmount(p, '100');
    } catch (err) {
      setError(err.message); // e.g. "That barcode isn't in Open Food Facts yet."
    } finally {
      setLooking(false);
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const saved = await addFood(token, {
        name: name.trim(),
        calories: Number(calories),
        proteinG: Number(protein), // blank becomes 0
        carbsG: Number(carbs),
        fatG: Number(fat),
        date: today(),
      });
      setEntries((list) => [...(list ?? []), saved]);
      [setName, setCalories, setProtein, setCarbs, setFat, setAmount].forEach((clear) => clear(''));
      setProduct(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const list = entries ?? [];
  const total = list.reduce((sum, e) => sum + e.calories, 0);
  const grams = Object.fromEntries(MACROS.map((m) => [m.key, list.reduce((sum, e) => sum + e[m.field], 0)]));
  const macroKcal = MACROS.reduce((sum, m) => sum + grams[m.key] * m.kcalPerGram, 0);
  const share = (m) => (macroKcal ? Math.round((grams[m.key] * m.kcalPerGram * 100) / macroKcal) : 0);
  const valid = name.trim() !== '' && Number(calories) >= 1 && Number(calories) <= 10000;

  const numberFields = [
    ['food-cal', 'Calories (kcal)', calories, setCalories, '350', 5],
    ['food-protein', 'Protein (g)', protein, setProtein, '30', 4],
    ['food-carbs', 'Carbs (g)', carbs, setCarbs, '40', 4],
    ['food-fat', 'Fat (g)', fat, setFat, '12', 4],
  ];

  return (
    <>
      <h1 className="admin-title">Calories</h1>
      <p className="admin-subtitle">
        {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
      </p>

      <div className="member-grid">
        <div className="member-stack">
          <section className="card" aria-labelledby="total-title">
            <h2 id="total-title" className="total-label">Total today</h2>
            <p className="total">
              <strong>{total.toLocaleString()}</strong> <span>kcal</span>
            </p>
            <div
              className="macro-bar"
              role="img"
              aria-label={`Macro split: ${MACROS.map((m) => `${m.label} ${share(m)}%`).join(', ')}`}
            >
              {macroKcal > 0 &&
                MACROS.map((m) => (
                  <span key={m.key} style={{ flexGrow: grams[m.key] * m.kcalPerGram, background: `var(--${m.key})` }} />
                ))}
            </div>
            <ul className="macro-legend">
              {MACROS.map((m) => (
                <li key={m.key}>
                  <span>
                    <span className="macro-dot" style={{ background: `var(--${m.key})` }} />
                    {m.label}
                  </span>
                  <strong>{grams[m.key]} g</strong>
                  <span>{share(m)}% of kcal</span>
                </li>
              ))}
            </ul>
          </section>

          <form className="card" onSubmit={handleAdd} aria-labelledby="add-title">
            <div className="card-head">
              <h2 id="add-title">Add food</h2>
              <button type="button" className="pill-btn" onClick={() => setScanning(true)} disabled={looking}>
                {looking ? 'Looking up…' : 'Scan barcode'}
              </button>
            </div>
            <div className="field">
              <label htmlFor="food-name">Food</label>
              <input id="food-name" placeholder="Chicken wrap" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoComplete="off" required />
            </div>
            {product && (
              <>
                <p className="product-note">
                  Per 100 g: {Math.round(product.kcal)} kcal, from{' '}
                  <a href={`https://world.openfoodfacts.org/product/${product.barcode}`} target="_blank" rel="noreferrer">
                    Open Food Facts
                  </a>
                </p>
                <div className="field">
                  <label htmlFor="food-amount">Amount (g)</label>
                  <input id="food-amount" inputMode="numeric" value={amount} onChange={(e) => applyAmount(product, digits(e.target.value, 4))} autoComplete="off" />
                </div>
              </>
            )}
            <div className="macro-fields">
              {numberFields.map(([id, label, value, set, hint, max]) => (
                <div className="field" key={id}>
                  <label htmlFor={id}>{label}</label>
                  <input id={id} inputMode="numeric" placeholder={hint} value={value} onChange={(e) => set(digits(e.target.value, max))} autoComplete="off" required={id === 'food-cal'} />
                </div>
              ))}
            </div>
            {error && <p className="msg error" role="alert">{error}</p>}
            <button className="login-btn" type="submit" disabled={saving || !valid}>
              {saving ? 'Adding…' : 'Add food'}
            </button>
          </form>
        </div>

        <section className="card" aria-labelledby="eaten-title">
          <h2 id="eaten-title">Eaten today</h2>
          {entries === null && !error && <p className="admin-subtitle">Loading…</p>}
          {entries?.length === 0 && (
            <p className="admin-subtitle">Nothing logged yet. Add what you eat and your totals update as you go.</p>
          )}
          {list.length > 0 && (
            <ul className="entry-list">
              {list.map((e) => (
                <li key={e.id}>
                  <div>
                    <div>{e.name}</div>
                    <div className="entry-sub">
                      P {e.proteinG} g · C {e.carbsG} g · F {e.fatG} g
                    </div>
                  </div>
                  <span className="entry-meta">{e.calories.toLocaleString()} kcal</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {scanning && <BarcodeScanner onResult={handleScan} onClose={() => setScanning(false)} />}
    </>
  );
}
