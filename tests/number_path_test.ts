import { dailyDifficulty, DIFFICULTIES, DifficultyChoices } from "../src/difficulty.ts";
import { revealHint, smartHint } from "../src/hints.ts";
import { adjacent, canStepNumberPath, generate, isSolved, type Puzzle } from "../src/puzzles.ts";
import { ProgressStore } from "../src/storage.ts";
import { tutorialSteps } from "../src/tutorials.ts";

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function disk() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
}

Deno.test("Number Path levels have ordered checkpoints, playable walls and deterministic varied routes", () => {
  for (const level of DIFFICULTIES) {
    const layouts = new Set<string>();
    for (let i = 0; i < 150; i++) {
      const seed = i % 2
        ? `practice:path-${i}`
        : new Date(Date.UTC(2026, 8, 25 + i)).toISOString().slice(0, 10);
      const p = generate("snap", seed, level), count = level === "easy" ? 6 : 12;
      assert(p.size === (level === "easy" ? 5 : 7));
      assert(p.clues.filter(Boolean).length === count);
      assert(p.solution.map((i) => p.clues[i]).filter(Boolean).every((v, i) => v === i + 1));
      assert(isSolved(p, p.solution), `${seed}/${level}: solution invalid`);
      assert(!isSolved(p, p.initial));
      assert(p.edges.length === (level === "hard" ? 10 : 0));
      assert(
        new Set(p.edges.map(([a, b]) => `${Math.min(a, b)}/${Math.max(a, b)}`)).size ===
          p.edges.length,
      );
      for (const [a, b] of p.edges) {
        assert(adjacent(a, p.size).includes(b));
        assert(!canStepNumberPath(p, a, b) && !canStepNumberPath(p, b, a));
        assert(Math.abs(p.solution.indexOf(a) - p.solution.indexOf(b)) > 1);
      }
      // Exercise visible-constraint hints along a known valid route, including near walls.
      for (let length = 1; length < p.solution.length; length += 5) {
        const values = p.solution.slice(0, length), hint = smartHint(p, values);
        if (hint.values) {
          assert(hint.values.at(-1) === p.solution[length], "hint contradicts valid route");
        }
      }
      layouts.add(JSON.stringify(p.clues));
    }
    assert(layouts.size > 140, `${level}: too few distinct layouts`);
    const before = JSON.stringify(generate("snap", "identity", level));
    for (let i = 0; i < 110; i++) generate("snap", `evict-${i}`, level);
    assert(JSON.stringify(generate("snap", "identity", level)) === before);
  }
});

Deno.test("Number Path walls constrain hints, completion, saved paths and tutorials", () => {
  const p: Puzzle = {
    ...structuredClone(generate("snap", "walls", "hard")),
    size: 3,
    initial: [0],
    clues: [1, 0, 0, 0, 0, 0, 0, 0, 2],
    solution: [0, 1, 2, 5, 4, 3, 6, 7, 8],
    edges: [[0, 1]],
  };
  assert(!isSolved(p, p.solution), "validator allowed crossing a wall");
  assert(smartHint(p, [0]).values?.at(-1) === 3, "hint crossed wall");
  const storage = disk(), store = new ProgressStore(storage), progress = store.load(p);
  progress.values = [0, 1];
  store.save(p.seed, p.kind, progress, p.difficulty);
  assert(new ProgressStore(storage).load(p).values.length === 1, "invalid wall crossing restored");
  assert(tutorialSteps(p).some((step) => step.title === "Go around walls"));
  const hard = generate("snap", "reveal-walls", "hard");
  let values = [...hard.initial];
  for (let i = 0; i < hard.size ** 2 && !isSolved(hard, values); i++) {
    const hint = revealHint(hard, values);
    assert(hint.values);
    values = hint.values;
  }
  assert(isSolved(hard, values));
});

Deno.test("Number Path preserves original dailies, separates level saves and shares daily credit", () => {
  assert(dailyDifficulty("snap", "2026-09-24") === undefined);
  assert(dailyDifficulty("snap", "2026-09-25") === "hard");
  const original = generate("snap", "2026-09-24");
  assert(JSON.stringify(original.clues) === "[0,0,0,0,2,0,6,0,1,0,0,0,3,0,0,0,5,0,0,0,0,0,0,4,0]");
  const storage = disk(), store = new ProgressStore(storage), date = "2026-09-25";
  const choices = new DifficultyChoices(storage);
  assert(choices.get("snap", date) === "hard");
  for (const [i, level] of DIFFICULTIES.entries()) {
    const p = generate("snap", date, level), progress = store.load(p);
    progress.values = [...p.solution];
    progress.completed = true;
    progress.elapsed = i + 10;
    store.save(date, "snap", progress, level);
    choices.set("snap", date, level);
  }
  for (const [i, level] of DIFFICULTIES.entries()) {
    const restored = new ProgressStore(storage).load(generate("snap", date, level));
    assert(restored.completed && restored.elapsed === i + 10);
  }
  assert(new DifficultyChoices(storage).get("snap", date) === "hard");
  assert(store.count(date) === 1, "levels should earn one daily credit");
  assert(new DifficultyChoices(storage, () => true).get("snap", date) === "hard");
  assert(new DifficultyChoices(disk(), () => true).get("snap", date) === "classic");
});
