import { type Puzzle, Random } from "./puzzles.ts";
import { nurikabeOptions, solveNurikabe } from "./extra-puzzles.ts";
import bank from "./nurikabe-bank.json" with { type: "json" };

export const NURIKABE_SIZES = { easy: 5, medium: 7, hard: 9 } as const;
/** Structural profiles, not a claim about human solving times. */
export function generateLargerNurikabe(p: Puzzle, rng: Random, level: "medium" | "hard") {
  const source = rng.pick(bank[level]), n = NURIKABE_SIZES[level];
  const turns = rng.int(4), reflect = rng.next() < .5;
  p.clues = Array(n * n).fill(0);
  p.solution = Array(n * n).fill(0);
  for (let i = 0; i < n * n; i++) {
    let r = Math.floor(i / n), c = i % n;
    if (reflect) c = n - 1 - c;
    for (let t = 0; t < turns; t++) [r, c] = [c, n - 1 - r];
    const j = r * n + c;
    p.clues[j] = source.clues[i];
    p.solution[j] = source.solution[i];
  }
  // Move clues within their islands to vary verified templates. Failed or
  // exhausted checks revert, so runtime work stays bounded and uniqueness holds.
  for (let attempt = 0; attempt < 4; attempt++) {
    const i = rng.pick(p.clues.flatMap((v, j) => v > 0 ? [j] : []));
    const cells = [i], seen = new Set(cells);
    for (let k = 0; k < cells.length; k++) {
      const x = cells[k];
      const adjacent = [x - n, x + n, x % n ? x - 1 : -1, x % n < n - 1 ? x + 1 : -1];
      for (const j of adjacent) {
        if (j >= 0 && j < n * n && p.solution[j] === 2 && !seen.has(j)) {
          seen.add(j);
          cells.push(j);
        }
      }
    }
    const j = rng.pick(cells.filter((j) => j !== i)), area = p.clues[i];
    p.clues[j] = area;
    p.clues[i] = 0;
    const options = nurikabeOptions(p.clues, n);
    const result = options.filter((o) => o.length > 1).length >= Math.ceil(options.length * .7)
      ? solveNurikabe(p.clues, n, 2, 1000)
      : undefined;
    if (!result || result.count !== 1 || result.exhausted) {
      p.clues[i] = area;
      p.clues[j] = 0;
    }
  }
  p.initial = p.clues.map((v) => v > 0 ? 2 : 0);
}
