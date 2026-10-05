import { adjacent, direction, rotate } from "./puzzles.ts";
import type { Difficulty } from "./difficulty.ts";

export const PIPES_SIZES = { easy: 5, medium: 7, hard: 9 } as const;
export function pipeDomains(shapes: number[], n: number): number[][] {
  if (shapes.length !== n * n || shapes.some((v) => !Number.isInteger(v) || v < 1 || v > 15)) return [];
  return shapes.map((mask, i) => [...new Set([mask, rotate(mask), rotate(rotate(mask)), rotate(rotate(rotate(mask)))])]
    .filter((v) => [1, 2, 4, 8].every((bit) => !(v & bit) || adjacent(i, n).some((j) => direction(i, j, n) === bit))));
}
type Domains = number[][];
/** Visible-shape deductions only; no generated answer or current rotations are consulted. */
function propagate(domains: Domains, n: number, network: boolean): boolean {
  if (domains.length !== n * n) return false;
  const edges = domains.flatMap((_, i) => adjacent(i, n).filter((j) => j > i).map((j) => [i, j]));
  const tree = domains.reduce((sum, d) => sum + (d[0] ?? 0).toString(2).split("1").length - 1, 0) === 2 * (n * n - 1);
  let changed = true;
  const restrict = (i: number, keep: (v: number) => boolean) => {
    const next = domains[i].filter(keep);
    if (next.length !== domains[i].length) { domains[i] = next; changed = true; }
  };
  while (changed) {
    changed = false;
    for (let i = 0; i < domains.length; i++) {
      restrict(i, (v) => adjacent(i, n).every((j) => domains[j].some((w) =>
        !!(v & direction(i, j, n)) === !!(w & direction(j, i, n)))));
      if (!domains[i].length) return false;
    }
    if (!network) continue;
    const parent = domains.map((_, i) => i);
    const root = (i: number): number => parent[i] === i ? i : parent[i] = root(parent[i]);
    const possible: number[][] = domains.map(() => []);
    for (const [i, j] of edges) {
      const bit = direction(i, j, n);
      if (domains[i].every((v) => !!(v & bit))) {
        const a = root(i), b = root(j);
        if (a === b && tree) return false;
        parent[a] = b;
      }
      if (domains[i].some((v) => !!(v & bit))) { possible[i].push(j); possible[j].push(i); }
    }
    if (tree) for (const [i, j] of edges) {
      const bit = direction(i, j, n);
      if (root(i) === root(j) && !domains[i].every((v) => !!(v & bit))) {
        restrict(i, (v) => !(v & bit));
        restrict(j, (v) => !(v & direction(j, i, n)));
      }
    }
    // A bridge in the possible network is the only route between two sections.
    const visited = Array(n * n).fill(-1), low = [...visited], bridges: number[][] = [];
    let time = 0;
    const visit = (i: number, from: number) => {
      visited[i] = low[i] = time++;
      for (const j of possible[i]) {
        if (j === from) continue;
        if (visited[j] < 0) {
          visit(j, i);
          low[i] = Math.min(low[i], low[j]);
          if (low[j] > visited[i]) bridges.push([i, j]);
        } else low[i] = Math.min(low[i], visited[j]);
      }
    };
    visit(0, -1);
    if (visited.some((v) => v < 0)) return false;
    for (const [i, j] of bridges) {
      restrict(i, (v) => !!(v & direction(i, j, n)));
      restrict(j, (v) => !!(v & direction(j, i, n)));
    }
    if (domains.some((d) => !d.length)) return false;
  }
  return true;
}
export function deducePipes(shapes: number[], n: number, level: Difficulty = "hard") {
  const domains = pipeDomains(shapes, n);
  let valid = propagate(domains, n, level !== "easy");
  if (valid && level === "hard") {
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < domains.length; i++) {
        if (domains[i].length < 2) continue;
        for (const v of [...domains[i]]) {
          const trial = domains.map((d) => [...d]);
          trial[i] = [v];
          if (propagate(trial, n, true)) continue;
          domains[i] = domains[i].filter((w) => w !== v);
          changed = true;
        }
        if (!propagate(domains, n, true)) { valid = false; break; }
      }
      if (!valid) break;
    }
  }
  return { domains, valid };
}
export function ratePipes(shapes: number[], n: number): Difficulty | undefined {
  for (const level of ["easy", "medium", "hard"] as const) {
    const result = deducePipes(shapes, n, level);
    if (!result.valid) return;
    if (result.domains.every((d) => d.length === 1)) return propagate(result.domains, n, true) ? level : undefined;
  }
}
/** Exact uniqueness check. Exhausting the search budget never proves uniqueness. */
export function solvePipes(shapes: number[], n: number, limit = 2, budget = 20000) {
  let count = 0, nodes = 0, exhausted = false, solution: number[] = [];
  const visit = (domains: Domains) => {
    if (count >= limit || exhausted) return;
    if (++nodes > budget) { exhausted = true; return; }
    if (!propagate(domains, n, true)) return;
    let best = -1;
    for (let i = 0; i < domains.length; i++) if (domains[i].length > 1 &&
      (best < 0 || domains[i].length < domains[best].length)) best = i;
    if (best < 0) { count++; solution = domains.map((d) => d[0]); return; }
    for (const v of domains[best]) {
      const next = domains.map((d) => [...d]);
      next[best] = [v];
      visit(next);
    }
  };
  visit(pipeDomains(shapes, n));
  return { count, solution, exhausted, nodes };
}
