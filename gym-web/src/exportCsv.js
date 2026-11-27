import { MEALS } from './meals.js';
import { dayKey } from './week.js';

const COLUMNS = [
  'Type',
  'Date',
  'Workout',
  'Exercise',
  'Set',
  'Side',
  'Weight (kg)',
  'Reps',
  'RIR',
  'Meal',
  'Food',
  'kcal',
  'Protein (g)',
  'Carbs (g)',
  'Fat (g)',
  'Body weight (kg)',
];
const mealName = Object.fromEntries(MEALS);

// One cell, quoted when it holds a comma, quote or line break. Text starting with = + - @ gets a
// leading ' so a spreadsheet shows it rather than running it as a formula: exercise names are typed by admins
function cell(value) {
  if (value == null) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

// GET /me/export's { workouts, food, bodyWeights } as one CSV for Excel or Numbers: a row per set,
// food and weigh-in, oldest first. Type says which kind a row is, and so which columns it fills
export default function toCsv({ workouts, food, bodyWeights }) {
  const rows = [
    ...workouts.flatMap((w) =>
      w.exercises.flatMap((e) =>
        e.sets.map((s, i) => ({
          Type: 'Set',
          Date: dayKey(new Date(w.date)),
          Workout: w.name,
          Exercise: e.name,
          Set: i + 1,
          Side: s.side,
          'Weight (kg)': s.weightKg,
          Reps: s.reps,
          RIR: s.rir,
        })),
      ),
    ),
    ...food.map((f) => ({
      Type: 'Food',
      Date: f.date,
      Meal: mealName[f.meal] ?? f.meal,
      Food: f.name,
      kcal: f.kcal,
      'Protein (g)': f.proteinG,
      'Carbs (g)': f.carbsG,
      'Fat (g)': f.fatG,
    })),
    ...bodyWeights.map((b) => ({ Type: 'Weigh-in', Date: b.date, 'Body weight (kg)': b.kg })),
  ].sort((a, b) => a.Date.localeCompare(b.Date)); // stable, so a day keeps sets, food, weigh-in in that order

  return [COLUMNS, ...rows.map((row) => COLUMNS.map((c) => row[c]))]
    .map((r) => r.map(cell).join(','))
    .join('\r\n');
}
