import { findSets, setDescription } from "./sets.ts";
import { fiveCellOptions } from "./extra-puzzles.ts";
import { adjacent, direction, isSolved, type Puzzle, rectangle, rotate } from "./puzzles.ts";

/** Smart hints deliberately cannot access a generated answer. Entries are treated as assumptions. */
type VisiblePuzzle = Omit<Puzzle, "solution" | "seed">;
export interface Hint {
  title: string;
  text: string;
  cells: number[];
  values?: number[];
}
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const at = (i: number, n: number) => `row ${Math.floor(i / n) + 1}, column ${i % n + 1}`;
const neighborhood = (i: number, n: number) =>
  range(n * n).filter((j) =>
    Math.abs(i % n - j % n) <= 1 && Math.abs(Math.floor(i / n) - Math.floor(j / n)) <= 1
  );
const problem = (text: string, cells: number[]): Hint => ({
  title: "Check these entries",
  text,
  cells,
});
const move = (a: number[], i: number, v: number, text: string, cells = [i]): Hint => {
  const values = [...a];
  values[i] = v;
  return { title: "A logical next move", text, cells: [...new Set(cells)], values };
};
function groups(a: number[], n: number, value: number) {
  const seen = new Set<number>(), result: number[][] = [];
  for (const i of range(n * n)) {
    if (a[i] !== value || seen.has(i)) continue;
    const cells = [i];
    seen.add(i);
    for (let k = 0; k < cells.length; k++) {
      for (const j of adjacent(cells[k], n)) {
        if (a[j] === value && !seen.has(j)) {
          seen.add(j);
          cells.push(j);
        }
      }
    }
    result.push(cells);
  }
  return result;
}

