import type { Cage, Puzzle, Random } from "./puzzles.ts";

const cells = Array.from({ length: 81 }, (_, i) => i);
const units = [
  ...Array.from({ length: 9 }, (_, r) => cells.filter((i) => Math.floor(i / 9) === r)),
  ...Array.from({ length: 9 }, (_, c) => cells.filter((i) => i % 9 === c)),
  ...Array.from(
    { length: 9 },
    (_, b) => cells.filter((i) => Math.floor(i / 27) * 3 + Math.floor(i % 9 / 3) === b),
  ),
];

/** Only direct candidates and one-blank cage sums; no hidden singles or candidate chains. */
function directMoves(values: number[], cages: Cage[], peers: number[][]) {
  const moves = new Map<number, number>();
  for (const i of cells) {
    if (values[i]) continue;
    const used = new Set(peers[i].map((j) => values[j]));
    const candidates = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((v) => !used.has(v));
    if (candidates.length === 1) moves.set(i, candidates[0]);
  }
  for (const cage of cages) {
    const empty = cage.cells.filter((i) => !values[i]);
    if (empty.length === 1) {
      moves.set(empty[0], cage.sum - cage.cells.reduce((sum, i) => sum + values[i], 0));
    }
  }
  return moves;
}

/** Carve a relaxed board from a valid answer, preserving obvious starts and a simple finish. */
export function generateRelaxedSudoku(p: Puzzle, rng: Random) {
  const killer = p.kind === "killer", targetGivens = killer ? 36 : 42;
  const peers = cells.map((i) =>
    [
      ...new Set([
        ...units.filter((unit) => unit.includes(i)).flat(),
        ...p.cages.filter((cage) => cage.cells.includes(i)).flatMap((cage) => cage.cells),
      ]),
    ].filter((j) => j !== i)
  );
  const obviousUnits = killer
    ? p.cages.filter((cage) => cage.cells.length > 1).map((c) => c.cells)
    : units;
  const minimumObvious = killer ? 4 : 2;
  p.initial = [...p.solution];
  let blanks = 0;
  for (const i of rng.shuffle(cells)) {
    if (81 - blanks <= targetGivens) break;
    p.initial[i] = 0;
    const obvious = obviousUnits.filter((unit) => unit.filter((j) => !p.initial[j]).length === 1);
    let moves = directMoves(p.initial, p.cages, peers);
    let accepted = obvious.length >= Math.min(minimumObvious, blanks + 1) &&
      moves.size >= Math.min(6, blanks + 1);
    if (accepted) {
      const values = [...p.initial];
      while (moves.size) {
        for (const [cell, value] of moves) values[cell] = value;
        moves = directMoves(values, p.cages, peers);
      }
      accepted = values.every(Boolean);
    }
    if (accepted) blanks++;
    else p.initial[i] = p.solution[i];
  }
}
