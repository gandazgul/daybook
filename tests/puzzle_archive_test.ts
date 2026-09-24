import snapshots from "../src/archive/index.ts";
import { ARCHIVE_END, ARCHIVE_START, archivedDay, archivedPuzzle } from "../src/puzzle-archive.ts";
import { dailyDifficulty, DIFFICULTIES, supportsDifficulty } from "../src/difficulty.ts";
import { generate, isSolved, KINDS } from "../src/puzzles.ts";
import { ProgressStore, STORAGE_KEY } from "../src/storage.ts";

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (v) => v.toString(16).padStart(2, "0")).join("");
}
Deno.test("the first 725 snapshots exactly match the published release before retiring generators", async () => {
  // Captured from release 2c6fe8c BEFORE deleting historical implementations.
  const initial = snapshots.filter((day) => day.date <= "2026-09-25");
  assert(initial.length === 25);
  assert(
    await digest(initial.map((day) => JSON.stringify(day) + "\n").join("")) ===
      "6506ae5f2d843bf2db28a2c1ebec38e33d81552360b16ec39161d38d06599839",
  );
});
Deno.test("every archived variant preserves board identity, saved entries, notes, time and completion", () => {
  const disk = new Map<string, string>();
  const storage = {
    getItem: (key: string) => disk.get(key) ?? null,
    setItem: (key: string, value: string) => {
      disk.set(key, value);
    },
  };
  assert(STORAGE_KEY === "daybook:v1:progress", "migration must retain the existing storage key");
  for (const snapshot of snapshots) {
    const day = archivedDay(snapshot.date)!;
    assert(day.schema === 1 && /^[a-f0-9]{40}$/.test(day.revision));
    let count = 0;
    for (const kind of KINDS) {
      assert(dailyDifficulty(kind, day.date) === (day.defaults[kind] ?? undefined));
      for (const level of [undefined, ...(supportsDifficulty(kind) ? DIFFICULTIES : [])]) {
        const expected = day.puzzles[`${kind}/${level ?? "classic"}`];
        const p = generate(kind, day.date, level);
        assert(p.kind === kind && p.seed === day.date && p.difficulty === level);
        assert(
          JSON.stringify(p) === JSON.stringify(expected),
          `${day.date}/${kind}/${level} changed`,
        );
        assert(isSolved(p, p.solution), "snapshot answer is invalid");
        const store = new ProgressStore(storage), progress = store.load(p);
        const blank = p.initial.findIndex((value) => !value);
        if (blank >= 0 && (kind === "sudoku" || kind === "killer")) {
          progress.notes[blank] = [p.solution[blank]];
        }
        progress.elapsed = 123.5;
        store.save(day.date, kind, progress, level);
        const resumed = new ProgressStore(storage).load(p);
        assert(resumed.elapsed === 123.5);
        assert(JSON.stringify(resumed.values) === JSON.stringify(progress.values));
        assert(JSON.stringify(resumed.notes) === JSON.stringify(progress.notes));
        progress.values = [...p.solution];
        progress.completed = true;
        store.save(day.date, kind, progress, level);
        const complete = new ProgressStore(storage).load(p);
        assert(complete.completed && complete.elapsed === 123.5);
        assert(JSON.stringify(complete.values) === JSON.stringify(p.solution));
        count++;
      }
    }
    assert(Object.keys(day.puzzles).length === count, "archive coverage mismatch");
  }
});
Deno.test("archive data survives runtime mutation and cache eviction", () => {
  const p = generate("nurikabe", "2026-09-24");
  const before = JSON.stringify(p);
  p.clues[0] = 99;
  assert(JSON.stringify(archivedPuzzle("nurikabe", "2026-09-24")) === before);
  for (let i = 0; i < 110; i++) generate("pipes", `archive-eviction:${i}`);
  assert(JSON.stringify(generate("nurikabe", "2026-09-24")) === before);
});
Deno.test("calendar archive is contiguous and new dates and practice use current generators", () => {
  assert(ARCHIVE_START === "2026-09-01");
  for (let time = Date.parse(`${ARCHIVE_START}T12:00:00Z`);; time += 86400000) {
    const date = new Date(time).toISOString().slice(0, 10);
    if (date > ARCHIVE_END) break;
    assert(archivedDay(date)?.date === date, `missing ${date}`);
  }
  let rejected = false;
  try {
    generate("nurikabe", "2026-08-31");
  } catch {
    rejected = true;
  }
  assert(rejected, "prelaunch dates must not silently produce different historical boards");
  const next = new Date(Date.parse(`${ARCHIVE_END}T12:00:00Z`) + 86400000).toISOString().slice(
    0,
    10,
  );
  for (const seed of [next, "practice:archive-boundary"]) {
    assert(!archivedDay(seed));
    const p = generate("nurikabe", seed);
    assert(p.clues.filter((clue) => clue === 1).length <= 2);
    assert(isSolved(p, p.solution));
    assert(dailyDifficulty("snap", seed) === "hard");
    assert(generate("snap", seed, "hard").edges.length === 10);
  }
});
