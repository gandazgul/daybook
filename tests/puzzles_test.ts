import {
  countBalance,
  countMosaic,
  countQueens,
  countShikaku,
  countSudoku,
  generate,
  isSolved,
  KINDS,
  Random,
  rotate,
} from "../src/puzzles.ts";
import {
  dateKey,
  dayIndex,
  featured,
  formatTime,
  ProgressStore,
  STORAGE_KEY,
} from "../src/storage.ts";
function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
Deno.test("all nine generators produce playable, deterministic, solvable daily puzzles", () => {
  for (let day = 1; day <= 20; day++) {
    for (const kind of KINDS) {
      const p = generate(kind, `2026-09-${String(day).padStart(2, "0")}`);
      assert(isSolved(p, p.solution), `${kind} day ${day} solution invalid`);
      assert(!isSolved(p, p.initial), `${kind} day ${day} starts solved`);
      assert(JSON.stringify(p) === JSON.stringify(generate(kind, p.seed)), "same date changed");
      if (kind === "sudoku" || kind === "killer") {
        assert(countSudoku(p.initial, p.cages) === 1, `${kind} not unique`);
      }
      if (kind === "queens") {
        assert(countQueens(p.regions, p.size) === 1, "Regional Queens not unique");
      }
      if (kind === "shikaku") assert(countShikaku(p.clues, p.size) === 1, "Shikaku not unique");
      if (kind === "mosaic") assert(countMosaic(p.clues, p.size) === 1, "Mosaic not unique");
      if (kind === "mambo") {
        assert(countBalance(p.initial, p.size, p.links) === 1, "Balance not unique");
      }
    }
  }
});
Deno.test("consecutive days and practice produce fresh content", () => {
  for (const kind of KINDS) {
    assert(
      JSON.stringify(generate(kind, "2026-09-08").solution) !==
        JSON.stringify(generate(kind, "2026-09-09").solution),
      `${kind} repeated`,
    );
    assert(generate(kind, "practice:one").seed === "practice:one");
  }
  assert(
    new Set(Array.from({ length: KINDS.length }, (_, i) => featured(`2026-09-${10 + i}`))).size ===
      KINDS.length,
  );
});
Deno.test("rotation, RNG, date and duration boundaries", () => {
  for (let mask = 1; mask < 16; mask++) assert(rotate(rotate(rotate(rotate(mask)))) === mask);
  const a = new Random("seed"), b = new Random("seed");
  for (let i = 0; i < 20; i++) assert(a.next() === b.next());
  assert(dateKey(new Date(2026, 0, 3)) === "2026-01-03");
  assert(dayIndex("2026-03-09") - dayIndex("2026-03-08") === 1);
  assert(formatTime(3601.7) === "60:01");
});
Deno.test("validators reject invalid complete boards and altered fixed clues", () => {
  for (const kind of KINDS) {
    const p = generate(kind, "validation");
    const wrong = [...p.solution];
    wrong[0] = kind === "snap" ? wrong[1] : 99;
    assert(!isSolved(p, wrong), `${kind} accepted illegal board`);
  }
  const snap = generate("snap", "validation");
  assert(!isSolved(snap, snap.solution.slice().reverse()));
  const mambo = generate("mambo", "validation");
  assert(!isSolved(mambo, mambo.solution.map((v) => 3 - v)));
});
Deno.test("archive persists state, notes and time; practice never marks daily completion", () => {
  const data = new Map<string, string>();
  const disk = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
  const store = new ProgressStore(disk), p = generate("sudoku", "2026-09-08");
  const state = store.load(p);
  state.values = [...p.solution];
  state.elapsed = 83.5;
  state.completed = true;
  state.notes = { 1: [2, 3] };
  store.save(p.seed, p.kind, state);
  const restored = new ProgressStore(disk);
  assert(restored.load(p).elapsed === 83.5);
  assert(restored.count(p.seed) === 1);
  state.values[0] = 99;
  assert(restored.load(p).values[0] !== 99, "not a copy");
  restored.save("practice:123", "sudoku", state);
  assert(!disk.getItem(STORAGE_KEY)?.includes("practice:123"));
  assert(new ProgressStore({ getItem: () => "broken", setItem: () => {} }).load(p).elapsed === 0);
  assert(
    !new ProgressStore({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
    }).available,
  );
});

Deno.test("generation remains deterministic after cache eviction", () => {
  const before = KINDS.map((kind) => JSON.stringify(generate(kind, "reproducibility")));
  for (let i = 0; i < 110; i++) generate("pipes", `cache-fill-${i}`);
  KINDS.forEach((kind, i) =>
    assert(
      JSON.stringify(generate(kind, "reproducibility")) === before[i],
      `${kind} changed after regeneration`,
    )
  );
});

Deno.test("Atoms accepts double bonds but rejects disconnected degree-correct networks", () => {
  const p = structuredClone(generate("atoms", "bond-constraints"));
  p.clues = Array(16).fill(2);
  const disconnected = p.edges.map(([a, b]) =>
    ((a / 8 | 0) === (b / 8 | 0) && (a % 4 / 2 | 0) === (b % 4 / 2 | 0)) ? 1 : 0
  );
  assert(!isSolved(p, disconnected), "Separate molecules accepted");
  const path = [0, 1, 2, 3, 7, 6, 5, 9, 10, 11, 15, 14, 13, 12, 8, 4];
  const cycle = p.edges.map(([a, b]) =>
    path.some((v, i) => v === a && path[(i + 1) % 16] === b || v === b && path[(i + 1) % 16] === a)
      ? 1
      : 0
  );
  assert(isSolved(p, cycle), "Alternative connected solution rejected");
  const original = generate("atoms", "2026-09-08");
  assert(original.solution.includes(2));
  assert(isSolved(original, original.solution));
});

Deno.test("damaged saved entries recover to an editable starting board", () => {
  for (const kind of ["sudoku", "snap", "atoms"] as const) {
    const p = generate(kind, "recovery"), values = [...p.initial];
    values[0] = 999;
    const disk = {
      getItem: () =>
        JSON.stringify({
          [`recovery/${kind}`]: { values, notes: {}, elapsed: 10, completed: false },
        }),
      setItem: () => {},
    };
    assert(JSON.stringify(new ProgressStore(disk).load(p).values) === JSON.stringify(p.initial));
  }
});
