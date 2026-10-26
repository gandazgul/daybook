import { autoWater, battleshipsConflict, battleshipsFixed } from "../src/battleships-assist.ts";
import { deduceBattleships, type FleetClues, solveBattleships } from "../src/battleships.ts";
import { smartHint } from "../src/hints.ts";
import { generate, isSolved } from "../src/puzzles.ts";
import { ProgressStore } from "../src/storage.ts";

function assert(v: unknown, message = "Assertion failed"): asserts v {
  if (!v) throw new Error(message);
}
const blank = () => Array(36).fill(0);
const clues = (): FleetClues => ({
  rows: [3, 3, 3, 3, 3, 3],
  columns: [3, 3, 3, 3, 3, 3],
  fleet: [3, 2, 1],
  parts: Array(36).fill(""),
});

Deno.test("Battleships zero lines start fixed without modifying published clues or entries", () => {
  const data = clues(), initial = blank();
  data.rows[2] = data.columns[5] = 0;
  const fixed = battleshipsFixed(data, initial, 6), state = autoWater(data, initial, initial, 6);
  for (let i = 0; i < 36; i++) {
    assert(state.values[i] === (Math.floor(i / 6) === 2 || i % 6 === 5 ? 2 : 0));
  }
  assert(initial.every((v) => v === 0) && fixed.filter(Boolean).length === 11);
  assert(state.autoWater.length === 0, "zero lines must not disappear when a ship changes");
});

Deno.test("Battleships fills completed rows and columns without overwriting existing marks", () => {
  const data = clues(), a = blank();
  data.rows[0] = 2;
  data.columns[0] = 1;
  a[0] = a[1] = 1;
  a[30] = 2;
  const state = autoWater(data, blank(), a, 6);
  assert([2, 3, 4, 5, 6, 12, 18, 24, 30].every((i) => state.values[i] === 2));
  assert(state.values[0] === 1 && state.values[1] === 1 && a[2] === 0);
  assert(!state.autoWater.includes(30), "manual water must remain manual");
  a[2] = 1;
  assert(autoWater(data, blank(), a, 6).values[2] === 1, "a conflicting ship must stay editable");
});

Deno.test("Battleships water follows ship geometry without sealing unfinished ends", () => {
  const data = clues(), a = blank();
  a[14] = a[15] = 1;
  let state = autoWater(data, blank(), a, 6);
  assert([7, 8, 9, 10, 19, 20, 21, 22].every((i) => state.values[i] === 2));
  assert(state.values[13] === 0 && state.values[16] === 0);
  a[16] = 1;
  state = autoWater(data, blank(), a, 6);
  assert(state.values[13] === 2 && state.values[17] === 2, "maximum length ship closes its ends");
  const edge = blank();
  edge[5] = 1;
  state = autoWater(data, blank(), edge, 6);
  assert(state.values[10] === 2 && state.values[6] === 0, "diagonals must not wrap rows");
  data.parts[14] = "left";
  const end = blank();
  end[14] = 1;
  state = autoWater(data, end, end, 6);
  assert(
    [13, 8, 20].every((i) => state.values[i] === 2) && state.values[15] === 0,
    "auto water must never place a ship",
  );
  data.parts[14] = "single";
  state = autoWater(data, end, end, 6);
  assert([7, 8, 9, 13, 15, 19, 20, 21].every((i) => state.values[i] === 2));
});

Deno.test("Battleships removes stale derived water and preserves manual water across saves", () => {
  const data = clues(), a = blank();
  a[14] = 1;
  a[35] = 2;
  const before = autoWater(data, blank(), a, 6);
  const removed = [...before.values];
  removed[14] = 0;
  const after = autoWater(data, blank(), removed, 6, before.autoWater);
  assert(after.values.filter(Boolean).length === 1 && after.values[35] === 2);
  const again = autoWater(data, blank(), before.values, 6, before.autoWater);
  assert(JSON.stringify(before) === JSON.stringify(again), "recomputation must be stable");
  const records = new Map<string, string>();
  const disk = {
    getItem: (k: string) => records.get(k) ?? null,
    setItem: (k: string, v: string) => {
      records.set(k, v);
    },
  };
  const p = generate("battleships", "2026-10-26", "medium");
  const store = new ProgressStore(disk), state = store.load(p);
  store.save(p.seed, p.kind, state, p.difficulty);
  assert(JSON.stringify(new ProgressStore(disk).load(p)) === JSON.stringify(state));
});

