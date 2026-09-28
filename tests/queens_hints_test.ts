import { smartHint } from "../src/hints.ts";
import { type Puzzle } from "../src/puzzles.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function board(rows: string[], marks: number[] = []): Puzzle {
  return {
    kind: "queens", seed: "test", size: rows.length,
    initial: rows.flatMap((row, r) => [...row].map((_, c) => marks.includes(r * rows.length + c) ? 2 : 0)),
    regions: rows.flatMap((row) => [...row].map((letter) => letter.charCodeAt(0) - 65)),
    get solution(): number[] { throw new Error("Smart hints must not read the answer"); },
    clues: [], cages: [], links: [], edges: [],
  };
}

// Enumerate every legal completion independently of the hint implementation.
// These fixtures need not have unique solutions: deductions must hold in all of them.
function verifyDeduction(p: Puzzle) {
  const before = JSON.stringify(p.initial), hint = smartHint(p, p.initial), n = p.size;
  assert(JSON.stringify(p.initial) === before, "Hint changed player marks");
  assert(hint.values, `Expected a deduction, got ${hint.title}: ${hint.text}`);
  const changes = hint.values.flatMap((v, i) => v !== p.initial[i] ? [i] : []);
  assert(changes.length === 1 && hint.values[changes[0]] === 2, "Expected one exclusion");
  assert(hint.cells.includes(changes[0]), "Excluded square must be highlighted");
  const chosen: number[] = [];
  let completions = 0;
  function visit(r: number) {
    if (r === n) {
      completions++;
      assert(!chosen.includes(changes[0]), `Excluded a possible queen: ${hint.text}`);
      return;
    }
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      if (p.initial[i] === 2 || chosen.some((j) => j % n === c || p.regions[j] === p.regions[i]) ||
        (r > 0 && Math.abs(chosen[r - 1] % n - c) <= 1)) continue;
      chosen.push(i);
      visit(r + 1);
      chosen.pop();
    }
  }
  visit(0);
  assert(completions > 0, "Fixture must have a valid completion");
  return hint;
}

Deno.test("Queens smart hint finds an advanced deduction on the reported board", () => {
  const p = board([
    "HHFFCCCC", "HHHFFCCE", "GGHHBCEE", "GGHBBCCC",
    "GGGDBBAA", "GGDDBBAA", "GGGDAAAA", "GGGDDAAA",
  ], [4, 10, 14, 31]);
  verifyDeduction(p);
});

Deno.test("Queens hints explain region confinement and shared touching exclusions", () => {
  const confined = board(["AAAABB", "BBBBBB", "CCCCCC", "DDDDDD", "EEEEEE", "FFFFFF"]);
  const lock = verifyDeduction(confined);
  assert(lock.text.includes("row 2"), "Explain the row confined to region B");
  assert(lock.values?.[4] === 2, "Row 2 reserves region B, ruling out its row 1 squares");
  const touching = board(["AAAAAA", "BBBBBB", "CCCCCC", "DDDDDD", "EEEEEE", "FFFFFF"], [2, 3, 4, 5]);
  const adjacent = verifyDeduction(touching);
  assert(adjacent.text.includes("Every option"), "Explain why all candidates rule out the square");
  assert(adjacent.values?.[6] === 2, "Both row 1 candidates rule out the touching square");
});

Deno.test("Queens hints reserve pairs and triples across rows, columns and regions", () => {
  for (const count of [2, 3]) {
    const n = count === 2 ? 6 : 7;
    const selectedRows = [0, 2, 4].slice(0, count), selectedColumns = [0, 3, 6].slice(0, count);
    const marks = Array.from({ length: n * n }, (_, i) => i).filter((i) =>
      selectedRows.includes(Math.floor(i / n)) && !selectedColumns.includes(i % n));
    const rows = Array.from({ length: n }, (_, r) => String.fromCharCode(65 + r).repeat(n));
    for (const transpose of [false, true]) {
      const p = board(rows, marks);
      if (transpose) {
        const transposeCells = (a: number[]) => a.map((_, i) => a[i % n * n + Math.floor(i / n)]);
        p.regions = transposeCells(p.regions);
        p.initial = transposeCells(p.initial);
      }
      const hint = verifyDeduction(p);
      assert(hint.text.includes(`The ${count} queens`), `Expected a reserved ${count}-unit set: ${hint.text}`);
      assert(hint.text.includes("reserved"), "Explain the reserved rows or columns");
    }
  }
});
