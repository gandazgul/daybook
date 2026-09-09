import { gridLine, QueensInput } from "../src/input.ts";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function apply(values: number[], marks: { index: number; value: number }[]) {
  marks.forEach(({ index, value }) => values[index] = value);
}

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

Deno.test("Queens fast drags fill skipped cells, preserve queens and ignore revisits", () => {
  const input = new QueensInput(), values = Array(36).fill(0);
  values[2] = 1;
  apply(values, input.begin(0, values, 0).marks);
  apply(values, input.move(5, values, 6));
  equal(values.slice(0, 6), [2, 2, 1, 2, 2, 2]);
  equal(input.move(0, values, 6), []);
  input.end(0, 90);
  equal(input.begin(0, values, 180).mergeUndo, false);
});

Deno.test("Queens drag starting on an existing mark paints Xs and restores starting queen", () => {
  for (const initial of [1, 2]) {
    const input = new QueensInput(), values = Array(36).fill(0);
    values[0] = initial;
    apply(values, input.begin(0, values, 0).marks);
    equal(values[0], 0);
    apply(values, input.move(12, values, 6));
    equal([values[0], values[6], values[12]], [initial, 2, 2]);
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
