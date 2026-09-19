import {
  countMosaic,
  countShikaku,
  generate,
  generateMosaic,
  generateShikaku,
  GENERATOR_VERSION,
  isSolved,
  type Puzzle,
  Random,
  rectangle,
} from "../src/puzzles.ts";
import { generateDosun, solveDosun } from "../src/extra-puzzles.ts";
import { ProgressStore } from "../src/storage.ts";

function assert(ok: unknown, message = "Assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}
// Enumerate all board rectangles independently of the generator's candidate search.
function ambiguousClues(p: Puzzle) {
  const counts = Array(p.size ** 2).fill(0);
  for (let top = 0; top < p.size; top++) {
    for (let left = 0; left < p.size; left++) {
      for (let bottom = top; bottom < p.size; bottom++) {
        for (let right = left; right < p.size; right++) {
          const cells = rectangle(top * p.size + left, bottom * p.size + right, p.size);
          const clues = cells.filter((i) => p.clues[i] > 0);
          if (clues.length === 1 && p.clues[clues[0]] === cells.length) counts[clues[0]]++;
        }
      }
    }
  }
  return counts.filter((count) => count > 1).length;
}
function ceilingAndFloor(p: Puzzle) {
  const values: number[] = p.regions.map((r) => r < 0 ? -1 : 0);
  for (let c = 0; c < p.size; c++) {
    let run: number[] = [];
    for (let r = 0; r <= p.size; r++) {
      const i = r * p.size + c;
      if (r === p.size || p.regions[i] < 0) {
        if (run.length) {
          values[run[0]] = 1;
          values[run[run.length - 1]] = 2;
        }
        run = [];
      } else run.push(i);
    }
  }
  return values;
}
function assertQuality(p: Puzzle) {
  assert(isSolved(p, p.solution), `${p.kind}/${p.seed}: invalid solution`);
  assert(!isSolved(p, p.initial), `${p.kind}/${p.seed}: starts solved`);
  if (p.kind === "shikaku") {
    assert(ambiguousClues(p) >= 2, "every rectangle is individually forced");
    assert(countShikaku(p.clues, p.size) === 1, "Shikaku is not unique");
  } else if (p.kind === "dosun") {
    assert(!isSolved(p, ceilingAndFloor(p)), "ceiling/floor placement solves Dosun");
    assert(solveDosun(p.regions, p.size).count === 1, "Dosun is not unique");
  } else {
    const missing = p.solution.flatMap((v, i) => v === 1 && !p.initial[i] ? [i] : []);
    assert(missing.length >= 4, "too little shading left in Mosaic");
    assert(countMosaic(p.clues, p.size) === 1, "Mosaic is not unique");
    // Empty marks are optional: shading alone must still complete the puzzle.
    const values = [...p.initial];
    missing.forEach((i) => values[i] = 1);
    assert(isSolved(p, values), "Mosaic unexpectedly requires empty marks");
  }
}
class ZeroRandom extends Random {
  override next() {
    return 0;
  }
}
class HighRandom extends Random {
  override next() {
    return .999999;
  }
}
function assertShikakuBlocks(p: Puzzle) {
  let blockCells = 0, nineBlocks = 0;
  for (const region of new Set(p.solution)) {
    const cells = p.solution.flatMap((value, i) => value === region ? [i] : []);
    const width = new Set(cells.map((i) => i % p.size)).size;
    const height = new Set(cells.map((i) => i / p.size | 0)).size;
    assert(cells.length >= 2 && cells.length <= 9, `${p.seed}: rectangle area outside 2–9`);
    if (cells.length === 9) nineBlocks++;
    if (width > 1 && height > 1) blockCells += cells.length;
    else assert(cells.length <= 3, `${p.seed}: long strip instead of a small filler`);
  }
  assert(blockCells >= p.size ** 2 * 0.75, `${p.seed}: blocks cover less than 75% of the board`);
  assert(nineBlocks <= 1, `${p.seed}: more than one nine-cell block`);
}
function assertShikakuStaggered(p: Puzzle) {
  const n = p.size, a = p.solution;
  for (let y = 1; y < n; y++) {
    for (let x = 1; x < n; x++) {
      const i = y * n + x;
      assert(
        new Set([a[i], a[i - 1], a[i - n], a[i - n - 1]]).size < 4,
        `${p.seed}: four rectangles meet at (${x}, ${y})`,
      );
    }
  }
  for (let k = 1; k < n; k++) {
    // A rectangle must straddle every horizontal and vertical grid division.
    const cells = Array.from({ length: n }, (_, j) => j);
    assert(cells.some((j) => a[k * n + j] === a[(k - 1) * n + j]), `${p.seed}: horizontal seam`);
    assert(cells.some((j) => a[j * n + k] === a[j * n + k - 1]), `${p.seed}: vertical seam`);
  }
  assert(
    ambiguousClues(p) >= Math.ceil(p.clues.filter(Boolean).length / 2),
    `${p.seed}: too many individually forced clues`,
  );
}
Deno.test("Shikaku staggers blocks, limits nines and avoids singletons across 500 boards", () => {
  const layouts = new Set<string>();
  const areas = new Set<number>();
  for (let i = 0; i < 250; i++) {
    const date = new Date(Date.UTC(2026, 8, 20 + i)).toISOString().slice(0, 10);
    for (const seed of [date, `practice:blocks-${i}`]) {
      const p = generate("shikaku", seed);
      assertQuality(p);
      assertShikakuBlocks(p);
      assertShikakuStaggered(p);
      layouts.add(JSON.stringify(p.solution));
      p.clues.filter(Boolean).forEach((area) => areas.add(area));
      const repeat = structuredClone(p);
      generateShikaku(repeat, new Random(`v${GENERATOR_VERSION}:shikaku:${seed}`));
      assert(
        JSON.stringify(p) === JSON.stringify(repeat),
        `${seed}: generator is not deterministic`,
      );
    }
  }
  assert(layouts.size >= 100, "block bias collapsed the variety of layouts");
  assert(areas.has(9), "nine-cell blocks should be possible");
  assert(areas.has(2) || areas.has(3), "small strip fillers should still be possible");
});
Deno.test("Shikaku staggered fallback obeys shape limits even with constant random values", () => {
  for (const rng of [new ZeroRandom("constant"), new HighRandom("constant")]) {
    const p = structuredClone(generate("shikaku", "block-fallback-template"));
    generateShikaku(p, rng);
    assertQuality(p);
    assertShikakuBlocks(p);
    assertShikakuStaggered(p);
  }
});
Deno.test("quality guards preserve solvability and uniqueness across 1500 daily/practice boards", () => {
  for (const kind of ["shikaku", "dosun", "mosaic"] as const) {
    for (let i = 0; i < 250; i++) {
      const date = new Date(Date.UTC(2026, 8, 12 + i)).toISOString().slice(0, 10);
      for (const seed of [date, `practice:quality-${i}`]) assertQuality(generate(kind, seed));
    }
  }
});
Deno.test("Shikaku rejects forced strips and its bounded fallback requires interacting rectangles", () => {
  const p = structuredClone(generate("shikaku", "quality-template"));
  generateShikaku(p, new ZeroRandom("constant"), true);
  assert(ambiguousClues(p) === 0, "legacy fixture must expose the trivial layout");
  generateShikaku(p, new ZeroRandom("constant"));
  assertQuality(p);
  const repeat = structuredClone(p);
  generateShikaku(repeat, new ZeroRandom("constant"));
  assert(JSON.stringify(p) === JSON.stringify(repeat), "fallback must be deterministic");
});
Deno.test("Dosun rejects unchanged chambers after rejected reshaping attempts", () => {
  const p = structuredClone(generate("dosun", "quality-template"));
  generateDosun(p, new ZeroRandom("constant"), true);
  assert(isSolved(p, ceilingAndFloor(p)), "legacy fixture must expose the trivial layout");
  generateDosun(p, new ZeroRandom("constant"));
  assertQuality(p);
  assert(
    p.solution.some((v, i) => v === 1 && p.solution[i - p.size] === 1) ||
      p.solution.some((v, i) => v === 2 && p.solution[i + p.size] === 2),
    "fallback needs a supported stack",
  );
});
Deno.test("Mosaic has a bounded fallback even when every proposed board is already solved", () => {
  const p = structuredClone(generate("mosaic", "quality-template"));
  generateMosaic(p, new HighRandom("constant"), true);
  assert(isSolved(p, p.initial), "legacy all-white fixture starts solved");
  generateMosaic(p, new HighRandom("constant"));
  assertQuality(p);
});
Deno.test("Mosaic rejects the one-shaded-cell layout found by the generator audit", () => {
  const seed = "2027-01-26", p = structuredClone(generate("mosaic", seed));
  generateMosaic(p, new Random(`v${GENERATOR_VERSION}:mosaic:${seed}`), true);
  assert(p.solution.filter((v, i) => v === 1 && !p.initial[i]).length === 1);
  assertQuality(generate("mosaic", seed));
});

Deno.test("quality guards preserve published daily layouts and completed progress", async () => {
  // Digests captured from the released generator before adding quality guards.
  const fixtures = [
    ["shikaku", "2026-09-09", "9eb99a29169d10aeb09757cbdfd6376229968a24ad5b9b5299c0d753cb876533"],
    ["dosun", "2026-09-09", "99d78be38aa3aba6877ad6dea65528e7cdd4024226d558bf8db6bc0233e8dc0e"],
    ["mosaic", "2026-09-09", "b232b473eac25aa1e08037c82bcc533ce4305cd858d48a5382f05545be2552e1"],
    ["shikaku", "2026-09-10", "69f1c0b8ad92db8b16f274ff48a7fea85d5cb5e042fb7a1ccce6e5b392d4f095"],
    ["dosun", "2026-09-10", "8e3035b4b212399c7ee2433ede48f2e899f9e32e585b4a5de868145495e2b011"],
    ["mosaic", "2026-09-10", "6a22998acc4fbbc304979c52eda0fef6371ec5510d14eb58778c687dce564d99"],
    ["shikaku", "2026-09-11", "33402994ed4fe789c070896bc8d1e8d5f48661e21629d0afbfc7e7d201c5cbc4"],
    ["dosun", "2026-09-11", "da140741c122ef861dea2e4fa30af478cef45ab8e6984a544549cde297935b76"],
    ["mosaic", "2026-09-11", "63387e251a6161c0496f937bc414779f01c652a453f6b9359b4dbb23e643375a"],
    ["shikaku", "2026-09-12", "ce268f8ed83e3cca18cd95b2c03710c38c6c44d2aeafa22eca49015903ee7776"],
    ["shikaku", "2026-09-19", "c56f59ae9bbbce205b6a43b8d93796796fd5fda8b9179761262f15e4a1139915"],
  ] as const;
  const disk = new Map<string, string>();
  const storage = {
    getItem: (k: string) => disk.get(k) ?? null,
    setItem: (k: string, v: string) => {
      disk.set(k, v);
    },
  };
  for (const [kind, seed, digest] of fixtures) {
    const p = generate(kind, seed);
    const snapshot = JSON.stringify({
      clues: p.clues,
      regions: p.regions,
      solution: p.solution,
      initial: p.initial,
    });
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(snapshot));
    assert(
      Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("") === digest,
      `${kind}/${seed}: published board changed`,
    );
    const store = new ProgressStore(storage), progress = store.load(p);
    progress.values = [...p.solution];
    progress.completed = true;
    progress.elapsed = 127;
    store.save(seed, kind, progress);
    const restored = new ProgressStore(storage).load(p);
    assert(restored.completed && restored.elapsed === 127, "saved completion must survive");
  }
});
