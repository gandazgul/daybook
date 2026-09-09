import {
  generateDosun,
  generateFiveCells,
  generateNurikabe,
  validDosun,
  validFiveCells,
  validNurikabe,
} from "./extra-puzzles.ts";
/** All generation is deterministic. Bump this version if generation changes after release. */
export const GENERATOR_VERSION = 1;
// These persisted identifiers also seed generation; keep them stable when display names change.
export const KINDS = [
  "sudoku",
  "pipes",
  "atoms",
  "killer",
  "queens",
  "shikaku",
  "snap",
  "mambo",
  "mosaic",
  "dosun",
  "nurikabe",
  "fivecells",
] as const;
export const EXTRA_GAMES_START = "2026-09-09";
export function kindsForDate(date: string): readonly Kind[] {
  return date < EXTRA_GAMES_START ? KINDS.slice(0, 9) : KINDS;
}
export type Kind = typeof KINDS[number];
export const META: Record<
  Kind,
  {
    name: string;
    category: string;
    description: string;
    rules: string;
    color: number;
    pale: number;
  }
> = {
  sudoku: {
    name: "Sudoku",
    category: "THE CLASSIC",
    description: "A place for every number.",
    rules:
      "Fill each row, column, and 3 × 3 box with the numbers 1–9, once each. Select a cell and use the number keys or the keypad. Notes toggle pencil marks. Backspace clears a cell.",
    color: 0x566b51,
    pale: 0xe9eee3,
  },
  pipes: {
    name: "Pipes",
    category: "FIND THE FLOW",
    description: "A twist. A turn. A connection.",
    rules:
      "Tap a pipe to rotate it clockwise. Connect every pipe and every endpoint to the filled water source. Every opening must meet another pipe: no leaks, no loose ends. Blue pipes are connected to the source.",
    color: 0x49777b,
    pale: 0xe6efed,
  },
  atoms: {
    name: "Atoms",
    category: "MAKE A CONNECTION",
    description: "Little bonds. One molecule.",
    rules:
      "Tap the space between neighboring atoms to cycle no bond, one line, or two lines. Each atom needs exactly the number of bonds printed inside it. Connect all atoms into one molecule. These are abstract bond puzzles, not chemical models.",
    color: 0x8a684c,
    pale: 0xf3eadd,
  },
  killer: {
    name: "Killer Sudoku",
    category: "THE SUM OF THINGS",
    description: "The classic, with a little extra.",
    rules:
      "Use the usual Sudoku rules: 1–9 in each row, column, and 3 × 3 box. Each outlined cage must add to its small corner number, with no repeated digit inside a cage. Notes and number keys work here too.",
    color: 0x8b6266,
    pale: 0xf2e5e4,
  },
  queens: {
    name: "Regional Queens",
    category: "A LITTLE STRATEGY",
    description: "Give every queen her space.",
    rules:
      "Place one queen in each row, column, and colored region. Queens cannot touch, even diagonally. Click or tap once to mark a large X; drag across cells to mark several. Double-click or double-tap a cell to place a queen. Tap any mark to clear it. Dragging preserves queens. Crosses are your own notes. With a keyboard, arrows select and Space cycles empty → queen → X → empty.",
    color: 0x807198,
    pale: 0xede8f2,
  },
  shikaku: {
    name: "Shikaku",
    category: "DIVIDE & DISCOVER",
    description: "Everything in its own rectangle.",
    rules:
      "Divide the entire grid into rectangles. Every rectangle contains exactly one clue and its area equals that number. Drag between opposite corners, or tap one corner then the other. Tap a finished rectangle to remove it.",
    color: 0x9a7c3c,
    pale: 0xf3eedb,
  },
  snap: {
    name: "Number Path",
    category: "FOLLOW THE THREAD",
    description: "One line to bring it all together.",
    rules:
      "Start at 1 and draw a single path through the numbered dots in order. Visit every square exactly once and finish at the last number. Drag or tap adjacent squares. Tap an earlier part of your path to backtrack.",
    color: 0x4e7a67,
    pale: 0xe4eee6,
  },
  mambo: {
    name: "Balance",
    category: "FIND YOUR BALANCE",
    description: "Two shapes. A perfect balance.",
    rules:
      "Fill each row and column with three circles and three diamonds. Never place three of the same shape in a row horizontally or vertically. = means neighboring shapes match; × means they differ. Tap to cycle circle → diamond → empty.",
    color: 0xa46548,
    pale: 0xf4e7db,
  },
  mosaic: {
    name: "Mosaic",
    category: "PIECE BY PIECE",
    description: "A small picture in the numbers.",
    rules:
      "Shade squares so each number equals the shaded squares in its surrounding 3 × 3 neighborhood, including its own square. At edges, count only squares inside the grid. Tap to cycle shaded → marked empty → undecided. Mark every square to finish. A red clue means too many shaded squares, or too few once every square in its neighborhood is decided.",
    color: 0x6b7d8b,
    pale: 0xe3e9ef,
  },
  dosun: {
    name: "Dosun-Fuwari",
    category: "RISE & REST",
    description: "A little lift. A little gravity.",
    rules:
      "Put one hollow balloon and one solid weight in every outlined region. A balloon needs the top edge, a rock, or another balloon directly above it. A weight needs the bottom edge, a rock, or another weight directly below. Region borders do not provide support. Tap to cycle balloon → weight → X note → clear. Rocks cannot be changed.",
    color: 0x86734f,
    pale: 0xeee8da,
  },
  nurikabe: {
    name: "Nurikabe",
    category: "ISLANDS & SEA",
    description: "Find the shape of the shoreline.",
    rules:
      "Each number belongs to an island of exactly that many cells, joined along their sides. Each island contains one number; different islands cannot share an edge. Shade every other cell as sea. The sea must connect along its sides, without any solid 2 × 2 sea squares. Tap to cycle sea → island dot → clear. Numbered cells stay land. Decide every square to finish.",
    color: 0x567b85,
    pale: 0xdfeaec,
  },
  fivecells: {
    name: "Five Cells",
    category: "FIVE AT A TIME",
    description: "Little shapes. A perfect fit.",
    rules:
      "Draw borders to divide the grid into connected groups of exactly five cells. A clue counts the bordering sides of its cell, including the outer frame. A group can contain any number of clues. Do not leave extra lines inside a group. Tap an internal grid edge to add or remove a border; drag along edges to draw several. With a keyboard, arrows select a cell and Shift + an arrow toggles that side.",
    color: 0x816777,
    pale: 0xeee1e8,
  },
};
export class Random {
  private value: number;
  constructor(seed: string) {
    this.value = 2166136261;
    for (const c of seed) this.value = Math.imul(this.value ^ c.charCodeAt(0), 16777619) >>> 0;
  }
  next() {
    let t = this.value += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  int(n: number) {
    return Math.floor(this.next() * n);
  }
  shuffle<T>(items: T[]): T[] {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  pick<T>(a: T[]) {
    return a[this.int(a.length)];
  }
}
export interface Cage {
  cells: number[];
  sum: number;
}
export interface Link {
  a: number;
  b: number;
  same: boolean;
}
export interface Puzzle {
  kind: Kind;
  size: number;
  seed: string;
  initial: number[];
  solution: number[];
  cages: Cage[];
  regions: number[];
  clues: number[];
  links: Link[];
  edges: [number, number][];
}
export function adjacent(i: number, n: number): number[] {
  return [
    i >= n ? i - n : -1,
    i % n < n - 1 ? i + 1 : -1,
    i < n * (n - 1) ? i + n : -1,
    i % n ? i - 1 : -1,
  ].filter((v) => v >= 0);
}
export function direction(a: number, b: number, n: number) {
  return b === a - n ? 1 : b === a + 1 ? 2 : b === a + n ? 4 : 8;
}
export function rotate(mask: number) {
  return ((mask << 1) & 15) | (mask >> 3);
}
function blank(kind: Kind, seed: string, size: number): Puzzle {
  return {
    kind,
    seed,
    size,
    initial: Array(size * size).fill(0),
    solution: [],
    cages: [],
    regions: [],
    clues: [],
    links: [],
    edges: [],
  };
}

/** MRV solver: returns at most limit solutions, with cage sum and nonrepetition pruning. */
export function countSudoku(grid: number[], cages: Cage[] = [], limit = 2): number {
  const a = [...grid], rows = Array(9).fill(0), cols = Array(9).fill(0), boxes = Array(9).fill(0);
  for (let i = 0; i < 81; i++) {
    if (a[i]) {
      const r = i / 9 | 0, c = i % 9, b = (r / 3 | 0) * 3 + (c / 3 | 0), bit = 1 << a[i];
      if ((rows[r] | cols[c] | boxes[b]) & bit) return 0;
      rows[r] |= bit;
      cols[c] |= bit;
      boxes[b] |= bit;
    }
  }
  const map = new Map<number, Cage>();
  cages.forEach((g) => g.cells.forEach((i) => map.set(i, g)));
  const cageOK = (i: number, v: number) => {
    const cage = map.get(i);
    if (!cage) return true;
    let sum = v, missing = 0;
    const used = new Set([v]);
    for (const j of cage.cells) {
      if (j !== i) {
        if (a[j]) {
          if (used.has(a[j])) return false;
          used.add(a[j]);
          sum += a[j];
        } else missing++;
      }
    }
    if (!missing) return sum === cage.sum;
    const available = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((x) => !used.has(x));
    return sum + available.slice(0, missing).reduce((s, x) => s + x, 0) <= cage.sum &&
      sum + available.slice(-missing).reduce((s, x) => s + x, 0) >= cage.sum;
  };
  if (a.some((v, i) => v && !cageOK(i, v))) return 0;
  let count = 0;
  const visit = () => {
    let best = -1, choices: number[] = [];
    for (let i = 0; i < 81; i++) {
      if (!a[i]) {
        const r = i / 9 | 0,
          c = i % 9,
          b = (r / 3 | 0) * 3 + (c / 3 | 0),
          mask = rows[r] | cols[c] | boxes[b];
        const opts = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((v) => !(mask & 1 << v) && cageOK(i, v));
        if (!opts.length) return;
        if (best < 0 || opts.length < choices.length) {
          best = i;
          choices = opts;
          if (opts.length === 1) break;
        }
      }
    }
    if (best < 0) {
      count++;
      return;
    }
    const r = best / 9 | 0, c = best % 9, b = (r / 3 | 0) * 3 + (c / 3 | 0);
    for (const v of choices) {
      a[best] = v;
      rows[r] |= 1 << v;
      cols[c] |= 1 << v;
      boxes[b] |= 1 << v;
      visit();
      a[best] = 0;
      rows[r] &= ~(1 << v);
      cols[c] &= ~(1 << v);
      boxes[b] &= ~(1 << v);
      if (count >= limit) return;
    }
  };
  visit();
  return count;
}
function sudoku(p: Puzzle, rng: Random) {
  const order = () =>
    rng.shuffle([0, 1, 2]).flatMap((b) => rng.shuffle([0, 1, 2]).map((i) => b * 3 + i));
  const rows = order(), cols = order(), digits = rng.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  p.solution = rows.flatMap((r) => cols.map((c) => digits[(r * 3 + Math.floor(r / 3) + c) % 9]));
  if (p.kind === "killer") {
    const unseen = new Set(rng.shuffle(Array.from({ length: 81 }, (_, i) => i)));
    while (unseen.size) {
      const start = unseen.values().next().value!;
      const cells = [start];
      unseen.delete(start);
      const length = 2 + rng.int(3);
      while (cells.length < length) {
        const choices = [...new Set(cells.flatMap((i) => adjacent(i, 9)))].filter((i) =>
          unseen.has(i) && !cells.some((c) => p.solution[c] === p.solution[i])
        );
        if (!choices.length) break;
        const next = rng.pick(choices);
        unseen.delete(next);
        cells.push(next);
      }
      p.cages.push({
        cells: cells.sort((a, b) => a - b),
        sum: cells.reduce((s, i) => s + p.solution[i], 0),
      });
    }
  }
  p.initial = [...p.solution];
  const target = p.kind === "killer" ? 9 : 36;
  let remaining = 81;
  for (const i of rng.shuffle(Array.from({ length: 81 }, (_, i) => i))) {
    const value = p.initial[i];
    p.initial[i] = 0;
    if (countSudoku(p.initial, p.cages) !== 1) p.initial[i] = value;
    else remaining--;
    if (remaining <= target) break;
  }
}
export function countQueens(regions: number[], n: number, limit = 2) {
  let count = 0;
  const usedCols = new Set<number>(), usedRegions = new Set<number>();
  const visit = (r: number, last: number) => {
    if (r === n) {
      count++;
      return;
    }
    for (let c = 0; c < n; c++) {
      const region = regions[r * n + c];
      if (usedCols.has(c) || usedRegions.has(region) || (r > 0 && Math.abs(last - c) <= 1)) {
        continue;
      }
      usedCols.add(c);
      usedRegions.add(region);
      visit(r + 1, c);
      usedCols.delete(c);
      usedRegions.delete(region);
      if (count >= limit) return;
    }
  };
  visit(0, -10);
  return count;
}
function queens(p: Puzzle, rng: Random) {
  const n = p.size;
  for (let attempt = 0; attempt < 1000; attempt++) {
    let perm: number[];
    do {
      perm = rng.shuffle(Array.from({ length: n }, (_, i) => i));
    } while (perm.some((c, r) => r > 0 && Math.abs(c - perm[r - 1]) <= 1));
    const regions = Array(n * n).fill(-1);
    perm.forEach((c, r) => regions[r * n + c] = r);
    while (regions.includes(-1)) {
      const options: [number, number][] = [];
      for (let i = 0; i < n * n; i++) {
        if (regions[i] >= 0) {
          for (const j of adjacent(i, n)) if (regions[j] < 0) options.push([j, regions[i]]);
        }
      }
      const [cell, region] = rng.pick(options);
      regions[cell] = region;
    }
    if (countQueens(regions, n) === 1) {
      p.regions = regions;
      p.solution = Array(n * n).fill(0);
      perm.forEach((c, r) => p.solution[r * n + c] = 1);
      return;
    }
  }
  // Guaranteed unique fallback, only used if the randomized search exhausts its budget.
  p.regions = [
    1,
    2,
    2,
    0,
    2,
    2,
    1,
    2,
    2,
    2,
    2,
    2,
    1,
    2,
    2,
    2,
    2,
    2,
    4,
    4,
    2,
    2,
    2,
    3,
    4,
    4,
    5,
    5,
    5,
    5,
    4,
    4,
    5,
    5,
    5,
    5,
  ];
  p.solution = Array(n * n).fill(0);
  [3, 6, 14, 23, 25, 34].forEach((i) => p.solution[i] = 1);
}
function pipes(p: Puzzle, rng: Random) {
  const n = p.size;
  p.solution = Array(n * n).fill(0);
  const seen = new Set([0]), stack = [0];
  while (stack.length) {
    const i = stack[stack.length - 1], options = adjacent(i, n).filter((j) => !seen.has(j));
    if (!options.length) {
      stack.pop();
      continue;
    }
    const j = rng.pick(options);
    seen.add(j);
    stack.push(j);
    p.solution[i] |= direction(i, j, n);
    p.solution[j] |= direction(j, i, n);
  }
  p.initial = p.solution.map((mask) => {
    for (let r = rng.int(4); r > 0; r--) mask = rotate(mask);
    return mask;
  });
  if (isSolved(p, p.initial)) p.initial[0] = rotate(p.initial[0]);
}
function atoms(p: Puzzle, rng: Random) {
  const n = p.size;
  for (let i = 0; i < n * n; i++) for (const j of adjacent(i, n)) if (j > i) p.edges.push([i, j]);
  const visited = new Set([0]);
  p.solution = Array(p.edges.length).fill(0);
  while (visited.size < n * n) {
    const choices = p.edges.map(([a, b], i) => ({ a, b, i })).filter((e) =>
      visited.has(e.a) !== visited.has(e.b)
    );
    const { a, b, i } = rng.pick(choices);
    visited.add(a);
    visited.add(b);
    p.solution[i] = 1;
  }
  p.edges.forEach((_, i) => {
    if (rng.next() < 0.15) p.solution[i] = 1;
    if (p.solution[i] && rng.next() < 0.35) p.solution[i] = 2;
  });
  p.clues = Array(n * n).fill(0);
  p.edges.forEach(([a, b], i) => {
    p.clues[a] += p.solution[i];
    p.clues[b] += p.solution[i];
  });
  p.initial = Array(p.edges.length).fill(0);
}
export function rectangle(a: number, b: number, n: number) {
  const x1 = Math.min(a % n, b % n),
    x2 = Math.max(a % n, b % n),
    y1 = Math.min(a / n | 0, b / n | 0),
    y2 = Math.max(a / n | 0, b / n | 0),
    cells: number[] = [];
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) cells.push(y * n + x);
  return cells;
}
export function countShikaku(clues: number[], n: number, limit = 2): number {
  const options = clues.flatMap((area, i) => {
    if (!area) return [];
    const rects: number[][] = [];
    for (let h = 1; h <= n; h++) {
      if (area % h === 0 && area / h <= n) {
        const w = area / h, r = i / n | 0, c = i % n;
        for (let y = Math.max(0, r - h + 1); y <= Math.min(r, n - h); y++) {
          for (let x = Math.max(0, c - w + 1); x <= Math.min(c, n - w); x++) {
            const cells = rectangle(y * n + x, (y + h - 1) * n + x + w - 1, n);
            if (
              cells.filter((j) => clues[j] > 0).length === 1
            ) rects.push(cells);
          }
        }
      }
    }
    return [rects];
  });
  let count = 0;
  const occupied = new Set<number>();
  const visit = (remaining: number[]) => {
    if (!remaining.length) {
      if (occupied.size === n * n) count++;
      return;
    }
    let best = -1, choices: number[][] = [];
    for (const i of remaining) {
      const valid = options[i].filter((cells) => cells.every((c) => !occupied.has(c)));
      if (!valid.length) return;
      if (best < 0 || valid.length < choices.length) {
        best = i;
        choices = valid;
      }
    }
    for (const cells of choices) {
      cells.forEach((c) => occupied.add(c));
      visit(remaining.filter((i) => i !== best));
      cells.forEach((c) => occupied.delete(c));
      if (count >= limit) return;
    }
  };
  visit(options.map((_, i) => i));
  return count;
}
function shikaku(p: Puzzle, rng: Random) {
  const n = p.size;
  for (let attempt = 0; attempt < 500; attempt++) {
    const rects: number[][] = [];
    const split = (x: number, y: number, w: number, h: number) => {
      if (w * h <= 6 && (w * h <= 3 || rng.next() < 0.6)) {
        rects.push(rectangle(y * n + x, (y + h - 1) * n + x + w - 1, n));
        return;
      }
      if (w > 1 && (h === 1 || rng.next() < 0.5)) {
        const k = 1 + rng.int(w - 1);
        split(x, y, k, h);
        split(x + k, y, w - k, h);
      } else {
        const k = 1 + rng.int(h - 1);
        split(x, y, w, k);
        split(x, y + k, w, h - k);
      }
    };
    split(0, 0, n, n);
    const clues = Array(n * n).fill(0);
    rects.forEach((cells) => clues[rng.pick(cells)] = cells.length);
    if (countShikaku(clues, n) === 1) {
      p.clues = clues;
      p.solution = Array(n * n).fill(0);
      rects.forEach((cells, i) => cells.forEach((c) => p.solution[c] = i + 1));
      return;
    }
  }
  // A clue in every leftmost cell forces one full-width rectangle per row.
  p.clues = Array.from({ length: n * n }, (_, i) => i % n === 0 ? n : 0);
  p.solution = Array.from({ length: n * n }, (_, i) => (i / n | 0) + 1);
}
function snap(p: Puzzle, rng: Random) {
  const n = p.size;
  let path = Array.from(
    { length: n },
    (_, r) => Array.from({ length: n }, (_, c) => r * n + (r % 2 ? n - 1 - c : c)),
  ).flat();
  // Backbite moves preserve a Hamiltonian path while breaking the initial zigzag.
  for (let k = 0; k < 250; k++) {
    if (rng.next() < 0.5) path.reverse();
    const options = adjacent(path[0], n).filter((i) => i !== path[1]);
    const next = rng.pick(options), index = path.indexOf(next);
    if (index > 1) path = [...path.slice(0, index).reverse(), ...path.slice(index)];
  }
  p.solution = path;
  p.clues = Array(n * n).fill(0);
  const checkpoints = [0, 4, 8, 13, 18, 24];
  checkpoints.forEach((i, k) => p.clues[path[i]] = k + 1);
  p.initial = [path[0]];
}
export function validBalance(a: number[], n: number, links: Link[]) {
  for (let axis = 0; axis < 2; axis++) {
    for (let k = 0; k < n; k++) {
      const line = Array.from({ length: n }, (_, j) => a[axis ? j * n + k : k * n + j]);
      if ([1, 2].some((v) => line.filter((x) => x === v).length > n / 2)) return false;
      if (
        line.some((v, j) => j >= 2 && v > 0 && v === line[j - 1] && v === line[j - 2])
      ) return false;
    }
  }
  return links.every(({ a: i, b: j, same }) => !a[i] || !a[j] || (a[i] === a[j]) === same);
}
export function countBalance(initial: number[], n: number, links: Link[], limit = 2) {
  const a = [...initial];
  let count = 0;
  if (!validBalance(a, n, links)) return 0;
  const visit = () => {
    const i = a.indexOf(0);
    if (i < 0) {
      count++;
      return;
    }
    for (const v of [1, 2]) {
      a[i] = v;
      if (validBalance(a, n, links)) visit();
      a[i] = 0;
      if (count >= limit) return;
    }
  };
  visit();
  return count;
}
function mambo(p: Puzzle, rng: Random) {
  const n = p.size, a = Array(n * n).fill(0);
  const fill = (i: number): boolean => {
    if (i === n * n) return true;
    for (const v of rng.shuffle([1, 2])) {
      a[i] = v;
      if (validBalance(a, n, []) && fill(i + 1)) return true;
    }
    a[i] = 0;
    return false;
  };
  fill(0);
  p.solution = [...a];
  const pairs: [number, number][] = [];
  for (let i = 0; i < n * n; i++) for (const j of adjacent(i, n)) if (j > i) pairs.push([i, j]);
  p.links = rng.shuffle(pairs).slice(0, 9).map(([i, j]) => ({ a: i, b: j, same: a[i] === a[j] }));
  p.initial = [...a];
  for (const i of rng.shuffle(Array.from({ length: n * n }, (_, i) => i))) {
    const v = p.initial[i];
    p.initial[i] = 0;
    if (countBalance(p.initial, n, p.links) !== 1) p.initial[i] = v;
  }
}
export function neighborhood(i: number, n: number) {
  const cells: number[] = [];
  const r = i / n | 0, c = i % n;
  for (let y = Math.max(0, r - 1); y <= Math.min(n - 1, r + 1); y++) {
    for (let x = Math.max(0, c - 1); x <= Math.min(n - 1, c + 1); x++) {
      cells.push(y * n + x);
    }
  }
  return cells;
}
/** Incomplete areas stay neutral unless their shaded count already exceeds the clue. */
export function mosaicClueConflict(clue: number, values: number[], index: number, size: number) {
  if (clue < 0) return false;
  const cells = neighborhood(index, size);
  const shaded = cells.filter((i) => values[i] === 1).length;
  const decided = cells.every((i) => values[i] === 1 || values[i] === 2);
  return shaded > clue || (decided && shaded < clue);
}
export function countMosaic(clues: number[], n: number, limit = 2): number {
  const constraints = clues.flatMap((v, i) =>
    v >= 0 ? [{ target: v, cells: neighborhood(i, n) }] : []
  );
  let count = 0;
  const visit = (a: number[]) => {
    let changed = true;
    while (changed) {
      changed = false;
      for (const { target, cells } of constraints) {
        const filled = cells.filter((i) => a[i] === 1).length,
          empty = cells.filter((i) => a[i] === 0);
        if (filled > target || filled + empty.length < target) return;
        if (empty.length && (filled === target || filled + empty.length === target)) {
          empty.forEach((i) => a[i] = filled === target ? 2 : 1);
          changed = true;
        }
      }
    }
    if (!a.includes(0)) {
      count++;
      return;
    }
    let best = -1, weight = -1;
    for (let i = 0; i < a.length; i++) {
      if (!a[i]) {
        const score = constraints.filter((c) => c.cells.includes(i)).reduce(
          (v, c) => v + 1 / c.cells.filter((j) => !a[j]).length,
          0,
        );
        if (score > weight) {
          best = i;
          weight = score;
        }
      }
    }
    for (const v of [1, 2]) {
      const b = [...a];
      b[best] = v;
      visit(b);
      if (count >= limit) return;
    }
  };
  visit(Array(n * n).fill(0));
  return count;
}
function mosaic(p: Puzzle, rng: Random) {
  p.solution = Array.from({ length: p.size ** 2 }, () => rng.next() < .48 ? 1 : 2);
  // The complete clues on a 6 × 6 board are invertible; remove only redundant clues.
  p.clues = p.solution.map((_, i) =>
    neighborhood(i, p.size).filter((j) => p.solution[j] === 1).length
  );
  for (const i of rng.shuffle(Array.from({ length: p.size ** 2 }, (_, i) => i))) {
    const v = p.clues[i];
    p.clues[i] = -1;
    if (countMosaic(p.clues, p.size) !== 1) p.clues[i] = v;
  }
}
const cache = new Map<string, Puzzle>();
export function generate(kind: Kind, seed: string): Puzzle {
  const key = `v${GENERATOR_VERSION}:${kind}:${seed}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const rng = new Random(key),
    size = kind === "sudoku" || kind === "killer"
      ? 9
      : kind === "atoms"
      ? 4
      : kind === "pipes" || kind === "snap" || kind === "nurikabe" || kind === "fivecells"
      ? 5
      : 6;
  const p = blank(kind, seed, size);
  switch (kind) {
    case "sudoku":
    case "killer":
      sudoku(p, rng);
      break;
    case "queens":
      queens(p, rng);
      break;
    case "pipes":
      pipes(p, rng);
      break;
    case "atoms":
      atoms(p, rng);
      break;
    case "shikaku":
      shikaku(p, rng);
      break;
    case "snap":
      snap(p, rng);
      break;
    case "mambo":
      mambo(p, rng);
      break;
    case "mosaic":
      mosaic(p, rng);
      break;
    case "dosun":
      generateDosun(p, rng);
      break;
    case "nurikabe":
      generateNurikabe(p, rng);
      break;
    case "fivecells":
      generateFiveCells(p, rng);
      break;
  }
  if (cache.size > 100) cache.delete(cache.keys().next().value!);
  cache.set(key, p);
  return p;
}
export function waterCells(p: Puzzle, a: number[]) {
  const seen = new Set([0]), stack = [0];
  while (stack.length) {
    const i = stack.pop()!;
    for (const j of adjacent(i, p.size)) {
      if ((a[i] & direction(i, j, p.size)) && (a[j] & direction(j, i, p.size)) && !seen.has(j)) {
        seen.add(j);
        stack.push(j);
      }
    }
  }
  return seen;
}
export function isSolved(p: Puzzle, a: number[]): boolean {
  const n = p.size;
  if (p.kind !== "snap" && a.length !== p.initial.length) return false;
  if (
    (p.kind === "sudoku" || p.kind === "killer" || p.kind === "mambo") &&
    p.initial.some((v, i) => v && a[i] !== v)
  ) return false;
  switch (p.kind) {
    case "sudoku":
    case "killer":
      return a.every((v) => Number.isInteger(v) && v >= 1 && v <= 9) &&
        countSudoku(a, p.cages, 1) === 1;
    case "pipes":
      return a.every((mask, i) => {
        if (
          ![
            p.initial[i],
            rotate(p.initial[i]),
            rotate(rotate(p.initial[i])),
            rotate(rotate(rotate(p.initial[i]))),
          ].includes(mask)
        ) return false;
        const neighbors = adjacent(i, n);
        return [1, 2, 4, 8].every((bit) =>
          !(mask & bit) ||
          neighbors.some((j) => direction(i, j, n) === bit && (a[j] & direction(j, i, n)))
        );
      }) && waterCells(p, a).size === n * n;
    case "atoms": {
      if (a.some((v) => v !== 0 && v !== 1 && v !== 2)) return false;
      const degree = Array(n * n).fill(0), seen = new Set([0]);
      p.edges.forEach(([i, j], k) => {
        degree[i] += a[k];
        degree[j] += a[k];
      });
      for (let k = 0; k < n * n; k++) {
        p.edges.forEach(([i, j], e) => {
          if (a[e] && (seen.has(i) || seen.has(j))) {
            seen.add(i);
            seen.add(j);
          }
        });
      }
      return degree.every((v, i) => v === p.clues[i]) && seen.size === n * n;
    }
    case "queens": {
      if (a.some((v) => v !== 0 && v !== 1 && v !== 2)) return false;
      const cells = a.flatMap((v, i) => v === 1 ? [i] : []);
      return cells.length === n && new Set(cells.map((i) => i / n | 0)).size === n &&
        new Set(cells.map((i) => i % n)).size === n &&
        new Set(cells.map((i) => p.regions[i])).size === n &&
        cells.every((i) =>
          cells.every((j) =>
            i === j || Math.abs((i / n | 0) - (j / n | 0)) > 1 || Math.abs(i % n - j % n) > 1
          )
        );
    }
    case "shikaku": {
      if (a.some((v) => !Number.isInteger(v) || v <= 0)) return false;
      return [...new Set(a)].every((id) => {
        const cells = a.flatMap((v, i) => v === id ? [i] : []),
          numbers = cells.filter((i) => p.clues[i] > 0),
          rect = rectangle(Math.min(...cells), Math.max(...cells), n);
        return numbers.length === 1 && p.clues[numbers[0]] === cells.length &&
          rect.length === cells.length && rect.every((i) => a[i] === id);
      });
    }
    case "snap": {
      if (
        a.length !== n * n || new Set(a).size !== n * n ||
        a.some((i) => !Number.isInteger(i) || i < 0 || i >= n * n)
      ) return false;
      const numbers = a.map((i) => p.clues[i]).filter((v) => v > 0);
      return p.clues[a[0]] === 1 && p.clues[a[a.length - 1]] === Math.max(...p.clues) &&
        a.every((v, i) => !i || adjacent(a[i - 1], n).includes(v)) &&
        numbers.every((v, i) => v === i + 1);
    }
    case "mosaic":
      return a.every((v) => v === 1 || v === 2) &&
        p.clues.every((v, i) => v < 0 || neighborhood(i, n).filter((j) => a[j] === 1).length === v);
    case "dosun":
      return validDosun(p.regions, a, n);
    case "nurikabe":
      return validNurikabe(p.clues, a, n);
    case "fivecells":
      return validFiveCells(p.clues, p.edges, a, n);
    case "mambo":
      return a.every((v) => v === 1 || v === 2) && validBalance(a, n, p.links);
  }
}
