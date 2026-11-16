import type { Point } from "@fm/protocol";
import type { Arms, ObjectOptions } from "@fm/domain";
import type { Slot } from "../style";

// The vocabulary of furniture parts in 3D (parts.04, .09). A piece's parts are built in its local frame: x across
// (−w/2 … w/2), y from the front edge (−d/2) to the back edge (d/2), z up from the piece's bottom (0 … h). At rotation 0
// the front faces −y, as everywhere in the domain. Every part lies inside the box; the fit still sees only the box
// (heights.05).

export type { Slot } from "../style";

/** An axis-aligned box in the local frame. */
export type Box3 = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };
/** A flat detail on a front (−y) or a top (+z) face, a door front or a hob ring: `at` has no thickness along its normal. */
export type Panel = { normal: "-y" | "+z"; at: Box3; slot: Slot };
/**
 * A part: a box; a 12-sided cylinder inscribed in `at`'s x/y extent; the piece's own drawn ring (the round table's
 * top, the shaped boxes) from `z0` to `z1`; or any convex `ring` in the local frame, extruded the same way (an
 * aggregate's turned chairs and its round table's top, seating.15). Its panels draw after it.
 */
export type Part =
  | { shape: "box"; at: Box3; slot: Slot; panels?: readonly Panel[] }
  | { shape: "cylinder"; at: Box3; slot: Slot; panels?: readonly Panel[] }
  | { shape: "outline"; z0: number; z1: number; slot: Slot; panels?: readonly Panel[] }
  | { shape: "ring"; ring: readonly Point[]; z0: number; z1: number; slot: Slot; panels?: readonly Panel[] };
/**
 * A kind's parts in a configuration at a size, with what the object's `options` add (none when left out, library.10):
 * a desk's computer stands on its top, above h (seating.12: drawn, never fitted); an `L` piece's `arms` (the object's,
 * else its kind's default, catalog.17); `flue`, the top of a kind's flue above the piece's bottom when its item gives one
 * (pieces.08), drawn above `h`.
 */
export type Appearance = (config: string, w: number, d: number, h: number, options?: ObjectOptions, arms?: Arms, flue?: number) => readonly Part[];
/** A group of kinds' appearances, by kind ID. */
export type AppearanceTable = ReadonlyMap<string, Appearance>;

/** One part filling the piece: today's box, in one slot (parts.09). */
export const boxOf = (slot: Slot): Appearance => (_config, _w, _d, h) => [{ shape: "outline", z0: 0, z1: h, slot }];
