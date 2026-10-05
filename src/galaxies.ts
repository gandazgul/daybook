import type { Difficulty } from "./difficulty.ts";
import type { Puzzle, Random } from "./puzzles.ts";
import bank from "./galaxies-bank.json" with { type: "json" };

// Doubled cell-center coordinates: even/even = cell, odd/even = edge, odd/odd = corner.
export type GalaxyCenter = [number, number];
export const GALAXY_SIZES = { easy: 5, medium: 7, hard: 7 };
export function galaxyEdges(n: number): [number, number][] {
  return Array.from({ length: n * n }, (_, i) => [
    ...(i % n < n - 1 ? [[i, i + 1] as [number, number]] : []),
    ...(i < n * (n - 1) ? [[i, i + n] as [number, number]] : []),
  ]).flat();
}
function neighbors(i: number, n: number) {
  return [
    i % n ? i - 1 : -1,
    i % n < n - 1 ? i + 1 : -1,
    i >= n ? i - n : -1,
    i < n * (n - 1) ? i + n : -1,
  ].filter((j) => j >= 0);
}
export function mirrorCell(i: number, center: GalaxyCenter, n: number) {
  const x = center[0] - i % n, y = center[1] - Math.floor(i / n);
  return x >= 0 && x < n && y >= 0 && y < n ? y * n + x : -1;
}
export function galaxyCore([x, y]: GalaxyCenter, n: number) {
  return [...new Set([Math.floor(y / 2), Math.ceil(y / 2)])].flatMap((r) =>
    [...new Set([Math.floor(x / 2), Math.ceil(x / 2)])].map((c) => r * n + c)
  );
}
export function galaxyRegions(edges: [number, number][], walls: number[], n: number) {
  const labels = Array(n * n).fill(-1), adjacent = labels.map(() => [] as number[]);
  edges.forEach(([a, b], e) => {
    if (walls[e] !== 1) {
      adjacent[a].push(b);
      adjacent[b].push(a);
    }
  });
  let id = 0;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] >= 0) continue;
    const queue = [i];
    labels[i] = id;
    for (const j of queue) {
      for (const k of adjacent[j]) {
        if (labels[k] < 0) {
          labels[k] = id;
          queue.push(k);
        }
      }
    }
    id++;
  }
  return labels;
}
export function validGalaxyRegions(centers: GalaxyCenter[], labels: number[], n: number) {
  return [...new Set(labels)].filter((id) =>
    id >= 0 && centers.some((c) => galaxyCore(c, n).every((i) => labels[i] === id))
  ).filter((id) => {
    const contained = centers.filter((c) => galaxyCore(c, n).every((i) => labels[i] === id));
    return contained.length === 1 && centers.every((c) => {
      const core = galaxyCore(c, n);
      return !core.some((i) => labels[i] === id) || core.every((i) => labels[i] === id);
    }) && labels.every((v, i) => v !== id || labels[mirrorCell(i, contained[0], n)] === id);
  });
}
export function validGalaxies(
  centers: GalaxyCenter[],
  edges: [number, number][],
  walls: number[],
  n: number,
) {
  if (!centers.length || walls.length !== edges.length || walls.some((v) => v !== 0 && v !== 1)) {
    return false;
  }
  const labels = galaxyRegions(edges, walls, n);
  return new Set(labels).size === centers.length &&
    centers.every((c) =>
      galaxyCore(c, n).every((i) => labels[i] === labels[galaxyCore(c, n)[0]])
    ) &&
    validGalaxyRegions(centers, labels, n).length === new Set(labels).size &&
    edges.every(([a, b], e) => (walls[e] === 1) === (labels[a] !== labels[b]));
}

