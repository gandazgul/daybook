import { revealHint, smartHint } from "../src/hints.ts";
import { generate, isSolved, KINDS, type Puzzle, Random } from "../src/puzzles.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function partial(p: Puzzle, rng: Random, density: number) {
  if (p.kind === "snap") {
    return p.solution.slice(0, Math.max(1, Math.floor(p.solution.length * density)));
  }
  if (p.kind === "shikaku") {
    const selected = new Set([...new Set(p.solution)].filter(() => rng.next() < density));
    return p.solution.map((v) => selected.has(v) ? v + 100 : 0);
  }
  return p.initial.map((v, i) => rng.next() < density ? p.solution[i] : v);
}
Deno.test("Reveals progress all daily and practice games to valid completion without mutating inputs", () => {
  for (const kind of KINDS) {
    for (const seed of ["2026-09-09", "practice:hint"]) {
      const p = generate(kind, seed), original = JSON.stringify(p);
      let values = [...p.initial];
      for (let step = 0; !isSolved(p, values) && step < 100; step++) {
        const before = JSON.stringify(values), hint = revealHint(p, values);
        assert(
          JSON.stringify(values) === before && JSON.stringify(p) === original,
          `${kind}: mutated input`,
        );
        assert(
          hint.values && JSON.stringify(hint.values) !== before,
          `${kind}: reveal must make progress`,
        );
        assert(hint.cells.every((i) => i >= 0 && i < p.size ** 2), `${kind}: invalid highlight`);
        values = hint.values;
      }
      assert(isSolved(p, values), `${kind}: reveals did not complete the board`);
    }
  }
});
Deno.test("Smart hints use only visible information and their moves agree with valid completions", () => {
  const exercised = new Set<string>();
  for (const kind of KINDS) {
    for (const seed of ["2026-09-09", "2026-09-10", "practice:logical-hint"]) {
      const puzzle = generate(kind, seed), answer = [...puzzle.solution], rng = new Random(seed);
      for (const density of [0, .2, .5, .8, .95]) {
        const values = partial(puzzle, rng, density), before = JSON.stringify(values);
        if (isSolved(puzzle, values)) {
          continue;
        }
        const visible = { ...puzzle };
        Object.defineProperty(visible, "solution", {
          get() {
            throw new Error("Smart hints cannot read solutions");
          },
        });
        const hint = smartHint(visible, values);
        assert(JSON.stringify(values) === before, `${kind}: smart hint mutated input`);
        assert(
          hint.cells.every((i) => i >= 0 && i < puzzle.size ** 2),
          `${kind}: invalid highlight`,
        );
        if (!hint.values) {
          assert(
            hint.title !== "Check these entries",
            `${kind}: rejected a valid partial board: ${hint.text}`,
          );
          continue;
        }
        exercised.add(kind);
        assert(hint.text.length > 30, `${kind}: missing explanation`);
        assert(JSON.stringify(hint.values) !== before, `${kind}: hint must change something`);
        if (kind === "shikaku") {
          const complete = [...hint.values];
          const id = Math.max(...complete) + 1;
          complete.forEach((v, i) => {
            if (!v) complete[i] = answer[i] + id;
          });
          assert(isSolved(puzzle, complete), `${kind}: rectangle hint conflicts with completion`);
        } else if (kind === "snap") {
          assert(hint.values.every((v, i) => v === answer[i]), `${kind}: wrong next step`);
        } else {
          hint.values.forEach((v, i) => {
            if (v === values[i]) return;
            const same = v === answer[i] || ((kind === "queens" || kind === "akari") && v === 2 && answer[i] === 0);
            assert(
              same,
              `${kind}: deduction at ${i} (${v}) contradicts valid solution (${
                answer[i]
              }): ${hint.text}`,
            );
          });
        }
      }
    }
  }
  assert(
    exercised.size === KINDS.length,
    `Missing deduction coverage: ${KINDS.filter((k) => !exercised.has(k)).join(", ")}`,
  );
});
Deno.test("Mosaic deductions handle satisfied, all-needed, overlapping and impossible clues", () => {
  const p: Puzzle = {
    kind: "mosaic",
    size: 3,
    seed: "test",
    initial: Array(9).fill(0),
    solution: [],
    clues: [1, -1, -1, -1, -1, -1, -1, -1, -1],
    cages: [],
    regions: [],
    edges: [],
    links: [],
  };
  let a = [1, 0, 0, 0, 0, 0, 0, 0, 0];
  assert(smartHint(p, a).values?.[1] === 2, "Satisfied clue must rule out shading");
  p.clues[0] = 4;
  assert(smartHint(p, a).values?.[1] === 1, "Remaining cells must all be shaded");
  p.clues = [1, 1, -1, -1, -1, -1, -1, -1, -1];
  a = Array(9).fill(0);
  assert(smartHint(p, a).values?.[2] === 2, "Equal overlapping clues rule out the extra squares");
  p.clues[0] = 0;
  a[0] = 1;
  assert(
    !smartHint(p, a).values && smartHint(p, a).title === "Check these entries",
    "Contradiction must not propose a move",
  );
});
Deno.test("Smart hints identify conflicts and honestly report positions without a known deduction", () => {
  const p = generate("sudoku", "2026-09-09"), a = [...p.initial];
  a[0] = a[1] = 9;
  assert(
    !smartHint(p, a).values && smartHint(p, a).title === "Check these entries",
    "Repeated digits require correction",
  );
  const q = generate("queens", "2026-09-09"), marks = [...q.initial];
  marks[0] = marks[1] = 1;
  assert(!smartHint(q, marks).values, "Attacking queens must not receive a placement");
  const empty: Puzzle = { ...p, initial: Array(81).fill(0), solution: [] };
  assert(
    smartHint(empty, empty.initial).title === "No simple deduction found",
    "Do not invent logical explanations",
  );
});
Deno.test("Reveals explicitly preview path backtracking and rectangle replacement", () => {
  const p = generate("snap", "practice:reveal-correction");
  const a = [...p.solution];
  [a[1], a[2]] = [a[2], a[1]];
  const hint = revealHint(p, a);
  assert(
    hint.values?.length === 2 && hint.text.includes("returns the path"),
    "Backtracking must be explained before applying",
  );
  const q = generate("shikaku", "practice:reveal-correction"), filled = Array(q.size ** 2).fill(42);
  const rectangle = revealHint(q, filled);
  assert(
    rectangle.values?.includes(0) && rectangle.text.includes("replaces"),
    "Overlapping rectangles must be explained before applying",
  );
});
