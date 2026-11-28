// Workouts from another app's CSV export, ready for POST /workouts. Both layouts read here have one
// row per set, and the header row says which one a file is:
//  - Title Case: Date, Workout Name, Duration, Exercise Name, Set Order, Weight, Reps, ..., RPE.
//    Weights carry no unit, so the member says which. Set Order is a number, or W/D/F for a
//    warm-up, drop or failure set
//  - snake_case: title, start_time, end_time, description, exercise_title, superset_id, set_type,
//    weight_kg or weight_lbs (which one says the unit), reps, rpe
// shortcut: layouts read from published samples, not a spec; add one here when a file won't read
import { toKg } from './units.js';

// The cells of a CSV file, row by row. Quoted cells may hold the delimiter, "" and line breaks.
// The delimiter is a comma, or a semicolon when the header row has more of those (decimal-comma regions)
export function parseCsv(text) {
  const src = text.replace(/^\uFEFF/, '');
  const header = src.slice(0, src.search(/\r?\n|$/));
  const delimiter =
    (header.match(/;/g) ?? []).length > (header.match(/,/g) ?? []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) rows.push([...row, cell]);
  // Blank lines (a file ending in a line break) have no cells worth reading
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// A date and time as ms, read as the phone's own time zone: "2026-05-11 18:30", "2026-05-11T18:30:00"
// or "11 May 2026, 18:30". A time with a zone ("...Z", "+02:00") keeps it. NaN = not a date
export function parseDate(text) {
  const s = (text ?? '').trim();
  if (/(z|[+-]\d{2}:?\d{2})$/i.test(s) && /\d:\d/.test(s)) return Date.parse(s);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(m[1], m[2] - 1, m[3], m[4] ?? 12, m[5] ?? 0, m[6] ?? 0).getTime();
  m = s.match(/^(\d{1,2}) ([a-z]{3})[a-z]* (\d{4}),? (\d{1,2}):(\d{2})/i);
  const month = m ? MONTHS.indexOf(m[2].toLowerCase()) : -1;
  if (month >= 0) return new Date(m[3], month, m[1], m[4], m[5]).getTime();
  return NaN;
}

// A workout's length in seconds: "1h 5m", "45m", "01:02:00" (h:m:s) or "1:05" (h:m). null = unknown
export function parseDuration(text) {
  const s = (text ?? '').trim();
  const clock = s.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (clock) return clock[1] * 3600 + clock[2] * 60 + Number(clock[3] ?? 0);
  const parts = [...s.matchAll(/(\d+)\s*([hms])/gi)];
  if (parts.length === 0) return null;
  return parts.reduce((sum, [, n, u]) => sum + n * { h: 3600, m: 60, s: 1 }[u.toLowerCase()], 0);
}

// "82,5" (decimal comma) or "82.5" -> 82.5; '' -> NaN
const num = (s) => (s == null || s.trim() === '' ? NaN : Number(s.trim().replace(',', '.')));

// RPE 8 -> RIR 2: how hard a set felt, as reps left in the tank. Outside 1 to 10 = none
const rirOf = (rpe) => (rpe >= 1 && rpe <= 10 ? Math.round(10 - rpe) : null);

const SET_TYPES = {
  w: 'warmup',
  warmup: 'warmup',
  d: 'drop',
  dropset: 'drop',
  f: 'failure',
  failure: 'failure',
};

// Each layout: how to tell it from its header, the unit its header gives (null = ask), and how to
// read one row into a workout key, the workout, the exercise and the set
const LAYOUTS = [
  {
    fits: (has) => has('date') && has('exercise name') && has('reps'),
    unit: () => null,
    read: (get) => ({
      key: `${get('date')}|${get('workout name')}`,
      name: get('workout name'),
      start: parseDate(get('date')),
      durationSec: parseDuration(get('duration')),
      notes: get('workout notes'),
      exercise: get('exercise name'),
      superset: '',
      type: SET_TYPES[get('set order').trim().toLowerCase()] ?? null,
      weight: num(get('weight')),
      reps: num(get('reps')),
      rpe: num(get('rpe')),
    }),
  },
  {
    fits: (has) => has('start_time') && has('exercise_title') && has('reps'),
    unit: (has) => (has('weight_lbs') ? 'lb' : has('weight_kg') ? 'kg' : null),
    read: (get) => {
      const start = parseDate(get('start_time'));
      const end = parseDate(get('end_time'));
      return {
        key: `${get('start_time')}|${get('title')}`,
        name: get('title'),
        start,
        durationSec: end > start ? (end - start) / 1000 : null,
        notes: get('description'),
        exercise: get('exercise_title'),
        superset: get('superset_id').trim(),
        type: SET_TYPES[get('set_type').trim().toLowerCase()] ?? null,
        weight: num(get('weight_kg') || get('weight_lbs')),
        reps: num(get('reps')),
        rpe: num(get('rpe')),
      };
    },
  },
];

// A file's workouts, oldest first, with weights still in the file's unit:
// { workouts: [{ name, start, durationSec, notes, exercises: [{ name, superset, sets }] }],
//   unit ('kg', 'lb', or null when the file doesn't say), skipped (sets with no reps: timed or cardio) }
export function readWorkouts(text) {
  const [header = [], ...rows] = parseCsv(text);
  const columns = header.map((h) => h.trim().toLowerCase());
  const has = (name) => columns.includes(name);
  const layout = LAYOUTS.find((l) => l.fits(has));
  if (!layout) {
    throw new Error(
      "BarMetric can't read this file. It needs one row per set, with the date, exercise, weight and reps.",
    );
  }
  const byKey = new Map();
  let skipped = 0;
  for (const [i, cells] of rows.entries()) {
    const r = layout.read((name) => cells[columns.indexOf(name)] ?? '');
    // Timed holds, cardio and rest-timer rows have no reps to log
    if (!Number.isInteger(r.reps) || r.reps < 1 || r.reps > 1000 || !r.exercise.trim()) {
      skipped++;
      continue;
    }
    if (Number.isNaN(r.start)) {
      // + 2: the header is row 1, and people count from 1
      throw new Error(`BarMetric can't read the date on row ${i + 2} of this file.`);
    }
    let w = byKey.get(r.key);
    if (!w) {
      w = {
        name: r.name.trim(),
        start: r.start,
        durationSec: r.durationSec,
        notes: '',
        exercises: [],
      };
      byKey.set(r.key, w);
    }
    if (!w.notes && r.notes.trim()) w.notes = r.notes.trim();
    // A set of a different exercise (or superset) than the row before starts a new exercise
    const last = w.exercises.at(-1);
    const name = r.exercise.trim();
    const exercise =
      last?.name === name && last.superset === r.superset
        ? last
        : { name, superset: r.superset, sets: [] };
    if (exercise !== last) w.exercises.push(exercise);
    exercise.sets.push({
      // Bodyweight exercises leave the weight blank
      weight: Number.isNaN(r.weight) ? 0 : r.weight,
      reps: r.reps,
      type: r.type,
      rir: rirOf(r.rpe),
    });
  }
  const workouts = [...byKey.values()].sort((a, b) => a.start - b.start);
  return { workouts, unit: layout.unit(has), skipped };
}

// Words for comparing exercise names: lower case, "(Barbell)" as a word, "Curls" as "curl"
const words = (name) =>
  name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));

