/** Offline authoring tool. Existing published banks must not be regenerated in place. */
import { countBalance, countSudoku, generate, type Puzzle, Random } from "../src/puzzles.ts";
import { rateBalance, rateSudoku } from "../src/logic-ratings.ts";
import { DIFFICULTIES, type Difficulty } from "../src/difficulty.ts";

type Template = Pick<Puzzle, "initial" | "solution" | "links" | "cages">;
const bank = {} as Record<string, Record<Difficulty, Template[]>>;
for (const kind of ["mambo", "sudoku", "killer"] as const) {
  const levels: Record<Difficulty, Template[]> = { easy: [], medium: [], hard: [] };
  bank[kind] = levels;
  for (
    let attempt = 0;
    attempt < 3000 && DIFFICULTIES.some((d) => levels[d].length < 24);
    attempt++
  ) {
    const seed = `number-difficulty-bank:v1:${kind}:${attempt}`, rng = new Random(seed);
    const p = structuredClone(generate(kind, seed, "hard"));
    const count = () =>
      kind === "mambo" ? countBalance(p.initial, 6, p.links) : countSudoku(p.initial, p.cages);
    for (const i of rng.shuffle(p.initial.flatMap((v, i) => v ? [i] : []))) {
      const value = p.initial[i];
      p.initial[i] = 0;
      if (count() !== 1) p.initial[i] = value;
    }
    const recorded = new Set<Difficulty>();
    const order = rng.shuffle(p.initial.flatMap((v, i) => v ? [] : [i]));
    while (true) {
      const rating = kind === "mambo"
        ? rateBalance(p.initial, 6, p.links)
        : rateSudoku(p.initial, p.cages);
      if (rating && !recorded.has(rating) && levels[rating].length < 24) {
        const { initial, solution, links, cages } = structuredClone(p);
        levels[rating].push({ initial, solution, links, cages });
        recorded.add(rating);
      }
      if (rating === "easy" || !order.length) break;
      const i = order.pop()!;
      p.initial[i] = p.solution[i];
    }
    if (attempt % 25 === 0) console.log(kind, attempt, DIFFICULTIES.map((d) => levels[d].length));
  }
  if (DIFFICULTIES.some((d) => levels[d].length < 24)) {
    throw Error(`Insufficient ${kind} templates`);
  }
  console.log("Complete", kind);
}
await Deno.writeTextFile(Deno.args[0] ?? "/tmp/number-bank.json", JSON.stringify(bank) + "\n");
