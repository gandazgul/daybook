import { smartHint } from "../src/hints.ts";
import { type Puzzle } from "../src/puzzles.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function board(rows: string[], links: Puzzle["links"] = []): Puzzle {
  return {
    kind: "mambo", size: rows.length, seed: "visible-only",
    initial: rows.flatMap((row) => [...row].map(Number)), links,
    get solution(): number[] { throw new Error("Smart hints must not read the answer"); },
    regions: [], clues: [], cages: [], edges: [],
  };
}

// Independent completion search: a hinted value must be possible, and its
// opposite must have zero completions, even when a fixture has multiple answers.
function canComplete(p: Puzzle, initial: number[]) {
  const a = [...initial], n = p.size;
  function legal() {
    for (let k = 0; k < n; k++) {
      for (const line of [a.slice(k * n, (k + 1) * n), a.filter((_, i) => i % n === k)]) {
        if ([1, 2].some((v) => line.filter((w) => w === v).length > n / 2)) return false;
        for (let j = 2; j < n; j++) {
          if (line[j] && line[j] === line[j - 1] && line[j] === line[j - 2]) return false;
        }
      }
    }
    return p.links.every(({ a: i, b: j, same }) => !a[i] || !a[j] || (a[i] === a[j]) === same);
  }
  function visit(): boolean {
    if (!legal()) return false;
    const i = a.indexOf(0);
    if (i < 0) return true;
    for (const v of [1, 2]) {
      a[i] = v;
      if (visit()) { a[i] = 0; return true; }
    }
    a[i] = 0;
    return false;
  }
  return visit();
}

function verify(p: Puzzle) {
  const before = JSON.stringify(p.initial), links = JSON.stringify(p.links);
  const hint = smartHint(p, p.initial);
  assert(JSON.stringify(p.initial) === before && JSON.stringify(p.links) === links, "Hint mutated inputs");
  assert(hint.values, `Expected a deduction: ${hint.text}`);
  const changed = hint.values.flatMap((v, i) => v !== p.initial[i] ? [i] : []);
  assert(changed.length === 1 && p.initial[changed[0]] === 0, "Only fill one empty square");
  const i = changed[0], opposite = [...p.initial];
  opposite[i] = 3 - hint.values[i];
  assert(hint.cells.includes(i), "Highlight the target square");
  assert(hint.cells.every((i) => i >= 0 && i < p.size ** 2), "Highlights must be on the board");
  assert(canComplete(p, hint.values), "Suggested shape must allow a completion");
  assert(!canComplete(p, opposite), "Opposite shape must be impossible in every completion");
  return hint;
}

const screenshot = () => board([
  "120000", "102010", "201020", "201000", "122100", "200010",
], [
  { a: 0, b: 1, same: false }, { a: 0, b: 6, same: true },
  { a: 5, b: 11, same: false }, { a: 8, b: 14, same: false },
  { a: 9, b: 15, same: true }, { a: 10, b: 16, same: false },
  { a: 12, b: 18, same: true }, { a: 14, b: 20, same: true },
  { a: 21, b: 22, same: false }, { a: 20, b: 26, same: false },
  { a: 25, b: 26, same: true },
]);

Deno.test("Balance explains the whole-line deduction missed on the screenshot", () => {
  const hint = verify(screenshot());
  assert(hint.values?.[11] === 2, "Row 2 column 6 must be a diamond");
  assert(hint.text.includes("Row 2 needs 1 more circle and 2 more diamonds"), "Explain the remaining balance");
  assert(hint.text.includes("three consecutive diamonds in columns 2–4"), "Explain the specific triple forced by the wrong choice");
});

Deno.test("Balance whole-line deductions work across orientations and shape swaps", () => {
  for (const transpose of [false, true]) for (const flip of [false, true]) for (const swap of [false, true]) {
    const p = screenshot(), n = p.size;
    const index = (i: number) => {
      const r = Math.floor(i / n), c = i % n;
      const mapped = transpose ? c * n + r : i;
      return flip ? n * n - 1 - mapped : mapped;
    };
    const initial = [...p.initial];
    initial.forEach((v, i) => p.initial[index(i)] = swap && v ? 3 - v : v);
    p.links = p.links.map((link) => ({ ...link, a: index(link.a), b: index(link.b) }));
    verify(p);
  }
});

Deno.test("Balance combines linked empty pairs with line counts", () => {
  const p = board(["1000", "0000", "0000", "0000"], [{ a: 1, b: 2, same: true }]);
  const hint = verify(p);
  assert(hint.values?.[1] === 2, "The equal pair must both be diamonds");
  assert(hint.text.includes("clues"), "Mention the linked clues in the explanation");
  const different = board(["1000", "0000", "0000", "0000"], [{ a: 1, b: 2, same: false }]);
  const pair = verify(different);
  assert(pair.values?.[3] === 2, "An opposite pair reserves one of each shape, forcing the last diamond");
});

Deno.test("Balance detects a line that cannot satisfy its linked clues", () => {
  const p = board(["0000", "0000", "0000", "0000"], [
    { a: 0, b: 1, same: true }, { a: 1, b: 2, same: true },
  ]);
  const hint = smartHint(p, p.initial);
  assert(!hint.values && hint.title === "Check these entries", "Do not invent a move for an impossible line");
  assert(hint.text.includes("Row 1 cannot be completed"), "Identify the conflicting line");
});

Deno.test("Balance preserves ambiguity and allows identical completed lines", () => {
  const empty = board(["0000", "0000", "0000", "0000"]);
  const hint = smartHint(empty, empty.initial);
  assert(!hint.values && hint.title !== "Check these entries", "Do not guess on an empty board");
  // Unlike some binary puzzles, Daybook has no distinct-rows rule.
  const repeated = board(["1122", "2211", "1122", "2210"]);
  verify(repeated);
});