Deno.test("Battleships hints isolate excess counts, blocked totals, diagonal contact and clue conflicts", () => {
  const data = clues(), a = blank();
  data.rows[0] = 1;
  a[0] = a[2] = 1;
  let hint = battleshipsConflict(data, a, 6)!;
  assert(hint.text.includes("Row 1 needs 1") && hint.cells.join() === "0,1,2,3,4,5");
  a.fill(0);
  a.fill(2, 0, 6);
  hint = battleshipsConflict(data, a, 6)!;
  assert(hint.text.includes("only 0 spaces") && hint.cells.length === 6);
  a.fill(0);
  a[14] = a[21] = 1;
  hint = battleshipsConflict(data, a, 6)!;
  assert(hint.text.includes("touch diagonally") && hint.cells.join() === "14,21");
  a[21] = 0;
  a[15] = 2;
  data.parts[14] = "left";
  hint = battleshipsConflict(data, a, 6)!;
  assert(hint.text.includes("flat side") && hint.cells.join() === "14,15");
  data.parts[14] = "middle";
  a[8] = 2;
  hint = battleshipsConflict(data, a, 6)!;
  assert(hint.text.includes("two opposite sides") && hint.cells.length === 5);
});

Deno.test("Battleships conflict hints include the ships responsible for automatic water", () => {
  const p = generate("battleships", "practice:auto-conflict", "medium");
  p.size = 6;
  p.initial = blank();
  p.fleet = clues();
  p.fleet.rows[0] = 1;
  p.fleet.rows[1] = 6;
  const a = blank();
  a[2] = 1;
  const state = autoWater(p.fleet, p.initial, a, 6);
  const hint = smartHint(p, state.values, state.autoWater);
  assert(hint.conflict && !hint.values && hint.cells.includes(2));
  assert(hint.text.includes("automatically") && hint.cells.length < 36);
});

Deno.test("Battleships advanced hints explain fleet placement and short contradictions", () => {
  for (const [seed, phrase] of [[3, "Only this position fits"], [0, "If row"]] as const) {
    const p = generate("battleships", `practice:assist-${seed}`, "medium");
    const a = deduceBattleships(p.fleet!, p.initial, p.size).values;
    const hint = smartHint(p, a);
    assert(hint.values && hint.text.includes(phrase), hint.text);
    const index = hint.values.findIndex((v, i) => v !== a[i]);
    const opposite = [...a];
    opposite[index] = hint.values[index] === 1 ? 2 : 1;
    const proof = solveBattleships(p.fleet!, opposite, p.size);
    assert(!proof.exhausted && proof.solutions.length === 0, "hint must be logically forced");
  }
});

Deno.test("Battleships automatic water and repeated hints solve varied boards without reading answers", () => {
  for (const level of ["easy", "medium", "hard"] as const) {
    for (let seed = 0; seed < 24; seed++) {
      const p = generate("battleships", `practice:assist-proof-${seed}`, level),
        answer = [...p.solution];
      Object.defineProperty(p, "solution", {
        get() {
          throw new Error("Hidden answer accessed");
        },
      });
      let state = autoWater(p.fleet!, p.initial, p.initial, p.size);
      for (let step = 0; step < p.size ** 2 && !isSolved(p, state.values); step++) {
        state.values.forEach((v, i) =>
          assert(!v || v === answer[i], `${level}/${seed}: incorrect automatic water at ${i}`)
        );
        const hint = smartHint(p, state.values, state.autoWater);
        assert(hint.values && !hint.conflict, `${level}/${seed}: ${hint.text}`);
        hint.values.forEach((v, i) =>
          assert(!v || v === answer[i], `${level}/${seed}: incorrect hint at ${i}: ${hint.text}`)
        );
        assert(hint.values.some((v, i) => v !== state.values[i]), "hint must make progress");
        state = autoWater(p.fleet!, p.initial, hint.values, p.size, state.autoWater);
      }
      assert(isSolved(p, state.values), `${level}/${seed}: could not finish`);
    }
  }
});
