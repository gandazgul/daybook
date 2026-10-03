/** Offline authoring only. Archive published puzzles before replacing the bank. */
import { type Puzzle, Random } from "../src/puzzles.ts";
import { nurikabeOptions, solveNurikabe, validNurikabe } from "../src/extra-puzzles.ts";

const bank: Record<string, Pick<Puzzle, "clues" | "solution">[]> = { medium: [], hard: [] };
const target = Number(Deno.args[1] ?? 32), seen = new Set<string>();
for (const level of ["medium", "hard"] as const) {
  const n = level === "medium" ? 7 : 9, maxArea = level === "medium" ? 5 : 6;
  const neighbors = (i: number) =>
    [i - n, i + n, i % n ? i - 1 : -1, i % n < n - 1 ? i + 1 : -1].filter((j) =>
      j >= 0 && j < n * n
    );
  const islands = (values: number[]) => {
    const seen = new Set<number>(), result: number[][] = [];
    for (let i = 0; i < values.length; i++) {
      if (values[i] !== 2 || seen.has(i)) continue;
      const cells = [i];
      seen.add(i);
      for (let k = 0; k < cells.length; k++) {
        for (const j of neighbors(cells[k])) {
          if (values[j] === 2 && !seen.has(j)) {
            cells.push(j);
            seen.add(j);
          }
        }
      }
      result.push(cells);
    }
    return result;
  };
  const pool = (v: number[]) =>
    v.some((_, i) =>
      i % n < n - 1 && i < n * (n - 1) && [i, i + 1, i + n, i + n + 1].every((j) => v[j] === 1)
    );
  for (let attempt = 0; bank[level].length < target && attempt < 30000; attempt++) {
    const rng = new Random(`nurikabe-bank:anchors:${level}:${attempt}`), values = Array(n * n).fill(2);
    const anchors = (level === "hard" ? 1 : 0) + bank[level].length % 2;
    values[rng.int(values.length)] = 1;
    for (let step = 0; step < n * n; step++) {
      const frontier = rng.shuffle(
        values.flatMap((v, i) => v === 2 && neighbors(i).some((j) => values[j] === 1) ? [i] : []),
      );
      const cell = frontier.find((i) => {
        values[i] = 1;
        const ok = !pool(values) && islands(values).filter((s) => s.length === 1).length <= anchors;
        values[i] = 2;
        return ok;
      });
      if (cell === undefined) break;
      values[cell] = 1;
      const groups = islands(values);
      const singles = groups.filter((s) => s.length === 1).map((s) => s[0]);
      if (
        groups.length < Math.ceil(n * n / 9) || groups.some((s) => s.length > maxArea) ||
        !groups.some((s) => s.length >= (level === "hard" ? 5 : 4)) || singles.length !== anchors
      ) continue;
      // Two anchors should offer starting points in different parts of a Hard board.
      if (singles.length === 2 && Math.abs(Math.floor(singles[0] / n) - Math.floor(singles[1] / n)) +
        Math.abs(singles[0] % n - singles[1] % n) < 5) continue;
      for (let placement = 0; placement < 3; placement++) {
        const clues = Array(n * n).fill(0);
        groups.forEach((cells) => clues[rng.pick(cells)] = cells.length);
        const options = nurikabeOptions(clues, n);
        if (options.filter((o) => o.length > 1).length < Math.ceil(groups.length * .7)) continue;
        const result = solveNurikabe(clues, n, 2, 12000);
        const key = clues.join(",");
        if (result.count !== 1 || result.exhausted || seen.has(key)) continue;
        if (!validNurikabe(clues, values, n)) throw new Error("Invalid authored board");
        seen.add(key);
        bank[level].push({ clues, solution: [...values] });
        await Deno.writeTextFile(
          Deno.args[0] ?? "/tmp/nurikabe-bank.json",
          JSON.stringify(bank) + "\n",
        );
        console.log(level, bank[level].length, "attempt", attempt, "nodes", result.nodes);
        break;
      }
      if (bank[level].length >= target) break;
    }
    if (attempt % 500 === 0) console.log(level, "attempts", attempt);
  }
  if (bank[level].length !== target) {
    throw new Error(`Only found ${bank[level].length} ${level} boards`);
  }
}
