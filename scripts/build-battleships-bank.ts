import { Random } from "../src/puzzles.ts";
import {
  deduceBattleships,
  type FleetClues,
  fleetForSize,
  shipNeighbors,
  shipParts,
  solveBattleships,
} from "../src/battleships.ts";
const rng = new Random("battleships-bank:v1");
const bank: Record<string, { initial: number[]; solution: number[] }[]> = {
  easy: [],
  medium: [],
  hard: [],
};
for (let attempt = 0; Object.values(bank).some((a) => a.length < 24); attempt++) {
  const n = bank.easy.length < 24 || bank.medium.length < 24 ? 6 : 8;
  const all = Array.from({ length: n * n }, (_, i) => i), solution = all.map(() => 2);
  let failed = false;
  for (const length of fleetForSize(n)) {
    const candidates = all.flatMap((i) =>
      [1, n].flatMap((step) => {
        if (
          step === 1 && i % n + length > n || step === n && Math.floor(i / n) + length > n
        ) return [];
        const cells = Array.from({ length }, (_, k) => i + k * step);
        return cells.every((j) =>
            solution[j] !== 1 && shipNeighbors(j, n, true).every((k) => solution[k] !== 1)
          )
          ? [cells]
          : [];
      })
    );
    if (!candidates.length) {
      failed = true;
      break;
    }
    rng.pick(candidates).forEach((i) => solution[i] = 1);
  }
  if (failed) continue;
  const initial = [...solution], parts = shipParts(solution, n);
  const data: FleetClues = {
    rows: Array.from(
      { length: n },
      (_, r) => solution.slice(r * n, r * n + n).filter((v) => v === 1).length,
    ),
    columns: Array.from(
      { length: n },
      (_, c) => all.filter((i) => i % n === c && solution[i] === 1).length,
    ),
    fleet: fleetForSize(n),
    parts: [...parts],
  };
  const easy = n === 6 && bank.easy.length < 24;
  for (const i of rng.shuffle(all)) {
    const v = initial[i], part = data.parts[i];
    initial[i] = 0;
    data.parts[i] = "";
    const solved = solveBattleships(data, initial, n, 2, 50000);
    if (
      solved.exhausted || solved.solutions.length !== 1 ||
      (easy && deduceBattleships(data, initial, n).values.includes(0))
    ) {
      initial[i] = v;
      data.parts[i] = part;
    }
  }
  const local = deduceBattleships(data, initial, n),
    remaining = local.values.filter((v) => !v).length;
  const level = easy ? "easy" : n === 6 ? "medium" : "hard";
  if (
    bank[level].length >= 24 || !easy && remaining < (n === 6 ? 4 : 10) ||
    initial.filter(Boolean).length > (easy ? 9 : n === 6 ? 6 : 10)
  ) continue;
  if (bank[level].some((b) => b.solution.join() === solution.join())) continue;
  bank[level].push({ initial, solution });
  console.log(
    attempt,
    level,
    bank[level].length,
    "clues",
    initial.filter(Boolean).length,
    "remaining",
    remaining,
  );
  await Deno.writeTextFile("src/battleships-bank.json", JSON.stringify(bank) + "\n");
}
