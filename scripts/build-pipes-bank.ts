/** Offline authoring. Archive published puzzles before replacing an existing bank. */
import { adjacent, direction, Random } from "../src/puzzles.ts";
import { pipeDomains, PIPES_SIZES, ratePipes, solvePipes } from "../src/pipes-logic.ts";

const bank: Record<string, number[][]> = { easy: [], medium: [], hard: [] };
const target = Number(Deno.args[1] ?? 32);
for (const level of ["easy", "medium", "hard"] as const) {
  const n = PIPES_SIZES[level], seen = new Set<string>(), ratings: Record<string, number> = {};
  for (let attempt = 0; attempt < 30000 && bank[level].length < target; attempt++) {
    const rng = new Random(`pipes-bank:${level}:${attempt}`), solution = Array(n * n).fill(0);
    const parent = solution.map((_, i) => i);
    const root = (i: number): number => parent[i] === i ? i : parent[i] = root(parent[i]);
    const edges = rng.shuffle(solution.flatMap((_, i) => adjacent(i, n).filter((j) => j > i).map((j) => [i, j])));
    for (const [i, j] of edges) {
      const a = root(i), b = root(j);
      if (a === b) continue;
      parent[a] = b;
      solution[i] |= direction(i, j, n);
      solution[j] |= direction(j, i, n);
    }
    if (pipeDomains(solution, n).filter((d) => d.length === 1).length < 2) continue;
    const rating = ratePipes(solution, n);
    ratings[rating ?? "unrated"] = (ratings[rating ?? "unrated"] ?? 0) + 1;
    if (rating === level && !seen.has(solution.join(","))) {
      const result = solvePipes(solution, n);
      if (result.count !== 1 || result.exhausted) throw new Error("Unproven unique board");
      seen.add(solution.join(","));
      bank[level].push(solution);
      await Deno.writeTextFile(Deno.args[0] ?? "/tmp/pipes-bank.json", JSON.stringify(bank) + "\n");
      console.log(level, bank[level].length, "attempt", attempt, "nodes", result.nodes);
    }
    if (attempt % 100 === 0) console.log(level, attempt, ratings);
  }
  if (bank[level].length !== target) throw new Error(`Found only ${bank[level].length} ${level} boards`);
}
