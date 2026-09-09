import type { Kind, Puzzle } from "./puzzles.ts";
import type { StorageLike } from "./storage.ts";

export const TUTORIAL_KEY = "daybook:tutorials:v1:";

/** One flag per game, shared by daily and practice; unavailable storage falls back to this session. */
export class TutorialStore {
  private seen = new Set<Kind>();
  constructor(private storage: StorageLike) {}
  hasSeen(kind: Kind) {
    if (this.seen.has(kind)) return true;
    try {
      return this.storage.getItem(TUTORIAL_KEY + kind) === "seen";
    } catch {
      return false;
    }
  }
  markSeen(kind: Kind) {
    this.seen.add(kind);
    try {
      this.storage.setItem(TUTORIAL_KEY + kind, "seen");
    } catch { /* Keep the session flag when local storage is unavailable. */ }
  }
}

export interface TutorialStep {
  title: string;
  text: string;
  example?: { rows: string[]; invalid?: boolean };
  cells: number[];
  anchor?: number;
  rings?: [number, number, number][];
  // Lines use board coordinates, so highlights survive resizing without covering clues.
  lines?: [number, number, number, number][];
}
// Tutorials can inspect visible clues and geometry, never the solution or the player's answers.
type VisiblePuzzle = Pick<
  Puzzle,
  "kind" | "size" | "initial" | "clues" | "regions" | "cages" | "links" | "edges"
>;

