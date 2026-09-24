import { generate, isSolved, KINDS, kindsForDate, Random } from "../src/puzzles.ts";
import {
  fiveEdges,
  fiveRegions,
  generateNurikabe,
  solveDosun,
  solveFiveCells,
  solveNurikabe,
  validDosun,
  validFiveCells,
  validNurikabe,
} from "../src/extra-puzzles.ts";
import { featured, ProgressStore, STORAGE_KEY } from "../src/storage.ts";
function assert(ok: unknown, message = "Assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}
Deno.test("all three new generators have unique valid solutions across daily and practice seeds", () => {
  for (let day = 0; day < 32; day++) {
    for (const kind of ["dosun", "nurikabe", "fivecells"] as const) {
      const p = generate(
        kind,
        day % 2 ? `practice:extra-${day}` : `2026-10-${String(day + 1).padStart(2, "0")}`,
      );
      assert(isSolved(p, p.solution), `${kind} solution invalid`);
      assert(!isSolved(p, p.initial), `${kind} starts complete`);
      const count = kind === "dosun"
        ? solveDosun(p.regions, p.size).count
        : kind === "nurikabe"
        ? solveNurikabe(p.clues, p.size).count
        : solveFiveCells(p.clues, p.size).count;
      assert(count === 1, `${kind} is not unique`);
    }
  }
});
Deno.test("Dosun requires vertical support, one of each piece per region, and immutable rocks", () => {
  const regions = [0, 1, 2, 0, 1, 2, 0, 1, 2];
  const valid = [1, 1, 1, 0, 0, 0, 2, 2, 2];
  assert(validDosun(regions, valid, 3));
  assert(validDosun(regions, [1, 1, 1, 3, 3, 3, 2, 2, 2], 3), "X notes are optional");
  assert(!validDosun(regions, [0, 1, 1, 1, 0, 0, 2, 2, 2], 3), "unsupported balloon");
  assert(!validDosun(regions, [1, 1, 1, 2, 0, 0, 0, 2, 2], 3), "unsupported weight");
  assert(!validDosun(regions, [1, 1, 1, 1, 0, 0, 2, 2, 2], 3), "extra balloon in a region");
  const p = generate("dosun", "support-fixture");
  const a = [...p.solution], rock = p.regions.indexOf(-1);
  assert(rock >= 0);
  a[rock] = 0;
  assert(!isSolved(p, a), "rocks cannot be erased");
  assert(
    p.solution.some((v, i) => v === 1 && p.solution[i - p.size] === 1) ||
      p.solution.some((v, i) => v === 2 && p.solution[i + p.size] === 2),
    "generated fixture includes a stack",
  );
});
Deno.test("Nurikabe checks connected sea, island clues, no pools, and fully decided cells", () => {
  const clues = [1, 0, 1, 0, 0, 0, 1, 0, 1], values = [2, 1, 2, 1, 1, 1, 2, 1, 2];
  assert(validNurikabe(clues, values, 3));
  assert(
    !validNurikabe([1, 0, 1, 0, 1, 0, 1, 0, 1], [2, 1, 2, 1, 2, 1, 2, 1, 2], 3),
    "sea is disconnected",
  );
  assert(!validNurikabe([1, 0, 0, 0, 0, 0, 0, 0, 0], [2, 1, 1, 1, 1, 1, 1, 1, 1], 3), "2x2 pool");
  assert(!validNurikabe(clues, [2, 2, 2, 1, 1, 1, 2, 1, 2], 3), "numbered islands join");
  assert(!validNurikabe([2, 0, 1, 0, 0, 0, 1, 0, 1], values, 3), "wrong island size");
  assert(!validNurikabe(clues, [2, 0, 2, 1, 1, 1, 2, 1, 2], 3), "undecided square");
});
Deno.test("Five Cells counts the outer frame and rejects internal cuts and wrong-size groups", () => {
  const n = 5,
    edges = fiveEdges(n),
    values = edges.map(([a, b]) => Math.floor(a / n) === Math.floor(b / n) ? 0 : 1);
  const clues = Array(25).fill(-1);
  clues[0] = 3;
  clues[2] = 2;
  clues[24] = 3;
  assert(validFiveCells(clues, edges, values, n));
  clues[0] = 2;
  assert(!validFiveCells(clues, edges, values, n), "outer frame is part of the clue");
  assert(
    !validFiveCells(Array(25).fill(-1), edges, Array(edges.length).fill(0), n),
    "one 25-cell region",
  );
  let tested = false;
  for (let seed = 0; seed < 20 && !tested; seed++) {
    const p = generate("fivecells", `internal-cut-${seed}`);
    for (let edge = 0; edge < p.edges.length; edge++) {
      if (p.solution[edge]) continue;
      const a = [...p.solution];
      a[edge] = 1;
      const r = fiveRegions(p.edges, a, n), [x, y] = p.edges[edge];
      if (r[x] !== r[y]) continue;
      assert(
        !validFiveCells(Array(25).fill(-1), p.edges, a, n),
        "internal dangling line rejected even with five-cell groups",
      );
      tested = true;
      break;
    }
  }
  assert(tested, "fixture with cyclic region found");
});
Deno.test("new games persist marks/borders and preserve old calendar completion", () => {
  const data = new Map<string, string>();
  const store = new ProgressStore({
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  });
  assert(kindsForDate("2026-09-08").length === 8);
  assert(kindsForDate("2026-09-09").length === 11);
  assert(KINDS.length === 14);
  for (const kind of kindsForDate("2026-09-08")) {
    const p = generate(kind, "2026-09-08"), progress = store.load(p);
    progress.values = [...p.solution];
    progress.completed = true;
    store.save(p.seed, kind, progress);
  }
  assert(store.count("2026-09-08") === 8);
  assert(!["dosun", "nurikabe", "fivecells"].includes(featured("2026-09-08")));
  for (const kind of ["dosun", "nurikabe", "fivecells"] as const) {
    const p = generate(kind, "2026-09-09"), progress = store.load(p);
    progress.values = [...p.solution];
    progress.completed = true;
    progress.elapsed = 127;
    store.save(p.seed, kind, progress);
    const fresh = new ProgressStore({
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => {
        data.set(k, v);
      },
    });
    assert(fresh.load(p).completed && fresh.load(p).elapsed === 127, `${kind} completion reload`);
  }
  assert(data.has(STORAGE_KEY));
});

Deno.test("New Nurikabe daily and practice boards always include a larger island and one solution", () => {
  for (let i = 0; i < 365; i++) {
    const date = new Date(Date.UTC(2026, 8, 11 + i)).toISOString().slice(0, 10);
    for (const seed of [date, `practice:nurikabe-variety-${i}`]) {
      const p = generate("nurikabe", seed);
      if (seed.startsWith("practice:") || seed >= "2026-09-25") {
        assert(p.clues.filter((v) => v === 1).length <= 2, `${seed}: too many singleton islands`);
      }
      assert(p.clues.some((v) => v > 1), `${seed}: all islands are 1`);
      assert(validNurikabe(p.clues, p.solution, p.size), `${seed}: invalid solution`);
      assert(solveNurikabe(p.clues, p.size).count === 1, `${seed}: not unique`);
      assert(!isSolved(p, p.initial), `${seed}: starts solved`);
    }
  }
});
Deno.test("Nurikabe fallback has larger islands and a unique solution in every orientation", () => {
  for (let orientation = 0; orientation < 8; orientation++) {
    class FallbackRandom extends Random {
      override shuffle<T>(_items: T[]): T[] { return []; }
      override int(n: number) { return n === 4 ? orientation % 4 : n === 2 ? Math.floor(orientation / 4) : 0; }
    }
    const p = structuredClone(generate("nurikabe", "fallback-template"));
    generateNurikabe(p, new FallbackRandom("force-empty-frontier"));
    assert(p.clues.includes(2) && p.clues.includes(3));
    assert(p.clues.filter((v) => v === 1).length <= 2);
    assert(validNurikabe(p.clues, p.solution, p.size));
    assert(solveNurikabe(p.clues, p.size).count === 1);
    assert(!isSolved(p, p.initial));
  }
});
Deno.test("Nurikabe preserves published daily clues and saves across the variety change", () => {
  const fixtures = [
    ["2026-09-24", [0,0,1,0,1,1,0,0,0,0,0,0,2,0,0,0,1,0,0,0,0,0,2,0,0]],
    ["2026-09-09", [0,0,0,0,1,0,2,0,1,0,0,0,0,0,0,0,0,0,0,0,0,1,0,4,0]],
    ["2026-09-10", [0,0,0,1,0,0,1,0,0,0,0,0,0,1,0,0,1,0,0,0,0,0,1,0,1]],
    ["2026-09-11", [0,0,4,0,1,0,0,0,0,0,0,0,2,0,1,0,0,0,0,0,0,0,3,0,1]],
  ] as const;
  const disk = new Map<string, string>();
  const storage = { getItem: (k: string) => disk.get(k) ?? null, setItem: (k: string, v: string) => { disk.set(k, v); } };
  for (const [seed, clues] of fixtures) {
    const p = generate("nurikabe", seed);
    assert(JSON.stringify(p.clues) === JSON.stringify(clues), `${seed}: published board changed`);
    const store = new ProgressStore(storage), progress = store.load(p);
    progress.values = [...p.solution]; progress.completed = true; progress.elapsed = 123;
    store.save(seed, "nurikabe", progress);
    const restored = new ProgressStore(storage).load(p);
    assert(restored.completed && restored.elapsed === 123);
  }
});
