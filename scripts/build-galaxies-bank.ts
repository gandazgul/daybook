import { Random } from "../src/puzzles.ts";
import { galaxyCore, galaxyEdges, mirrorCell, solveGalaxies } from "../src/galaxies.ts";
import type { GalaxyCenter } from "../src/galaxies.ts";
const rng = new Random("galaxies-bank:v1");
const bank: Record<string, { centers: GalaxyCenter[]; labels: number[] }[]> = {
  easy: [],
  medium: [],
  hard: [],
};
const seen = new Set<string>();
for (let attempt = 0; Object.values(bank).some((a) => a.length < 24); attempt++) {
  const n = bank.easy.length < 24 ? 5 : 7;
  const all = Array.from({ length: n * n }, (_, i) => i), edges = galaxyEdges(n);
  const adj = all.map((i) => edges.flatMap(([a, b]) => a === i ? [b] : b === i ? [a] : []));
  const labels = all.map(() => -1), centers: GalaxyCenter[] = [];
  // Grow symmetric connected regions in random order; unused cells become later centers.
  while (labels.includes(-1)) {
    const seed = rng.pick(all.filter((i) => labels[i] < 0));
    const sx = seed % n * 2, sy = Math.floor(seed / n) * 2;
    const options = [-1, 0, 1].flatMap((dx) =>
      [-1, 0, 1].map((dy): GalaxyCenter => [sx + dx, sy + dy])
    )
      .filter(([x, y]) => x >= 0 && y >= 0 && x <= 2 * (n - 1) && y <= 2 * (n - 1))
      .filter((c) => galaxyCore(c, n).every((i) => labels[i] < 0));
    const center = rng.pick(options), id = centers.length, cells = galaxyCore(center, n);
    centers.push(center);
    cells.forEach((i) => labels[i] = id);
    const target = 4 + rng.int(n === 5 ? 8 : 14);
    while (cells.length < target) {
      const next = rng.shuffle([...new Set(cells.flatMap((i) => adj[i]))]).find((i) => {
        const j = mirrorCell(i, center, n);
        return labels[i] < 0 && j >= 0 && labels[j] < 0 && adj[j].some((k) => labels[k] === id);
      });
      if (next === undefined) break;
      const pair = mirrorCell(next, center, n);
      labels[next] = labels[pair] = id;
      cells.push(next, pair);
    }
  }
  const sizes = centers.map((_, g) => labels.filter((v) => v === g).length);
  if (sizes.filter((s) => s === 1).length > 2 || centers.length > (n === 5 ? 9 : 14)) continue;
  const irregular = centers.filter((_, g) => {
    const cells = all.filter((i) => labels[i] === g);
    return (Math.max(...cells.map((i) => i % n)) - Math.min(...cells.map((i) => i % n)) + 1) *
        (Math.max(...cells.map((i) => Math.floor(i / n))) - Math.min(...cells.map((i) =>
          Math.floor(i / n)
        )) + 1) !== cells.length;
  }).length;
  if (irregular < (n === 5 ? 1 : 2)) continue;
  const result = solveGalaxies(centers, n, [], 2, 3000);
  if (result.exhausted || result.solutions.length !== 1) continue;
  const hard = result.domains.some((d) => d.length > 1);
  const level = n === 5 ? "easy" : hard ? "hard" : "medium";
  if (n === 5 && !hard || bank[level].length >= 24) continue;
  const key = centers.map((c) => c.join(",")).sort().join(";");
  if (seen.has(key)) continue;
  seen.add(key);
  bank[level].push({ centers, labels });
  console.log(attempt, level, bank[level].length, "centers", centers.length, "nodes", result.nodes);
  await Deno.writeTextFile("src/galaxies-bank.json", JSON.stringify(bank) + "\n");
}