export function smartHint(p: VisiblePuzzle, a: number[]): Hint {
  const n = p.size, all = range(n * n);
  const row = (i: number) => all.filter((j) => Math.floor(i / n) === Math.floor(j / n));
  const col = (i: number) => all.filter((j) => i % n === j % n);
  const put = (i: number, v: number, why: string, cells = [i]) => move(a, i, v, why, cells);
  switch (p.kind) {
    case "sets": {
      const triples = findSets(p.clues), index = triples.findIndex((_, i) => !a[i]);
      if (index < 0) return { title: "Already complete", text: "All three sets have been found.", cells: range(8) };
      const cells = triples[index], values = [...a];
      values[index] = 1;
      return {
        title: "Compare these three cards",
        text: `Cards ${cells.map((i) => i + 1).join(", ")} form a set: ${setDescription(cells.map((i) => p.clues[i]))}. Every feature passes the same-or-different rule. Apply to record this set.`,
        cells,
        values,
      };
    }
    case "sudoku":
    case "killer": {
      const units = [
        ...range(9).map((r) => row(r * 9)),
        ...range(9).map(col),
        ...range(9).map((b) =>
          all.filter((i) => Math.floor(i / 27) * 3 + Math.floor(i % 9 / 3) === b)
        ),
      ];
      const unique = [...units, ...p.cages.map((c) => c.cells)];
      for (const cells of unique) {
        const filled = cells.filter((i) => a[i]);
        if (new Set(filled.map((i) => a[i])).size !== filled.length) {
          return problem(
            "A digit repeats in this row, column, box or cage. Correct the repeated entry before using a deduction.",
            cells,
          );
        }
      }
      const candidates = all.map((i) =>
        a[i]
          ? []
          : range(9).map((v) => v + 1).filter((v) =>
            unique.filter((u) => u.includes(i)).every((u) => u.every((j) => a[j] !== v))
          )
      );
      for (const cage of p.cages) {
        const empty = cage.cells.filter((i) => !a[i]),
          total = cage.cells.reduce((s, i) => s + a[i], 0);
        if (total > cage.sum || (!empty.length && total !== cage.sum)) {
          return problem(`These entries do not fit the cage total of ${cage.sum}.`, cage.cells);
        }
        if (empty.length === 1) {
          const v = cage.sum - total, i = empty[0];
          if (!candidates[i].includes(v)) {
            return problem(
              "The remaining cage total conflicts with a row, column or box.",
              cage.cells,
            );
          }
          return put(
            i,
            v,
            `The cage totals ${cage.sum}; its filled digits add to ${total}. Put ${v} at ${
              at(i, n)
            }.`,
            cage.cells,
          );
        }
      }
      const impossible = all.find((i) => !a[i] && !candidates[i].length);
      if (impossible !== undefined) {
        return problem("No digit fits this empty square. Check the surrounding entries.", [
          impossible,
        ]);
      }
      const single = all.find((i) => candidates[i].length === 1);
      if (single !== undefined) {
        return put(
          single,
          candidates[single][0],
          `Only ${candidates[single][0]} can go at ${
            at(single, n)
          }: the other digits already occur in its row, column, box${
            p.kind === "killer" ? " or cage" : ""
          }.`,
          unique.filter((u) => u.includes(single)).flat(),
        );
      }
      for (const cells of units) {
        for (const v of range(9).map((v) => v + 1)) {
          if (cells.some((i) => a[i] === v)) continue;
          const places = cells.filter((i) => candidates[i].includes(v));
          if (!places.length) {
            return problem(
              `There is no place for ${v} in this highlighted row, column or box. Check its entries.`,
              cells,
            );
          }
          if (places.length === 1) {
            return put(
              places[0],
              v,
              `This highlighted row, column or box needs a ${v}. Only ${
                at(places[0], n)
              } can hold it without repeating a digit.`,
              cells,
            );
          }
        }
      }
      break;
    }
    case "mosaic": {
      const constraints = all.filter((i) => p.clues[i] >= 0).map((i) => {
        const cells = neighborhood(i, n), unknown = cells.filter((j) => !a[j]);
        return {
          i,
          cells,
          unknown,
          remaining: p.clues[i] - cells.filter((j) => a[j] === 1).length,
        };
      });
      for (const c of constraints) {
        if (c.remaining < 0 || c.remaining > c.unknown.length) {
          return problem(
            `The clue at ${at(c.i, n)} cannot be satisfied with these shaded and empty marks.`,
            c.cells,
          );
        }
      }
      for (const c of constraints) {
        if (c.unknown.length && (c.remaining === 0 || c.remaining === c.unknown.length)) {
          const i = c.unknown[0], shade = c.remaining > 0;
          return put(
            i,
            shade ? 1 : 2,
            shade
              ? `The clue at ${
                at(c.i, n)
              } still needs ${c.remaining} shaded squares and has exactly ${c.unknown.length} undecided squares. Shade ${
                at(i, n)
              }.`
              : `The clue at ${at(c.i, n)} already has all its shaded squares. ${
                at(i, n)
              } must stay unshaded; an optional empty mark records that.`,
            c.cells,
          );
        }
      }
      for (const small of constraints) {
        for (const big of constraints) {
          if (
            !small.unknown.length || small.unknown.length >= big.unknown.length ||
            !small.unknown.every((i) => big.unknown.includes(i))
          ) continue;
          const extra = big.unknown.filter((i) => !small.unknown.includes(i)),
            remaining = big.remaining - small.remaining;
          if (remaining < 0 || remaining > extra.length) {
            return problem("These overlapping clues cannot both match the current marks.", [
              ...small.cells,
              ...big.cells,
            ]);
          }
          if (remaining === 0 || remaining === extra.length) {
            return put(
              extra[0],
              remaining ? 1 : 2,
              `Compare the clues at ${at(small.i, n)} and ${
                at(big.i, n)
              }. The larger undecided area has ${remaining} more shaded squares across ${extra.length} extra squares. ${
                at(extra[0], n)
              } must be ${remaining ? "shaded" : "unshaded"}.`,
              [...small.cells, ...big.cells],
            );
          }
        }
      }
      break;
    }
    case "queens": {
      const queens = all.filter((i) => a[i] === 1);
      const attacks = (i: number, j: number) =>
        row(i).includes(j) || col(i).includes(j) || p.regions[i] === p.regions[j] ||
        neighborhood(i, n).includes(j);
      for (const i of queens) {
        const j = queens.find((j) => i !== j && attacks(i, j));
        if (j !== undefined) {
          return problem(
            "These queens share a row, column or region, or touch at a side or corner.",
            [i, j],
          );
        }
      }
      const blocked = all.find((i) => !a[i] && queens.some((j) => attacks(i, j)));
      if (blocked !== undefined) {
        const q = queens.find((j) => attacks(blocked, j))!;
        return put(
          blocked,
          2,
          `The queen at ${at(q, n)} rules out ${
            at(blocked, n)
          }: queens cannot share a row, column or region, or touch. Mark it X.`,
          [q, blocked],
        );
      }
      const units = [
        ...range(n).map((r) => row(r * n)),
        ...range(n).map(col),
        ...[...new Set(p.regions)].map((r) => all.filter((i) => p.regions[i] === r)),
      ];
      for (const cells of units) {
        if (cells.some((i) => a[i] === 1)) continue;
        const places = cells.filter((i) => !a[i] && !queens.some((j) => attacks(i, j)));
        if (!places.length) {
          return problem(
            "This row, column or region has no available square for its queen. Check its X marks and nearby queens.",
            cells,
          );
        }
        if (places.length === 1) {
          return put(
            places[0],
            1,
            `This highlighted row, column or region needs one queen. ${
              at(places[0], n)
            } is its only available square.`,
            cells,
          );
        }
      }
      break;
    }
    case "mambo": {
      const units = [...range(n).map((r) => row(r * n)), ...range(n).map(col)];
      const violation = (values: number[]) => {
        for (const cells of units) {
          if ([1, 2].some((v) => cells.filter((i) => values[i] === v).length > n / 2)) {
            return "give a row or column too many of one shape";
          }
          for (let k = 0; k < n - 2; k++) {
            if (
              values[cells[k]] && values[cells[k]] === values[cells[k + 1]] &&
              values[cells[k]] === values[cells[k + 2]]
            ) return "put three identical shapes consecutively";
          }
        }
        for (const link of p.links) {
          if (
            values[link.a] && values[link.b] && ((values[link.a] === values[link.b]) !== link.same)
          ) return "break an = or × clue";
        }
        return "";
      };
      if (violation(a)) {
        return problem(`The current entries ${violation(a)}. Correct that before continuing.`, all);
      }
      for (const i of all.filter((i) => !a[i])) {
        const reasons = [1, 2].map((v) => {
          const test = [...a];
          test[i] = v;
          return violation(test);
        });
        if (reasons.every(Boolean)) {
          return problem(
            "Neither shape fits this square. Check the row, column and neighboring clues.",
            [...row(i), ...col(i)],
          );
        }
        const invalid = reasons.findIndex(Boolean);
        if (invalid >= 0) {
          return put(
            i,
            2 - invalid,
            `A ${invalid === 0 ? "circle" : "diamond"} at ${at(i, n)} would ${
              reasons[invalid]
            }. Put a ${invalid === 0 ? "diamond" : "circle"} there instead.`,
            [...row(i), ...col(i)],
          );
        }
      }
      break;
    }
    case "pipes": {
      const domains = p.initial.map((mask, i) =>
        [...new Set([mask, rotate(mask), rotate(rotate(mask)), rotate(rotate(rotate(mask)))])]
          .filter((v) =>
            [1, 2, 4, 8].every((bit) =>
              !(v & bit) || adjacent(i, n).some((j) => direction(i, j, n) === bit)
            )
          )
      );
      let changed = true;
      while (changed) {
        changed = false;
        for (const i of all) {
          const next = domains[i].filter((v) =>
            adjacent(i, n).every((j) =>
              domains[j].some((w) =>
                Boolean(v & direction(i, j, n)) === Boolean(w & direction(j, i, n))
              )
            )
          );
          if (next.length !== domains[i].length) {
            domains[i] = next;
            changed = true;
          }
        }
      }
      const i = all.find((i) => domains[i].length === 1 && a[i] !== domains[i][0]);
      if (i !== undefined) {
        return put(
          i,
          domains[i][0],
          `Rotate the pipe at ${
            at(i, n)
          } to the shown orientation. Every other orientation forces an opening off the board or a mismatch with neighboring pipe shapes. This deduction uses pipe shapes, not your current rotations.`,
          [i, ...adjacent(i, n)],
        );
      }
      break;
    }
    case "atoms": {
      const incident = all.map((i) =>
        p.edges.flatMap(([u, v], e) => u === i || v === i ? [e] : [])
      );
      const remaining = all.map((i) => p.clues[i] - incident[i].reduce((s, e) => s + a[e], 0));
      const bad = all.find((i) => remaining[i] < 0);
      if (bad !== undefined) {
        return problem("This atom has more bonds than its number allows.", [bad]);
      }
      const capacity = p.edges.map(([u, v], e) => Math.min(2 - a[e], remaining[u], remaining[v]));
      for (const i of all) {
        const total = incident[i].reduce((s, e) => s + capacity[e], 0);
        if (total < remaining[i]) {
          return problem(
            "This atom cannot reach its required bonds without exceeding a neighboring atom’s number. Check the existing bonds.",
            [i, ...adjacent(i, n)],
          );
        }
        if (remaining[i] && total === remaining[i]) {
          const e = incident[i].find((e) => capacity[e] > 0)!;
          return put(
            e,
            a[e] + capacity[e],
            `The atom at ${at(i, n)} still needs ${
              remaining[i]
            } bonds. Its neighbors have room for exactly that many. Add ${capacity[e]} ${
              capacity[e] === 1 ? "bond" : "bonds"
            } between the highlighted atoms.`,
            p.edges[e],
          );
        }
      }
      break;
    }
    case "shikaku": {
      for (const i of all.filter((i) => p.clues[i] > 0 && !a[i])) {
        const choices: number[][] = [];
        for (const start of all) {
          for (const end of all) {
            if (end < start || end % n < start % n) continue;
            const cells = rectangle(start, end, n);
            if (
              cells.length === p.clues[i] && cells.includes(i) &&
              cells.every((j) => !a[j] && (j === i || !p.clues[j]))
            ) choices.push(cells);
          }
        }
        if (!choices.length) {
          return problem(
            "No rectangle fits this clue without overlapping an existing rectangle or another clue.",
            [i],
          );
        }
        if (choices.length === 1) {
          const cells = choices[0], values = [...a], id = Math.max(0, ...a) + 1;
          cells.forEach((j) => values[j] = id);
          return {
            title: "A logical next move",
            text: `Only this rectangle has area ${
              p.clues[i]
            }, contains this clue alone, and avoids the rectangles already placed.`,
            cells,
            values,
          };
        }
      }
      break;
    }
    case "snap": {
      const tail = a.at(-1)!,
        next = a.filter((i) => p.clues[i] > 0).length + 1,
        last = Math.max(...p.clues);
      const choices = adjacent(tail, n).filter((i) =>
        !a.includes(i) && (!p.clues[i] || p.clues[i] === next) &&
        (p.clues[i] !== last || a.length === n * n - 1)
      );
      if (!choices.length) {
        return problem(
          "The path has no legal next square. Backtrack: it must keep visiting unused squares and numbered dots in order.",
          [tail],
        );
      }
      if (choices.length === 1) {
        return {
          title: "A logical next move",
          text: `From the end of your path, ${
            at(choices[0], n)
          } is the only unused neighboring square that respects the number order and leaves the final dot until last.`,
          cells: [tail, choices[0]],
          values: [...a, choices[0]],
        };
      }
      break;
    }
    case "nurikabe": {
      const islands = groups(a, n, 2);
      for (const cells of islands) {
        const clues = cells.filter((i) => p.clues[i] > 0);
        if (clues.length > 1 || (clues.length === 1 && cells.length > p.clues[clues[0]])) {
          return problem(
            "This island contains two numbers or more land squares than its number allows.",
            cells,
          );
        }
        const border = [...new Set(cells.flatMap((i) => adjacent(i, n)))].filter((i) => !a[i]);
        if (clues.length === 1 && cells.length === p.clues[clues[0]] && border.length) {
          return put(
            border[0],
            1,
            `This island already has its full ${cells.length} squares. Its neighboring square at ${
              at(border[0], n)
            } must be water.`,
            [...cells, border[0]],
          );
        }
        if (clues.length === 1 && cells.length < p.clues[clues[0]] && border.length === 1) {
          return put(
            border[0],
            2,
            `This island still needs land and has only one way to grow: ${
              at(border[0], n)
            } must be land.`,
            [...cells, border[0]],
          );
        }
      }
      for (const i of all.filter((i) => !a[i])) {
        const touching = islands.filter((cells) => cells.some((j) => adjacent(i, n).includes(j)));
        if (touching.flat().filter((j) => p.clues[j] > 0).length > 1) {
          return put(
            i,
            1,
            `Land at ${at(i, n)} would join two numbered islands. This square must be water.`,
            [i, ...touching.flat()],
          );
        }
      }
      for (const i of all.filter((i) => i % n < n - 1 && i < n * (n - 1))) {
        const cells = [i, i + 1, i + n, i + n + 1], water = cells.filter((j) => a[j] === 1);
        if (water.length === 4) return problem("A 2 × 2 block of water is not allowed.", cells);
        const blank = cells.find((j) => !a[j]);
        if (water.length === 3 && blank !== undefined) {
          return put(
            blank,
            2,
            `These three water squares cannot become a 2 × 2 pool. ${at(blank, n)} must be land.`,
            cells,
          );
        }
      }
      break;
    }
    case "dosun": {
      for (const i of all.filter((i) => a[i] === 1 || a[i] === 2)) {
        const j = i + (a[i] === 1 ? -n : n);
        if (j < 0 || j >= n * n || p.regions[j] < 0) continue;
        if (a[j] === 0) {
          return put(
            j,
            a[i],
            `The ${a[i] === 1 ? "balloon" : "weight"} at ${at(i, n)} needs another ${
              a[i] === 1 ? "balloon directly above" : "weight directly below"
            } it. Place one at ${at(j, n)}.`,
            [i, j],
          );
        }
        if (a[j] !== a[i]) {
          return problem(
            "This piece needs support from the same kind of piece, or the board edge or a rock.",
            [i, j],
          );
        }
      }
      for (const region of [...new Set(p.regions.filter((r) => r >= 0))]) {
        for (const v of [1, 2]) {
          const cells = all.filter((i) => p.regions[i] === region),
            placed = cells.filter((i) => a[i] === v);
          if (placed.length > 1) {
            return problem("A region must have exactly one balloon and one weight.", cells);
          }
          if (placed.length) {
            continue;
          }
          const choices = cells.filter((i) => {
            if (a[i]) return false;
            const regions = new Set<number>();
            for (let j = i; j >= 0 && j < n * n && p.regions[j] >= 0; j += v === 1 ? -n : n) {
              if (
                (a[j] && a[j] !== v) || regions.has(p.regions[j]) ||
                all.some((k) => k !== j && p.regions[k] === p.regions[j] && a[k] === v)
              ) return false;
              regions.add(p.regions[j]);
            }
            return true;
          });
          if (!choices.length) {
            return problem(
              "This region has no supported place for its missing piece. Check the pieces and X marks.",
              cells,
            );
          }
          if (choices.length === 1) {
            return put(
              choices[0],
              v,
              `This region needs a ${v === 1 ? "balloon" : "weight"}. Only ${
                at(choices[0], n)
              } can form a supported stack without placing the same piece twice in a region.`,
              cells,
            );
          }
        }
      }
      break;
    }
    case "fivecells": {
      for (const i of all.filter((i) => p.clues[i] >= 0)) {
        const edges = p.edges.flatMap(([u, v], e) => u === i || v === i ? [e] : []);
        const outer = 4 - edges.length,
          drawn = edges.filter((e) => a[e] === 1),
          empty = edges.filter((e) => !a[e]);
        const remaining = p.clues[i] - outer - drawn.length;
        if (remaining < 0) {
          return problem(
            `The square at ${at(i, n)} has too many bordering sides. The outer frame also counts.`,
            [i],
          );
        }
        if (remaining && remaining === empty.length) {
          const e = empty[0];
          return put(
            e,
            1,
            `The clue ${p.clues[i]} at ${at(i, n)} has ${
              outer + drawn.length
            } bordering sides already. All ${remaining} remaining sides must be boundaries. Add the boundary between the highlighted squares.`,
            p.edges[e],
          );
        }
      }
      const options = fiveCellOptions(p.clues, n).filter(({ cells }) =>
        p.edges.every(([u, v], e) => !a[e] || !cells.includes(u) || !cells.includes(v))
      );
      for (const i of all) {
        const choices = options.filter(({ cells }) => cells.includes(i));
        if (!choices.length) {
          return problem(
            "No five-square group fits this square with the current boundaries and clue counts.",
            [i],
          );
        }
        for (const j of adjacent(i, n)) {
          const e = p.edges.findIndex(([u, v]) => (u === i && v === j) || (u === j && v === i));
          if (!a[e] && choices.every(({ cells }) => !cells.includes(j))) {
            return put(
              e,
              1,
              `A group must contain five connected squares and satisfy every clue on it. None of the ${choices.length} possible groups containing ${
                at(i, n)
              } can also include ${at(j, n)}. Add a boundary between these squares.`,
              [i, j],
            );
          }
        }
      }
      break;
    }
  }
  return {
    title: "No simple deduction found",
    text:
      "The logical rules available so far could not prove a next move from this position. That does not mean your board is wrong. You can keep working or choose Reveal one move.",
    cells: all,
  };
}

