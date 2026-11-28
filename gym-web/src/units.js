// Weights are stored in kg; a member who picks lb in Settings sees and types lb instead
const KG_PER_LB = 0.45359237;

export const weightUnit = () => (localStorage.getItem('weight-unit') === 'lb' ? 'lb' : 'kg');

// kg from the API -> the number to show: lb to 0.1, kg to 0.01 (a set logged as 135 lb is 61.235 kg)
export const fromKg = (kg, unit) =>
  unit === 'lb' ? Math.round((kg / KG_PER_LB) * 10) / 10 : Math.round(kg * 100) / 100;

// A typed weight -> kg for the API, kept to the gram so lb survive the round trip
export const toKg = (weight, unit) =>
  unit === 'lb' ? Math.round(weight * KG_PER_LB * 1000) / 1000 : weight;

// A set's weight for the API. `kg` is the exact weight it came from (last time's, or a saved
// workout's); while the number shown is still that one, it's sent unchanged, so 80 kg viewed as
// 176.4 lb stays 80 kg instead of becoming 80.014
export const setKg = (set, unit) =>
  set.kg != null && set.weight === String(fromKg(set.kg, unit))
    ? set.kg
    : toKg(Number(set.weight), unit);
