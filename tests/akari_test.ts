import { akariLights, generateAkari, solveAkari, validAkari } from "../src/akari.ts";
import { AKARI_START, generate, isSolved, KINDS, kindsForDate, Random } from "../src/puzzles.ts";
import { ProgressStore, STORAGE_KEY } from "../src/storage.ts";
import { revealHint, smartHint } from "../src/hints.ts";

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
// Independent rule oracle: cast rays from bulbs rather than using production sight/constraints.
function referenceValid(clues: number[], values: number[], n: number) {
  const lit = new Set<number>();
  for (let i = 0; i < n * n; i++) {
    if (clues[i] !== -2) {
      if (values[i] !== -1) return false;
      if (clues[i] >= 0) {
        let count = 0;
        for (let j = 0; j < n * n; j++) {
          if (
            values[j] === 1 &&
            Math.abs(Math.floor(i / n) - Math.floor(j / n)) + Math.abs(i % n - j % n) === 1
          ) count++;
        }
        if (count !== clues[i]) return false;
      }
      continue;
    }
    if (![0, 1, 2].includes(values[i])) return false;
    if (values[i] !== 1) continue;
    lit.add(i);
    for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      for (let step = 1; step < n; step++) {
        const r = Math.floor(i / n) + dr * step, c = i % n + dc * step;
        if (r < 0 || r >= n || c < 0 || c >= n || clues[r * n + c] !== -2) break;
        if (values[r * n + c] === 1) return false;
        lit.add(r * n + c);
      }
    }
  }
  return clues.every((v, i) => v !== -2 || lit.has(i));
}
Deno.test("Akari solver matches exhaustive independent enumeration on small grids", () => {
  const rng = new Random("akari-oracle");
  const fixtures = [Array(9).fill(-2), [-2, -2, -2, -2, 4, -2, -2, -2, -2], [
    4,
    -2,
    -2,
    -2,
    -2,
    -2,
    -2,
    -2,
    -2,
  ]];
  for (let i = 0; i < 45; i++) {
    fixtures.push(Array.from({ length: 9 }, () => rng.next() < .3 ? rng.int(6) - 1 : -2));
  }
  for (const clues of fixtures) {
    const white = clues.flatMap((v, i) => v === -2 ? [i] : []);
    let count = 0;
    for (let mask = 0; mask < 2 ** white.length; mask++) {
      const values: number[] = clues.map((v) => v === -2 ? 0 : -1);
      white.forEach((cell, bit) => values[cell] = (mask >> bit) & 1);
      const valid = referenceValid(clues, values, 3);
      assert(validAkari(clues, values, 3) === valid, "validator differs from rule oracle");
      if (valid) count++;
    }
    const solved = solveAkari(clues, 3, 1000);
    assert(
      !solved.exhausted && solved.count === count,
      `solution count ${solved.count} != ${count}`,
    );
  }
  assert(solveAkari(Array(9).fill(-2), 3, 2, 0).exhausted, "budget exhaustion must be explicit");
});
Deno.test("Akari daily/practice generation stays unique, varied and nontrivial across 730 boards", () => {
  const seen = new Set<string>();
  for (let day = 0; day < 365; day++) {
    const date = new Date(Date.UTC(2026, 8, 14 + day)).toISOString().slice(0, 10);
    for (const seed of [date, `practice:akari-${day}`]) {
      const p = generate("akari", seed), solved = solveAkari(p.clues, p.size);
      assert(!solved.exhausted && solved.count === 1, `${seed}: ambiguous`);
      assert(referenceValid(p.clues, p.solution, p.size) && isSolved(p, p.solution));
      assert(!isSolved(p, p.initial));
      assert(p.solution.filter((v) => v === 1).length >= 4);
      assert(p.clues.filter((v) => v === -2).length >= 25);
      assert(p.clues.filter((v) => v >= 0).length >= 3);
      seen.add(JSON.stringify(p.clues));
    }
  }
  assert(seen.size > 700, "too many repeated boards");
});
Deno.test("Akari fallback remains valid and unique under symmetries and extreme RNGs", () => {
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
  for (
    const rng of [
      new ZeroRandom("zero"),
      new HighRandom("high"),
      ...Array.from({ length: 20 }, (_, i) => new Random(`fallback-${i}`)),
    ]
  ) {
    const p = structuredClone(generate("akari", "fallback"));
    generateAkari(p, rng, 0);
    assert(referenceValid(p.clues, p.solution, 6));
    const result = solveAkari(p.clues, 6);
    assert(result.count === 1 && !result.exhausted);
    assert(p.solution.filter((v) => v === 1).length >= 4);
  }
  for (const rng of [new ZeroRandom("zero"), new HighRandom("high")]) {
    const p = structuredClone(generate("akari", "extreme"));
    generateAkari(p, rng);
    assert(referenceValid(p.clues, p.solution, 6) && solveAkari(p.clues, 6).count === 1);
  }
});
Deno.test("Akari lighting stops at walls; X notes are optional and bulb conflicts are visible", () => {
  const clues = [-2, -1, -2, -2, -1, -2, -2, -1, -2], values = [1, -1, 1, 0, -1, 0, 0, -1, 0];
  assert(validAkari(clues, values, 3), "wall-separated bulbs should be allowed");
  assert(validAkari(clues, values.map((v) => v === 0 ? 2 : v), 3));
  values[6] = 1;
  assert(!validAkari(clues, values, 3));
  const conflict = akariLights(clues, values, 3).conflicts;
  assert(conflict.has(0) && conflict.has(6) && !conflict.has(2));
  values[6] = 0;
  values[2] = 0;
  assert(!validAkari(clues, values, 3), "unlit white squares must prevent completion");
  assert(!akariLights(clues, values, 3).lit[2], "light crossed a black wall");
  values[1] = 1;
  assert(!validAkari(clues, values, 3), "a bulb on a wall was accepted");
});
Deno.test("Akari saves and hints preserve walls, optional notes, time and deterministic boards", () => {
  const data = new Map<string, string>();
  const disk = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
  const store = new ProgressStore(disk),
    p = generate("akari", AKARI_START),
    progress = store.load(p);
  progress.values = p.solution.map((v) => v === 0 ? 2 : v);
  progress.elapsed = 81;
  progress.completed = true;
  store.save(p.seed, p.kind, progress);
  const restored = new ProgressStore(disk).load(p);
  assert(restored.completed && restored.elapsed === 81);
  const original = JSON.stringify(p);
  for (let i = 0; i < 110; i++) generate("pipes", `akari-evict-${i}`);
  assert(JSON.stringify(generate("akari", AKARI_START)) === original);
  const visible = { ...p };
  Object.defineProperty(visible, "solution", {
    get: () => {
      throw Error("Read hidden answer");
    },
  });
  const hint = smartHint(visible, p.initial);
  assert(hint.values && hint.values.some((v, i) => v !== p.initial[i]));
  let values = [...p.initial];
  for (let i = 0; i < 40 && !isSolved(p, values); i++) {
    const reveal = revealHint(p, values);
    assert(reveal.values && reveal.text.includes("revealed answer"));
    values = reveal.values;
    assert(values.every((v, j) => p.clues[j] === -2 || v === -1));
  }
  assert(isSolved(p, values));
  store.save("practice:akari", "akari", progress);
  assert(!data.get(STORAGE_KEY)?.includes("practice:akari"));
});
Deno.test("Akari replaces Five Cells from September 14; Mosaic and Five Cells remain in practice", () => {
  assert(
    KINDS.length === 14 && KINDS.includes("mosaic") && KINDS.includes("fivecells") &&
      KINDS.includes("akari"),
  );
  const before = kindsForDate("2026-09-13"), after = kindsForDate(AKARI_START);
  assert(before.length === 12 && after.length === 12);
  assert(before.includes("fivecells") && !before.includes("akari"));
  assert(after.includes("akari") && !after.includes("fivecells") && !after.includes("mosaic"));
  assert(before.indexOf("fivecells") === after.indexOf("akari"), "daily slot changed");
  assert(KINDS.slice(-2).join() === "sudoku,killer" && after.slice(-2).join() === "sudoku,killer");
  const store = new ProgressStore({ getItem: () => null, setItem: () => {} });
  for (const kind of ["fivecells", "mosaic"] as const) {
    const p = generate(kind, AKARI_START), progress = store.load(p);
    progress.values = [...p.solution];
    progress.completed = true;
    progress.elapsed = 30;
    store.save(AKARI_START, kind, progress);
  }
  assert(store.count(AKARI_START) === 0 && !store.started(AKARI_START));
  for (const kind of after) {
    const p = generate(kind, AKARI_START), progress = store.load(p);
    progress.values = [...p.solution];
    progress.completed = true;
    store.save(AKARI_START, kind, progress);
  }
  assert(store.count(AKARI_START) === 12);
  assert(store.get(AKARI_START, "fivecells")?.completed, "existing save was deleted");
});
