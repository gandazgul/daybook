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
      // A drag always paints Xs; starting on a queen preserves that queen.
      marks.push({ index: this.start, value: this.original === 1 ? 1 : 2 });
      this.dragged = true;
    }
    for (const cell of gridLine(this.last, index, size)) {
      if (this.visited.has(cell)) continue;
      this.visited.add(cell);
      if (values[cell] !== 1) marks.push({ index: cell, value: 2 });
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
