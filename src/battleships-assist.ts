import {
  deduceBattleships,
  type FleetClues,
  shipGroups,
  shipNeighbors,
  shipParts,
  solveBattleships,
} from "./battleships.ts";

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const at = (i: number, n: number) => `row ${Math.floor(i / n) + 1}, column ${i % n + 1}`;
const offsets = (n: number): Record<string, number> => ({ top: n, bottom: -n, left: 1, right: -1 });

/** Zero lines are fixed by the printed clues, without changing the archived puzzle. */
export function battleshipsFixed(data: FleetClues, initial: number[], n: number) {
  return initial.map((v, i) =>
    v || (data.rows[Math.floor(i / n)] === 0 || data.columns[i % n] === 0 ? 2 : 0)
  );
}

/** Rebuild derived water from player marks. Never infer ships or consult the answer. */
export function autoWater(
  data: FleetClues,
  initial: number[],
  values: number[],
  n: number,
  previous: number[] = [],
  causes?: Map<number, number[]>,
) {
  const fixed = battleshipsFixed(data, initial, n), a = [...values];
  for (const i of previous) if (!fixed[i] && a[i] === 2) a[i] = 0;
  fixed.forEach((v, i) => {
    if (v && !a[i]) a[i] = v;
  });
  const water = new Set<number>();
  const put = (i: number, sources: number[] = []) => {
    if (!a[i]) {
      a[i] = 2;
      if (!fixed[i]) water.add(i);
    }
    if (water.has(i) && causes) causes.set(i, [...new Set([...(causes.get(i) ?? []), ...sources])]);
  };
  for (const [axis, counts] of [data.rows, data.columns].entries()) {
    counts.forEach((target, line) => {
      const cells = range(n).map((k) => axis ? k * n + line : line * n + k);
      const ships = cells.filter((i) => a[i] === 1);
      if (ships.length === target) cells.forEach((i) => put(i, ships));
    });
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== 1) continue;
    const neighbors = shipNeighbors(i, n);
    shipNeighbors(i, n, true).filter((j) =>
      i % n !== j % n && Math.floor(i / n) !== Math.floor(j / n)
    ).forEach((j) => put(j, [i]));
    const part = data.parts[i], offset = offsets(n)[part];
    if (part === "single") neighbors.forEach((j) => put(j, [i]));
    if (offset !== undefined) neighbors.filter((j) => j !== i + offset).forEach((j) => put(j, [i]));
    if (neighbors.some((j) => a[j] === 1 && j % n !== i % n)) {
      neighbors.filter((j) => j % n === i % n).forEach((j) =>
        put(j, [i, ...neighbors.filter((k) => a[k] === 1)])
      );
    }
    if (neighbors.some((j) => a[j] === 1 && j % n === i % n)) {
      neighbors.filter((j) => j % n !== i % n).forEach((j) =>
        put(j, [i, ...neighbors.filter((k) => a[k] === 1)])
      );
    }
  }
  // A ship as long as the largest fleet member cannot extend at either end.
  for (const group of shipGroups(a, n)) {
    if (group.length !== Math.max(...data.fleet)) continue;
    const straight = group.every((i) => i % n === group[0] % n) ||
      group.every((i) => Math.floor(i / n) === Math.floor(group[0] / n));
    if (straight) {
      group.forEach((i) =>
        shipNeighbors(i, n, true).filter((j) => !group.includes(j)).forEach((j) => put(j, group))
      );
    }
  }
  return { values: a, autoWater: [...water] };
}

export interface FleetAdvice {
  text: string;
  cells: number[];
  index?: number;
  value?: number;
}

