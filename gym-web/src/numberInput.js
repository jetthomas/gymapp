// onChange for a box that takes a decimal number (a weight, a height): digits and one decimal mark.
// iPhones in many regions show "," on the number keypad, so it's taken too and kept as "."
export const decimal = (set) => (e) => {
  const value = e.target.value.replace(',', '.');
  if (/^\d*\.?\d*$/.test(value)) set(value);
};
