import { adjacent, type Puzzle, Random } from "./puzzles.ts";
import type { Difficulty } from "./difficulty.ts";
import { rateBalance, rateSudoku } from "./logic-ratings.ts";
import bank from "./number-bank.json" with { type: "json" };
import { generateRelaxedSudoku, RELAXED_SUDOKU_START } from "./easy-sudoku.ts";

export type NumberKind = "mambo" | "sudoku" | "killer";

/** Bounded offline generation from verified templates, with rating-preserving clue edits. */
export function generateRatedNumberPuzzle(p: Puzzle, rng: Random, difficulty: Difficulty) {
  const source = rng.pick<Pick<Puzzle, "initial" | "solution" | "links" | "cages">>(
    bank[p.kind as NumberKind][difficulty],
  );
  const n = p.size, turns = rng.int(4), reflect = rng.next() < .5;
  const order = () =>
    rng.shuffle([0, 1, 2]).flatMap((b) => rng.shuffle([0, 1, 2]).map((i) => b * 3 + i));
  const rows = p.kind === "sudoku" ? order() : [], cols = p.kind === "sudoku" ? order() : [];
  const map = Array.from({ length: n * n }, (_, i) => {
    let r = Math.floor(i / n), c = i % n;
    if (rows.length) {
      r = rows[r];
      c = cols[c];
    }
    if (reflect) c = n - 1 - c;
    for (let t = 0; t < turns; t++) [r, c] = [c, n - 1 - r];
    return r * n + c;
  });
  const invert = rng.next() < .5;
  const digits = p.kind === "sudoku" ? rng.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]) : [];
  const value = (v: number) =>
    !v ? 0 : digits.length ? digits[v - 1] : invert ? (p.kind === "mambo" ? 3 : 10) - v : v;
  p.initial = Array(n * n).fill(0);
  p.solution = Array(n * n).fill(0);
  source.initial.forEach((v, i) => p.initial[map[i]] = value(v));
  source.solution.forEach((v, i) => p.solution[map[i]] = value(v));
  p.links = source.links.map(({ a, b, same }) => ({ a: map[a], b: map[b], same }));
  p.cages = source.cages.map(({ cells, sum }) => ({
    cells: cells.map((i) => map[i]).sort((a, b) => a - b),
    sum: invert ? cells.length * 10 - sum : sum,
  }));
  const rating = () =>
    p.kind === "mambo"
      ? rateBalance(p.initial, n, p.links, difficulty)
      : rateSudoku(p.initial, p.cages, difficulty);
  const attempts = p.kind === "mambo" ? 8 : difficulty === "hard" ? 2 : 4;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const i = rng.int(n * n);
    if (p.kind === "mambo" && rng.next() < .5) {
      const j = rng.pick(adjacent(i, n));
      const old = p.links;
      const exists = old.some((l) => l.a === i && l.b === j || l.a === j && l.b === i);
      p.links = exists
        ? old.filter((l) => !(l.a === i && l.b === j || l.a === j && l.b === i))
        : [...old, { a: i, b: j, same: p.solution[i] === p.solution[j] }];
      if (rating() !== difficulty) p.links = old;
    } else {
      const old = p.initial[i];
      p.initial[i] = old ? 0 : p.solution[i];
      if (rating() !== difficulty) p.initial[i] = old;
    }
  }
  // Published daily boards retain their clues so existing saves remain compatible.
  if (
    difficulty === "easy" && (p.kind === "sudoku" || p.kind === "killer") &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(p.seed) || p.seed >= RELAXED_SUDOKU_START)
  ) generateRelaxedSudoku(p, rng);
}
