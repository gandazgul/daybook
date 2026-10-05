import { generate, isSolved, KINDS, kindsForDate, type Puzzle } from "../src/puzzles.ts";
import { countMiniSudoku, sudokuUnits } from "../src/mini-sudoku.ts";
import { type GalaxyCenter, galaxyEdges, solveGalaxies, validGalaxies } from "../src/galaxies.ts";
import bank from "../src/galaxies-bank.json" with { type: "json" };
import { dailyDifficulty, DifficultyChoices, supportsDifficulty } from "../src/difficulty.ts";
import { pruneSudokuNotes } from "../src/input.ts";
import { ProgressStore } from "../src/storage.ts";
import { smartHint } from "../src/hints.ts";
function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
Deno.test("daily replacement starts October 4, keeps historical lineups and practice Sudoku", () => {
  const before = kindsForDate("2026-10-03"), after = kindsForDate("2026-10-04");
  assert(before.includes("sudoku") && !before.includes("mini") && !before.includes("galaxies"));
  assert(!after.includes("sudoku") && after.includes("mini") && after.includes("galaxies"));
  assert(after.length === before.length + 2 && KINDS.includes("sudoku"));
  assert(!supportsDifficulty("mini") && dailyDifficulty("galaxies", "2026-10-04") === "medium");
  assert(generate("sudoku", "practice:unchanged", "easy").size === 9);
});
Deno.test("Mini Sudoku has at most ten clues, 2 by 3 boxes and one solution across a year", () => {
  const signatures = new Set<string>();
  for (let day = 0; day < 365; day++) {
    const seed = new Date(Date.UTC(2027, 0, 1 + day)).toISOString().slice(0, 10);
    const p = generate("mini", seed);
    assert(p.size === 6 && !p.difficulty && p.initial.filter(Boolean).length <= 10);
    assert(countMiniSudoku(p.initial) === 1 && isSolved(p, p.solution) && !isSolved(p, p.initial));
    assert(sudokuUnits(6).every((u) => new Set(u.map((i) => p.solution[i])).size === 6));
    signatures.add(JSON.stringify(p.initial));
  }
  assert(signatures.size === 365);
  assert(countMiniSudoku(Array(36).fill(0)) === 2);
  assert(countMiniSudoku(Array(36).fill(7)) === 0);
});
Deno.test("Mini Sudoku notes prune rectangular box peers and preserve unrelated cells", () => {
  const a = Array(36).fill(0);
  a[0] = 4;
  const notes = { 0: [1, 4], 1: [2, 4], 6: [3, 4], 8: [4, 6], 15: [4, 5] };
  const result = pruneSudokuNotes(a, notes, [], 6);
  assert(JSON.stringify(result) === JSON.stringify({ 1: [2], 6: [3], 8: [6], 15: [4, 5] }));
  assert(notes[8].includes(4));
});
Deno.test("all Galaxies bank boards are unique and rated by visible symmetry deductions", () => {
  for (const level of ["easy", "medium", "hard"] as const) {
    const n = level === "easy" ? 5 : 7;
    assert(bank[level].length === 24);
    for (const template of bank[level]) {
      const centers = template.centers as GalaxyCenter[], edges = galaxyEdges(n);
      const walls = edges.map(([a, b]) => template.labels[a] === template.labels[b] ? 0 : 1);
      assert(validGalaxies(centers, edges, walls, n));
      const result = solveGalaxies(centers, n);
      assert(!result.exhausted && result.solutions.length === 1);
      assert(result.domains.some((d) => d.length > 1) === (level !== "medium"));
      assert(JSON.stringify(result.solutions[0]) === JSON.stringify(template.labels));
    }
    for (let day = 0; day < 100; day++) {
      const p = generate("galaxies", `practice:transforms-${day}`, level);
      assert(p.size === n && p.difficulty === level && isSolved(p, p.solution));
      assert(!isSolved(p, p.initial));
      const solved = solveGalaxies(p.centers!, n);
      assert(!solved.exhausted && solved.solutions.length === 1);
      const hint = smartHint(p, p.initial);
      if (hint.values) hint.values.forEach((v, i) => assert(!v || p.solution[i] === v));
    }
  }
});
Deno.test("Galaxies rejects split centers, dangling cuts, asymmetry and missing circles", () => {
  const n = 3, edges = galaxyEdges(n), centers: GalaxyCenter[] = [[2, 2]];
  const empty = edges.map(() => 0);
  assert(validGalaxies(centers, edges, empty, n));
  const cut = [...empty];
  cut[0] = 1;
  assert(!validGalaxies(centers, edges, cut, n), "a cut inside a connected galaxy is illegal");
  assert(!validGalaxies([], edges, empty, n));
  assert(!validGalaxies([[1, 1]], edges, empty, n));
  const p = generate("galaxies", "practice:split-center", "medium");
  for (let e = 0; e < p.edges.length; e++) {
    const changed = [...p.solution];
    changed[e] = 1 - changed[e];
    assert(!isSolved(p, changed), `accepted changed boundary ${e}`);
  }
});
Deno.test("Galaxies solver agrees with exhaustive small-board boundary enumeration", () => {
  const n = 3, edges = galaxyEdges(n);
  for (
    const centers of [[[2, 2]], [[0, 2], [3, 2]], [[0, 0], [2, 2], [4, 4]], [
      [1, 1],
      [4, 0],
      [4, 3],
      [1, 4],
    ]] as GalaxyCenter[][]
  ) {
    let count = 0;
    for (let mask = 0; mask < 1 << edges.length; mask++) {
      if (validGalaxies(centers, edges, edges.map((_, e) => mask >> e & 1), n)) count++;
    }
    const result = solveGalaxies(centers, n, [], 100);
    assert(
      !result.exhausted && result.solutions.length === count,
      `${JSON.stringify(centers)} ${count}`,
    );
  }
});
Deno.test("new games persist independent progress and all Galaxies levels share daily credit", () => {
  const records = new Map<string, string>();
  const disk = {
    getItem: (k: string) => records.get(k) ?? null,
    setItem: (k: string, v: string) => {
      records.set(k, v);
    },
  };
  const store = new ProgressStore(disk), choices = new DifficultyChoices(disk);
  assert(choices.get("galaxies", "2026-10-04") === "medium");
  for (
    const p of [
      generate("mini", "2026-10-04"),
      ...["easy", "medium", "hard"].map((d) =>
        generate("galaxies", "2026-10-04", d as Puzzle["difficulty"])
      ),
    ]
  ) {
    const state = store.load(p);
    state.values = [...p.solution];
    state.completed = true;
    state.elapsed = 42;
    store.save(p.seed, p.kind, state, p.difficulty);
    assert(
      new ProgressStore(disk).load(p).completed && new ProgressStore(disk).load(p).elapsed === 42,
    );
  }
  assert(store.count("2026-10-04") === 2);
  const mini = generate("mini", "2026-10-04"), bad = store.load(mini);
  bad.values[mini.initial.findIndex((v) => !v)] = 7;
  store.save(mini.seed, mini.kind, bad);
  assert(!store.load(mini).completed && store.load(mini).values.every((v) => v <= 6));
});
