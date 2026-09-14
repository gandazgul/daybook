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
// Older daily puzzles keep their original board as the default.
export const DIFFICULTY_START = "2026-09-15";
export function supportsDifficulty(kind: Kind) {
  return kind === "queens";
}
export function isDifficulty(value: unknown): value is Difficulty {
  return DIFFICULTIES.includes(value as Difficulty);
}
export function dailyDifficulty(kind: Kind, date: string): Difficulty | undefined {
  if (!supportsDifficulty(kind) || date < DIFFICULTY_START) return;
  // A separate versioned hash: opening or switching a level never rerolls the daily pick.
  let hash = 2166136261;
  for (const c of `daily-difficulty:v1:${kind}:${date}`) {
    hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
  }
  return DIFFICULTIES[hash % DIFFICULTIES.length];
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
