import type { Link } from "./puzzles.ts";

export interface BalanceConflict {
  kind: "count" | "triple" | "link";
  cells: number[];
}

/** Only flag contradictions already present in the visible entries. */
export function balanceConflicts(values: number[], size: number, links: Link[]): BalanceConflict[] {
  const conflicts: BalanceConflict[] = [];
  for (let axis = 0; axis < 2; axis++) {
    for (let k = 0; k < size; k++) {
      const cells = Array.from({ length: size }, (_, j) => axis ? j * size + k : k * size + j);
      for (const value of [1, 2]) {
        const matching = cells.filter((i) => values[i] === value);
        if (matching.length > size / 2) conflicts.push({ kind: "count", cells: matching });
      }
      for (let j = 2; j < size; j++) {
        const triple = cells.slice(j - 2, j + 1);
        if (values[triple[0]] && triple.every((i) => values[i] === values[triple[0]])) {
          conflicts.push({ kind: "triple", cells: triple });
        }
      }
    }
  }
  for (const { a, b, same } of links) {
    if (values[a] && values[b] && (values[a] === values[b]) !== same) {
      conflicts.push({ kind: "link", cells: [a, b] });
    }
  }
  return conflicts;
}