export function tutorialSteps(p: VisiblePuzzle): TutorialStep[] {
  const n = p.size, all = Array.from({ length: n * n }, (_, i) => i);
  const row = (r: number) => all.filter((i) => Math.floor(i / n) === r);
  const col = (c: number) => all.filter((i) => i % n === c);
  const neighborhood = (i: number) =>
    all.filter((j) =>
      Math.abs(i % n - j % n) <= 1 && Math.abs(Math.floor(i / n) - Math.floor(j / n)) <= 1
    );
  const first = (predicate: (i: number) => boolean) => all.find(predicate) ?? 0;
  const center = Math.floor(n / 2) * n + Math.floor(n / 2);
  const fixed = first((i) => p.initial[i] > 0), blank = first((i) => !p.initial[i]);
  const clue = first((i) => p.clues[i] > 0);
  const regionId = p.regions.find((r) => r >= 0);
  const region = all.filter((i) => p.regions[i] === regionId);
  const step = (title: string, text: string, cells = all): TutorialStep => ({ title, text, cells });
  const sharedEdge = (a: number, b: number): [number, number, number, number] => {
    const x = (a % n + b % n) / 2 + .5;
    const y = (Math.floor(a / n) + Math.floor(b / n)) / 2 + .5;
    return a % n === b % n ? [x - .5, y, x + .5, y] : [x, y - .5, x, y + .5];
  };
  const cellSides = (i: number): TutorialStep["lines"] => {
    const x = i % n, y = Math.floor(i / n);
    return [[x, y, x + 1, y], [x + 1, y, x + 1, y + 1], [x + 1, y + 1, x, y + 1], [x, y + 1, x, y]];
  };
  const sudoku = [
    step("Every row", "Fill each row with 1–9. A digit appears exactly once in each row.", row(0)),
    step("Every column", "Each column must also contain 1–9, with no repeated digits.", col(0)),
    step(
      "Every box",
      "Each outlined 3 × 3 box must contain 1–9, with no repeated digits.",
      all.filter((i) => Math.floor(i / n) < 3 && i % n < 3),
    ),
  ];
  const sudokuControls = [
    step("Fixed clues", "The starting numbers are fixed. Fill the empty cells around them.", [
      fixed,
    ]),
    step(
      "Write a number",
      "Select an empty cell, then tap a keypad digit or press 1–9. Backspace or the × button clears an entry.",
      [blank],
    ),
    step(
      "Pencil notes",
      "Notes are optional. Turn Notes on, or drag across cells to select several. A digit toggles that note in the selected empty cells.",
      [blank, ...row(Math.floor(blank / n)).filter((i) => !p.initial[i])],
    ),
    step(
      "Notes follow entries",
      "Placing a digit removes conflicting notes in its row, column and box" +
        (p.kind === "killer" ? ", and its cage." : ".") +
        " Undo restores the entry and those notes together.",
      [...row(Math.floor(blank / n)), ...col(blank % n)],
    ),
    step(
      "A single note",
      "Double-tap or double-click a cell with exactly one note to fill that number. Notes mode can stay on.",
      [blank],
    ),
    step(
      "Completed digits",
      "Once nine copies of a digit are placed, its keypad button turns gray and disables. Clearing or undoing an entry enables it again.",
    ),
  ];
  switch (p.kind) {
    case "sudoku":
      return [...sudoku, ...sudokuControls];
    case "killer": {
      const cage = p.cages[0];
      return [
        ...sudoku,
        step(
          "Cage totals",
          "The numbers inside each dashed cage must add up to its small corner clue.",
          cage.cells,
        ),
        step(
          "No repeats in a cage",
          "A digit cannot appear twice in the same cage, even in different rows, columns or boxes.",
          cage.cells,
        ),
        ...sudokuControls,
      ];
    }
    case "pipes": {
      const endpoint = first((i) => i !== 0 && [1, 2, 4, 8].includes(p.initial[i]));
      return [
        step("The water source", "Connect the entire pipe network to this filled source.", [0]),
        step(
          "Every endpoint",
          "The water must reach every pipe and every endpoint. Endpoints have just one opening.",
          [endpoint],
        ),
        step(
          "Turn the pipes",
          "Tap a tile to rotate its pipe clockwise. Tiles stay in their squares.",
          [center],
        ),
        step(
          "No loose openings",
          "Every opening must face an opening in the next tile. No openings may point off the board.",
          [center, center + 1],
        ),
        step(
          "Follow the water",
          "Blue pipes are currently connected to the source. Finish when all pipes connect and no openings leak.",
          [0, ...row(0)],
        ),
      ];
    }
    case "atoms": {
      const [a, b] = p.edges[0];
      const dx = b % n - a % n, dy = Math.floor(b / n) - Math.floor(a / n);
      const bond = {
        ...step(
          "One or two bonds",
          "Bonds join atoms in neighboring squares horizontally or vertically. One line counts as one bond; two lines count as two.",
          [a, b],
        ),
        lines: [
          [
            a % n + .5 + dx * .33,
            Math.floor(a / n) + .5 + dy * .33,
            b % n + .5 - dx * .33,
            Math.floor(b / n) + .5 - dy * .33,
          ] as [
            number,
            number,
            number,
            number,
          ],
        ],
      };
      return [
        step(
          "Match each number",
          "Each atom needs exactly the number of bonds printed inside it.",
          [a],
        ),
        bond,
        {
          ...bond,
          title: "Draw a connection",
          text:
            "Tap between neighboring atoms to cycle no bond → one line → two lines → no bond. Keyboard: Shift + an arrow edits a selected atom’s bond.",
        },
        step(
          "One molecule",
          "All atoms must belong to one connected network. Separate groups do not finish the puzzle.",
        ),
      ];
    }
    case "queens":
      return [
        step("One per row", "Place exactly one queen in every row.", row(0)),
        step("One per column", "Place exactly one queen in every column.", col(0)),
        step(
          "One per region",
          "Each colored region must contain exactly one queen. Letters identify the regions too.",
          region,
        ),
        step(
          "Queens cannot touch",
          "Two queens cannot occupy neighboring squares, including diagonals. This outline shows a square and all its neighbors; it is not a suggested placement.",
          neighborhood(center),
        ),
        step(
          "Place a queen",
          "Double-tap or double-click a square to place a queen. Tap an existing mark to clear it. Keyboard: Space cycles empty, queen and X.",
          [center],
        ),
        step(
          "Optional X marks",
          "Single-tap to mark an X, or drag to mark several. Dragging preserves queens. Xs are only notes and are not required to finish.",
          row(0),
        ),
      ];
    case "shikaku":
      return [
        step(
          "Cover the grid",
          "Divide the whole grid into rectangles. Leave no gaps and no overlapping rectangles.",
        ),
        step("One clue per rectangle", "Every rectangle must contain exactly one numbered clue.", [
          clue,
        ]),
        step(
          "The clue is its area",
          "A rectangle must contain exactly as many squares as its clue says. Count every square, including the clue’s square.",
          [clue],
        ),
        step(
          "Draw a rectangle",
          "Drag between opposite corners, or tap one corner and then the other. Tap a placed rectangle to remove it.",
        ),
      ];
    case "snap": {
      const start = first((i) => p.clues[i] === 1);
      return [
        step("Start at 1", "Your path starts at the dot numbered 1.", [start]),
        step(
          "Follow the numbers",
          "Visit the numbered dots in order. Finish at the highest numbered dot.",
          all.filter((i) => p.clues[i] > 0),
        ),
        step(
          "Move along edges",
          "Move horizontally or vertically between squares that share an edge. Diagonal moves are not allowed.",
          [center, center - 1, center + 1, center - n, center + n],
        ),
        step(
          "Use every square",
          "Your single path must visit every square exactly once before it finishes. It cannot cross or revisit itself.",
        ),
        step(
          "Draw and backtrack",
          "Drag or tap adjacent squares to extend your path. Tap an earlier square on the path to backtrack.",
          [start],
        ),
      ];
    }
    case "mambo": {
      const steps = [
        step("Balance each row", "Fill every row with three circles and three diamonds.", row(0)),
        step(
          "Balance each column",
          "Fill every column with three circles and three diamonds too.",
          col(0),
        ),
        step("No three in a row", "Never place three identical shapes consecutively in a row.", [
          0,
          1,
          2,
        ]),
        step(
          "No three in a column",
          "Never place three identical shapes consecutively in a column either.",
          [0, n, n * 2],
        ),
      ];
      for (const same of [true, false]) {
        const link = p.links.find((l) => l.same === same);
        steps.push({
          ...step(
            same ? "Matching neighbors" : "Different neighbors",
            same
              ? "An = between two squares means their shapes must match."
              : "A × between two squares means their shapes must differ.",
            link ? [link.a, link.b] : all,
          ),
          ...(link
            ? {
              rings: [
                [
                  (link.a % n + link.b % n) / 2 + .5,
                  (Math.floor(link.a / n) + Math.floor(link.b / n)) / 2 + .5,
                  .24,
                ] as [number, number, number],
              ],
            }
            : {}),
        });
      }
      return [
        ...steps,
        step(
          "Starting shapes",
          "Shapes with a small corner dot are fixed and cannot be changed.",
          all.filter((i) => p.initial[i] > 0),
        ),
        step("Choose a shape", "Tap an editable square to cycle circle → diamond → empty.", [
          blank,
        ]),
      ];
    }
    case "mosaic": {
      const middle = first((i) =>
        p.clues[i] >= 0 && i % n > 0 && i % n < n - 1 && i >= n && i < n * (n - 1)
      );
      const edge = first((i) =>
        p.clues[i] >= 0 && (i % n === 0 || i % n === n - 1 || i < n || i >= n * (n - 1))
      );
      return [
        {
          ...step(
            "Count the shaded squares",
            "Each clue gives the number of shaded squares in its surrounding 3 × 3 area.",
            neighborhood(middle),
          ),
          anchor: middle,
        },
        step(
          "Include the clue’s square",
          "The square containing the number is part of the count. It can be shaded or marked empty too.",
          [middle],
        ),
        {
          ...step(
            "Only inside the board",
            "At an edge, count only squares inside the board. A corner covers four squares; any other edge square covers six.",
            neighborhood(edge),
          ),
          anchor: edge,
        },
        step(
          "Three cell states",
          "Tap a square to cycle shaded → marked empty → undecided. An empty mark means you have decided to leave it unshaded.",
          [middle],
        ),
        step(
          "Decide every square",
          "Finish with every square shaded or marked empty, and every clue’s count satisfied.",
        ),
        {
          ...step(
            "Red clue feedback",
            "A clue turns red if it has too many shaded squares, or too few once its whole neighborhood is decided. An undecided count can still be wrong.",
            neighborhood(middle),
          ),
          anchor: middle,
        },
      ];
    }
    case "dosun": {
      const rock = first((i) => p.regions[i] < 0);
      return [
        step(
          "One of each per region",
          "Every colored region needs exactly one white balloon and one black weight.",
          region,
        ),
        step(
          "Balloons rise",
          "A balloon must have the top edge, a rock or another balloon directly above it. Nothing else supports it.",
          col(center % n),
        ),
        step(
          "Weights fall",
          "A weight must have the bottom edge, a rock or another weight directly below it. Nothing else supports it.",
          col(center % n),
        ),
        step(
          "Region lines are not support",
          "Colored region boundaries do not support either piece. Support is checked across region boundaries too.",
          region,
        ),
        step(
          "Rocks are fixed",
          "The dark squares with diagonal strokes are rocks. You cannot place a piece on a rock or remove it.",
          p.regions.some((r) => r < 0) ? [rock] : all,
        ),
        step(
          "Place the pieces",
          "Tap a square to cycle white balloon → black weight → X → clear.",
          [first((i) => p.regions[i] >= 0)],
        ),
        step(
          "Xs are optional",
          "Xs are notes for unused squares. Unused squares may stay blank; only the balloons and weights are required.",
        ),
      ];
    }
    case "nurikabe": {
      // Fixed teaching boards, independent of the daily puzzle and its hidden solution.
      // Digits and o are land; # is water; ? is undecided.
      const complete = ["3o#2o", "#o###", "###1#", "2o###", "###2o"];
      const corners = ["####", "#2o#", "###2", "2o#o"];
      const example = (
        title: string,
        text: string,
        rows: string[],
        cells?: number[],
        invalid = false,
      ): TutorialStep => ({
        title,
        text,
        cells: cells ?? Array.from({ length: rows.length ** 2 }, (_, i) => i),
        example: { rows, invalid },
      });
      return [
        example(
          "Land and water",
          "Pale squares are land. Blue squares are water. The goal is to make separate islands surrounded by one connected body of water.",
          complete,
        ),
        {
          ...example(
            "A 3 means three squares",
            "This island has three land squares: the numbered square plus two dotted squares. The number gives the TOTAL island size.",
            complete,
            [0, 1, 6],
          ),
          anchor: 0,
        },
        {
          ...example(
            "A 1 is already an island",
            "The numbered square counts as land. This 1 is an entire island by itself: one square, with nothing added.",
            complete,
            [13],
          ),
          anchor: 13,
        },
        example(
          "Land joins along sides",
          "These three land squares share edges, making one L-shaped island. Islands can have any shape; squares must connect along their sides.",
          complete,
          [0, 1, 6],
        ),
        example(
          "Two numbers: not allowed",
          "Land sharing an edge becomes ONE island. These joined squares contain two numbers, which is forbidden. Different islands cannot share an edge.",
          ["3o#2o", "#2###", "###1#", "2o###", "###2o"],
          [0, 1, 6],
          true,
        ),
        example(
          "Corner touches are allowed",
          "These two islands touch only at a corner. That is allowed: a corner touch does not join land into one island.",
          corners,
          [5, 6, 11, 15],
        ),
        example(
          "All water must connect",
          "You must be able to travel between any two blue squares using water only. Move up, down, left or right; diagonal contact does not connect water.",
          complete,
          [...complete.join("")].flatMap((v, i) => v === "#" ? [i] : []),
        ),
        example(
          "Four water squares: no",
          "The outlined water squares form a solid 2 × 2 block. That is forbidden, anywhere on the board. Water can bend and branch, but cannot fill a 2 × 2 block.",
          ["3o#2o", "#o###", "#####", "2o###", "###2o"],
          [7, 8, 12, 13],
          true,
        ),
        example(
          "How to mark a square",
          "Tap once for water, twice for land (a dot), and again to clear. A blank square is still undecided. Numbered squares always stay land.",
          ["?#o", "???", "???"],
          [0, 1, 2],
        ),
        step(
          "Back to your puzzle",
          "Mark every square as land or water. Each island needs one number and the right size; all water must connect, without any solid 2 × 2 blocks.",
        ),
      ];
    }
    case "fivecells": {
      const numbered = first((i) => p.clues[i] >= 0);
      const edge = p.edges[0];
      return [
        step(
          "Five squares per region",
          "Divide the whole grid into regions of exactly five squares each. Regions do not have to be rectangles.",
        ),
        step(
          "Connect along sides",
          "The five squares within a region must connect through shared edges. A corner touch alone does not connect them.",
          [center, center + 1],
        ),
        {
          ...step(
            "Clues count borders",
            "Each clue counts how many of its square’s four sides are region borders.",
            [numbered],
          ),
          lines: cellSides(numbered),
        },
        {
          ...step(
            "The frame counts too",
            "The outer frame counts as a border wherever it touches a square.",
            [0],
          ),
          lines: [[0, 0, 1, 0], [0, 0, 0, 1]],
        },
        step(
          "Any number of clues",
          "A region may contain no clues, one clue or several. Its size must still be exactly five squares.",
        ),
        step(
          "No extra internal borders",
          "Borders separate different regions. Do not leave an extra border between two squares that are still connected within the same region.",
        ),
        {
          ...step(
            "Draw the borders",
            "Tap a shared grid edge to add or remove a border. Drag along edges to draw several. Keyboard: Shift + an arrow toggles a selected square’s border.",
            edge,
          ),
          lines: [sharedEdge(...edge)],
        },
      ];
    }
  }
}
