/** Offline authoring tool. Never overwrite a published bank; archive daily boards first. */
import { Random, staggeredShikakuPartition } from "../src/puzzles.ts";
import { shikakuOptions, type ShikakuShape, solveShikaku } from "../src/shikaku.ts";
const bank: Record<string, { clues: number[]; shapes: ShikakuShape[]; solution: number[] }[]> = {
  medium: [],
  hard: [],
};
for (const level of ["medium", "hard"]) {
  const n = level === "medium" ? 7 : 8;
  let missingTotal = 0;
  for (let attempt = 0; attempt < 2000 && bank[level].length < 32; attempt++) {
    const rng = new Random(`shape-shikaku-bank:v1:${level}:${attempt}`),
      rects = staggeredShikakuPartition(n, rng);
    if (!rects) continue;
    const p = {
      clues: Array(n * n).fill(0),
      shapes: Array(n * n).fill("") as ShikakuShape[],
      solution: Array(n * n).fill(0),
    };
    const markers: number[] = [];
    rects.forEach((cells, id) => {
      const i = rng.pick(cells);
      markers.push(i);
      p.clues[i] = cells.length;
      const w = new Set(cells.map((i) => i % n)).size,
        h = new Set(cells.map((i) => Math.floor(i / n))).size;
      p.shapes[i] = rng.next() < .28 ? "any" : w === h ? "square" : w > h ? "wide" : "tall";
      cells.forEach((j) => p.solution[j] = id + 1);
    });
    if (new Set(p.shapes.filter(Boolean)).size < 4) continue;
    let result = solveShikaku(p.clues, n, p.shapes, 2, 12000);
    if (result.count !== 1 || result.exhausted) continue;
    let removed = 0;
    const target = Math.ceil(markers.length * (level === "medium" ? .3 : .6));
    for (const i of rng.shuffle(markers)) {
      const area = p.clues[i];
      p.clues[i] = 0;
      result = solveShikaku(p.clues, n, p.shapes, 2, 12000);
      if (result.count !== 1 || result.exhausted) p.clues[i] = area;
      else removed++;
      if (removed >= target) break;
    }
    if (removed < target) continue;
    const options = shikakuOptions(p.clues, n, p.shapes);
    if (options.filter((o) => o.length > 1).length < Math.ceil(markers.length * .5)) continue;
    bank[level].push(p);
    missingTotal += removed;
    console.log(level, attempt, bank[level].length, markers.length, removed, result.nodes);
  }
  if (bank[level].length !== 32) throw Error("insufficient " + level);
  console.log("COMPLETE", level, missingTotal / 32);
}
await Deno.writeTextFile(Deno.args[0] ?? "/tmp/shikaku-bank.json", JSON.stringify(bank) + "\n");
