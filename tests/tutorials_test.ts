import { generate, isSolved, KINDS } from "../src/puzzles.ts";
import { validNurikabe } from "../src/extra-puzzles.ts";
import { TUTORIAL_KEY, tutorialSteps, TutorialStore } from "../src/tutorials.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

Deno.test("Every tutorial highlights visible board geometry without using answers or changing puzzles", () => {
  for (const kind of KINDS) {
    for (const seed of ["2026-09-09", "2026-09-10", "practice:tutorial-check"]) {
      const puzzle = generate(kind, seed), original = JSON.stringify(puzzle);
      const steps = tutorialSteps(puzzle);
      assert(steps.length >= 4, `${kind} needs a full walkthrough`);
      for (const step of steps) {
        const size = step.boardExample?.size ?? step.example?.rows.length ?? puzzle.size;
        assert(step.title && step.text && step.cells.length, `${kind}: empty tutorial step`);
        assert(
          step.cells.every((i) => Number.isInteger(i) && i >= 0 && i < size ** 2),
          `${kind}: out-of-board cell`,
        );
        assert(
          (step.lines || []).every((line) => line.every((v) => v >= 0 && v <= size)),
          `${kind}: out-of-board highlight line`,
        );
      }
      assert(JSON.stringify(puzzle) === original, `${kind}: tutorial mutated the puzzle`);
      Object.defineProperty(puzzle, "solution", {
        get() {
          throw new Error("Tutorial must not read the answer");
        },
      });
      assert(
        JSON.stringify(tutorialSteps(puzzle)) === JSON.stringify(steps),
        `${kind}: tutorial depends on hidden answers`,
      );
    }
  }
});

Deno.test("Nurikabe teaching boards distinguish valid islands, forbidden examples and undecided cells", () => {
  const steps = tutorialSteps(generate("nurikabe", "2026-09-09"));
  for (const step of steps) {
    if (!step.example) continue;
    const rows = step.example.rows, cells = [...rows.join("")];
    assert(rows.every((row) => row.length === rows.length), "Examples must be square");
    assert(cells.every((c) => /[1-9o#?]/.test(c)), "Unknown teaching symbol");
    const clues = cells.map((c) => /[1-9]/.test(c) ? Number(c) : 0);
    const values = cells.map((c) => c === "#" ? 1 : c === "?" ? 0 : 2);
    assert(
      validNurikabe(clues, values, rows.length) === (!step.example.invalid && !cells.includes("?")),
      `Incorrect rule example: ${step.title}`,
    );
  }
  assert(!steps.at(-1)!.example, "The last step must return to the player's actual board");
});

Deno.test("Tutorial first-run flags are independent per game and persist across sessions", () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  const first = new TutorialStore(storage);
  assert(!first.hasSeen("sudoku"), "New device should see the tutorial");
  first.markSeen("sudoku");
  assert(first.hasSeen("sudoku"), "Completing the tutorial should mark the game seen");
  const next = new TutorialStore(storage);
  assert(next.hasSeen("sudoku"), "Daily and practice share a game flag across sessions");
  assert(!next.hasSeen("killer"), "Killer has its own tutorial");
  assert(
    data.size === 1 && data.get(TUTORIAL_KEY + "sudoku") === "seen",
    "Only the tutorial flag should be written",
  );
});

Deno.test("Tutorial flags tolerate damaged or unavailable local storage", () => {
  const broken = new TutorialStore({
    getItem: () => "garbage",
    setItem: () => {
      throw new Error("quota");
    },
  });
  assert(!broken.hasSeen("mosaic"), "Invalid flags should not suppress the tutorial");
  broken.markSeen("mosaic");
  assert(broken.hasSeen("mosaic"), "Quota failures should retain the session flag");
  const denied = new TutorialStore({
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  });
  assert(!denied.hasSeen("atoms"), "Denied storage should allow a first tutorial");
  denied.markSeen("atoms");
  assert(denied.hasSeen("atoms"), "Denied storage should not repeat the tutorial in this session");
});

Deno.test("Every tutorial starts with a valid finished example independent of daily and practice puzzles", () => {
  for (const kind of KINDS) {
    const first = tutorialSteps(generate(kind, "2026-09-09"))[0];
    const practice = tutorialSteps(generate(kind, "practice:finished-check"))[0];
    assert(first.finished, `${kind}: must show the goal first`);
    assert(JSON.stringify(first) === JSON.stringify(practice), `${kind}: demo must be independent`);
    if (first.boardExample) {
      const board = first.boardExample;
      assert(
        isSolved({ ...board, seed: "tutorial:finished-example:v1", solution: [] }, board.values),
        `${kind}: finished example must satisfy the actual game rules`,
      );
    } else {
      assert(kind === "nurikabe" && first.example, "Missing finished board");
      const cells = [...first.example.rows.join("")];
      assert(
        validNurikabe(
          cells.map((c) => /[1-9]/.test(c) ? Number(c) : 0),
          cells.map((c) => c === "#" ? 1 : 2),
          first.example.rows.length,
        ),
        "Finished Nurikabe example must be valid",
      );
    }
  }
});
