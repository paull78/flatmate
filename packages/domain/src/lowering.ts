import { toMm } from "./format";
import { MIN_HEIGHT, kindConfigs, kindOf } from "./kinds";

// A new piece may take a lower height to fit under what's over it (clarity.06, .11).

/** A piece never gets shorter than this share of its default height. */
export const LOWEST_SHARE = 0.75;

/**
 * Whether a new piece of this kind may be lowered: one configuration (a height is shared by all of a piece's layouts,
 * and a second configuration's is the mechanism's), no stair (its height is its rise), a numeric elevation. False for
 * an unknown kind.
 */
export function lowerable(kindId: string): boolean {
  const configs = kindConfigs(kindId);
  return configs.length === 1 && kindOf(kindId)?.stair === null && configs.every((c) => c.z !== "ceiling");
}

/** The lowest height a default of `h` may take: its share, rounded up to the millimetre, and never under MIN_HEIGHT. */
export function lowestHeight(h: number): number {
  return Math.max(Math.ceil(toMm(h) * LOWEST_SHARE) / 1000, MIN_HEIGHT);
}