/** Diagnose visible contradictions before propagating assumptions. */
export function battleshipsConflict(
  data: FleetClues,
  a: number[],
  n: number,
): FleetAdvice | undefined {
  for (const [axis, counts] of [data.rows, data.columns].entries()) {
    for (const [line, target] of counts.entries()) {
      const cells = range(n).map((k) => axis ? k * n + line : line * n + k);
      const used = cells.filter((i) => a[i] === 1).length,
        available = cells.filter((i) => a[i] !== 2).length;
      const name = `${axis ? "Column" : "Row"} ${line + 1}`;
      if (used > target) {
        return {
          text: `${name} needs ${target} ship ${
            target === 1 ? "square" : "squares"
          }, but you have marked ${used}. Remove ${used - target} ship ${
            used - target === 1 ? "square" : "squares"
          } from this line.`,
          cells,
        };
      }
      if (available < target) {
        return {
          text: `${name} needs ${target} ship ${
            target === 1 ? "square" : "squares"
          }, but only ${available} spaces remain outside the water. Check the water marks in this line.`,
          cells,
        };
      }
    }
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== 1) continue;
    const neighbors = shipNeighbors(i, n);
    const diagonal = shipNeighbors(i, n, true).find((j) =>
      a[j] === 1 && i % n !== j % n && Math.floor(i / n) !== Math.floor(j / n)
    );
    if (diagonal !== undefined) {
      return {
        text: `The ship squares at ${at(i, n)} and ${
          at(diagonal, n)
        } touch diagonally. Different ships cannot touch, even at corners. Check these two placements.`,
        cells: [i, diagonal],
      };
    }
    const part = data.parts[i], offset = offsets(n)[part];
    const forbidden = neighbors.find((j) =>
      a[j] === 1 && (part === "single" || offset !== undefined && j !== i + offset)
    );
    if (forbidden !== undefined) {
      return {
        text: `The revealed ${
          part === "single"
            ? "submarine must have water on every side"
            : "ship end connects only on its flat side"
        }. The adjacent ship at ${at(forbidden, n)} conflicts with that clue.`,
        cells: [i, forbidden],
      };
    }
    if (offset !== undefined && a[i + offset] === 2) {
      return {
        text: `The revealed end at ${
          at(i, n)
        } must continue along its flat side, but that square is marked water. Clear that water mark.`,
        cells: [i, i + offset],
      };
    }
    if (part === "middle") {
      const horizontal = i % n > 0 && i % n < n - 1 && a[i - 1] !== 2 && a[i + 1] !== 2;
      const vertical = i >= n && i < n * (n - 1) && a[i - n] !== 2 && a[i + n] !== 2;
      if (!horizontal && !vertical) {
        return {
          text: `The middle clue at ${
            at(i, n)
          } needs ship squares on two opposite sides. Water blocks both possible directions. Check these neighboring water marks.`,
          cells: [i, ...neighbors],
        };
      }
    }
  }
  const groups = shipGroups(a, n), closed = new Map<number, number[][]>();
  for (const group of groups) {
    if (group.length > Math.max(...data.fleet)) {
      return {
        text:
          `This connected ship has ${group.length} squares, but the longest ship in the fleet has ${
            Math.max(...data.fleet)
          }. Check these connected pieces.`,
        cells: group,
      };
    }
    if (group.every((i) => shipNeighbors(i, n).every((j) => group.includes(j) || a[j] === 2))) {
      const same = closed.get(group.length) ?? [];
      same.push(group);
      closed.set(group.length, same);
      const required = data.fleet.filter((length) => length === group.length).length;
      if (same.length > required) {
        return {
          text: `The fleet has ${required} ${
            required === 1 ? "ship" : "ships"
          } of length ${group.length}, but these water-enclosed groups make ${same.length}. Check the ships or the water preventing them from extending.`,
          cells: [...new Set(same.flatMap((g) => g.flatMap((i) => [i, ...shipNeighbors(i, n)])))],
        };
      }
    }
  }
}

