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

// "Oats, Banana, Milk": a saved meal's name from its foods, as many as fit in the API's 100 characters
export function mealName(foods) {
  let name = foods[0].name;
  for (const f of foods.slice(1)) {
    const next = `${name}, ${f.name}`;
    if (next.length > 100) break;
    name = next;
  }
  return name;
}