// The library exercise each imported name most likely is: the one holding all of its words with
// the fewest others ("Squat (Barbell)" -> "Barbell Squat"). null = no match; the member picks one
export function matchExercises(names, library) {
  const known = library.map((e) => ({ e, words: new Set(words(e.name)) }));
  return new Map(
    names.map((name) => {
      const want = words(name);
      let best = null;
      for (const k of want.length ? known : []) {
        if (want.every((w) => k.words.has(w)) && (!best || k.words.size < best.words.size))
          best = k;
      }
      return [name, best?.e ?? null];
    }),
  );
}

// Hidden and control characters, which the API refuses in names (notes keep their line breaks)
const strip = (text, keepLines) =>
  text.replace(
    keepLines
      ? /[^\P{Cc}\n\t]|[\u202A-\u202E\u2066-\u2069]/gu
      : /[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu,
    ' ',
  );

// One workout as POST /workouts takes it, with `ids` mapping each exercise name in the file to the
// library exercise it's saved as (left out = skipped). null when nothing in it is left to save
export function workoutBody(w, unit, ids) {
  const exercises = w.exercises
    .filter((e) => ids.has(e.name))
    .map((e) => ({
      superset: e.superset,
      exerciseId: ids.get(e.name),
      sets: e.sets
        .map((s) => ({
          weightKg: toKg(s.weight, unit),
          reps: s.reps,
          rir: s.rir,
          side: null,
          type: s.type,
        }))
        // The API's limits: up to 1000 kg, 50 sets an exercise, 50 exercises a workout
        .filter((s) => s.weightKg >= 0 && s.weightKg <= 1000)
        .slice(0, 50),
    }))
    .filter((e) => e.sets.length > 0)
    .slice(0, 50)
    .map(({ superset, ...e }, k, kept) => ({
      ...e,
      supersetWithNext: superset !== '' && kept[k + 1]?.superset === superset,
    }));
  if (exercises.length === 0) return null;
  return {
    name: strip(w.name, false).trim().slice(0, 200) || 'Imported workout',
    date: new Date(w.start).toISOString(),
    notes: strip(w.notes, true).trim().slice(0, 2000),
    durationSec: w.durationSec > 0 ? Math.min(86400, Math.round(w.durationSec)) : null,
    exercises,
  };
}

// The clientId a workout is saved under, made from its start and name: importing the same file
// again saves each workout once, because the server answers a repeat with the one it already has
export async function importId(w) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`import|${w.start}|${w.name}`),
  );
  const hex = [...new Uint8Array(hash).slice(0, 16)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
