import { dailyDifficulty, DIFFICULTIES, DifficultyChoices } from "../src/difficulty.ts";
import { countQueens, generate, isSolved, KINDS, Random } from "../src/puzzles.ts";
import { generateRatedQueens, QUEENS_SIZES, rateQueens } from "../src/queens-difficulty.ts";
import { ProgressStore, STORAGE_KEY } from "../src/storage.ts";
import bank from "../src/queens-bank.json" with { type: "json" };

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function disk() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
}
function assertQueens(p: ReturnType<typeof generate>) {
  assert(isSolved(p, p.solution), "invalid answer");
  assert(!isSolved(p, p.initial), "starts complete");
  assert(countQueens(p.regions, p.size) === 1, "ambiguous board");
  assert(rateQueens(p.regions, p.size) === p.difficulty, "wrong deduction level");
  for (let region = 0; region < p.size; region++) {
    const cells = p.regions.flatMap((r, i) => r === region ? [i] : []);
    const seen = new Set<number>(), stack = cells.slice(0, 1);
    while (stack.length) {
      const i = stack.pop()!;
      if (seen.has(i)) continue;
      seen.add(i);
      for (const j of cells) {
        if (
          !seen.has(j) &&
          Math.abs(Math.floor(i / p.size) - Math.floor(j / p.size)) +
                Math.abs(i % p.size - j % p.size) === 1
        ) stack.push(j);
      }
    }
    assert(seen.size === cells.length && cells.length > 0, "disconnected region");
  }
}
Deno.test("Queens difficulty variants stay unique, connected, rated and varied", () => {
  for (const difficulty of DIFFICULTIES) {
    const boards = new Set<string>();
    for (let i = 0; i < 150; i++) {
      const seed = i % 2
        ? `practice:ratings-${i}`
        : new Date(Date.UTC(2026, 8, 15 + i)).toISOString().slice(0, 10);
      const p = generate("queens", seed, difficulty);
      assert(p.size === QUEENS_SIZES[difficulty]);
      assertQueens(p);
      boards.add(JSON.stringify(p.regions));
    }
    assert(boards.size > 140, "too many repeated layouts");
  }
});
Deno.test("every Queens fallback and degenerate random source preserves its rating", () => {
  class ZeroRandom extends Random {
    override next() {
      return 0;
    }
  }
  class HighRandom extends Random {
    override next() {
      return .999999;
    }
  }
  for (const difficulty of DIFFICULTIES) {
    for (const source of bank[difficulty]) {
      const p = structuredClone(generate("queens", "bank-check", difficulty));
      Object.assign(p, source);
      assertQueens(p);
    }
    for (const rng of [new ZeroRandom("zero"), new HighRandom("high")]) {
      const p = structuredClone(generate("queens", "fallback", difficulty));
      generateRatedQueens(p, rng, difficulty);
      assertQueens(p);
    }
  }
});
Deno.test("difficulty identities survive eviction and do not affect original boards", () => {
  const published = generate("queens", "2026-09-14");
  assert(
    JSON.stringify(published.regions) ===
      "[1,1,0,0,0,0,1,0,0,0,0,0,1,0,2,2,2,2,0,0,3,3,3,3,4,4,4,4,3,3,4,4,4,4,4,5]",
    "published board changed",
  );
  assert(
    JSON.stringify(published.solution.flatMap((v, i) => v ? [i] : [])) === "[3,6,14,22,25,35]",
  );
  const original = JSON.stringify(generate("queens", "2026-09-14"));
  const variants = DIFFICULTIES.map((level) =>
    JSON.stringify(generate("queens", "2026-09-14", level))
  );
  assert(new Set([original, ...variants]).size === 4);
  for (let i = 0; i < 110; i++) generate("pipes", `evict-${i}`);
  assert(JSON.stringify(generate("queens", "2026-09-14")) === original);
  DIFFICULTIES.forEach((level, i) =>
    assert(JSON.stringify(generate("queens", "2026-09-14", level)) === variants[i])
  );
  let rejected = false;
  try {
    generate("sudoku", "practice:unsupported", "hard");
  } catch {
    rejected = true;
  }
  assert(rejected, "unsupported games must not silently claim a rating");
});
Deno.test("daily difficulty is shared and repeatable while legacy defaults stay original", () => {
  assert(dailyDifficulty("queens", "2026-09-14") === undefined);
  const found = new Set();
  for (let i = 0; i < 90; i++) {
    const date = new Date(Date.UTC(2026, 8, 15 + i)).toISOString().slice(0, 10);
    found.add(dailyDifficulty("queens", date));
    const a = new DifficultyChoices(disk()), b = new DifficultyChoices(disk());
    assert(a.get("queens", date) === b.get("queens", date));
  }
  assert(found.size === 3);
  for (const kind of KINDS.filter((k) => k !== "queens")) {
    assert(dailyDifficulty(kind, "2026-10-01") === undefined);
  }
});
Deno.test("level saves stay separate, any daily level counts once, and practice never counts", () => {
  const storage = disk(), store = new ProgressStore(storage), date = "2026-09-14";
  for (const [i, difficulty] of [undefined, ...DIFFICULTIES].entries()) {
    const p = generate("queens", date, difficulty), progress = store.load(p);
    progress.values = [...p.solution];
    progress.completed = true;
    progress.elapsed = 60 + i;
    progress.notes = { 2: [1] };
    store.save(date, "queens", progress, difficulty);
    assert(store.count(date) === 1);
  }
  const restored = new ProgressStore(storage);
  for (const [i, difficulty] of [undefined, ...DIFFICULTIES].entries()) {
    const progress = restored.load(generate("queens", date, difficulty));
    assert(progress.completed && progress.elapsed === 60 + i && progress.notes[2][0] === 1);
  }
  const easy = generate("queens", date, "easy"), cleared = restored.load(easy);
  cleared.values = [...easy.initial];
  cleared.completed = false;
  restored.save(date, "queens", cleared, "easy");
  assert(restored.count(date) === 1, "resetting one level removed another completion");
  const practice = generate("queens", "practice:separate", "hard");
  const progress = restored.load(practice);
  progress.values = [...practice.solution];
  progress.completed = true;
  restored.save(practice.seed, "queens", progress, "hard");
  assert(!storage.getItem(STORAGE_KEY)?.includes("practice:"));
  assert(restored.count("2026-09-15") === 0);
  assert(restored.started(date));
  const onlyVariant = new ProgressStore(disk());
  onlyVariant.save(date, "queens", progress, "hard");
  assert(onlyVariant.count(date) === 1 && onlyVariant.started(date), "new variants do not count");
});
Deno.test("choices resume per day and practice retains its level without changing tomorrow", () => {
  const storage = disk(), choices = new DifficultyChoices(storage);
  choices.set("queens", "2026-09-14", "hard");
  choices.set("queens", "practice:first", "easy");
  const restored = new DifficultyChoices(storage);
  assert(restored.get("queens", "2026-09-14") === "hard");
  assert(restored.get("queens", "2026-09-15") === dailyDifficulty("queens", "2026-09-15"));
  assert(restored.get("queens", "practice:another") === "easy");
  assert(restored.get("pipes", "2026-09-14") === undefined);
  const lateUpdate = new DifficultyChoices(disk(), (_kind, seed) => seed === "2026-09-20");
  assert(
    lateUpdate.get("queens", "2026-09-20") === "classic",
    "late update abandoned an original save",
  );
  lateUpdate.set("queens", "2026-09-20", "hard");
  assert(
    lateUpdate.get("queens", "2026-09-20") === "hard",
    "original save prevented an explicit override",
  );
  for (const raw of ["null", "[]", '"bad"', '{"practice/queens":"expert"}', "broken"]) {
    assert(
      new DifficultyChoices({ getItem: () => raw, setItem: () => {} }).get(
        "queens",
        "practice:x",
      ) === "medium",
    );
  }
  const blocked = new DifficultyChoices({
    getItem: () => {
      throw Error();
    },
    setItem: () => {
      throw Error();
    },
  });
  blocked.set("queens", "2026-09-14", "easy");
  assert(blocked.get("queens", "2026-09-14") === "easy");
});