/** Reveal one step toward one generated solution; never present this as a logical proof. */
export function revealHint(p: Puzzle, a: number[]): Hint {
  const n = p.size;
  if (p.kind === "sets") {
    const hint = smartHint(p, a);
    return hint.values ? { ...hint, title: "Reveal one set", text: `The highlighted cards form one of the three sets. Apply to record it. Cards stay available for other sets.` } : hint;
  }
  if (isSolved(p, a)) {
    return {
      title: "Already complete",
      text: "This board satisfies every rule.",
      cells: range(n * n),
    };
  }
  if (p.kind === "snap") {
    let prefix = 0;
    while (prefix < a.length && a[prefix] === p.solution[prefix]) prefix++;
    const values = p.solution.slice(0, prefix + 1), i = values.at(-1)!;
    return {
      title: "Reveal one path step",
      text: `${
        prefix < a.length
          ? `This returns the path by ${
            a.length - prefix
          } squares to match one generated solution, then extends it`
          : "Extend the path"
      } to ${at(i, n)}. This is a revealed answer, not a deduction.`,
      cells: [p.solution[Math.max(0, prefix - 1)], i],
      values,
    };
  }
  if (p.kind === "shikaku") {
    const id = p.solution.find((v, i) => {
      const cells = p.solution.flatMap((w, j) => w === v ? [j] : []);
      return !a[i] || cells.some((j) => a[j] !== a[i]) ||
        a.filter((w) => w === a[i]).length !== cells.length;
    });
    if (id !== undefined) {
      const cells = p.solution.flatMap((v, i) => v === id ? [i] : []),
        overlaps = new Set(cells.map((i) => a[i]).filter(Boolean));
      const values = a.map((v) => overlaps.has(v) ? 0 : v), nextId = Math.max(0, ...a) + 1;
      cells.forEach((i) => values[i] = nextId);
      return {
        title: "Reveal one rectangle",
        text: `Fill this rectangle from one generated solution.${
          overlaps.size ? " This replaces any existing rectangles it overlaps." : ""
        } This is a revealed answer, not a deduction.`,
        cells,
        values,
      };
    }
  }
  const differs = (v: number, i: number) => {
    if (p.kind === "queens" && v === 0 && a[i] === 2) return false;
    if (p.kind === "mosaic" && v === 2 && a[i] === 0) return false;
    if (p.kind === "dosun" && v === 0 && a[i] === 3) return false;
    return v !== a[i];
  };
  const i = p.solution.findIndex(differs);
  if (i >= 0) {
    const v = p.solution[i],
      cells = p.kind === "atoms" || p.kind === "fivecells" ? p.edges[i] : [i];
    const action = p.kind === "atoms"
      ? `Set the bond between these atoms to ${v} ${v === 1 ? "line" : "lines"}`
      : p.kind === "fivecells"
      ? `${v ? "Add" : "Remove"} the boundary between these squares`
      : p.kind === "pipes"
      ? `Rotate the highlighted pipe to match the revealed orientation`
      : `Set ${at(i, n)} to ${
        p.kind === "sudoku" || p.kind === "killer"
          ? v
          : p.kind === "mambo"
          ? v === 1 ? "a circle" : "a diamond"
          : p.kind === "queens"
          ? v === 1 ? "a queen" : "empty"
          : p.kind === "dosun"
          ? v === 1 ? "a white balloon" : v === 2 ? "a black weight" : "empty"
          : p.kind === "nurikabe"
          ? v === 1 ? "water" : "land"
          : v === 1
          ? "shaded"
          : "unshaded"
      }`;
    const hint = move(
      a,
      i,
      v,
      `${action}. This matches one generated solution; it is a revealed answer, not a deduction.`,
      cells,
    );
    hint.title = "Reveal one move";
    // Edge indices are not cell indices.
    hint.cells = cells;
    return hint;
  }
  return {
    title: "No move to reveal",
    text: "No further move is needed toward the generated solution.",
    cells: range(n * n),
  };
}
