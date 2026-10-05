import type { Difficulty } from "./difficulty.ts";
import type { Puzzle, Random } from "./puzzles.ts";
import bank from "./battleships-bank.json" with { type: "json" };
export type ShipPart = "" | "ship" | "single" | "top" | "right" | "bottom" | "left" | "middle";
export interface FleetClues {
  rows: number[];
  columns: number[];
  fleet: number[];
  parts: ShipPart[];
}
export const BATTLESHIP_SIZES = { easy: 6, medium: 6, hard: 8 };
export const fleetForSize = (n: number) =>
  n === 6 ? [3, 2, 2, 1, 1, 1] : [4, 3, 3, 2, 2, 2, 1, 1, 1];
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
export function shipNeighbors(i: number, n: number, diagonal = false) {
  const x = i % n, y = Math.floor(i / n);
  return [-1, 0, 1].flatMap((dy) =>
    [-1, 0, 1].flatMap((dx) =>
      (dx || dy) && (diagonal || !dx || !dy) && x + dx >= 0 && x + dx < n && y + dy >= 0 &&
        y + dy < n
        ? [(y + dy) * n + x + dx]
        : []
    )
  );
}
export function shipParts(values: number[], n: number): ShipPart[] {
  return values.map((v, i) => {
    if (v !== 1) return "";
    const adjacent = shipNeighbors(i, n).filter((j) => values[j] === 1);
    if (!adjacent.length) return "single";
    if (adjacent.length > 1) return "middle";
    return adjacent[0] === i + 1
      ? "left"
      : adjacent[0] === i - 1
      ? "right"
      : adjacent[0] === i + n
      ? "top"
      : "bottom";
  });
}
export function shipGroups(values: number[], n: number) {
  const seen = new Set<number>(), groups: number[][] = [];
  for (let i = 0; i < values.length; i++) {
    if (values[i] !== 1 || seen.has(i)) continue;
    const group = [i];
    seen.add(i);
    for (const j of group) {
      for (const k of shipNeighbors(j, n)) {
        if (values[k] === 1 && !seen.has(k)) {
          seen.add(k);
          group.push(k);
        }
      }
    }
    groups.push(group);
  }
  return groups;
}
export function validBattleships(data: FleetClues, values: number[], n: number) {
  if (values.length !== n * n || values.some((v) => ![0, 1, 2].includes(v))) return false;
  if (
    data.rows.some((v, r) => range(n).filter((c) => values[r * n + c] === 1).length !== v) ||
    data.columns.some((v, c) => range(n).filter((r) => values[r * n + c] === 1).length !== v)
  ) return false;
  const groups = shipGroups(values, n);
  if (
    groups.some((g) =>
      !g.every((i) => i % n === g[0] % n) &&
      !g.every((i) => Math.floor(i / n) === Math.floor(g[0] / n))
    )
  ) return false;
  if (
    values.some((v, i) =>
      v === 1 &&
      shipNeighbors(i, n, true).some((j) =>
        values[j] === 1 && i % n !== j % n && Math.floor(i / n) !== Math.floor(j / n)
      )
    )
  ) return false;
  if (
    groups.map((g) => g.length).sort((a, b) => b - a).join() !==
      [...data.fleet].sort((a, b) => b - a).join()
  ) return false;
  const parts = shipParts(values, n);
  return data.parts.every((part, i) =>
    !part || part === "ship" ? !part || values[i] === 1 : parts[i] === part
  );
}
/** Returns local forced marks, with no access to a solution. */
export function deduceBattleships(data: FleetClues, initial: number[], n: number) {
  const a = [...initial];
  let conflict = false;
  const moves: { index: number; value: number; text: string; cells: number[] }[] = [];
  const put = (i: number, v: number, text: string, cells: number[]) => {
    if (i < 0 || i >= n * n) {
      conflict = true;
      return;
    }
    if (a[i] && a[i] !== v) {
      conflict = true;
      return;
    }
    if (!a[i]) {
      a[i] = v;
      moves.push({ index: i, value: v, text, cells });
    }
  };
  let old = -1;
  while (!conflict && old !== moves.length) {
    old = moves.length;
    for (const [axis, counts] of [data.rows, data.columns].entries()) {
      for (const [line, target] of counts.entries()) {
        const cells = range(n).map((k) => axis ? k * n + line : line * n + k);
        const used = cells.filter((i) => a[i] === 1).length, unknown = cells.filter((i) => !a[i]);
        if (used > target || used + unknown.length < target) {
          conflict = true;
          break;
        }
        if (used === target || used + unknown.length === target) {
          for (const i of unknown) {
            put(
              i,
              used === target ? 2 : 1,
              `${axis ? "Column" : "Row"} ${line + 1} needs ${target} ship squares. ${
                used === target
                  ? "Its ships are all accounted for, so the other squares are water."
                  : "Every remaining square is needed for a ship."
              }`,
              cells,
            );
          }
        }
      }
    }
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== 1) continue;
      const diag = shipNeighbors(i, n, true).filter((j) =>
        i % n !== j % n && Math.floor(i / n) !== Math.floor(j / n)
      );
      diag.forEach((j) =>
        put(j, 2, "Ships cannot touch diagonally. These diagonal neighbors must be water.", [i, j])
      );
      const part = data.parts[i];
      if (part === "single") {
        shipNeighbors(i, n).forEach((j) =>
          put(
            j,
            2,
            "This round clue is a one-square submarine. Every neighboring square must be water.",
            [i, j],
          )
        );
      }
      const offsets: Partial<Record<ShipPart, number>> = { top: n, bottom: -n, left: 1, right: -1 };
      if (offsets[part] !== undefined) {
        const next = i + offsets[part]!;
        if (!shipNeighbors(i, n).includes(next)) conflict = true;
        else {put(
            next,
            1,
            "This revealed end points along its ship. The square beyond its flat side must contain another ship segment.",
            [i, next],
          );}
        shipNeighbors(i, n).filter((j) => j !== next).forEach((j) =>
          put(
            j,
            2,
            "A revealed ship end connects only on its flat side. Its other neighbors must be water.",
            [i, j],
          )
        );
      }
      const neighbors = shipNeighbors(i, n).filter((j) => a[j] === 1);
      if (neighbors.some((j) => j % n !== i % n)) {
        shipNeighbors(i, n).filter((j) => j % n === i % n).forEach((j) =>
          put(j, 2, "Ships are straight. This horizontal ship cannot extend up or down.", [i, j])
        );
      }
      if (neighbors.some((j) => j % n === i % n)) {
        shipNeighbors(i, n).filter((j) => j % n !== i % n).forEach((j) =>
          put(j, 2, "Ships are straight. This vertical ship cannot extend left or right.", [i, j])
        );
      }
    }
  }
  return { values: a, moves, conflict };
}
/** Enumerate row patterns, pruning totals, diagonal contact and visible ship clues. */
export function solveBattleships(
  data: FleetClues,
  initial: number[],
  n: number,
  limit = 2,
  budget = 200000,
) {
  const first = deduceBattleships(data, initial, n);
  const solutions: number[][] = [];
  let nodes = 0, exhausted = false;
  if (first.conflict) return { solutions, nodes, exhausted };
  const counts = range(1 << n).map((m) => range(n).filter((c) => m & (1 << c)).length);
  const options = data.rows.map((target, r) =>
    range(1 << n).filter((m) =>
      counts[m] === target &&
      range(n).every((c) =>
        !first.values[r * n + c] || ((m >> c & 1) === 1) === (first.values[r * n + c] === 1)
      )
    )
  );
  const cols = Array(n).fill(0), masks: number[] = [];
  const partsMatch = (r: number, prev: number, current: number, next: number) =>
    range(n).every((c) => {
      const part = data.parts[r * n + c];
      if (!part || part === "ship") return !part || !!(current >> c & 1);
      if (!(current >> c & 1)) return false;
      const up = !!(prev >> c & 1),
        down = !!(next >> c & 1),
        left = c > 0 && !!(current >> (c - 1) & 1),
        right = c < n - 1 && !!(current >> (c + 1) & 1);
      return part === "single"
        ? !up && !down && !left && !right
        : part === "middle"
        ? (up && down && !left && !right) || (left && right && !up && !down)
        : part === "top"
        ? down && !up && !left && !right
        : part === "bottom"
        ? up && !down && !left && !right
        : part === "left"
        ? right && !left && !up && !down
        : left && !right && !up && !down;
    });
  function visit(r: number) {
    if (++nodes > budget) {
      exhausted = true;
      return;
    }
    if (r === n) {
      if (!partsMatch(n - 1, masks[n - 2] ?? 0, masks[n - 1], 0)) return;
      const values = masks.flatMap((m) => range(n).map((c) => m >> c & 1 ? 1 : 2));
      if (validBattleships(data, values, n)) solutions.push(values);
      return;
    }
    for (const mask of options[r]) {
      const prev = masks[r - 1] ?? 0;
      if (mask & ((prev << 1) | (prev >> 1))) continue;
      if (r && !partsMatch(r - 1, masks[r - 2] ?? 0, prev, mask)) continue;
      if (
        range(n).some((c) =>
          cols[c] + (mask >> c & 1) > data.columns[c] ||
          cols[c] + (mask >> c & 1) + (n - r - 1) < data.columns[c]
        )
      ) continue;
      masks[r] = mask;
      range(n).forEach((c) => cols[c] += mask >> c & 1);
      visit(r + 1);
      range(n).forEach((c) => cols[c] -= mask >> c & 1);
      if (solutions.length >= limit || exhausted) return;
    }
  }
  visit(0);
  return { solutions, nodes, exhausted };
}
export function generateBattleships(p: Puzzle, rng: Random, level: Difficulty) {
  const template = rng.pick(bank[level]), n = p.size, turns = rng.int(4), flip = rng.int(2);
  const transform = (i: number) => {
    let x = i % n, y = Math.floor(i / n);
    if (flip) x = n - 1 - x;
    for (let k = 0; k < turns; k++) [x, y] = [n - 1 - y, x];
    return y * n + x;
  };
  p.initial = Array(n * n).fill(0);
  p.solution = Array(n * n).fill(0);
  template.solution.forEach((v, i) => p.solution[transform(i)] = v);
  template.initial.forEach((v, i) => p.initial[transform(i)] = v);
  const parts = shipParts(p.solution, n).map((part, i) => p.initial[i] === 1 ? part : "");
  p.fleet = {
    rows: range(n).map((r) => p.solution.slice(r * n, r * n + n).filter((v) => v === 1).length),
    columns: range(n).map((c) => range(n).filter((r) => p.solution[r * n + c] === 1).length),
    fleet: fleetForSize(n),
    parts,
  };
}
