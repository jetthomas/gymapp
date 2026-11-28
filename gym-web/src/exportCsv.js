import { MEALS } from './meals.js';
import { typeName } from './setTypes.js';
import { dayKey } from './week.js';

const mealName = Object.fromEntries(MEALS);

// One cell, quoted when it holds a comma, quote or line break. Text starting with = + - @ gets a
// leading ' so a spreadsheet shows it rather than running it as a formula: exercise names are typed by admins
function cell(value) {
  if (value == null) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

// GET /me/export's { workouts, food, bodyWeights } as one CSV for Excel or Numbers, in three
// sections: a title row, that section's headings, then a row per set, food or weigh-in, oldest
// first (the API sends them in date order). A blank row between sections
export default function toCsv({ workouts, food, bodyWeights }) {
  const sections = [
    [
      'Workouts',
      ['Date', 'Workout', 'Exercise', 'Set', 'Set type', 'Side', 'Weight (kg)', 'Reps', 'RIR'],
      workouts.flatMap((w) =>
        w.exercises.flatMap((e) =>
          e.sets.map((s, i) => [
            dayKey(new Date(w.date)),
            w.name,
            e.name,
            i + 1,
            // Blank for a normal working set, so a spreadsheet can filter warm-ups out
            s.type && typeName(s.type),
            s.side,
            s.weightKg,
            s.reps,
            s.rir,
          ]),
        ),
      ),
    ],
    [
      'Calories',
      ['Date', 'Meal', 'Food', 'kcal', 'Protein (g)', 'Carbs (g)', 'Fat (g)'],
      food.map((f) => [
        f.date,
        mealName[f.meal] ?? f.meal,
        f.name,
        f.kcal,
        f.proteinG,
        f.carbsG,
        f.fatG,
      ]),
    ],
    ['Body weight', ['Date', 'Weight (kg)'], bodyWeights.map((b) => [b.date, b.kg])],
  ];
  return sections
    .map(([title, headings, rows]) =>
      [[title], headings, ...rows].map((r) => r.map(cell).join(',')).join('\r\n'),
    )
    .join('\r\n\r\n');
}
