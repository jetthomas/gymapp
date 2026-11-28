// Supersets: an exercise with `withNext` is done as a superset with the one after it, so a run of
// linked exercises is one superset. Workouts, routines and drafts all store it this way

// Each exercise's superset number; linked exercises share one. [A linked, B, C] -> [0, 0, 2]
export const supersetIds = (exercises) =>
  exercises.reduce(
    (ids, _, i) => [...ids, i > 0 && exercises[i - 1].withNext ? ids[i - 1] : i],
    [],
  );

// The list without exercise i. The one before it stays linked only if i was linked on too:
// taking B out of A+B+C leaves A+C, but out of A+B then C it leaves A on its own
export const withoutExercise = (list, i) =>
  list
    .filter((_, k) => k !== i)
    .map((e, k) => (k === i - 1 ? { ...e, withNext: e.withNext && list[i].withNext } : e));
