// The same limits as check_workout in the API: a set outside them would be refused,
// so it can't be ticked. weight and reps are the strings typed in the inputs.
// The 1000 cap is checked on the number as typed, so in lb it stops at 1000 lb (454 kg)
export function validSet({ weight, reps }) {
  const w = Number(weight);
  const n = Number(reps);
  return weight !== '' && w >= 0 && w <= 1000 && Number.isInteger(n) && n >= 1 && n <= 1000;
}