/** Find places a fleet member can occupy using only local, necessary constraints. */
function fleetMove(data: FleetClues, a: number[], n: number): FleetAdvice | undefined {
  for (const length of [...new Set(data.fleet)].sort((x, y) => y - x)) {
    const placements: number[][] = [];
    for (const start of range(n * n)) {
      for (const stride of length === 1 ? [1] : [1, n]) {
        const cells = range(length).map((k) => start + k * stride), last = cells.at(-1)!;
        if (
          last >= a.length || stride === 1 && Math.floor(start / n) !== Math.floor(last / n) ||
          cells.some((i) => a[i] === 2)
        ) continue;
        const area = new Set(
          cells.flatMap((i) => shipNeighbors(i, n, true)).filter((i) => !cells.includes(i)),
        );
        if ([...area].some((i) => a[i] === 1)) continue;
        const trial = [...a];
        cells.forEach((i) => trial[i] = 1);
        area.forEach((i) => trial[i] = 2);
        const parts = shipParts(trial, n);
        if (
          cells.some((i) => data.parts[i] && data.parts[i] !== "ship" && data.parts[i] !== parts[i])
        ) continue;
        if (
          data.rows.some((target, r) => {
            const line = trial.slice(r * n, (r + 1) * n);
            return line.filter((v) => v === 1).length > target ||
              line.filter((v) => v !== 2).length < target;
          }) || data.columns.some((target, c) => {
            const line = range(n).map((r) => trial[r * n + c]);
            return line.filter((v) => v === 1).length > target ||
              line.filter((v) => v !== 2).length < target;
          })
        ) continue;
        placements.push(cells);
      }
    }
    const required = data.fleet.filter((v) => v === length).length;
    if (placements.length === required) {
      const index = placements.flat().find((i) => !a[i]);
      if (index !== undefined) {
        return {
          index,
          value: 1,
          cells: [...new Set(placements.flat())],
          text: `The fleet needs ${required} ${length}-square ${
            required === 1 ? "ship" : "ships"
          }. Only ${
            placements.length === 1 ? "this position fits" : "these positions fit"
          } without touching ships, crossing water, or breaking the row and column totals. Place a ship square at ${
            at(index, n)
          }.`,
        };
      }
    }
    if (required === 1 && placements.length > 1) {
      const index = placements[0].find((i) =>
        !a[i] && placements.every((cells) => cells.includes(i))
      );
      if (index !== undefined) {
        return {
          index,
          value: 1,
          cells: [...new Set(placements.flat())],
          text:
            `There are ${placements.length} possible positions for the ${length}-square ship. Every position covers ${
              at(index, n)
            }, so this square must be a ship.`,
        };
      }
    }
  }
}

export function battleshipsAdvice(
  data: FleetClues,
  a: number[],
  initial: number[],
  n: number,
): FleetAdvice | undefined {
  const direct = battleshipsConflict(data, a, n);
  if (direct) return direct;
  const deduction = deduceBattleships(data, a, n);
  if (deduction.conflict) return deduction.reason;
  const next = deduction.moves[0];
  if (next) return next;
  const fleet = fleetMove(data, a, n);
  if (fleet) return fleet;
  // A short contradiction is explainable without showing a completed answer.
  for (const i of range(a.length).filter((i) => !a[i])) {
    for (const value of [1, 2]) {
      const trial = [...a];
      trial[i] = value;
      const result = deduceBattleships(data, trial, n);
      if (result.conflict && result.reason) {
        return {
          index: i,
          value: value === 1 ? 2 : 1,
          cells: [...new Set([i, ...result.reason.cells])],
          text: `If ${at(i, n)} were ${
            value === 1 ? "a ship" : "water"
          }, the row totals and ship rules would lead to a contradiction: ${result.reason.text} Therefore this square must be ${
            value === 1 ? "water" : "a ship"
          }.`,
        };
      }
    }
  }
  const solved = solveBattleships(data, a, n, 2, 30000);
  if (!solved.exhausted && !solved.solutions.length) {
    // Reduce the contradictory assumptions; these entries conflict as a group.
    const trial = [...a];
    for (const i of range(a.length).filter((i) => a[i] && !initial[i])) {
      const old = trial[i];
      trial[i] = 0;
      const check = solveBattleships(data, trial, n, 1, 3000);
      if (check.exhausted || check.solutions.length) trial[i] = old;
    }
    const cells = range(a.length).filter((i) => trial[i] && !initial[i]);
    return {
      text:
        "These highlighted entries cannot all be correct: no arrangement of the required fleet fits them together with the printed clues. Check this group of ship and water marks.",
      cells: cells.length ? cells : range(a.length).filter((i) => initial[i]),
    };
  }
  if (!solved.exhausted && solved.solutions.length === 1) {
    const i = a.findIndex((v) => !v);
    if (i >= 0) {
      return {
        index: i,
        value: solved.solutions[0][i],
        cells: [i],
        text: `At ${at(i, n)}, only ${
          solved.solutions[0][i] === 1 ? "a ship" : "water"
        } allows the full fleet to fit the row totals, column totals and revealed parts without touching. The opposite mark leaves no valid fleet arrangement.`,
      };
    }
  }
}