/** Visible-clue solver: symmetry, center ownership and connected reachability, then MRV trials. */
export function solveGalaxies(
  centers: GalaxyCenter[],
  n: number,
  walls: number[] = [],
  limit = 2,
  budget = 20000,
) {
  const edges = galaxyEdges(n), all = Array.from({ length: n * n }, (_, i) => i);
  const cores = centers.map((c) => galaxyCore(c, n));
  const mirrors = centers.map((c) => all.map((i) => mirrorCell(i, c, n)));
  const adj = all.map((i) => neighbors(i, n));
  const owner = all.map((i) => cores.findIndex((core) => core.includes(i)));
  let nodes = 0, exhausted = false;
  const solutions: number[][] = [];
  const initial = all.map((i) =>
    centers.flatMap((_, g) => {
      const j = mirrors[g][i];
      return j >= 0 && (owner[i] < 0 || owner[i] === g) && (owner[j] < 0 || owner[j] === g)
        ? [g]
        : [];
    })
  );
  function propagate(d: number[][]) {
    let changed = true;
    while (changed) {
      changed = false;
      const restrict = (i: number, keep: (g: number) => boolean) => {
        const next = d[i].filter(keep);
        if (next.length !== d[i].length) {
          d[i] = next;
          changed = true;
        }
      };
      for (const i of all) {
        restrict(i, (g) => d[mirrors[g][i]]?.includes(g));
        if (d[i].length === 1) {
          const g = d[i][0];
          restrict(mirrors[g][i], (h) => h === g);
        }
      }
      edges.forEach(([a, b], e) => {
        if (walls[e] !== 1) return;
        if (d[a].length === 1) restrict(b, (g) => g !== d[a][0]);
        if (d[b].length === 1) restrict(a, (g) => g !== d[b][0]);
      });
      for (let g = 0; g < centers.length; g++) {
        const core = cores[g];
        if (core.some((i) => !d[i]?.includes(g))) return false;
        const seen = new Set([core[0]]), queue = [core[0]];
        for (const i of queue) {
          for (const j of adj[i]) {
            if (!seen.has(j) && d[j].includes(g)) {
              seen.add(j);
              queue.push(j);
            }
          }
        }
        for (const i of all) if (!seen.has(i)) restrict(i, (h) => h !== g);
      }
      if (d.some((v) => !v.length)) return false;
    }
    return true;
  }
  const possible = propagate(initial);
  const domains = initial.map((d) => [...d]);
  function visit(d: number[][]) {
    if (++nodes > budget) {
      exhausted = true;
      return;
    }
    if (!propagate(d)) return;
    const undecided = all.filter((i) => d[i].length > 1).sort((a, b) => d[a].length - d[b].length);
    if (!undecided.length) {
      const labels = d.map((v) => v[0]);
      const answer = edges.map(([a, b]) => labels[a] === labels[b] ? 0 : 1);
      if (
        validGalaxies(centers, edges, answer, n) &&
        walls.every((v, e) => v !== 1 || answer[e] === 1)
      ) solutions.push(labels);
      return;
    }
    const i = undecided[0];
    for (const g of d[i]) {
      const next = d.map((v) => [...v]);
      next[i] = [g];
      visit(next);
      if (solutions.length >= limit || exhausted) return;
    }
  }
  if (possible) visit(initial);
  return { solutions, domains, nodes, exhausted };
}
export function generateGalaxies(p: Puzzle, rng: Random, level: Difficulty) {
  const n = p.size, template = rng.pick(bank[level]);
  const turns = rng.int(4), flip = rng.int(2);
  const transform = ([xx, yy]: number[]): GalaxyCenter => {
    let x = flip ? 2 * (n - 1) - xx : xx, y = yy;
    for (let k = 0; k < turns; k++) [x, y] = [2 * (n - 1) - y, x];
    return [x, y];
  };
  p.centers = template.centers.map(transform);
  const labels = Array(n * n).fill(0);
  template.labels.forEach((g, i) => {
    const [x, y] = transform([2 * (i % n), 2 * Math.floor(i / n)]);
    labels[y / 2 * n + x / 2] = g;
  });
  p.edges = galaxyEdges(n);
  p.initial = p.edges.map(() => 0);
  p.solution = p.edges.map(([a, b]) => labels[a] === labels[b] ? 0 : 1);
}
