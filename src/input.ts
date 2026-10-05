import { sudokuUnits } from "./mini-sudoku.ts";
import type { Cage } from "./puzzles.ts";

/** Remove pencil marks ruled out by entries, without changing the supplied undo state. */
export function pruneSudokuNotes(
  values: number[],
  notes: Record<number, number[]>,
  cages: Cage[] = [],
  size = 9,
): Record<number, number[]> {
  const result: Record<number, number[]> = {};
  for (const [key, candidates] of Object.entries(notes)) {
    const i = Number(key);
    if (values[i]) continue;
    const blocked = new Set<number>(sudokuUnits(size).filter((u) => u.includes(i)).flat().map((j) => values[j]));
    for (const cage of cages) {
      if (cage.cells.includes(i)) cage.cells.forEach((cell) => blocked.add(values[cell]));
    }
    const remaining = candidates.filter((v) => !blocked.has(v));
    if (remaining.length) result[i] = remaining;
  }
  return result;
}

/** Cells crossed between two sampled positions, including fast horizontal/vertical drags. */
export function gridLine(from: number, to: number, size: number): number[] {
  let x = from % size, y = Math.floor(from / size);
  const endX = to % size, endY = Math.floor(to / size);
  const dx = Math.abs(endX - x), dy = -Math.abs(endY - y);
  const sx = x < endX ? 1 : -1, sy = y < endY ? 1 : -1;
  let error = dx + dy;
  const cells: number[] = [];
  while (true) {
    cells.push(y * size + x);
    if (x === endX && y === endY) return cells;
    const twice = 2 * error;
    if (twice >= dy) {
      error += dy;
      x += sx;
    }
    if (twice <= dx) {
      error += dx;
      y += sy;
    }
  }
}

type Mark = { index: number; value: number };

/** Cycle each editable cell once per stroke, including cells skipped by pointer sampling. */
export function cyclePaintCells(
  from: number,
  to: number,
  size: number,
  values: number[],
  clues: number[],
  visited: Set<number>,
): Mark[] {
  const marks: Mark[] = [];
  for (const index of gridLine(from, to, size)) {
    if (visited.has(index) || clues[index] > 0) continue;
    visited.add(index);
    marks.push({ index, value: (values[index] + 1) % 3 });
  }
  return marks;
}

/** Gesture state only; the scene applies edits and owns persistence/undo. */
export class QueensInput {
  private lastTap?: { index: number; time: number };
  private start = -1;
  private last = -1;
  private startedAt = 0;
  private original = 0;
  private double = false;
  private dragged = false;
  private visited = new Set<number>();

  begin(index: number, values: number[], time: number) {
    const previous = this.lastTap;
    this.double = !!previous && previous.index === index && time - previous.time <= 320;
    this.lastTap = undefined;
    this.start = this.last = index;
    this.original = values[index];
    this.startedAt = time;
    this.dragged = false;
    this.visited = new Set([index]);
    return {
      mergeUndo: this.double,
      marks: [{ index, value: this.double ? 1 : values[index] === 0 ? 2 : 0 }],
    };
  }

  move(index: number, values: number[], size: number): Mark[] {
    if (this.start < 0 || this.double || index === this.last) return [];
    const marks: Mark[] = [];
    if (!this.dragged) {
      // begin already toggled the starting cell. Restore it only if it was a queen.
      if (this.original === 1) marks.push({ index: this.start, value: 1 });
      this.dragged = true;
    }
    const value = this.original === 2 ? 0 : 2;
    for (const cell of gridLine(this.last, index, size)) {
      if (this.visited.has(cell)) continue;
      this.visited.add(cell);
      if (values[cell] !== 1 && values[cell] !== value) marks.push({ index: cell, value });
    }
    this.last = index;
    return marks;
  }

  end(index: number, time: number) {
    this.lastTap = this.start >= 0 && index === this.start && !this.dragged && !this.double &&
        time - this.startedAt <= 400
      ? { index, time }
      : undefined;
    this.start = this.last = -1;
  }

  reset() {
    this.lastTap = undefined;
    this.start = this.last = -1;
    this.visited.clear();
  }
}

/** Battleships taps cycle blank → water → ship; drags paint water and preserve ships. */
export class BattleshipsInput {
  private start = -1;
  private last = -1;
  private dragged = false;
  private dragValue = 2;
  private visited = new Set<number>();
  private lastTap?: { index: number; time: number };
  begin(index: number) {
    this.start = this.last = index;
    this.dragged = false;
    this.visited.clear();
  }
  move(index: number, values: number[], fixed: number[], size: number): Mark[] {
    if (this.start < 0 || index === this.last) return [];
    if (!this.dragged) this.dragValue = values[this.start] === 2 ? 0 : 2;
    this.dragged = true;
    this.lastTap = undefined;
    const marks: Mark[] = [];
    for (const i of gridLine(this.last, index, size)) {
      if (this.visited.has(i)) continue;
      this.visited.add(i);
      if (!fixed[i] && values[i] !== 1 && values[i] !== this.dragValue) marks.push({index:i,value:this.dragValue});
    }
    this.last = index;
    return marks;
  }
  end(index: number, values: number[], fixed: number[], time: number) {
    const result = {marks: [] as Mark[], mergeUndo: false};
    if (this.start >= 0 && index === this.start && !this.dragged && !fixed[index]) {
      const double = this.lastTap?.index === index && time - this.lastTap.time <= 320;
      result.marks.push({index,value:double ? 1 : values[index] === 0 ? 2 : values[index] === 2 ? 1 : 0});
      result.mergeUndo = !!double;
      this.lastTap = double ? undefined : {index,time};
    } else this.lastTap = undefined;
    this.start = this.last = -1;
    return result;
  }
  reset() { this.start = this.last = -1; this.lastTap = undefined; this.visited.clear(); }
}
