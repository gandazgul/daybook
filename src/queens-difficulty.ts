import { adjacent, countQueens, type Puzzle, Random } from "./puzzles.ts";
import type { Difficulty } from "./difficulty.ts";
import bank from "./queens-bank.json" with { type: "json" };

export const QUEENS_SIZES: Record<Difficulty, number> = { easy: 6, medium: 7, hard: 8 };
interface LogicState {
  candidates: Set<number>;
  queens: Set<number>;
}
/** Rates visible constraints only; the stored solution is never consulted. */
export function rateQueens(regions: number[], n: number): Difficulty | undefined {
  const cells = Array.from({ length: n * n }, (_, i) => i);
  const units = [
    ...Array.from({ length: n }, (_, r) => cells.filter((i) => Math.floor(i / n) === r)),
    ...Array.from({ length: n }, (_, c) => cells.filter((i) => i % n === c)),
    ...Array.from({ length: n }, (_, r) => cells.filter((i) => regions[i] === r)),
  ];
  const attacks = (a: number, b: number) =>
    a === b ||
    Math.floor(a / n) === Math.floor(b / n) || a % n === b % n || regions[a] === regions[b] ||
    (Math.abs(Math.floor(a / n) - Math.floor(b / n)) <= 1 && Math.abs(a % n - b % n) <= 1);
  const place = (state: LogicState, cell: number) => {
    state.queens.add(cell);
    for (const other of state.candidates) if (attacks(cell, other)) state.candidates.delete(other);
  };
  const propagate = (state: LogicState, locked: boolean): boolean => {
    while (true) {
      let changed = false;
      for (const unit of units) {
        if (unit.some((i) => state.queens.has(i))) continue;
        const options = unit.filter((i) => state.candidates.has(i));
        if (!options.length) return false;
        if (options.length === 1) {
          place(state, options[0]);
          changed = true;
          break;
        }
      }
      if (changed) continue;
      if (locked) {
        for (const unit of units) {
          if (unit.some((i) => state.queens.has(i))) continue;
          const options = unit.filter((i) => state.candidates.has(i));
          for (const other of state.candidates) {
            if (!unit.includes(other) && options.every((i) => attacks(i, other))) {
              state.candidates.delete(other);
              changed = true;
            }
          }
        }
      }
      if (!changed) return true;
    }
  };
  const state: LogicState = { candidates: new Set(cells), queens: new Set() };
  if (!propagate(state, false)) return;
  if (state.queens.size === n) return "easy";
  if (!propagate(state, true)) return;
  if (state.queens.size === n) return "medium";
  // Hard puzzles require testing a candidate and proving it contradicts a unit.
  // Trials use the same logical deductions, with no recursive guessing.
  while (state.queens.size < n) {
    let eliminated = false;
    for (const cell of state.candidates) {
      const trial = { candidates: new Set(state.candidates), queens: new Set(state.queens) };
      place(trial, cell);
      if (!propagate(trial, true)) {
        state.candidates.delete(cell);
        eliminated = true;
        break;
      }
    }
    if (!eliminated || !propagate(state, true)) return;
  }
  return "hard";
}

export function queensCandidate(n: number, rng: Random): { regions: number[]; solution: number[] } {
  // A bounded backtracking construction also handles degenerate RNGs without hanging.
  const permutation: number[] = [];
  const visit = (): boolean => {
    if (permutation.length === n) return true;
    for (const c of rng.shuffle(Array.from({ length: n }, (_, i) => i))) {
      if (
        permutation.includes(c) || (permutation.length && Math.abs(c - permutation.at(-1)!) <= 1)
      ) continue;
      permutation.push(c);
      if (visit()) return true;
      permutation.pop();
    }
    return false;
  };
  visit();
  const regions = Array(n * n).fill(-1), solution = Array(n * n).fill(0);
  permutation.forEach((c, r) => {
    regions[r * n + c] = r;
    solution[r * n + c] = 1;
  });
  let remaining = n * n - n;
  while (remaining--) {
    const options: [number, number][] = [];
    for (let i = 0; i < n * n; i++) {
      if (regions[i] >= 0) {
        for (const j of adjacent(i, n)) if (regions[j] < 0) options.push([j, regions[i]]);
      }
    }
    const [cell, region] = rng.pick(options);
    regions[cell] = region;
  }
  return { regions, solution };
}

export function generateRatedQueens(p: Puzzle, rng: Random, difficulty: Difficulty) {
  const n = p.size, source = rng.pick(bank[difficulty]);
  const candidate = { regions: [...source.regions], solution: [...source.solution] };
  // Change boundary cells while preserving connected regions, the queen placements,
  // uniqueness, and the requested logical rating. Failed edits revert to the verified board.
  for (let attempt = 0; attempt < 60; attempt++) {
    const cell = Math.floor(rng.next() * n * n);
    if (candidate.solution[cell]) continue;
    const old = candidate.regions[cell];
    const neighbors = adjacent(cell, n).filter((i) => candidate.regions[i] !== old);
    if (!neighbors.length) continue;
    candidate.regions[cell] = candidate.regions[rng.pick(neighbors)];
    const remaining = candidate.regions.flatMap((r, i) => r === old ? [i] : []);
    const seen = new Set<number>(), stack = remaining.slice(0, 1);
    while (stack.length) {
      const i = stack.pop()!;
      if (seen.has(i)) continue;
      seen.add(i);
      stack.push(...adjacent(i, n).filter((j) => candidate.regions[j] === old && !seen.has(j)));
    }
    if (
      seen.size !== remaining.length || countQueens(candidate.regions, n) !== 1 ||
      rateQueens(candidate.regions, n) !== difficulty
    ) candidate.regions[cell] = old;
  }
  const turns = Math.floor(rng.next() * 4), reflect = rng.next() < .5;
  const labels = rng.shuffle(Array.from({ length: n }, (_, i) => i));
  p.regions = Array(n * n).fill(0);
  p.solution = Array(n * n).fill(0);
  for (let i = 0; i < n * n; i++) {
    let r = Math.floor(i / n), c = i % n;
    if (reflect) c = n - 1 - c;
    for (let t = 0; t < turns; t++) [r, c] = [c, n - 1 - r];
    p.regions[r * n + c] = labels[candidate.regions[i]];
    p.solution[r * n + c] = candidate.solution[i];
  }
}
