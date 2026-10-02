import type { Puzzle } from "./puzzles.ts";

export type ShikakuShape = "" | "any" | "square" | "wide" | "tall";
type Clues = Pick<Puzzle, "clues" | "size" | "shapes">;
export const SHIKAKU_SIZES = { easy: 6, medium: 7, hard: 8 } as const;
export const SHAPE_LABELS = {
  any: "any rectangle",
  square: "square",
  wide: "wide rectangle",
  tall: "tall rectangle",
};
export function shikakuClueCells(p: Clues) {
  return p.clues.flatMap((area, i) => area > 0 || p.shapes?.[i] ? [i] : []);
}
export function matchesShikakuShape(
  shape: ShikakuShape | undefined,
  width: number,
  height: number,
) {
  return shape === "square"
    ? width === height
    : shape === "wide"
    ? width > height
    : shape === "tall"
    ? height > width
    : true;
}
/** Checks a drawn rectangle against visible clues; no generated answer is consulted. */
export function shikakuRectangleError(p: Clues, cells: number[]): string | undefined {
  const clues = cells.filter((i) => p.clues[i] > 0 || p.shapes?.[i]);
  if (clues.length !== 1) return "Include exactly one clue in each rectangle.";
  const i = clues[0], area = p.clues[i];
  if (area > 0 && area !== cells.length) return `This clue needs exactly ${area} cells.`;
  const width = new Set(cells.map((i) => i % p.size)).size;
  const height = new Set(cells.map((i) => Math.floor(i / p.size))).size;
  const shape = p.shapes?.[i];
  if (!matchesShikakuShape(shape, width, height)) {
    return shape === "square"
      ? "This clue needs a square: equal width and height."
      : shape === "wide"
      ? "This clue needs a wide rectangle: wider than it is tall."
      : "This clue needs a tall rectangle: taller than it is wide.";
  }
}

/** One option list per clue, including shape-only clues with no fixed area. */
export function shikakuOptions(
  clues: number[],
  n: number,
  shapes: ShikakuShape[] = [],
): number[][][] {
  const markers = clues.map((area, i) => area > 0 || !!shapes[i]);
  return clues.flatMap((area, i) => {
    if (!markers[i]) return [];
    const rects: number[][] = [], r = Math.floor(i / n), c = i % n;
    for (let h = 1; h <= n; h++) {
      for (let w = 1; w <= n; w++) {
        if ((area > 0 && h * w !== area) || !matchesShikakuShape(shapes[i], w, h)) continue;
        for (let y = Math.max(0, r - h + 1); y <= Math.min(r, n - h); y++) {
          for (let x = Math.max(0, c - w + 1); x <= Math.min(c, n - w); x++) {
            const cells = Array.from(
              { length: h * w },
              (_, k) => (y + Math.floor(k / w)) * n + x + k % w,
            );
            if (
              cells.filter((j) => markers[j]).length === 1
            ) rects.push(cells);
          }
        }
      }
    }
    return [rects];
  });
}
/** Exact cover with both clue and uncovered-cell constraints. Exhaustion never proves uniqueness. */
export function solveShikaku(
  clues: number[],
  n: number,
  shapes: ShikakuShape[] = [],
  limit = 2,
  budget = 50000,
) {
  const options = shikakuOptions(clues, n, shapes);
  const candidates = options.flatMap((rects, clue) =>
    rects.map((cells) => ({
      clue,
      cells,
      mask: cells.reduce((mask, i) => mask | 1n << BigInt(i), 0n),
    }))
  );
  const byClue = options.map((_, clue) => candidates.filter((o) => o.clue === clue));
  const byCell = Array.from(
    { length: n * n },
    (_, i) => candidates.filter((o) => o.cells.includes(i)),
  );
  const full = (1n << BigInt(n * n)) - 1n;
  let count = 0, nodes = 0, exhausted = false, solution: number[][] | undefined;
  const placed = new Set<number>(), chosen: number[][] = [];
  const visit = (occupied: bigint) => {
    if (count >= limit || exhausted) return;
    if (++nodes > budget) {
      exhausted = true;
      return;
    }
    if (placed.size === options.length) {
      if (occupied === full) {
        count++;
        solution ??= chosen.map((cells) => [...cells]);
      }
      return;
    }
    let best: typeof candidates | undefined;
    const consider = (list: typeof candidates) => {
      const valid = list.filter((o) => !placed.has(o.clue) && !(o.mask & occupied));
      if (!best || valid.length < best.length) best = valid;
    };
    for (let i = 0; i < options.length; i++) {
      if (!placed.has(i)) {
        consider(byClue[i]);
        if (!best?.length) return;
      }
    }
    for (let i = 0; i < n * n; i++) {
      if (!(occupied & 1n << BigInt(i))) {
        consider(byCell[i]);
        if (!best?.length) return;
      }
    }
    for (const option of best!) {
      placed.add(option.clue);
      chosen.push(option.cells);
      visit(occupied | option.mask);
      chosen.pop();
      placed.delete(option.clue);
      if (count >= limit || exhausted) return;
    }
  };
  visit(0n);
  return { count, exhausted, nodes, solution };
}
/** Existing number-only callers retain exhaustive counting semantics. */
export function countShikaku(clues: number[], n: number, limit = 2, shapes: ShikakuShape[] = []) {
  return solveShikaku(clues, n, shapes, limit, Infinity).count;
}
