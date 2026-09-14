import { cyclePaintCells, gridLine, pruneSudokuNotes, QueensInput } from "../src/input.ts";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function apply(values: number[], marks: { index: number; value: number }[]) {
  marks.forEach(({ index, value }) => values[index] = value);
}

Deno.test("Sudoku entries remove conflicting row, column and box notes, preserving other candidates", () => {
  const values = Array(81).fill(0);
  values[0] = 5;
  const notes = { 0: [1, 5], 8: [5, 7], 72: [5], 10: [2, 5], 40: [5, 9] };
  equal(pruneSudokuNotes(values, notes), { 8: [7], 10: [2], 40: [5, 9] });
  equal(notes, { 0: [1, 5], 8: [5, 7], 72: [5], 10: [2, 5], 40: [5, 9] });
  equal(values[0], 5);
});

Deno.test("Killer notes also respect cage peers outside the same row, column or box", () => {
  const values = Array(81).fill(0);
  values[20] = 5;
  const notes = { 21: [5, 6], 30: [5, 7], 80: [5, 9] };
  const cages = [{ cells: [20, 21, 30], sum: 15 }, { cells: [79, 80], sum: 10 }];
  equal(pruneSudokuNotes(values, notes, cages), { 21: [6], 30: [7], 80: [5, 9] });
  equal(pruneSudokuNotes(values, notes), { 21: [6], 30: [5, 7], 80: [5, 9] });
});

Deno.test("Queens single taps mark/clear; a double tap places a queen and merges undo", () => {
  const input = new QueensInput(), values = [0, 0];
  const first = input.begin(0, values, 0);
  equal(first.mergeUndo, false);
  apply(values, first.marks);
  equal(values, [2, 0]);
  input.end(0, 40);
  const second = input.begin(0, values, 180);
  equal(second.mergeUndo, true);
  apply(values, second.marks);
  equal(values, [1, 0]);
  input.end(0, 220);
  apply(values, input.begin(0, values, 700).marks);
  equal(values, [0, 0]);
  input.end(0, 730);
  apply(values, input.begin(1, values, 1200).marks);
  input.end(1, 1230);
  apply(values, input.begin(1, values, 1700).marks);
  equal(values, [0, 0]);
});

Deno.test("Queens rapid taps on different cells and expired taps never create a queen", () => {
  const input = new QueensInput(), values = [0, 0];
  apply(values, input.begin(0, values, 0).marks);
  input.end(0, 30);
  const other = input.begin(1, values, 100);
  equal(other.mergeUndo, false);
  apply(values, other.marks);
  input.end(1, 130);
  equal(values, [2, 2]);
  const late = input.begin(1, values, 451);
  equal(late.mergeUndo, false);
  apply(values, late.marks);
  equal(values, [2, 0]);
});

Deno.test("Queens fast drags toggle mixed cells once, preserve queens and ignore revisits", () => {
  const input = new QueensInput(), values = Array(36).fill(0);
  values[2] = 1;
  values[1] = values[4] = 2;
  apply(values, input.begin(0, values, 0).marks);
  apply(values, input.move(5, values, 6));
  equal(values.slice(0, 6), [2, 0, 1, 2, 0, 2]);
  equal(input.move(0, values, 6), []);
  input.end(0, 90);
  equal(input.begin(0, values, 180).mergeUndo, false);
});

Deno.test("Queens drags clear a starting X, restore a starting queen and toggle again on a new stroke", () => {
  for (const initial of [1, 2]) {
    const input = new QueensInput(), values = Array(36).fill(0);
    values[0] = initial;
    values[6] = 2;
    apply(values, input.begin(0, values, 0).marks);
    equal(values[0], 0);
    apply(values, input.move(12, values, 6));
    equal([values[0], values[6], values[12]], [initial === 1 ? 1 : 0, 0, 2]);
    equal(input.move(0, values, 6), []);
    input.end(0, 100);
    apply(values, input.begin(0, values, 150).marks);
    apply(values, input.move(12, values, 6));
    equal([values[0], values[6], values[12]], [initial, 2, 0]);
  }
});

Deno.test("Queens cancelled gestures, long presses and outside releases cannot become double taps", () => {
  for (const end of ["reset", "outside", "long"]) {
    const input = new QueensInput(), values = [0];
    apply(values, input.begin(0, values, 0).marks);
    if (end === "reset") {
      input.end(0, 20);
      input.reset();
    }
    if (end === "outside") input.end(-1, 20);
    if (end === "long") input.end(0, 500);
    const next = input.begin(0, values, end === "long" ? 550 : 100);
    equal(next.mergeUndo, false);
    equal(next.marks, [{ index: 0, value: 0 }]);
  }
});

Deno.test("Queens double-tap followed by movement does not paint unintended Xs", () => {
  const input = new QueensInput(), values = Array(36).fill(0);
  apply(values, input.begin(0, values, 0).marks);
  input.end(0, 20);
  apply(values, input.begin(0, values, 100).marks);
  equal(input.move(5, values, 6), []);
  equal(values.slice(0, 6), [1, 0, 0, 0, 0, 0]);
});

Deno.test("Grid drags follow rows, columns and diagonals without wrapping rows", () => {
  equal(gridLine(0, 5, 6), [0, 1, 2, 3, 4, 5]);
  equal(gridLine(30, 0, 6), [30, 24, 18, 12, 6, 0]);
  equal(gridLine(0, 35, 6), [0, 7, 14, 21, 28, 35]);
  equal(gridLine(5, 6, 6), [5, 4, 3, 8, 7, 6]);
});

Deno.test("Nurikabe painting cycles mixed cells and skips numbered land", () => {
  const values = [0, 1, 2, 2], clues = [0, 0, 0, 3];
  const marks = cyclePaintCells(0, 3, 4, values, clues, new Set());
  equal(values, [0, 1, 2, 2]); // Scene retains the original values for undo.
  apply(values, marks);
  equal(values, [1, 2, 0, 2]);
});

Deno.test("Nurikabe fast drags fill intervening cells, but backtracking never cycles twice", () => {
  const values = Array(16).fill(0), clues = Array(16).fill(0), visited = new Set<number>();
  apply(values, cyclePaintCells(0, 3, 4, values, clues, visited));
  apply(values, cyclePaintCells(3, 0, 4, values, clues, visited));
  equal(values.slice(0, 4), [1, 1, 1, 1]);
  apply(values, cyclePaintCells(0, 12, 4, values, clues, visited));
  equal([values[0], values[4], values[8], values[12]], [1, 1, 1, 1]);
  apply(values, cyclePaintCells(0, 3, 4, values, clues, new Set()));
  equal(values.slice(0, 4), [2, 2, 2, 2]);
});

Deno.test("Nurikabe can start a stroke on a clue and paint beyond it", () => {
  const values = [2, 0, 1], clues = [3, 0, 0], visited = new Set<number>();
  equal(cyclePaintCells(0, 0, 3, values, clues, visited), []);
  equal(visited.size, 0);
  apply(values, cyclePaintCells(0, 2, 3, values, clues, visited));
  equal(values, [2, 1, 2]);
});
