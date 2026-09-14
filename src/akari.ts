import { adjacent, type Puzzle, Random } from "./puzzles.ts";

// Clues: -2 is white, -1 is an unnumbered wall, 0–4 are numbered walls.
// Entries: walls stay -1; white cells are 0 empty, 1 bulb, 2 optional X.
export const AKARI_WHITE = -2;
export function akariSight(clues: number[], n: number): number[][] {
  return clues.map((clue, i) => {
    if (clue !== AKARI_WHITE) return [];
    const cells = [i];
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      let r = Math.floor(i / n) + dr, c = i % n + dc;
      while (r >= 0 && r < n && c >= 0 && c < n && clues[r * n + c] === AKARI_WHITE) {
        cells.push(r * n + c);
        r += dr;
        c += dc;
      }
    }
    return cells;
  });
}
export function akariLights(clues: number[], values: number[], n: number) {
  const sight = akariSight(clues, n);
  const lit = sight.map((cells) => cells.some((i) => values[i] === 1));
  const conflicts = new Set<number>();
  values.forEach((v, i) => {
    if (v === 1 && sight[i].some((j) => j !== i && values[j] === 1)) conflicts.add(i);
  });
  clues.forEach((clue, i) => {
    if (clue < 0) return;
    const neighbors = adjacent(i, n).filter((j) => clues[j] === AKARI_WHITE);
    const bulbs = neighbors.filter((j) => values[j] === 1).length;
    const possible = neighbors.filter((j) => values[j] === 0 && !lit[j]).length;
    if (bulbs > clue || bulbs + possible < clue) conflicts.add(i);
  });
  return { sight, lit, conflicts };
}
export function validAkari(clues: number[], values: number[], n: number): boolean {
  if (clues.length !== n * n || values.length !== n * n || !clues.includes(AKARI_WHITE)) {
    return false;
  }
  if (values.some((v, i) => clues[i] === AKARI_WHITE ? ![0, 1, 2].includes(v) : v !== -1)) {
    return false;
  }
  const { lit, conflicts } = akariLights(clues, values, n);
  return !conflicts.size &&
    clues.every((clue, i) =>
      clue === AKARI_WHITE
        ? lit[i]
        : clue < 0 || adjacent(i, n).filter((j) => values[j] === 1).length === clue
    );
}

/** Exhaustive binary solver with propagation; hitting the budget never proves uniqueness. */
export function solveAkari(clues: number[], n: number, limit = 2, budget = 30000) {
  const sight = akariSight(clues, n);
  const white = clues.flatMap((v, i) => v === AKARI_WHITE ? [i] : []);
  const numbered = clues.flatMap((v, i) =>
    v >= 0 ? [{ cells: adjacent(i, n).filter((j) => clues[j] === AKARI_WHITE), total: v }] : []
  );
  let count = 0, nodes = 0, exhausted = false;
  let solution: number[] = [];
  const propagate = (a: number[]): boolean => {
    while (true) {
      let changed = false;
      for (const i of white) {
        const bulbs = sight[i].filter((j) => a[j] === 1);
        if (a[i] === 1) {
          if (bulbs.length > 1) return false;
          for (const j of sight[i]) {
            if (j !== i && a[j] === -1) {
              a[j] = 0;
              changed = true;
            }
          }
        }
        if (!bulbs.length) {
          const possible = sight[i].filter((j) => a[j] === -1);
          if (!possible.length) return false;
          if (possible.length === 1) {
            a[possible[0]] = 1;
            changed = true;
          }
        }
      }
      for (const { cells, total } of numbered) {
        const bulbs = cells.filter((j) => a[j] === 1).length;
        const unknown = cells.filter((j) => a[j] === -1);
        if (bulbs > total || bulbs + unknown.length < total) return false;
        if (unknown.length && (bulbs === total || bulbs + unknown.length === total)) {
          unknown.forEach((j) => a[j] = bulbs === total ? 0 : 1);
          changed = true;
        }
      }
      if (!changed) return true;
    }
  };
  const visit = (a: number[]) => {
    if (count >= limit || exhausted) return;
    if (++nodes > budget) {
      exhausted = true;
      return;
    }
    if (!propagate(a)) return;
    const unknown = white.filter((i) => a[i] === -1);
    if (!unknown.length) {
      const result = a.map((v, i) => clues[i] === AKARI_WHITE ? v : -1);
      if (validAkari(clues, result, n)) {
        count++;
        solution = result;
      }
      return;
    }
    const i = unknown.reduce((best, cell) => sight[cell].length > sight[best].length ? cell : best);
    for (const v of [1, 0]) {
      const next = [...a];
      next[i] = v;
      visit(next);
    }
  };
  visit(clues.map((v) => v === AKARI_WHITE ? -1 : 0));
  return { count, solution, exhausted, nodes };
}

export function generateAkari(p: Puzzle, rng: Random, attemptLimit = 160) {
  const n = p.size, cells = Array.from({ length: n * n }, (_, i) => i);
  for (let attempt = 0; attempt < Math.min(attemptLimit, 160); attempt++) {
    const walls = new Set(rng.shuffle(cells).slice(0, 7 + rng.int(5)));
    const clues: number[] = cells.map((i) => walls.has(i) ? -1 : AKARI_WHITE);
    const sight = akariSight(clues, n), values: number[] = cells.map((i) => walls.has(i) ? -1 : 0);
    for (const i of rng.shuffle(cells)) {
      if (!walls.has(i) && !sight[i].some((j) => values[j] === 1)) values[i] = 1;
    }
    if (values.filter((v) => v === 1).length < 4) continue;
    walls.forEach((i) => clues[i] = adjacent(i, n).filter((j) => values[j] === 1).length);
    const solved = solveAkari(clues, n);
    if (solved.exhausted || solved.count !== 1) continue;
    let numbered = walls.size;
    for (const i of rng.shuffle([...walls])) {
      if (numbered <= 3) break;
      const before = clues[i];
      clues[i] = -1;
      const check = solveAkari(clues, n);
      if (check.exhausted || check.count !== 1) clues[i] = before;
      else numbered--;
    }
    p.clues = clues;
    p.solution = values;
    p.initial = cells.map((i) => walls.has(i) ? -1 : 0);
    return;
  }
  // Independently checked unique fallback. Symmetries preserve walls, clues and rules.
  const clues = [
    0,
    -2,
    -2,
    -2,
    -2,
    -2,
    -2,
    -2,
    -2,
    -1,
    -2,
    -2,
    -2,
    1,
    -2,
    2,
    -2,
    2,
    -2,
    -2,
    -1,
    -2,
    -2,
    -2,
    2,
    -2,
    -2,
    -2,
    -1,
    -2,
    -2,
    -2,
    0,
    -2,
    -1,
    -1,
  ];
  const values = [
    -1,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
    -1,
    0,
    1,
    1,
    -1,
    0,
    -1,
    1,
    -1,
    0,
    0,
    -1,
    1,
    0,
    0,
    -1,
    1,
    0,
    0,
    -1,
    1,
    1,
    0,
    -1,
    0,
    -1,
    -1,
  ];
  const turns = rng.int(4), reflect = rng.next() < .5;
  p.clues = Array(n * n);
  p.solution = Array(n * n);
  cells.forEach((i) => {
    let r = Math.floor(i / n), c = i % n;
    if (reflect) c = n - 1 - c;
    for (let t = 0; t < turns; t++) [r, c] = [c, n - 1 - r];
    p.clues[r * n + c] = clues[i];
    p.solution[r * n + c] = values[i];
  });
  p.initial = p.clues.map((clue) => clue === AKARI_WHITE ? 0 : -1);
}
