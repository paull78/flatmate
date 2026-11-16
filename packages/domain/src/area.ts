import type { Point } from "@fm/protocol";

// A leaf, re-exported by model.ts, as section.ts is: shape-areas.ts reads the row and must not import the model.

/**
 * A named area (areas.01, .05, .08): a rectangle square to the page, centred at `at`, `w` along x and `d` along y,
 * naming part of the room that holds its centre. A label only: no fit, warning or free floor reads it. Shared by every
 * layout. A blank name reads "Area".
 */
export type Area = { id: string; name: string; at: Point; w: number; d: number };
export const MIN_AREA_SIZE = 0.3; // metres, each side (areas.07, .15)
