import snapshots from "./archive/index.ts";
import type { Kind, Puzzle } from "./puzzles.ts";
import type { Difficulty } from "./difficulty.ts";

interface ArchivedDay {
  schema: number;
  date: string;
  revision: string;
  defaults: Record<Kind, Difficulty | null>;
  puzzles: Record<string, Puzzle>;
}
const days = new Map((snapshots as unknown as ArchivedDay[]).map((day) => [day.date, day]));
export const ARCHIVE_START = snapshots[0].date;
export const ARCHIVE_END = snapshots[snapshots.length - 1].date;

export function archivedDay(date: string): ArchivedDay | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  if (date < ARCHIVE_START) throw new Error("This date predates Daybook's calendar");
  if (date > ARCHIVE_END) return;
  const day = days.get(date);
  if (!day || day.schema !== 1) throw new Error(`Missing or unsupported archive: ${date}`);
  return day;
}
export function archivedPuzzle(kind: Kind, date: string, difficulty?: Difficulty) {
  const day = archivedDay(date);
  if (!day) return;
  const puzzle = day.puzzles[`${kind}/${difficulty ?? "classic"}`];
  if (!puzzle) throw new Error(`Missing archived puzzle: ${date}/${kind}/${difficulty}`);
  // Runtime edits must never modify the source snapshot, including after cache eviction.
  return structuredClone(puzzle);
}
