// The four meals of a day, as the API stores them and as the screens show them
export const MEALS = [
  ['breakfast', 'Breakfast'],
  ['lunch', 'Lunch'],
  ['dinner', 'Dinner'],
  ['snacks', 'Snacks'],
];

// One field (kcal, proteinG...) added up over a list of logged foods
export const total = (foods, field) => foods.reduce((sum, f) => sum + f[field], 0);

// The three macros, as the API names them and as the screens label them
export const MACROS = [
  ['Protein', 'proteinG'],
  ['Carbs', 'carbsG'],
  ['Fat', 'fatG'],
];
