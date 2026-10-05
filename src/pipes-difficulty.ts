import { type Puzzle, Random, rotate } from "./puzzles.ts";
import type { Difficulty } from "./difficulty.ts";
import bank from "./pipes-bank.json" with { type: "json" };

/** Verified layouts, varied by symmetry and independently scrambled rotations. */
export function generateRatedPipes(p: Puzzle, rng: Random, level: Difficulty) {
  const source = rng.pick(bank[level]), n = p.size, turns = rng.int(4), reflect = rng.next() < .5;
  p.solution = Array(n * n).fill(0);
  source.forEach((value, i) => {
    let r = Math.floor(i / n), c = i % n;
    if (reflect) { c = n - 1 - c; value = (value & 5) | ((value & 2) << 2) | ((value & 8) >> 2); }
    for (let t = 0; t < turns; t++) { [r, c] = [c, n - 1 - r]; value = rotate(value); }
    p.solution[r * n + c] = value;
  });
  p.initial = p.solution.map((value) => {
    for (let t = rng.int(4); t > 0; t--) value = rotate(value);
    return value;
  });
  // Avoid nearly solved starts, including adversarial random sources.
  let changed = p.initial.filter((v, i) => v !== p.solution[i]).length;
  for (let i = 0; changed < Math.ceil(n * n * .4) && i < p.initial.length; i++) {
    if (p.initial[i] === p.solution[i] && rotate(p.initial[i]) !== p.initial[i]) {
      p.initial[i] = rotate(p.initial[i]);
      changed++;
    }
  }
}
