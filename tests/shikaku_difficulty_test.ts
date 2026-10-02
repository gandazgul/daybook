import { dailyDifficulty, DIFFICULTIES, DifficultyChoices } from "../src/difficulty.ts";
import { generate, isSolved, type Puzzle, Random } from "../src/puzzles.ts";
import {
  shikakuClueCells,
  shikakuOptions,
  shikakuRectangleError,
  type ShikakuShape,
  solveShikaku,
} from "../src/shikaku.ts";
import { generateShapeShikaku } from "../src/shikaku-difficulty.ts";
import { revealHint, smartHint } from "../src/hints.ts";
import { tutorialSteps } from "../src/tutorials.ts";
import { ProgressStore, STORAGE_KEY } from "../src/storage.ts";
import bank from "../src/shikaku-bank.json" with { type: "json" };

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
/** Independent corner enumeration and exact-cover oracle, without production geometry helpers. */
function oracleOptions(p: Pick<Puzzle, "size" | "clues" | "shapes">) {
  const n = p.size, markers = p.clues.flatMap((v, i) => v > 0 || p.shapes?.[i] ? [i] : []);
  const options: number[][][] = markers.map(() => []);
  for (let top = 0; top < n; top++) {
    for (let left = 0; left < n; left++) {
      for (let bottom = top; bottom < n; bottom++) {
        for (let right = left; right < n; right++) {
          const w = right - left + 1, h = bottom - top + 1, cells: number[] = [];
          for (let r = top; r <= bottom; r++) {
            for (let c = left; c <= right; c++) cells.push(r * n + c);
          }
          const clues = cells.filter((i) => markers.includes(i));
          if (clues.length !== 1) continue;
          const i = clues[0], shape = p.shapes?.[i];
          if (p.clues[i] && p.clues[i] !== w * h) continue;
          if (
            shape === "square" && w !== h || shape === "tall" && h <= w ||
            shape === "wide" && w <= h
          ) continue;
          options[markers.indexOf(i)].push(cells);
        }
      }
    }
  }
  return options;
}
function oracleCount(p: Puzzle) {
  const options = oracleOptions(p), occupied = new Set<number>();
  let count = 0;
  const visit = (remaining: number[]) => {
    if (!remaining.length) {
      if (occupied.size === p.size ** 2) count++;
      return;
    }
    let best = -1, choices: number[][] = [];
    for (const i of remaining) {
      const valid = options[i].filter((cells) => cells.every((c) => !occupied.has(c)));
      if (!valid.length) return;
      if (best < 0 || valid.length < choices.length) {
        best = i;
        choices = valid;
      }
    }
    for (const cells of choices) {
      cells.forEach((c) => occupied.add(c));
      visit(remaining.filter((i) => i !== best));
      cells.forEach((c) => occupied.delete(c));
      if (count >= 2) return;
    }
  };
  visit(options.map((_, i) => i));
  return count;
}
function quality(p: Puzzle) {
  assert(isSolved(p, p.solution), "invalid solution");
  assert(!isSolved(p, p.initial), "starts solved");
  const markers = shikakuClueCells(p), unknown = markers.filter((i) => !p.clues[i]);
  assert(p.size === (p.difficulty === "medium" ? 7 : 8));
  assert(new Set(p.shapes?.filter(Boolean)).size === 4, "missing a shape type");
  assert(
    unknown.length >= Math.ceil(markers.length * (p.difficulty === "medium" ? .3 : .6)),
    "too much area information",
  );
  assert(markers.length - unknown.length >= 2, "keep numbered clues as well");
  assert(
    shikakuOptions(p.clues, p.size, p.shapes).filter((o) => o.length > 1).length >=
      Math.ceil(markers.length / 2),
    "too many individually forced clues",
  );
  const result = solveShikaku(p.clues, p.size, p.shapes);
  assert(result.count === 1 && !result.exhausted, "unproven uniqueness");
  let thin = 0, nines = 0;
  for (const id of new Set(p.solution)) {
    const cells = p.solution.flatMap((v, i) => v === id ? [i] : []);
    assert(!shikakuRectangleError(p, cells));
    assert(cells.length >= 2 && cells.length <= 9);
    if (cells.length === 9) nines++;
    const w = new Set(cells.map((i) => i % p.size)).size,
      h = new Set(cells.map((i) => Math.floor(i / p.size))).size;
    if (w === 1 || h === 1) {
      thin += cells.length;
      assert(cells.length <= 3);
    }
  }
  assert(thin <= p.size ** 2 * .25 && nines <= 1, "shape preferences regressed");
  const n = p.size, a = p.solution;
  for (let k = 1; k < n; k++) {
    assert(
      Array.from({ length: n }, (_, j) => j).some((j) => a[k * n + j] === a[(k - 1) * n + j]),
      "horizontal seam",
    );
    assert(
      Array.from({ length: n }, (_, j) => j).some((j) => a[j * n + k] === a[j * n + k - 1]),
      "vertical seam",
    );
    for (let x = 1; x < n; x++) {
      const i = k * n + x;
      assert(new Set([a[i], a[i - 1], a[i - n], a[i - n - 1]]).size < 4, "four-way corner");
    }
  }
}
Deno.test("shape Shikaku profiles stay unique, varied and deterministic across 500 boards", () => {
  for (const level of ["medium", "hard"] as const) {
    const layouts = new Set<string>();
    for (let i = 0; i < 250; i++) {
      const seed = i % 2
        ? `practice:shapes-${i}`
        : new Date(Date.UTC(2026, 9, 4 + i)).toISOString().slice(0, 10);
      const p = generate("shikaku", seed, level);
      quality(p);
      layouts.add(JSON.stringify([p.clues, p.shapes]));
      if (i < 16) {
        const normalize = (options: number[][][]) =>
          options.map((o) => o.map((c) => c.join()).sort());
        assert(
          JSON.stringify(normalize(oracleOptions(p))) ===
            JSON.stringify(normalize(shikakuOptions(p.clues, p.size, p.shapes))),
        );
        assert(oracleCount(p) === 1, "independent solver found ambiguity");
      }
    }
    assert(layouts.size > 235, "too many repeat puzzles");
  }
});
Deno.test("every shape template and extreme random source preserves uniqueness and orientation", () => {
  class FixedRandom extends Random {
    constructor(private fixed: number) {
      super("fixed");
    }
    override next() {
      return this.fixed;
    }
  }
  for (const level of ["medium", "hard"] as const) {
    for (const source of bank[level]) {
      const p = structuredClone(generate("shikaku", "bank-template", level));
      Object.assign(p, structuredClone(source));
      quality(p);
      assert(oracleCount(p) === 1);
    }
    for (const value of [0, .25, .5, .75, .999999]) {
      const p = structuredClone(generate("shikaku", "shape-fallback", level));
      generateShapeShikaku(p, new FixedRandom(value), level);
      quality(p);
      assert(oracleCount(p) === 1);
    }
  }
});
Deno.test("square, wide, tall, unrestricted and numberless rectangle clues are enforced", () => {
  const clues = [0, 0, 0, 0],
    p = { size: 2, clues, shapes: ["square", "", "", ""] as ShikakuShape[] };
  assert(!shikakuRectangleError(p, [0, 1, 2, 3]));
  assert(!!shikakuRectangleError(p, [0, 1]));
  p.shapes[0] = "wide";
  assert(!shikakuRectangleError(p, [0, 1]));
  assert(!!shikakuRectangleError(p, [0, 2]));
  assert(!!shikakuRectangleError(p, [0, 1, 2, 3]));
  p.shapes[0] = "tall";
  assert(!shikakuRectangleError(p, [0, 2]));
  assert(!!shikakuRectangleError(p, [0, 1]));
  p.shapes[0] = "any";
  assert(!shikakuRectangleError(p, [0, 1, 2, 3]));
  assert(!shikakuRectangleError(p, [0]));
  p.clues[0] = 2;
  assert(!!shikakuRectangleError(p, [0, 1, 2, 3]));
  assert(!shikakuRectangleError(p, [0, 1]));
  p.shapes[1] = "any";
  assert(!!shikakuRectangleError(p, [0, 1]));
  assert(!!shikakuRectangleError(p, [2, 3]), "missing clue accepted");
  const exhausted = solveShikaku([2, 0, 0, 2], 2, [], 2, 0);
  assert(exhausted.exhausted && exhausted.count !== 1);
  assert(solveShikaku([2, 0, 0, 2], 2).count === 2);
  assert(solveShikaku([3, 0, 0, 0], 2).count === 0);
});
Deno.test("Shikaku Easy preserves archived boards and any level grants daily credit once", () => {
  const data = new Map<string, string>(),
    disk = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        data.set(k, v);
      },
    };
  assert(dailyDifficulty("shikaku", "2026-10-01") === undefined);
  assert(dailyDifficulty("shikaku", "2026-10-02") === "hard");
  const store = new ProgressStore(disk), choices = new DifficultyChoices(disk), date = "2026-10-02";
  assert(choices.get("shikaku", date) === "hard");
  for (const d of DIFFICULTIES) {
    const p = generate("shikaku", date, d), state = store.load(p);
    state.values = [...p.solution];
    state.completed = true;
    state.elapsed = 75;
    store.save(date, "shikaku", state, d);
    assert(store.count(date) === 1);
    assert(new ProgressStore(disk).load(p).completed);
  }
  const easy = generate("shikaku", date, "easy"), original = generate("shikaku", date);
  assert(easy.size === 6 && !easy.shapes);
  assert(JSON.stringify(easy.clues) === JSON.stringify(original.clues));
  assert(JSON.stringify(easy.solution) === JSON.stringify(original.solution));
  choices.set("shikaku", date, "easy");
  assert(new DifficultyChoices(disk).get("shikaku", date) === "easy");
  assert(choices.get("shikaku", "2026-10-03") === "hard");
  choices.set("shikaku", "practice:first", "medium");
  assert(choices.get("shikaku", "practice:next") === "medium");
  const p = generate("shikaku", "practice:credit", "hard"), state = store.load(p);
  state.values = [...p.solution];
  state.completed = true;
  store.save(p.seed, p.kind, state, "hard");
  assert(!disk.getItem(STORAGE_KEY)?.includes("practice:"));
  const legacy = new DifficultyChoices(disk, (_, seed) => seed === "2026-10-04");
  assert(legacy.get("shikaku", "2026-10-04") === "classic");
});
Deno.test("shape clues and hints survive cache eviction, reveals complete, and tutorials use fixed examples", () => {
  for (const level of ["medium", "hard"] as const) {
    const p = generate("shikaku", "2026-10-02", level), before = JSON.stringify(p);
    for (let i = 0; i < 110; i++) generate("pipes", `shikaku-eviction-${level}-${i}`);
    assert(JSON.stringify(generate("shikaku", p.seed, level)) === before);
    let a = [...p.initial];
    for (let i = 0; i < 50 && !isSolved(p, a); i++) {
      const hint = revealHint(p, a);
      assert(hint.values);
      a = hint.values;
    }
    assert(isSolved(p, a));
    const visible = structuredClone(p), steps = tutorialSteps(visible);
    const example = steps[0].boardExample!;
    assert(isSolved({ ...p, ...example }, example.values));
    assert(example.shapes?.some(Boolean));
    assert(steps.some((s) => s.title === "Discover missing sizes"));
    Object.defineProperty(visible, "solution", {
      get() {
        throw Error("hidden answer read");
      },
    });
    assert(JSON.stringify(tutorialSteps(visible)) === JSON.stringify(steps));
    for (const density of [0, .3, .6, .9]) {
      const rng = new Random(`${level}:${density}`),
        regions = new Set([...new Set(p.solution)].filter(() => rng.next() < density));
      const values = p.solution.map((v) => regions.has(v) ? v + 100 : 0),
        copy = JSON.stringify(values),
        hint = smartHint(visible, values);
      assert(JSON.stringify(values) === copy);
      assert(hint.title !== "Check these entries", hint.text);
      if (hint.values) {
        const complete = [...hint.values], id = Math.max(...complete) + 1;
        complete.forEach((v, i) => {
          if (!v) complete[i] = p.solution[i] + id;
        });
        assert(isSolved(p, complete), "hint conflicts with unique answer");
      }
    }
  }
});
