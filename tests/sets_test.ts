import { generate, isSolved, KINDS, kindsForDate, Random } from "../src/puzzles.ts";
import { EXAMPLE_CARDS, findSets, generateSets, isSet } from "../src/sets.ts";
import { ProgressStore, STORAGE_KEY } from "../src/storage.ts";
import { revealHint, smartHint } from "../src/hints.ts";

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
// Independent, literal same-or-different check for all 56 possible triples.
function enumerate(cards: number[]) {
  const result: number[][] = [];
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 7; j++) for (let k = j + 1; k < 8; k++) {
    if ([1, 3, 9, 27].every((power) => {
      const values = [i, j, k].map((index) => Math.floor(cards[index] / power) % 3);
      return values.every((v) => v === values[0]) || new Set(values).size === 3;
    })) result.push([i, j, k]);
  }
  return result;
}
Deno.test("Sets validates all four independent features and rejects repeated or invalid cards", () => {
  assert(isSet([0, 40, 80]), "all attributes different");
  assert(isSet([0, 1, 2]), "count differs, other attributes match");
  for (const power of [1, 3, 9, 27]) {
    assert(!isSet([0, 40, 80 - power]), `two-match failure on axis ${power}`);
  }
  for (const cards of [[0, 0, 0], [0, 1], [0, 1, 2, 3], [-1, 0, 1], [0, 1, 81], [0, 1, 1.5]]) {
    assert(!isSet(cards), `invalid cards ${cards}`);
  }
});
Deno.test("Sets daily and practice deals have eight unique cards and exactly three sets, with no unused cards", () => {
  const unique = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const p = generate("sets", i % 2 ? `practice:sets-${i}` : `date-test:${i}`);
    const sets = enumerate(p.clues);
    assert(p.clues.length === 8 && new Set(p.clues).size === 8);
    assert(sets.length === 3, `seed ${i}: ${sets.length} sets`);
    assert(new Set(sets.flat()).size === 8, "Every card participates");
    assert(JSON.stringify(sets) === JSON.stringify(findSets(p.clues)));
    assert(!isSolved(p, p.initial) && isSolved(p, [1, 1, 1]));
    assert(!isSolved(p, [1, 1, 0]) && !isSolved(p, [1, 1, 2]));
    unique.add([...p.clues].sort((a, b) => a - b).join(","));
    assert(JSON.stringify(p) === JSON.stringify(generate("sets", p.seed)));
  }
  assert(unique.size > 490, "Seeds should produce varied card collections");
});
Deno.test("Sets bounded-generation fallback still has exactly three sets", () => {
  class FallbackRandom extends Random {
    override shuffle<T>(a: T[]): T[] { return [...a]; }
  }
  const p = structuredClone(generate("sets", "fallback"));
  generateSets(p, new FallbackRandom("fallback"));
  assert(JSON.stringify(p.clues) === JSON.stringify(EXAMPLE_CARDS));
  assert(enumerate(p.clues).length === 3 && new Set(enumerate(p.clues).flat()).size === 8);
});
Deno.test("Practice Mosaic never counts toward daily completion; Sets starts September 11", () => {
  const data = new Map<string, string>();
  const store = new ProgressStore({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } });
  assert(KINDS.includes("mosaic") && KINDS.includes("sets"));
  assert(KINDS.slice(-2).join() === "sudoku,killer", "Sudokus must finish the practice collection");
  for (const date of ["2026-09-08", "2026-09-10", "2026-09-11"]) {
    assert(!kindsForDate(date).includes("mosaic"));
    assert(kindsForDate(date).slice(-2).join() === "sudoku,killer", "Sudokus must finish daily collections");
    const mosaic = generate("mosaic", date), saved = store.load(mosaic);
    saved.values = [...mosaic.solution]; saved.completed = true; saved.elapsed = 75;
    store.save(date, "mosaic", saved);
    assert(store.count(date) === 0 && !store.started(date));
    for (const kind of kindsForDate(date)) {
      const p = generate(kind, date), progress = store.load(p);
      progress.values = [...p.solution]; progress.completed = true;
      store.save(date, kind, progress);
    }
    assert(store.count(date) === kindsForDate(date).length);
    assert(store.load(mosaic).elapsed === 75 && store.load(mosaic).completed);
  }
  assert(!kindsForDate("2026-09-10").includes("sets"));
  assert(kindsForDate("2026-09-11").includes("sets"));
  assert(data.get(STORAGE_KEY)?.includes("mosaic"), "Keep existing Mosaic saves");
});
Deno.test("Sets records found triples and time across reload, while practice cannot complete a daily board", () => {
  const data = new Map<string, string>();
  const disk = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
  const store = new ProgressStore(disk), p = generate("sets", "2026-09-11"), progress = store.load(p);
  progress.values = [1, 0, 1]; progress.elapsed = 42;
  store.save(p.seed, p.kind, progress);
  const restored = new ProgressStore(disk).load(p);
  assert(restored.values.join() === "1,0,1" && restored.elapsed === 42 && !restored.completed);
  progress.values = [1, 1, 1]; progress.completed = true;
  store.save("practice:sets", "sets", progress);
  assert(store.count(p.seed) === 0);
  assert(!data.get(STORAGE_KEY)?.includes("practice:sets"));
  store.save(p.seed, p.kind, progress);
  assert(new ProgressStore(disk).load(p).completed && store.count(p.seed) === 1);
});
Deno.test("Sets hints explain visible features, skip found sets, and record one new trio per application", () => {
  const p = structuredClone(generate("sets", "hints"));
  Object.defineProperty(p, "solution", { get() { throw new Error("No answer access needed"); } });
  for (const getHint of [smartHint, revealHint]) {
    let a = [...p.initial];
    for (let i = 0; i < 3; i++) {
      const before = [...a], hint = getHint(p, a);
      assert(hint.values && hint.cells.length === 3 && isSet(hint.cells.map((cell) => p.clues[cell])));
      assert(a.join() === before.join(), "Preview must not change progress");
      assert(hint.values.filter(Boolean).length === i + 1);
      a = hint.values;
    }
    assert(isSolved(p, a) && !getHint(p, a).values);
  }
});
