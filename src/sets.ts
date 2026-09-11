import type { Puzzle, Random } from "./puzzles.ts";

// Four base-three attributes: count, shape, color and fill. Cards are unique integers 0–80.
export const SET_ATTRIBUTES = ["number", "shape", "color", "fill"] as const;
export function cardAttributes(card: number): number[] {
  return [0, 1, 2, 3].map((axis) => Math.floor(card / 3 ** axis) % 3);
}
export function isSet(cards: number[]): boolean {
  return cards.length === 3 && new Set(cards).size === 3 &&
    cards.every((card) => Number.isInteger(card) && card >= 0 && card < 81) &&
    [0, 1, 2, 3].every((axis) =>
      cards.reduce((sum, card) => sum + Math.floor(card / 3 ** axis) % 3, 0) % 3 === 0
    );
}
export function findSets(cards: number[]): number[][] {
  const sets: number[][] = [];
  for (let a = 0; a < cards.length - 2; a++) {
    for (let b = a + 1; b < cards.length - 1; b++) {
      for (let c = b + 1; c < cards.length; c++) {
        if (isSet([cards[a], cards[b], cards[c]])) sets.push([a, b, c]);
      }
    }
  }
  return sets;
}
// A verified fallback, also used as a separate finished tutorial example.
export const EXAMPLE_CARDS = [46, 31, 28, 58, 16, 21, 24, 68];
export function generateSets(p: Puzzle, rng: Random) {
  const deck = Array.from({ length: 81 }, (_, i) => i);
  let cards = EXAMPLE_CARDS;
  for (let attempt = 0; attempt < 512; attempt++) {
    const candidate = rng.shuffle(deck).slice(0, 8), sets = findSets(candidate);
    // All eight cards participate; exactly one card belongs to two sets.
    if (sets.length === 3 && new Set(sets.flat()).size === 8) {
      cards = candidate;
      break;
    }
  }
  // Attribute/value permutations preserve every valid and invalid triple, including the fallback.
  const axes = rng.shuffle([0, 1, 2, 3]);
  const permutations = axes.map(() => rng.shuffle([0, 1, 2]));
  p.clues = rng.shuffle(cards.map((card) => {
    const attributes = cardAttributes(card);
    return axes.reduce((sum, axis, i) => sum + permutations[i][attributes[axis]] * 3 ** i, 0);
  }));
  p.initial = [0, 0, 0]; // One found flag per lexicographically ordered valid triple.
  p.solution = [1, 1, 1];
}
export function setDescription(cards: number[]): string {
  const attributes = cards.map(cardAttributes);
  return SET_ATTRIBUTES.map((name, axis) =>
    `${name}: ${new Set(attributes.map((card) => card[axis])).size === 1 ? "all the same" : "all different"}`
  ).join("; ");
}
export function cardDescription(card: number): string {
  const [count, shape, color, fill] = cardAttributes(card);
  return `${count + 1} ${["sage", "clay", "lavender"][color]} ${["oval", "diamond", "wave"][shape]}${count ? "s" : ""}, ${["outline", "striped", "solid"][fill]}`;
}
