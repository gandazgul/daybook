import { generate, isSolved, kindsForDate } from "../src/puzzles.ts";
import { dailyDifficulty, DifficultyChoices } from "../src/difficulty.ts";
import { BattleshipsInput } from "../src/input.ts";
import {
  deduceBattleships,
  fleetInventory,
  type FleetClues,
  shipLineStatus,
  shipParts,
  touchingShipCells,
  solveBattleships,
  validBattleships,
} from "../src/battleships.ts";
import bank from "../src/battleships-bank.json" with { type: "json" };
import { ProgressStore } from "../src/storage.ts";
import { smartHint } from "../src/hints.ts";
function assert(v: unknown, message = "Assertion failed"): asserts v {
  if (!v) throw new Error(message);
}
Deno.test("Battleships highlights both touching pieces, not the rest of their ships", () => {
  const cells = [0, 6, 9, 10, 18, 20, 24, 27, 29, 30];
  const values = Array.from({ length: 36 }, (_, i) => cells.includes(i) ? 1 : 2);
  assert([...touchingShipCells(values, 6)].join() === "20,27", "October 4 screenshot conflict");
  values[27] = 2;
  assert(touchingShipCells(values, 6).size === 0, "clearing the contact must clear both warnings");
  const joined = Array(36).fill(0);
  for (const i of [0, 1, 2, 8]) joined[i] = 1;
  assert([...touchingShipCells(joined, 6)].join() === "1,8");
  const edges = Array(36).fill(0);
  edges[5] = edges[6] = 1;
  assert(touchingShipCells(edges, 6).size === 0, "row edges do not wrap");
});
Deno.test("Battleships inventory tracks placed, missing, excess and joined ships", () => {
  const data: FleetClues = { rows: [], columns: [], fleet: [3, 2, 1], parts: Array(36).fill("") };
  const values = Array(36).fill(0);
  const count = (length: number) => fleetInventory(data, values, 6).find((v) => v.length === length)!;
  assert(count(3).placed === 0 && count(3).required === 1);
  for (const i of [0, 1, 2, 12, 13, 24, 26]) values[i] = 1;
  assert(count(3).placed === 1 && count(2).placed === 1 && count(1).placed === 2);
  values[25] = 1;
  assert(count(1).placed === 0 && count(3).placed === 2, "joining pieces must update lengths");
  values[3] = 1;
  assert(count(4).placed === 1 && count(4).required === 0, "unexpected lengths must show excess");
  values.fill(2);
  assert(fleetInventory(data, values, 6).every((v) => v.placed === 0));
});
Deno.test("Battleships inventory excludes bent, touching and unfinished fixed ship clues", () => {
  const data: FleetClues = { rows: [], columns: [], fleet: [3, 2, 1], parts: Array(36).fill("") };
  for (const cells of [[0, 1, 7], [0, 7]]) {
    const values = Array.from({ length: 36 }, (_, i) => cells.includes(i) ? 1 : 0);
    assert(fleetInventory(data, values, 6).every((v) => v.placed === 0));
  }
  const values = Array(36).fill(0);
  values[0] = 1;
  data.parts[0] = "left";
  assert(fleetInventory(data, values, 6).every((v) => v.placed === 0));
  values[1] = 1;
  assert(fleetInventory(data, values, 6).find((v) => v.length === 2)!.placed === 1);
});
Deno.test("Battleships edge totals flag excess ships and water blocking the required total", () => {
  assert(shipLineStatus([1, 1, 0, 2], 1) === "error");
  assert(shipLineStatus([1, 2, 2, 2], 2) === "error");
  assert(shipLineStatus([1, 0, 2, 2], 2) === "missing");
  assert(shipLineStatus([1, 1, 0, 2], 2) === "complete");
  assert(shipLineStatus([0, 0, 2, 2], 0) === "complete");
});
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
Deno.test("Battleships water-start drags erase water throughout the stroke and preserve ships and clues", () => {
  const g = new BattleshipsInput(), a = Array(36).fill(0), fixed = Array(36).fill(0);
  for (const i of [0, 1, 3, 5, 11]) a[i] = 2;
  a[2] = 1;
  fixed[3] = 2;
  fixed[4] = a[4] = 1;
  g.begin(0);
  const first = g.move(5, a, fixed, 6);
  assert(first.map((m) => m.index).join() === "0,1,5");
  assert(first.every((m) => m.value === 0));
  first.forEach(({ index, value }) => a[index] = value);
  const next = g.move(11, a, fixed, 6);
  assert(next.length === 1 && next[0].index === 11 && next[0].value === 0);
  next.forEach(({ index, value }) => a[index] = value);
  assert(!g.move(0, a, fixed, 6).length, "backtracking must not repaint water");
  assert(!g.end(0, a, fixed, 100).marks.length, "erasing must not become a ship tap");
  assert(a[2] === 1 && a[3] === 2 && a[4] === 1);
  g.begin(0);
  assert(g.move(1, a, fixed, 6).every((m) => m.value === 2), "new blank-start stroke paints");
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
