// The same limits as check_workout in the API: a set outside them would be refused,
// so it can't be ticked. weightKg and reps are the strings typed in the inputs
export function validSet({ weightKg, reps }) {
  const kg = Number(weightKg);
  const n = Number(reps);
  return weightKg !== '' && kg >= 0 && kg <= 1000 && Number.isInteger(n) && n >= 1 && n <= 1000;
}
