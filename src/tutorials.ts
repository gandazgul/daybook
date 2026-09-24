import { EXAMPLE_CARDS, cardAttributes } from "./sets.ts";
import { akariSight, AKARI_WHITE } from "./akari.ts";
import finishedBoards from "./tutorial-boards.json" with { type: "json" };
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
  finished?: boolean;
  boardExample?: VisiblePuzzle & { values: number[] };
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

const finishedGoals: Record<Exclude<Kind, "nurikabe">, string> = {
  sudoku:
    "Every square is filled. Each row, column and outlined 3 × 3 box contains 1–9 exactly once.",
  killer:
    "Every row, column and 3 × 3 box contains 1–9. Each dashed cage adds up to its clue, without repeated digits.",
  pipes:
    "All pipes carry water from the source. Every opening connects to another pipe, with no leaks or openings off the board.",
  atoms:
    "Every atom has as many bonds as its number. A double line counts as two bonds. All atoms belong to one connected network.",
  queens:
    "There is one queen in every row, column and colored region. No queens touch, even at corners. The other squares can stay blank.",
  shikaku:
    "The whole board is divided into rectangles. Each rectangle has exactly one number, equal to the number of squares inside it.",
  snap:
    "One continuous path visits every square exactly once, passing through the numbered dots in order from 1 to the last number.",
  mambo:
    "Every row and column has three circles and three diamonds, with no three identical symbols in a row. Every = or × clue is satisfied.",
  sets: "All three sets have been found. The eight cards stay visible, including the card shared by two sets.",
  mosaic:
    "Each clue matches the shaded squares in its 3 × 3 area, including itself. Clue squares are fixed; other unshaded squares may stay blank.",
  dosun:
    "Each colored region has one white balloon and one black weight. Balloons are supported above; weights below. Unused squares can stay blank.",
  fivecells:
    "Every outlined group contains exactly five squares. A clue counts the sides of its square that lie on a group boundary, including the board edge.",
  akari:
    "Every white square is lit. Bulbs do not shine on each other, and every numbered wall has exactly its number of bulbs touching its sides.",
};

export function tutorialSteps(p: VisiblePuzzle): TutorialStep[] {
  if (p.kind === "sets") {
    const board: VisiblePuzzle & { values: number[] } = {
      kind: "sets", size: 4, initial: [0, 0, 0], clues: [...EXAMPLE_CARDS],
      regions: [], cages: [], links: [], edges: [], values: [1, 1, 1],
    };
    const cards = [0, 3, 4], all = Array.from({ length: 8 }, (_, i) => i);
    const labels = [
      ["one symbol", "two symbols", "three symbols"],
      ["oval", "diamond", "wave"],
      ["sage", "clay", "lavender"],
      ["outline", "striped", "solid"],
    ];
    return [{
      title: "A finished puzzle", finished: true, boardExample: board, cells: all,
      text: "All three sets are recorded below the cards. Each set uses three cards. Cards stay in place: card 8 belongs to two sets in this separate example.",
    }, ...["Number", "Shape", "Color", "Fill"].map((feature, axis): TutorialStep => {
      const values = cards.map((i) => cardAttributes(board.clues[i])[axis]);
      return {
        title: `${feature}: same or different`, boardExample: { ...board, values: [1, 0, 0] }, cells: cards,
        text: `Compare cards 1, 4 and 5. Their ${feature.toLowerCase()} is ${new Set(values).size === 1 ? `the same on all three (${labels[axis][values[0]]})` : `different on all three (${values.map((v) => labels[axis][v]).join(", ")})`}. This passes. Two the same and one different would fail.`,
      };
    }), {
      title: "Every feature must pass", boardExample: { ...board, values: [1, 0, 0] }, cells: cards,
      text: "These three cards pass all four checks, so they form a set. One feature can be all the same while another is all different. If even one feature fails, the group is not a set.",
    }, {
      title: "Find three different sets", cells: all,
      text: "This is your board. Tap three cards to check them; tap a selected card to deselect it. Cards can be reused, but the same trio only counts once. There are exactly three sets. Find all three to finish.",
    }];
  }
  const steps = ruleSteps(p);
  if (p.kind === "nurikabe") {
    steps[0].finished = true;
    steps[0].title = "A finished puzzle";
    return steps;
  }
  // These fixed examples are unrelated to the current puzzle and never reveal its answer.
  const boardExample = finishedBoards[p.kind] as VisiblePuzzle & { values: number[] };
  return [{
    title: "A finished puzzle",
    text: finishedGoals[p.kind] +
      " This is a separate example. Next explains the rules on your board.",
    finished: true,
    boardExample,
    cells: Array.from({ length: boardExample.size ** 2 }, (_, i) => i),
  }, ...steps];
}

function ruleSteps(p: VisiblePuzzle): TutorialStep[] {
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
      "Select an empty cell, then tap a keypad digit or press 1–9. Backspace or the eraser button clears an entry.",
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
    case "akari": {
      const white = first((i) => p.clues[i] === AKARI_WHITE);
      const numbered = first((i) => p.clues[i] >= 0);
      return [
        step("Light every white square", "Place bulbs in white squares. The warm shading shows which squares are lit; every white square needs light.", all.filter((i) => p.clues[i] === AKARI_WHITE)),
        step("Light travels straight", "A bulb lights its own square and shines along its row and column. Black squares and the outer edge stop the light. Light does not bend or travel diagonally.", akariSight(p.clues, n)[white]),
        step("Bulbs need their own space", "Never place two bulbs where one can shine on the other. A black square between them blocks the light, so bulbs on opposite sides of that wall are allowed.", akariSight(p.clues, n)[white]),
        step("Numbers count neighboring bulbs", "A number on a black square gives the exact number of bulbs touching its four sides. Diagonal bulbs do not count. A 0 forbids bulbs on all neighboring white squares.", [numbered, ...all.filter((i) => Math.abs(Math.floor(i / n) - Math.floor(numbered / n)) + Math.abs(i % n - numbered % n) === 1)]),
        step("Unnumbered walls", "A black square without a number only blocks light. It does not require any particular number of neighboring bulbs.", all.filter((i) => p.clues[i] === -1)),
        step("Bulb, note, or empty", "Tap a white square to cycle bulb → X → empty. Xs are optional notes for squares without bulbs. With a keyboard, use arrows and Space. Black squares cannot be changed.", [white]),
      ];
    }
    case "sets":
      return [];
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
          "Single-tap to mark an X. Drag from an empty square to add Xs, or from an X to erase Xs. Dragging preserves queens. Xs are optional notes.",
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
        ...(p.edges.length ? [step(
          "Go around walls",
          "Thick lines between squares are walls. Your path cannot cross them; find a route around them while following the numbers.",
          [...new Set(p.edges.flat())],
        )] : []),
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
          "The numbered square is part of the count. Its shading is already given and locked: include it if shaded; do not count it if unshaded.",
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
          "Fill the unnumbered squares",
          "Tap a square without a number to cycle shaded → marked empty → undecided. Numbered squares are fixed. Empty marks are optional.",
          [first((i) => p.clues[i] < 0)],
        ),
        step(
          "Empty marks are optional",
          "Finish when every clue matches the shaded squares. You can leave other squares blank. Empty marks are only an aid for keeping track.",
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
          "Tap or drag to change each square once: blank → water → land dot → blank. Drag over water to mark land dots. Numbered squares always stay land.",
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
