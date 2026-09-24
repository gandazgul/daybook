import { archivedDay } from "./puzzle-archive.ts";
import type { Kind } from "./puzzles.ts";
import type { StorageLike } from "./storage.ts";

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = typeof DIFFICULTIES[number];
export type DifficultyChoice = Difficulty | "classic";
export const DIFFICULTY_LABELS: Record<DifficultyChoice, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  classic: "Original",
};
export const DAILY_DIFFICULTIES: Partial<Record<Kind, Difficulty>> = {
  queens: "hard", mambo: "hard", sudoku: "easy", killer: "easy", snap: "hard",
};
export function supportsDifficulty(kind: Kind) {
  return DAILY_DIFFICULTIES[kind] !== undefined;
}
export function isDifficulty(value: unknown): value is Difficulty {
  return DIFFICULTIES.includes(value as Difficulty);
}
export function dailyDifficulty(kind: Kind, date: string): Difficulty | undefined {
  if (!supportsDifficulty(kind)) return;
  const day = archivedDay(date);
  return day ? day.defaults[kind] ?? undefined : DAILY_DIFFICULTIES[kind];
}
export function difficultyDescription(kind: Kind, level: DifficultyChoice): string {
  if (level === "classic") return "The original daily board, with your existing progress.";
  if (kind === "queens") return {
    easy: "6 × 6 · Find the only available square.",
    medium: "7 × 7 · Combine row, column, and region exclusions.",
    hard: "8 × 8 · Test candidates and follow their consequences.",
  }[level];
  if (kind === "snap") return {
    easy: "5 × 5 · Follow 6 numbered dots.",
    medium: "7 × 7 · Connect 12 dots and fill the larger grid.",
    hard: "7 × 7 · Connect 12 dots while navigating walls.",
  }[level];
  if (kind === "mambo") return {
    easy: "6 × 6 · Follow shape counts, triples, and = / × clues.",
    medium: "6 × 6 · Compare the possible patterns in each line.",
    hard: "6 × 6 · Test shapes and follow their consequences.",
  }[level];
  return {
    easy: kind === "killer"
      ? "9 × 9 · More starting digits and simple cage totals."
      : "9 × 9 · More starting digits and straightforward singles.",
    medium: kind === "killer"
      ? "9 × 9 · Combine cage sums, pairs, and shared exclusions."
      : "9 × 9 · Use pairs and shared row, column, and box exclusions.",
    hard: "9 × 9 · Test candidates and follow their consequences.",
  }[level];
}
export class DifficultyChoices {
  private choices: Record<string, DifficultyChoice> = {};
  constructor(
    private storage: StorageLike,
    private hasOriginal: (kind: Kind, seed: string) => boolean = () => false,
  ) {
    try {
      const raw = JSON.parse(storage.getItem("daybook:difficulty-choices:v1") || "{}");
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [key, value] of Object.entries(raw)) {
          if (isDifficulty(value) || value === "classic") this.choices[key] = value;
        }
      }
    } catch { /* In-memory choices still work when storage is unavailable. */ }
  }
  private key(kind: Kind, seed: string) {
    return `${seed.startsWith("practice:") ? "practice" : seed}/${kind}`;
  }
  get(kind: Kind, seed: string): DifficultyChoice | undefined {
    if (!supportsDifficulty(kind)) return;
    return this.choices[this.key(kind, seed)] ??
      (seed.startsWith("practice:")
        ? "medium"
        : this.hasOriginal(kind, seed)
        ? "classic"
        : dailyDifficulty(kind, seed) ?? "classic");
  }
  set(kind: Kind, seed: string, choice: DifficultyChoice) {
    if (!supportsDifficulty(kind)) return;
    this.choices[this.key(kind, seed)] = choice;
    try {
      this.storage.setItem("daybook:difficulty-choices:v1", JSON.stringify(this.choices));
    } catch { /* Keep the selection for this session. */ }
  }
}
