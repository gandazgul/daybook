import { generate, isSolved, Random } from "../src/puzzles.ts";
import { deducePipes, pipeDomains, PIPES_SIZES, ratePipes, solvePipes } from "../src/pipes-logic.ts";
import { generateRatedPipes } from "../src/pipes-difficulty.ts";
import { dailyDifficulty, DIFFICULTIES, DifficultyChoices, supportsDifficulty } from "../src/difficulty.ts";
import { ProgressStore } from "../src/storage.ts";
import { revealHint, smartHint } from "../src/hints.ts";
import bank from "../src/pipes-bank.json" with { type: "json" };

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
// Independent orientation enumeration: no production domains, propagation or graph solver.
function oracle(shapes: number[], n: number) {
  const options = shapes.map((shape) => {
    const rotations: number[] = [];
    for (let t = 0; t < 4; t++) { rotations.push(shape); shape = (shape * 2 % 16) + Math.floor(shape / 8); }
    return [...new Set(rotations)];
  });
  let count = 0;
  const values: number[] = [];
  const visit = (i: number) => {
    if (i === n * n) {
      const seen = new Set([0]), queue = [0];
      for (let k = 0; k < queue.length; k++) {
        const x = queue[k];
        for (const [bit, y] of [[1, x - n], [2, x + 1], [4, x + n], [8, x - 1]]) {
          if ((values[x] & bit) && !seen.has(y)) { seen.add(y); queue.push(y); }
        }
      }
      if (seen.size === n * n) count++;
      return;
    }
    const r = Math.floor(i / n), c = i % n;
    for (const mask of options[i]) {
      if ((!r && (mask & 1)) || (!c && (mask & 8)) ||
        (r === n - 1 && (mask & 4)) || (c === n - 1 && (mask & 2))) continue;
      if (r && !!(mask & 1) !== !!(values[i - n] & 4)) continue;
      if (c && !!(mask & 8) !== !!(values[i - 1] & 2)) continue;
      values[i] = mask;
      visit(i + 1);
    }
  };
  visit(0);
  return count;
}
Deno.test("Pipes solver matches exhaustive tiny boards including loops, contradictions and ambiguous networks", () => {
  const rng = new Random("pipes-oracle");
  for (const n of [2, 3]) for (let sample = 0; sample < 50; sample++) {
    const shapes = Array.from({ length: n * n }, () => rng.pick([1, 3, 5, 7, 15]));
    if (sample < 30) {
      shapes.fill(0);
      const seen = new Set([0]);
      const edges = shapes.flatMap((_, i) => [
        ...(i % n < n - 1 ? [[i, i + 1, 2, 8]] : []),
        ...(i < n * (n - 1) ? [[i, i + n, 4, 1]] : []),
      ]);
      while (seen.size < shapes.length) {
        const [a, b, bitA, bitB] = rng.pick(edges.filter(([a, b]) => seen.has(a) !== seen.has(b)));
        shapes[a] |= bitA; shapes[b] |= bitB; seen.add(a); seen.add(b);
      }
      // Also check cyclic networks; the game accepts them if all tiles connect.
      if (sample % 3 === 0) for (const [a, b, bitA, bitB] of rng.shuffle(edges).slice(0, 2)) {
        shapes[a] |= bitA; shapes[b] |= bitB;
      }
    }
    const expected = oracle(shapes, n), result = solvePipes(shapes, n, 2, Infinity);
    assert(!result.exhausted && result.count === Math.min(2, expected), `oracle mismatch: ${n}/${sample}`);
    if (sample < 30) assert(expected >= 1);
  }
  assert(solvePipes([3, 3, 3, 3], 2).count === 1, "a connected cycle is legal when shapes permit it");
  const exhausted = solvePipes(bank.hard[0], 9, 2, 0);
  assert(exhausted.exhausted && exhausted.count === 0, "budget exhaustion is not uniqueness");
});
Deno.test("all Pipes templates and adversarial random sources preserve their logical rating and unique solution", () => {
  class FixedRandom extends Random {
    constructor(private fixed: number) { super("fixed-pipes"); }
    override next() { return this.fixed; }
  }
  for (const level of DIFFICULTIES) {
    const n = PIPES_SIZES[level];
    assert(bank[level].length === 32);
    for (const source of bank[level]) {
      assert(ratePipes(source, n) === level);
      assert(pipeDomains(source, n).filter((d) => d.length === 1).length >= 2, "missing starting anchors");
      const solved = solvePipes(source, n);
      assert(solved.count === 1 && !solved.exhausted);
      const p = structuredClone(generate("pipes", "practice:template", level));
      p.initial = [...source]; p.solution = [...source];
      assert(isSolved(p, source));
    }
    for (const fixed of [0, .249, .499, .749, .999999]) {
      const p = structuredClone(generate("pipes", `practice:extreme-${fixed}`, level));
      generateRatedPipes(p, new FixedRandom(fixed), level);
      assert(ratePipes(p.initial, n) === level && isSolved(p, p.solution));
      assert(!isSolved(p, p.initial));
      assert(p.initial.filter((v, i) => v !== p.solution[i]).length >= Math.ceil(n * n * .4));
    }
  }
});
Deno.test("rated Pipes vary and regenerate deterministically; smart hints solve every level from visible shapes", () => {
  for (const level of DIFFICULTIES) {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const seed = i % 2 ? `practice:pipes-level-${i}` : `2027-01-${String(i % 28 + 1).padStart(2, "0")}`;
      const p = generate("pipes", seed, level), solved = solvePipes(p.initial, p.size);
      assert(ratePipes(p.initial, p.size) === level);
      assert(solved.count === 1 && !solved.exhausted && isSolved(p, p.solution));
      assert(!isSolved(p, p.initial));
      seen.add(p.solution.join(","));
    }
    assert(seen.size >= 55, `${level}: too few distinct layouts`);
    const p = generate("pipes", "2026-10-04", level), before = JSON.stringify(p);
    for (let i = 0; i < 110; i++) generate("pipes", `evict-rated-pipes:${i}`);
    assert(JSON.stringify(generate("pipes", p.seed, level)) === before);
    const poisoned = { ...p, solution: Array(p.size ** 2).fill(-999) };
    let values = [...p.initial];
    for (let step = 0; step < p.size ** 2 && !isSolved(p, values); step++) {
      const hint = smartHint(poisoned, values);
      assert(hint.values, `${level}: logical hint missing`);
      assert(hint.values.every((v, i) => v === values[i] || v === p.solution[i]));
      values = hint.values;
    }
    assert(isSolved(p, values));
    const reveal = revealHint(p, p.initial);
    assert(reveal.values && JSON.stringify(p) === before);
    assert(deducePipes(p.initial, p.size, level).valid);
  }
});
Deno.test("Pipes daily remains Original; level choices, daily credit and legacy progress stay separate", () => {
  const data = new Map<string, string>(), disk = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
  };
  const store = new ProgressStore(disk), choices = new DifficultyChoices(disk), date = "2026-10-04";
  assert(supportsDifficulty("pipes"));
  for (const seed of ["2026-09-01", date, "2026-10-06", "2027-01-01"]) {
    assert(dailyDifficulty("pipes", seed) === undefined && choices.get("pipes", seed) === "classic");
  }
  const original = generate("pipes", date), old = store.load(original), before = JSON.stringify(original);
  old.values = [...original.solution]; old.elapsed = 127; old.completed = true;
  store.save(date, "pipes", old);
  for (const level of DIFFICULTIES) {
    const p = generate("pipes", date, level), progress = store.load(p);
    progress.values = [...p.solution]; progress.elapsed = 75; progress.completed = true;
    store.save(date, "pipes", progress, level);
    assert(store.count(date) === 1 && new ProgressStore(disk).load(p).completed);
  }
  assert(JSON.stringify(generate("pipes", date)) === before && new ProgressStore(disk).load(original).elapsed === 127);
  choices.set("pipes", date, "hard");
  assert(new DifficultyChoices(disk).get("pipes", date) === "hard");
  assert(choices.get("pipes", "2026-10-05") === "classic");
  choices.set("pipes", "practice:first", "easy");
  assert(new DifficultyChoices(disk).get("pipes", "practice:another") === "easy");
});
