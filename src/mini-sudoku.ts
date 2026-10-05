import type { Kind, Puzzle, Random } from "./puzzles.ts";

export function isSudoku(kind: Kind | undefined) {
  return kind === "sudoku" || kind === "mini" || kind === "killer";
}
export function sudokuUnits(n: number): number[][] {
  const height = n === 6 ? 2 : 3, width = 3;
  const all = Array.from({ length: n * n }, (_, i) => i);
  return [
    ...Array.from({ length: n }, (_, r) => all.filter((i) => Math.floor(i / n) === r)),
    ...Array.from({ length: n }, (_, c) => all.filter((i) => i % n === c)),
    ...Array.from(
      { length: n },
      (_, b) =>
        all.filter((i) =>
          Math.floor(Math.floor(i / n) / height) * (n / width) + Math.floor(i % n / width) === b
        ),
    ),
  ];
}
export function countMiniSudoku(grid: number[], limit = 2): number {
  if (grid.length !== 36 || grid.some((v) => !Number.isInteger(v) || v < 0 || v > 6)) return 0;
  const units = sudokuUnits(6), a = [...grid];
  if (
    units.some((u) => {
      const digits = u.map((i) => a[i]).filter(Boolean);
      return new Set(digits).size !== digits.length;
    })
  ) return 0;
  const peers = a.map((_, i) => [...new Set(units.filter((u) => u.includes(i)).flat())]);
  let count = 0;
  function visit() {
    let best = -1, options: number[] = [];
    for (let i = 0; i < 36; i++) {
      if (a[i]) continue;
      const choices = [1, 2, 3, 4, 5, 6].filter((v) => peers[i].every((j) => a[j] !== v));
      if (!choices.length) return;
      if (best < 0 || choices.length < options.length) {
        best = i;
        options = choices;
      }
    }
    if (best < 0) {
      count++;
      return;
    }
    for (const v of options) {
      a[best] = v;
      visit();
      a[best] = 0;
      if (count >= limit) return;
    }
  }
  visit();
  return count;
}
export function generateMiniSudoku(p: Puzzle, rng: Random) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const digits = rng.shuffle([1, 2, 3, 4, 5, 6]);
    const rows = rng.shuffle([0, 1, 2]).flatMap((b) => rng.shuffle([0, 1]).map((r) => b * 2 + r));
    const cols = rng.shuffle([0, 1]).flatMap((b) => rng.shuffle([0, 1, 2]).map((c) => b * 3 + c));
    const solution = rows.flatMap((r) =>
      cols.map((c) => digits[(r * 3 + Math.floor(r / 2) + c) % 6])
    );
    const clues = [...solution];
    for (const i of rng.shuffle(Array.from({ length: 36 }, (_, i) => i))) {
      const v = clues[i];
      clues[i] = 0;
      if (countMiniSudoku(clues) !== 1) clues[i] = v;
    }
    if (clues.filter(Boolean).length <= 10) {
      p.initial = clues;
      p.solution = solution;
      return;
    }
  }
  throw new Error("Could not generate a sparse Mini Sudoku");
}
