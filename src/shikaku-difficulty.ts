import { type Puzzle, Random } from "./puzzles.ts";
import {
  SHIKAKU_SIZES,
  shikakuClueCells,
  shikakuOptions,
  type ShikakuShape,
  solveShikaku,
} from "./shikaku.ts";
import bank from "./shikaku-bank.json" with { type: "json" };

/** Profiles reflect grid size and how much size information is withheld, not human timings. */
export function generateShapeShikaku(p: Puzzle, rng: Random, level: "medium" | "hard") {
  const source = rng.pick(bank[level]);
  const n = SHIKAKU_SIZES[level], turns = rng.int(4), reflect = rng.next() < .5;
  p.clues = Array(n * n).fill(0);
  p.shapes = Array(n * n).fill("");
  p.initial = Array(n * n).fill(0);
  p.solution = Array(n * n).fill(0);
  for (let i = 0; i < n * n; i++) {
    let r = Math.floor(i / n), c = i % n;
    if (reflect) c = n - 1 - c;
    for (let t = 0; t < turns; t++) [r, c] = [c, n - 1 - r];
    const j = r * n + c;
    const shape = source.shapes[i] as ShikakuShape;
    p.clues[j] = source.clues[i];
    p.shapes[j] = turns % 2 && (shape === "wide" || shape === "tall")
      ? shape === "wide" ? "tall" : "wide"
      : shape;
    p.solution[j] = source.solution[i];
  }
  // Moving clues produces new boards while preserving the partition and clue mix.
  // Failed uniqueness checks revert to the verified template rather than rerolling without bounds.
  for (let attempt = 0; attempt < 12; attempt++) {
    const i = rng.pick(shikakuClueCells(p));
    const cells = p.solution.flatMap((v, j) => v === p.solution[i] && j !== i ? [j] : []);
    const j = rng.pick(cells), shape = p.shapes[i], area = p.clues[i];
    p.shapes[j] = shape;
    p.clues[j] = area;
    p.shapes[i] = "";
    p.clues[i] = 0;
    const result = solveShikaku(p.clues, n, p.shapes, 2, 12000);
    const options = shikakuOptions(p.clues, n, p.shapes);
    if (
      result.count !== 1 || result.exhausted ||
      options.filter((o) => o.length > 1).length < Math.ceil(options.length / 2)
    ) {
      p.shapes[i] = shape;
      p.clues[i] = area;
      p.shapes[j] = "";
      p.clues[j] = 0;
    }
  }
}
