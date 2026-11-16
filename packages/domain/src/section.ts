import type { Point } from "@fm/protocol";

// A leaf, re-exported by model.ts, because shape.ts reads the row through shape-sections.ts and model.ts leads back to
// shape.ts: shape-sections.ts importing the model would be an import cycle.

/**
 * A vertical cut (section.09, .14): a line from `a` to `b`, looking to `side` of it (1 is the left of a → b), as far as
 * `depth` metres (0 draws only the cut, null the whole drawing). The letter is the row's ID, so it never changes and two
 * people taking one clash like any edit of one row. Read through `sectionsOf`.
 */
export type Section = { id: string; a: Point; b: Point; side: 1 | -1; depth: number | null };
export const SECTION_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const MIN_SECTION_LENGTH = 0.5; // metres
