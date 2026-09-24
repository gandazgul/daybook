import { generateRatedNumberPuzzle } from "../src/number-difficulty.ts";
import { countSudoku, generate, isSolved, type Puzzle, Random } from "../src/puzzles.ts";
import { ProgressStore } from "../src/storage.ts";

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
const cells = Array.from({ length: 81 }, (_, i) => i);
const row = (i: number) => Math.floor(i / 9);
const col = (i: number) => i % 9;
const box = (i: number) => Math.floor(row(i) / 3) * 3 + Math.floor(col(i) / 3);

// Independent, visible-clue-only check: no rating solver and no access to the answer.
function directMoves(p: Pick<Puzzle, "cages">, values: number[]) {
  const moves = new Map<number, number>();
  for (const i of cells.filter((i) => !values[i])) {
    const cage = p.cages.find((c) => c.cells.includes(i));
    const candidates = Array.from({ length: 9 }, (_, v) => v + 1).filter((v) =>
      !cells.some((j) =>
        values[j] === v &&
        (row(i) === row(j) || col(i) === col(j) || box(i) === box(j) || cage?.cells.includes(j))
      )
    );
    if (candidates.length === 1) moves.set(i, candidates[0]);
    if (cage && cage.cells.filter((j) => !values[j]).length === 1) {
      moves.set(i, cage.sum - cage.cells.reduce((sum, j) => sum + values[j], 0));
    }
  }
  return moves;
}
function checkRelaxed(p: Puzzle) {
  const givens = p.initial.filter(Boolean).length;
  assert(givens >= (p.kind === "killer" ? 36 : 42) && givens <= 46, "wrong clue density");
  assert(countSudoku(p.initial, p.cages) === 1, "not unique");
  assert(!isSolved(p, p.initial), "starts solved");
  const easyUnits = p.kind === "killer"
    ? p.cages.filter((cage) => cage.cells.length > 1).map((cage) => cage.cells)
    : [row, col, box].flatMap((unit) =>
      Array.from({ length: 9 }, (_, k) => cells.filter((i) => unit(i) === k))
    );
  assert(
    easyUnits.filter((unit) => unit.filter((i) => !p.initial[i]).length === 1).length >=
      (p.kind === "killer" ? 4 : 2),
    "missing obvious opening units",
  );
  let values = [...p.initial], moves = directMoves(p, values);
  assert(moves.size >= 6, "too few straightforward opening moves");
  while (moves.size) {
    const next = [...values];
    for (const [i, value] of moves) next[i] = value;
    values = next;
    moves = directMoves(p, values);
  }
  assert(isSolved(p, values), "needs harder techniques after opening");
}

Deno.test("Relaxed Easy Sudoku and Killer offer obvious starts and direct moves to completion", () => {
  for (const kind of ["sudoku", "killer"] as const) {
    const boards = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const seed = i % 2
        ? `practice:relaxed-${i}`
        : new Date(Date.UTC(2026, 8, 25 + i)).toISOString().slice(0, 10);
      const p = generate(kind, seed, "easy");
      checkRelaxed(p);
      boards.add(JSON.stringify(p.initial));
    }
    assert(boards.size === 200, "duplicate boards");
    for (const fixed of [0, .999999]) {
      class FixedRandom extends Random {
        override next() {
          return fixed;
        }
      }
      const p = structuredClone(generate(kind, "practice:extreme-relaxed", "easy"));
      generateRatedNumberPuzzle(p, new FixedRandom("extreme"), "easy");
      checkRelaxed(p);
    }
  }
});

Deno.test("Relaxed Easy preserves published boards, saves and other difficulty levels", async () => {
  const fixtures = [
    [
      "sudoku",
      "2026-09-24",
      "easy",
      "5def4104be0fb3691bdcd3522bf300916b46469ff75346a780b47e93c6ddb717",
    ],
    [
      "killer",
      "2026-09-24",
      "easy",
      "82fb5b1ccd3c6776ee2108b9efa44156831ed2c81e9a444d84486493c5d85fd0",
    ],
    [
      "sudoku",
      "2026-09-25",
      "medium",
      "20f46e29a69603d27ee84bc1e9e2103be2031b1ce03ff2c468dcf70577257598",
    ],
    [
      "sudoku",
      "2026-09-25",
      "hard",
      "558f78796f5ca2576ff2c4d99c9185d131757bbb1b3e6be040e5c3fb9b751efe",
    ],
    [
      "killer",
      "2026-09-25",
      "medium",
      "40722753226b66ea726ee3fe8e70c2e0f621446ae3f95746cda36a66dcc33d29",
    ],
    [
      "killer",
      "2026-09-25",
      "hard",
      "77d402d80db58d59a1f48f264e13d3e88bd89319d9d2d932ecef0930491352f4",
    ],
  ] as const;
  const data = new Map<string, string>();
  const disk = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
  const store = new ProgressStore(disk);
  for (const [kind, date, level, expected] of fixtures) {
    const p = generate(kind, date, level);
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(p)));
    assert(
      Array.from(new Uint8Array(hash), (v) => v.toString(16).padStart(2, "0")).join("") ===
        expected,
      `${kind}/${date}/${level} changed`,
    );
    const progress = store.load(p);
    progress.values = [...p.solution];
    progress.completed = true;
    progress.elapsed = 123;
    store.save(date, kind, progress, level);
    const restored = new ProgressStore(disk).load(p);
    assert(restored.completed && restored.elapsed === 123);
  }
  for (const kind of ["sudoku", "killer"] as const) {
    const before = JSON.stringify(generate(kind, "2026-09-25", "easy"));
    for (let i = 0; i < 110; i++) generate("pipes", `relaxed-evict-${i}`);
    assert(JSON.stringify(generate(kind, "2026-09-25", "easy")) === before);
  }
});
