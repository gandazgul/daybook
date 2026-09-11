import {
  adjacent,
  GENERATOR_VERSION,
  isSolved,
  type Kind,
  kindsForDate,
  type Puzzle,
} from "./puzzles.ts";
export interface Progress {
  values: number[];
  notes: Record<number, number[]>;
  elapsed: number;
  completed: boolean;
  completedAt?: string;
}
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export const STORAGE_KEY = `daybook:v${GENERATOR_VERSION}:progress`;
export function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${
    String(date.getDate()).padStart(2, "0")
  }`;
}
export function parseDate(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}
export function dayIndex(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}
export function featured(key: string): Kind {
  const kinds = kindsForDate(key);
  return kinds[((dayIndex(key) % kinds.length) + kinds.length) % kinds.length];
}
export function formatTime(seconds: number) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
export class ProgressStore {
  private records: Record<string, Progress> = {};
  available = true;
  constructor(private storage: StorageLike) {
    try {
      const raw = JSON.parse(storage.getItem(STORAGE_KEY) || "{}");
      if (raw && typeof raw === "object" && !Array.isArray(raw)) this.records = raw;
    } catch {
      this.available = false;
    }
  }
  key(date: string, kind: Kind) {
    return `${date}/${kind}`;
  }
  get(date: string, kind: Kind): Progress | undefined {
    const p = this.records[this.key(date, kind)];
    if (
      !p || !Array.isArray(p.values) || !p.values.every(Number.isInteger) ||
      !Number.isFinite(p.elapsed) || p.elapsed < 0 || typeof p.completed !== "boolean" ||
      !p.notes || typeof p.notes !== "object"
    ) return;
    if (
      Object.values(p.notes).some((v) =>
        !Array.isArray(v) || v.some((n) => !Number.isInteger(n) || n < 1 || n > 9)
      )
    ) return;
    return structuredClone(p);
  }
  load(puzzle: Puzzle): Progress {
    const saved = this.get(puzzle.seed, puzzle.kind);
    const good = saved && this.validEntries(puzzle, saved.values) &&
      (puzzle.kind === "snap"
        ? saved.values.length <= puzzle.size ** 2
        : saved.values.length === puzzle.initial.length);
    if (good) {
      // Upgrade older Mosaic saves without losing editable squares, notes, or elapsed time.
      if (puzzle.kind === "mosaic") {
        puzzle.initial.forEach((value, i) => {
          if (value) saved.values[i] = value;
        });
      }
      saved.completed = isSolved(puzzle, saved.values);
      return saved;
    }
    return { values: [...puzzle.initial], notes: {}, elapsed: 0, completed: false };
  }
  private validEntries(p: Puzzle, a: number[]): boolean {
    switch (p.kind) {
      case "sudoku":
      case "killer":
      case "mambo":
        return a.every((v, i) =>
          v >= 0 && v <= (p.kind === "mambo" ? 2 : 9) && (!p.initial[i] || v === p.initial[i])
        );
      case "pipes":
        return a.every((v) => v >= 1 && v <= 15);
      case "atoms":
      case "queens":
      case "mosaic":
        return a.every((v) => v >= 0 && v <= 2);
      case "dosun":
        return a.every((v, i) => p.initial[i] === -1 ? v === -1 : v >= 0 && v <= 3);
      case "nurikabe":
        return a.every((v, i) => v >= 0 && v <= 2 && (!p.clues[i] || v === 2));
      case "sets":
      case "fivecells":
        return a.every((v) => v === 0 || v === 1);
      case "shikaku":
        return a.every((v) => v >= 0);
      case "snap":
        return a.length > 0 && a[0] === p.initial[0] && new Set(a).size === a.length &&
          a.every((v, i) =>
            v >= 0 && v < p.size ** 2 && (!i || adjacent(a[i - 1], p.size).includes(v))
          ) && a.map((i) => p.clues[i]).filter((v) => v > 0).every((v, i) => v === i + 1);
    }
  }
  save(date: string, kind: Kind, progress: Progress) {
    this.records[this.key(date, kind)] = structuredClone(progress);
    // Practice is intentionally session-only, keeping the archive small and durable.
    if (date.startsWith("practice:")) return;
    try {
      this.storage.setItem(
        STORAGE_KEY,
        JSON.stringify(Object.fromEntries(
          Object.entries(this.records).filter(([key]) => !key.startsWith("practice:")),
        )),
      );
      this.available = true;
    } catch {
      this.available = false;
    }
  }
  count(date: string) {
    return kindsForDate(date).filter((kind) => this.get(date, kind)?.completed).length;
  }
  started(date: string) {
    return kindsForDate(date).some((kind) => {
      const p = this.get(date, kind);
      return p && (p.elapsed > 0 || p.completed);
    });
  }
}
