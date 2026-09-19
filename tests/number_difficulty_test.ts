import { dailyDifficulty, DIFFICULTIES, DifficultyChoices } from "../src/difficulty.ts";
import { rateBalance, rateSudoku } from "../src/logic-ratings.ts";
import { generateRatedNumberPuzzle, type NumberKind } from "../src/number-difficulty.ts";
import bank from "../src/number-bank.json" with { type: "json" };
import {
  adjacent,
  countBalance,
  countSudoku,
  generate,
  isSolved,
  type Puzzle,
  Random,
} from "../src/puzzles.ts";
import { ProgressStore, STORAGE_KEY } from "../src/storage.ts";

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
const kinds: NumberKind[] = ["mambo", "sudoku", "killer"];
function check(p: Puzzle) {
  assert(isSolved(p, p.solution), `${p.kind} invalid answer`);
  assert(!isSolved(p, p.initial), "starts solved");
  assert(p.initial.every((v, i) => !v || v === p.solution[i]), "inconsistent givens");
  const rating = p.kind === "mambo"
    ? rateBalance(p.initial, p.size, p.links)
    : rateSudoku(p.initial, p.cages);
  assert(rating === p.difficulty, `${p.kind}/${p.seed}/${p.difficulty} rated ${rating}`);
  // Independent exhaustive solvers: the rating solver cannot certify its own uniqueness.
  assert(
    (p.kind === "mambo"
      ? countBalance(p.initial, p.size, p.links)
      : countSudoku(p.initial, p.cages)) === 1,
    `${p.kind} ambiguous puzzle`,
  );
  for (const link of p.links) {
    assert(adjacent(link.a, p.size).includes(link.b), "non-adjacent link");
  }
  if (p.kind === "killer") {
    const cells = p.cages.flatMap((c) => c.cells);
    assert(cells.length === 81 && new Set(cells).size === 81, "cages must partition the board");
    for (const cage of p.cages) {
      const seen = new Set<number>(), todo = cage.cells.slice(0, 1);
      while (todo.length) {
        const i = todo.pop()!;
        if (seen.has(i)) continue;
        seen.add(i);
        todo.push(...adjacent(i, 9).filter((j) => cage.cells.includes(j) && !seen.has(j)));
      }
      assert(seen.size === cage.cells.length, "disconnected cage");
    }
  }
}
Deno.test("Balance and both Sudokus have unique, correctly rated, varied levels", () => {
  for (const kind of kinds) {
    for (const difficulty of DIFFICULTIES) {
      const boards = new Set<string>();
      for (let i = 0; i < 40; i++) {
        const seed = i % 2
          ? `practice:levels-${i}`
          : new Date(Date.UTC(2026, 8, 19 + i)).toISOString().slice(0, 10);
        const p = generate(kind, seed, difficulty);
        check(p);
        boards.add(JSON.stringify([p.initial, p.links, p.cages]));
      }
      assert(boards.size > 37, `${kind} repeats too often`);
    }
  }
});
Deno.test("every number template and extreme random source keeps the requested rating", () => {
  class FixedRandom extends Random {
    constructor(private fixed: number) {
      super("fixed");
    }
    override next() {
      return this.fixed;
    }
  }
  for (const kind of kinds) {
    for (const difficulty of DIFFICULTIES) {
      for (const template of bank[kind][difficulty]) {
        const p = structuredClone(generate(kind, "template", difficulty));
        Object.assign(p, structuredClone(template));
        check(p);
      }
      for (const value of [0, .999999]) {
        const p = structuredClone(generate(kind, "extreme", difficulty));
        generateRatedNumberPuzzle(p, new FixedRandom(value), difficulty);
        check(p);
      }
    }
  }
});
Deno.test("rated number puzzles regenerate exactly and legacy puzzle identities are unchanged", async () => {
  const expected: Record<NumberKind, string> = {
    mambo: "1517c76fcd160a511f851a9246a76b3a3611ed79c0c5ad80b80f5e7b0a1a353f",
    sudoku: "340a422c73b406d2d5fab76eec2d5e62ab7108983729b1196967662764536751",
    killer: "af4908eeaf441da24cfc2595abbb863d6e760508cf7a7b76a5d170599746c240",
  };
  const snapshots = kinds.flatMap((kind) =>
    DIFFICULTIES.map((level) => JSON.stringify(generate(kind, "identities", level)))
  );
  for (let i = 0; i < 110; i++) generate("pipes", `evict-rated-${i}`);
  let index = 0;
  for (const kind of kinds) {
    for (const level of DIFFICULTIES) {
      assert(JSON.stringify(generate(kind, "identities", level)) === snapshots[index++]);
    }
    const data = new TextEncoder().encode(JSON.stringify(generate(kind, "2026-09-18")));
    const digest = await crypto.subtle.digest("SHA-256", data);
    const actual = Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join(
      "",
    );
    assert(actual === expected[kind], `${kind} legacy board changed`);
  }
  assert(
    JSON.stringify([15, 16, 17, 18].map((d) => dailyDifficulty("queens", `2026-09-${d}`))) ===
      '["hard","hard","medium","hard"]',
    "published Queens picks changed",
  );
});
Deno.test("any level earns the daily credit once for all four games and retains separate saves", () => {
  const data = new Map<string, string>();
  const disk = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
  const date = "2026-09-19", store = new ProgressStore(disk), choices = new DifficultyChoices(disk);
  for (const [index, kind] of ["queens" as const, ...kinds].entries()) {
    for (const [i, difficulty] of DIFFICULTIES.entries()) {
      const p = generate(kind, date, difficulty), progress = store.load(p);
      progress.values = [...p.solution];
      progress.completed = true;
      progress.elapsed = 50 + i;
      progress.notes = { 0: [1, 2] };
      store.save(date, kind, progress, difficulty);
      assert(
        store.count(date) === index + 1,
        "daily achievement depends on difficulty or counts twice",
      );
      choices.set(kind, date, difficulty);
      assert(
        choices.get(kind, "2026-09-20") === dailyDifficulty(kind, "2026-09-20"),
        "selection changed tomorrow",
      );
    }
    const reloaded = new ProgressStore(disk);
    for (const [i, difficulty] of DIFFICULTIES.entries()) {
      const restored = reloaded.load(generate(kind, date, difficulty));
      assert(restored.completed && restored.elapsed === 50 + i && restored.notes[0].length === 2);
    }
    const p = generate(kind, date, "hard"), reset = store.load(p);
    reset.values = [...p.initial];
    reset.completed = false;
    store.save(date, kind, reset, "hard");
    assert(store.count(date) === index + 1, "resetting hard removed easy credit");
    const practice = generate(kind, "practice:credit", "easy"), progress = store.load(practice);
    progress.values = [...practice.solution];
    progress.completed = true;
    store.save(practice.seed, kind, progress, "easy");
    assert(!disk.getItem(STORAGE_KEY)?.includes("practice:"));
    choices.set(kind, "practice:first", "easy");
    assert(new DifficultyChoices(disk).get(kind, "practice:next") === "easy");
    const old = new DifficultyChoices(disk, (k, seed) => k === kind && seed === "2026-09-22");
    assert(old.get(kind, "2026-09-22") === "classic", "existing original save abandoned");
  }
  assert(new ProgressStore(disk).count(date) === 4);
});
Deno.test("rating solvers reject contradictions and never rate unconstrained boards", () => {
  const balance = generate("mambo", "invalid-rating", "easy");
  const wrong = [...balance.initial];
  wrong[0] = wrong[1] = wrong[2] = 1;
  assert(rateBalance(wrong, 6, balance.links) === undefined);
  assert(rateBalance(Array(36).fill(0), 6, []) === undefined);
  const sudoku = Array(81).fill(0);
  sudoku[0] = sudoku[1] = 1;
  assert(rateSudoku(sudoku) === undefined);
  assert(rateSudoku(Array(81).fill(0)) === undefined);
  assert(rateSudoku(Array(81).fill(0), [{ cells: [0], sum: 10 }]) === undefined);
});
