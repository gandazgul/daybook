import { generate, isSolved, kindsForDate } from "../src/puzzles.ts";
import { dailyDifficulty, DifficultyChoices } from "../src/difficulty.ts";
import { BattleshipsInput } from "../src/input.ts";
import {
  deduceBattleships,
  type FleetClues,
  shipParts,
  solveBattleships,
  validBattleships,
} from "../src/battleships.ts";
import bank from "../src/battleships-bank.json" with { type: "json" };
import { ProgressStore } from "../src/storage.ts";
import { smartHint } from "../src/hints.ts";
function assert(v: unknown, message = "Assertion failed"): asserts v {
  if (!v) throw new Error(message);
}
Deno.test("Battleships makes fourteen daily games from October 4, with Medium default", () => {
  assert(
    kindsForDate("2026-10-04").length === 14 && kindsForDate("2026-10-04").includes("battleships"),
  );
  assert(
    kindsForDate("2026-10-03").length === 12 && !kindsForDate("2026-10-03").includes("battleships"),
  );
  assert(dailyDifficulty("battleships", "2026-10-04") === "medium");
  assert(
    new DifficultyChoices({ getItem: () => null, setItem: () => {} }).get(
      "battleships",
      "2026-10-04",
    ) === "medium",
  );
});
Deno.test("Battleships boards keep a unique solution, clue shapes, fleet and difficulty under transformations", () => {
  for (const level of ["easy", "medium", "hard"] as const) {
    assert(bank[level].length === 24);
    for (let i = 0; i < 150; i++) {
      const p = generate("battleships", `practice:battleships-${i}`, level), n = p.size;
      assert(n === (level === "hard" ? 8 : 6));
      assert(isSolved(p, p.solution) && !isSolved(p, p.initial));
      const result = solveBattleships(p.fleet!, p.initial, n);
      assert(!result.exhausted && result.solutions.length === 1);
      assert(JSON.stringify(result.solutions[0]) === JSON.stringify(p.solution));
      const local = deduceBattleships(p.fleet!, p.initial, n);
      assert(!local.conflict && local.values.includes(0) === (level !== "easy"));
      local.values.forEach((v, j) => assert(!v || v === p.solution[j]));
      const sparse = p.solution.map((v, j) => v === 2 && !p.initial[j] ? 0 : v);
      assert(isSolved(p, sparse), "water marking is optional");
      const wrong = [...p.solution], fixed = p.initial.findIndex(Boolean);
      if (fixed >= 0) {
        wrong[fixed] = 0;
        assert(!isSolved(p, wrong));
      }
    }
  }
});
Deno.test("Battleships solver matches independently enumerated small fleets", () => {
  const rows = [2, 0, 1, 0], columns = [1, 1, 0, 1];
  const data: FleetClues = { rows, columns, fleet: [2, 1], parts: Array(16).fill("") };
  // Independently place a length-two ship and a non-touching submarine, then compare totals.
  const expected = new Set<string>();
  for (let start = 0; start < 16; start++) {
    for (const step of [1, 4]) {
      const end = start + step;
      if (end >= 16 || step === 1 && Math.floor(start / 4) !== Math.floor(end / 4)) continue;
      for (let single = 0; single < 16; single++) {
        if (
          [start, end].some((i) =>
            Math.abs(i % 4 - single % 4) <= 1 &&
            Math.abs(Math.floor(i / 4) - Math.floor(single / 4)) <= 1
          )
        ) continue;
        const cells = [start, end, single];
        if (
          rows.every((v, r) => cells.filter((i) => Math.floor(i / 4) === r).length === v) &&
          columns.every((v, c) => cells.filter((i) => i % 4 === c).length === v)
        ) expected.add(Array.from({ length: 16 }, (_, i) => cells.includes(i) ? 1 : 2).join());
      }
    }
  }
  const result = solveBattleships(data, Array(16).fill(0), 4, 100);
  assert(!result.exhausted && result.solutions.length === expected.size && expected.size > 0);
  result.solutions.forEach((a) => assert(expected.has(a.join())));
  const a = result.solutions[0], parts = shipParts(a, 4);
  const end = parts.findIndex((p) => p === "left" || p === "top");
  data.parts[end] = parts[end] === "left" ? "right" : "bottom";
  assert(!validBattleships(data, a, 4));
});
Deno.test("Battleships rejects touching, bent and wrong fleets without relying on the answer", () => {
  const n = 4;
  for (const cells of [[0, 1, 5], [0, 5], [0, 1, 2]]) {
    const values = Array.from({ length: 16 }, (_, i) => cells.includes(i) ? 1 : 2);
    const data: FleetClues = {
      rows: Array.from(
        { length: n },
        (_, r) => cells.filter((i) => Math.floor(i / n) === r).length,
      ),
      columns: Array.from({ length: n }, (_, c) => cells.filter((i) => i % n === c).length),
      fleet: cells.length === 2 ? [1, 1] : [2, 1],
      parts: Array(16).fill(""),
    };
    assert(!validBattleships(data, values, n));
  }
});
Deno.test("Battleships taps, water taps and double taps place the expected marks and merge undo", () => {
  const g = new BattleshipsInput(), a = Array(36).fill(0), fixed = Array(36).fill(0);
  g.begin(0);
  let edit = g.end(0, a, fixed, 1000);
  assert(edit.marks[0].value === 2 && !edit.mergeUndo);
  a[0] = 2;
  g.begin(0);
  edit = g.end(0, a, fixed, 1100);
  assert(edit.marks[0].value === 1 && edit.mergeUndo);
  a[0] = 1;
  g.begin(0);
  edit = g.end(0, a, fixed, 2000);
  assert(edit.marks[0].value === 0 && !edit.mergeUndo);
  a[1] = 2;
  g.begin(1);
  edit = g.end(1, a, fixed, 3000);
  assert(edit.marks[0].value === 1 && !edit.mergeUndo);
  a[1] = 1;
  g.begin(1);
  edit = g.end(1, a, fixed, 3100);
  assert(edit.marks[0].value === 1 && edit.mergeUndo, "double tap on water must leave a ship");
  fixed[2] = 1;
  g.begin(2);
  assert(!g.end(2, a, fixed, 4000).marks.length);
});
Deno.test("Battleships drags paint water, preserve ships and clues, interpolate and do not turn into taps", () => {
  const g = new BattleshipsInput(), a = Array(36).fill(0), fixed = Array(36).fill(0);
  a[1] = 1;
  fixed[2] = a[2] = 2;
  g.begin(0);
  const first = g.move(5, a, fixed, 6);
  assert(first.map((m) => m.index).join() === "0,3,4,5");
  first.forEach(({ index, value }) => a[index] = value);
  assert(!g.move(0, a, fixed, 6).length);
  assert(!g.end(0, a, fixed, 100).marks.length);
  assert(a[1] === 1 && a[2] === 2);
  g.begin(7);
  g.reset();
  assert(!g.end(7, a, fixed, 200).marks.length, "cancelled gesture became a tap");
  g.begin(7);
  assert(!g.end(-1, a, fixed, 300).marks.length, "outside release became a tap");
});
Deno.test("Battleships stores each level independently, awards one credit and hints use visible clues", () => {
  const records = new Map<string, string>(),
    disk = {
      getItem: (k: string) => records.get(k) ?? null,
      setItem: (k: string, v: string) => {
        records.set(k, v);
      },
    };
  const store = new ProgressStore(disk);
  for (const level of ["easy", "medium", "hard"] as const) {
    const p = generate("battleships", "2026-10-04", level),
      state = store.load(p),
      answer = [...p.solution];
    Object.defineProperty(p, "solution", {
      get() {
        throw new Error("hidden answer");
      },
      configurable: true,
    });
    const hint = smartHint(p, state.values);
    assert(hint.values, "missing usable hint");
    hint.values.forEach((v, i) => assert(!v || v === answer[i]));
    Object.defineProperty(p, "solution", { value: answer, writable: true });
    state.values = answer;
    state.completed = true;
    state.elapsed = 90;
    store.save(p.seed, p.kind, state, p.difficulty);
    const resumed = new ProgressStore(disk).load(p);
    assert(resumed.completed && resumed.elapsed === 90);
  }
  assert(store.count("2026-10-04") === 1);
});
