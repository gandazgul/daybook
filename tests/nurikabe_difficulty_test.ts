import { generate, isSolved, Random } from "../src/puzzles.ts";
import { nurikabeOptions, solveNurikabe, validNurikabe } from "../src/extra-puzzles.ts";
import { dailyDifficulty, DIFFICULTIES, DifficultyChoices } from "../src/difficulty.ts";
import { ProgressStore, STORAGE_KEY } from "../src/storage.ts";
import { revealHint, smartHint } from "../src/hints.ts";
import { generateLargerNurikabe } from "../src/nurikabe-difficulty.ts";
import bank from "../src/nurikabe-bank.json" with { type: "json" };

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function profile(clues: number[], n: number, level: "medium" | "hard") {
  const areas = clues.filter(Boolean), options = nurikabeOptions(clues, n);
  const singles = clues.flatMap((v, i) => v === 1 ? [i] : []);
  assert(areas.every((v) => v >= 1 && v <= (level === "medium" ? 5 : 6)));
  assert(level === "medium" ? singles.length <= 1 : singles.length >= 1 && singles.length <= 2);
  if (singles.length === 2) {
    assert(Math.abs(Math.floor(singles[0] / n) - Math.floor(singles[1] / n)) +
      Math.abs(singles[0] % n - singles[1] % n) >= 5, "Hard anchors should be spread apart");
  }
  assert(Math.max(...areas) >= (level === "medium" ? 4 : 5));
  assert(options.filter((o) => o.length > 1).length >= Math.ceil(options.length * .7));
  const result = solveNurikabe(clues, n);
  assert(result.count === 1 && !result.exhausted, `${level}: not proven unique`);
  assert(validNurikabe(clues, result.solution, n));
}
Deno.test("Nurikabe solver agrees with exhaustive cell assignments and reports budget exhaustion", () => {
  const rng = new Random("nurikabe-oracle");
  for (let fixture = 0; fixture < 40; fixture++) {
    const clues = Array(9).fill(0);
    rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]).slice(0, 1 + fixture % 3)
      .forEach((i) => clues[i] = 1 + rng.int(4));
    let count = 0;
    for (let mask = 0; mask < 512; mask++) {
      const values = Array.from({ length: 9 }, (_, i) => mask & (1 << i) ? 2 : 1);
      if (validNurikabe(clues, values, 3)) count++;
    }
    const actual = solveNurikabe(clues, 3, 2, Infinity);
    assert(actual.count === Math.min(2, count) && !actual.exhausted);
  }
  const exhausted = solveNurikabe(bank.hard[0].clues, 9, 2, 0);
  assert(exhausted.exhausted && exhausted.count === 0, "exhaustion cannot prove uniqueness");
});
Deno.test("all larger Nurikabe templates and extreme random sources preserve profiles and unique answers", () => {
  class FixedRandom extends Random {
    constructor(private fixed: number) {
      super("fixed");
    }
    override next() {
      return this.fixed;
    }
  }
  for (const level of ["medium", "hard"] as const) {
    const n = level === "medium" ? 7 : 9;
    assert(bank[level].length === 32);
    assert(new Set(bank[level].map((p) => p.clues.filter((v) => v === 1).length)).size === 2);
    for (const source of bank[level]) {
      profile(source.clues, n, level);
      assert(validNurikabe(source.clues, source.solution, n));
    }
    for (const value of [0, .249, .499, .749, .999999]) {
      const p = structuredClone(generate("nurikabe", `practice:extreme-${level}`, level));
      generateLargerNurikabe(p, new FixedRandom(value), level);
      profile(p.clues, n, level);
      assert(isSolved(p, p.solution));
    }
  }
});
Deno.test("larger Nurikabe daily and practice boards stay varied, deterministic and usable with hints", () => {
  for (const level of ["medium", "hard"] as const) {
    const seen = new Set<string>();
    for (let i = 0; i < 120; i++) {
      const seed = i % 2
        ? `practice:nurikabe-level-${i}`
        : new Date(Date.UTC(2027, 0, i + 1)).toISOString().slice(0, 10);
      const p = generate("nurikabe", seed, level);
      profile(p.clues, p.size, level);
      assert(isSolved(p, p.solution) && !isSolved(p, p.initial));
      assert(p.initial.every((v, j) => v === (p.clues[j] > 0 ? 2 : 0)));
      seen.add(p.clues.join(","));
    }
    assert(seen.size >= 90, `${level}: too many repeated clue layouts`);
    const p = generate("nurikabe", "2026-10-02", level), before = JSON.stringify(p);
    for (let i = 0; i < 110; i++) generate("pipes", `nurikabe-evict-${i}`);
    assert(JSON.stringify(generate("nurikabe", p.seed, level)) === before);
    let values = [...p.initial];
    for (let i = 0; i < p.size ** 2 && !isSolved(p, values); i++) {
      const smart = smartHint(p, values);
      if (smart.values) assert(smart.values.every((v, j) => !v || v === p.solution[j]));
      const revealed = revealHint(p, values);
      assert(revealed.values);
      values = revealed.values;
    }
    assert(isSolved(p, values) && JSON.stringify(p) === before);
  }
});
Deno.test("Nurikabe defaults, lower-level daily credit, practice preferences and Original saves remain separate", () => {
  const data = new Map<string, string>();
  const disk = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
  const store = new ProgressStore(disk), choices = new DifficultyChoices(disk), date = "2026-10-02";
  assert(dailyDifficulty("nurikabe", "2026-10-01") === undefined);
  assert(dailyDifficulty("nurikabe", date) === "hard" && choices.get("nurikabe", date) === "hard");
  const original = generate("nurikabe", date), easy = generate("nurikabe", date, "easy");
  assert(easy.size === 5 && JSON.stringify(easy.clues) === JSON.stringify(original.clues));
  for (const level of DIFFICULTIES) {
    const p = generate("nurikabe", date, level), progress = store.load(p);
    progress.values = [...p.solution];
    progress.completed = true;
    progress.elapsed = 75;
    store.save(date, "nurikabe", progress, level);
    assert(store.count(date) === 1 && new ProgressStore(disk).load(p).completed);
  }
  choices.set("nurikabe", date, "easy");
  assert(new DifficultyChoices(disk).get("nurikabe", date) === "easy");
  assert(dailyDifficulty("nurikabe", "2026-10-03") === "medium");
  assert(choices.get("nurikabe", "2026-10-03") === "medium");
  assert(choices.get("nurikabe", "2026-10-04") === "medium");
  assert(choices.get("nurikabe", "2027-01-01") === "medium");
  choices.set("nurikabe", "2026-10-03", "hard");
  assert(new DifficultyChoices(disk).get("nurikabe", "2026-10-03") === "hard",
    "Changing the default must preserve an explicit choice and its progress");
  choices.set("nurikabe", "practice:first", "hard");
  assert(choices.get("nurikabe", "practice:another") === "hard");
  const p = generate("nurikabe", "practice:credit", "hard"), progress = store.load(p);
  progress.values = [...p.solution];
  progress.completed = true;
  store.save(p.seed, "nurikabe", progress, "hard");
  assert(!data.get(STORAGE_KEY)?.includes("practice:"));
  const old = store.load(original);
  old.values = [...original.solution];
  old.elapsed = 127;
  store.save(date, "nurikabe", old);
  assert(new ProgressStore(disk).load(original).completed);
  assert(new DifficultyChoices(disk, (_, seed) => seed === date).get("nurikabe", date) === "easy");
  assert(
    new DifficultyChoices({ getItem: () => null, setItem: () => {} }, () => true).get(
      "nurikabe",
      date,
    ) === "classic",
  );
});
