// Set types, as the API stores them; a set with no type is a normal working set.
// Tapping a set's number steps through them in this order
export const SET_TYPES = [
  [null, 'Normal'],
  ['warmup', 'Warm-up'],
  ['drop', 'Drop set'],
  ['failure', 'To failure'],
];

const LETTER = { warmup: 'W', drop: 'D', failure: 'F' };

export const typeName = (type) => SET_TYPES.find(([t]) => t === (type ?? null))[1];

// The next type after `type`, for one tap on the set's number
export const nextType = (type) => {
  const i = SET_TYPES.findIndex(([t]) => t === (type ?? null));
  return SET_TYPES[(i + 1) % SET_TYPES.length][0];
};

// What a set's row is called: "W", "D" or "F" for a typed set, else its number among the normal
// sets, so a warm-up doesn't make the first working set "2". One side of a unilateral pair adds
// L or R, and both sides of a pair share the number ("2L", "2R")
export function setLabel(sets, j) {
  const s = sets[j];
  if (s.type) return `${LETTER[s.type]}${s.side ?? ''}`;
  const n = sets.slice(0, j + 1).filter((x) => !x.type && x.side !== 'R').length;
  return `${n}${s.side ?? ''}`;
}
