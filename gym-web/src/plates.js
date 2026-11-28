// Standard plates in kg, heaviest first
export const PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];
// And in lb. Every one is a whole number of 1.25 steps, so plates() below works for them unchanged
export const LB_PLATES = [45, 35, 25, 10, 5, 2.5];

// The fewest plates for EACH side of the bar, heaviest first, and the weight they really make.
// `have` is the plates the gym has. `total` is under `target` when the target can't be made (61 kg),
// or the bar alone when it's too light.
export default function plates(target, bar = 20, have = PLATES) {
  // Counted in 1.25 kg steps, so the decimals add up exactly
  const steps = Math.max(0, Math.floor((target - bar) / 2 / 1.25 + 1e-9));
  const sizes = have.map((p) => Math.round(p / 1.25));
  // fewest[n] = fewest plates that make exactly n steps; last[n] = the plate added to get there.
  // Heaviest-first can't be used: with only 25s and 20s it would load 25 for 40 and get stuck.
  const fewest = [0];
  const last = [0];
  for (let n = 1; n <= steps; n++) {
    fewest[n] = Infinity;
    for (const s of sizes) {
      if (s <= n && fewest[n - s] + 1 < fewest[n]) {
        fewest[n] = fewest[n - s] + 1;
        last[n] = s;
      }
    }
  }
  let n = steps;
  while (fewest[n] === Infinity) n--;
  const side = [];
  for (; n > 0; n -= last[n]) side.push(last[n] * 1.25);
  side.sort((a, b) => b - a);
  return { side, total: bar + 2 * side.reduce((sum, p) => sum + p, 0) };
}
