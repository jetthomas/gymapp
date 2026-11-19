// What each activity level multiplies resting energy by, from 1 (sedentary) to 5 (very active)
const ACTIVITY = [1.2, 1.375, 1.55, 1.725, 1.9];
// Calories added to or taken off a day for each goal
const ADJUST = { lose: -500, maintain: 0, lean_bulk: 250, bulk: 500 };

// Whole years between a YYYY-MM-DD birth date and today
export function age(birthDate, today = new Date()) {
  const [y, m, d] = birthDate.split('-').map(Number);
  const hadBirthday =
    today.getMonth() + 1 > m || (today.getMonth() + 1 === m && today.getDate() >= d);
  return today.getFullYear() - y - (hadBirthday ? 0 : 1);
}

// Daily calories and macro grams for a profile, or null when there isn't enough to work them out.
// An estimate (the Mifflin-St Jeor formula), so the member's own kcalTarget always wins
export default function targets(p, today = new Date()) {
  let kcal = p.kcalTarget;
  if (!kcal) {
    if (!(p.weightKg && p.heightCm && p.birthDate && p.activity)) return null;
    // The formula has a constant per sex; "prefer not to say" uses the midpoint
    const s = p.sex === 'male' ? 5 : p.sex === 'female' ? -161 : -78;
    const resting = 10 * p.weightKg + 6.25 * p.heightCm - 5 * age(p.birthDate, today) + s;
    kcal = Math.round((resting * ACTIVITY[p.activity - 1] + (ADJUST[p.goal] ?? 0)) / 10) * 10;
  }
  // 2 g of protein per kg of body weight (30% of calories when the weight isn't known), 25% fat, the rest carbs
  const proteinG = Math.round(p.weightKg ? 2 * p.weightKg : (kcal * 0.3) / 4);
  const fatG = Math.round((kcal * 0.25) / 9);
  const carbsG = Math.max(0, Math.round((kcal - proteinG * 4 - fatG * 9) / 4));
  return { kcal, proteinG, carbsG, fatG };
}
