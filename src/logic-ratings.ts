import { type Cage, type Link, validBalance } from "./puzzles.ts";
import type { Difficulty } from "./difficulty.ts";

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const single = (mask: number) => mask > 0 && (mask & (mask - 1)) === 0;
const BIT_OPTIONS = range(512).map((mask) =>
  range(9).map((v) => 1 << v).filter((bit) => mask & bit)
);
const bits = (mask: number) => BIT_OPTIONS[mask];
type Propagate = (state: number[], advanced: boolean) => boolean;

/** Deduction tiers use only visible clues. Trials prove contradictions, never guess an answer. */
function rate(state: number[], propagate: Propagate, ceiling: Difficulty): Difficulty | undefined {
  if (!propagate(state, false)) return;
  if (state.every(single)) return "easy";
  if (ceiling === "easy") return;
  if (!propagate(state, true)) return;
  if (state.every(single)) return "medium";
  if (ceiling === "medium") return;
  while (!state.every(single)) {
    let changed = false;
    for (let i = 0; i < state.length && !changed; i++) {
      if (single(state[i])) continue;
      for (const bit of bits(state[i])) {
        const trial = [...state];
        trial[i] = bit;
        if (!propagate(trial, true)) {
          state[i] &= ~bit;
          changed = true;
          break;
        }
      }
    }
    if (!changed || !propagate(state, true)) return;
  }
  return "hard";
}

export function rateBalance(
  initial: number[],
  n: number,
  links: Link[],
  ceiling: Difficulty = "hard",
): Difficulty | undefined {
  const units = [
    ...range(n).map((r) => range(n).map((c) => r * n + c)),
    ...range(n).map((c) => range(n).map((r) => r * n + c)),
  ];
  const patterns = range(1 << n).map((mask) => range(n).map((i) => (mask >> i & 1) + 1))
    .filter((line) =>
      line.filter((v) => v === 1).length === n / 2 &&
      !line.some((v, i) => i > 1 && v === line[i - 1] && v === line[i - 2])
    );
  const propagate: Propagate = (state, advanced) => {
    while (true) {
      const before = state.join();
      const a = state.map((v) => single(v) ? v : 0);
      if (!validBalance(a, n, links)) return false;
      for (let i = 0; i < state.length; i++) {
        if (single(state[i])) continue;
        for (const v of [1, 2]) {
          a[i] = v;
          if (!validBalance(a, n, links)) state[i] &= ~v;
        }
        a[i] = single(state[i]) ? state[i] : 0;
      }
      if (advanced) {
        for (const unit of units) {
          const local = links.filter((l) => unit.includes(l.a) && unit.includes(l.b));
          const options = patterns.filter((line) =>
            line.every((v, k) => state[unit[k]] & v) &&
            local.every((l) => (line[unit.indexOf(l.a)] === line[unit.indexOf(l.b)]) === l.same)
          );
          if (!options.length) return false;
          unit.forEach((i, k) => state[i] &= options.reduce((mask, line) => mask | line[k], 0));
        }
      }
      if (state.some((v) => !v)) return false;
      if (before === state.join()) return true;
    }
  };
  return rate(initial.map((v) => v || 3), propagate, ceiling);
}

const SUDOKU_UNITS = [
  ...range(9).map((r) => range(9).map((c) => r * 9 + c)),
  ...range(9).map((c) => range(9).map((r) => r * 9 + c)),
  ...range(9).map((b) =>
    range(9).map((k) => (Math.floor(b / 3) * 3 + Math.floor(k / 3)) * 9 + b % 3 * 3 + k % 3)
  ),
];

export function rateSudoku(
  initial: number[],
  cages: Cage[] = [],
  ceiling: Difficulty = "hard",
): Difficulty | undefined {
  const unique = [...SUDOKU_UNITS, ...cages.map((c) => c.cells)];
  const intersections = SUDOKU_UNITS.flatMap((unit) =>
    SUDOKU_UNITS
      .filter((other) => other !== unit && unit.some((i) => other.includes(i)))
      .map((other) => ({ unit, other, outside: other.filter((i) => !unit.includes(i)) }))
  );
  const propagate: Propagate = (state, advanced) => {
    while (true) {
      const before = state.join();
      for (const unit of unique) {
        let filled = 0;
        for (const i of unit) {
          if (!single(state[i])) continue;
          if (filled & state[i]) return false;
          filled |= state[i];
        }
        for (const i of unit) if (!single(state[i])) state[i] &= ~filled;
      }
      for (const unit of SUDOKU_UNITS) {
        for (const bit of bits(511)) {
          const places = unit.filter((i) => state[i] & bit);
          if (!places.length) return false;
          if (places.length === 1) state[places[0]] = bit;
        }
      }
      for (const cage of cages) {
        const empty = cage.cells.filter((i) => !single(state[i]));
        const sum = cage.cells.reduce(
          (s, i) => s + (single(state[i]) ? Math.log2(state[i]) + 1 : 0),
          0,
        );
        if (!empty.length && sum !== cage.sum) return false;
        if (empty.length === 1) {
          const v = cage.sum - sum;
          if (v < 1 || v > 9) return false;
          state[empty[0]] &= 1 << (v - 1);
        }
        if (advanced && empty.length > 1) {
          // Enumerate cage assignments, retaining only digits supported by its sum.
          const support = cage.cells.map(() => 0), assigned: number[] = [];
          const visit = (k: number, total: number, used: number) => {
            if (k === cage.cells.length) {
              if (total === cage.sum) assigned.forEach((bit, j) => support[j] |= bit);
              return;
            }
            for (const bit of bits(state[cage.cells[k]] & ~used)) {
              const next = total + Math.log2(bit) + 1;
              const left = cage.cells.length - k - 1;
              if (next + left > cage.sum || next + left * 9 < cage.sum) continue;
              assigned[k] = bit;
              visit(k + 1, next, used | bit);
            }
          };
          visit(0, 0, 0);
          cage.cells.forEach((i, k) => state[i] &= support[k]);
        }
      }
      if (advanced) {
        for (const unit of unique) {
          for (const i of unit) {
            if (bits(state[i]).length !== 2) continue;
            const pair = unit.filter((j) => state[j] === state[i]);
            if (pair.length === 2) {
              for (const j of unit) if (!pair.includes(j)) state[j] &= ~state[i];
            }
          }
        }
        for (const { unit, other, outside } of intersections) {
          for (const bit of bits(511)) {
            const places = unit.filter((i) => state[i] & bit);
            if (places.length && places.every((i) => other.includes(i))) {
              for (const i of outside) state[i] &= ~bit;
            }
          }
        }
      }
      if (state.some((v) => !v)) return false;
      if (before === state.join()) return true;
    }
  };
  return rate(initial.map((v) => v ? 1 << (v - 1) : 511), propagate, ceiling);
}
