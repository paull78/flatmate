import type { Side } from "./kinds";

// A placement's stored use zones (furnish.21): twelve flat keys, three per side, because wire entities nest one level
// only (dims.23). A side's three keys are all null (the kind's default, worked out when read) or all numbers: a depth
// and two insets from the side's corners (front and back from the left corner, left and right from the back corner).

type ZoneKey = `${Side}${"Depth" | "Start" | "End"}`;
export type ZoneExtents = Record<ZoneKey, number | null>;
/** One side's zone: its depth and its two insets, in metres. */
export type ZoneExtent = { depth: number; start: number; end: number };

/** The smallest stored depth, and the smallest zone length a drag or a clamp leaves (furnish.15). */
export const MIN_ZONE_SIZE = 0.1;

/**
 * A kind's default zone along one side (furnish.15, .20): two insets from the side's corners, a length centred on the
 * side (the whole side when the side is shorter), or along a long side's front square only, as long as the piece is
 * wide from its front corner (a winder's entry, steps.09).
 */
export type ZoneDefault = { start: number; end: number } | { centred: number } | { frontSquare: true };

/** How far the open Murphy bed's mattress, and so its front zone, sits in from each end of the cabinet (furnish.20). */
export const MURPHY_MATTRESS_INSET = 0.1;

/**
 * Insets that leave at least MIN_ZONE_SIZE of a side `length` long, as they are; larger ones shrink in proportion
 * until they do (none left at a side of MIN_ZONE_SIZE or less). Applied when read: stored numbers never change.
 */
export function clampInsets(length: number, start: number, end: number): [number, number] {
  if (start + end + MIN_ZONE_SIZE <= length + 1e-9) return [start, end];
  const sum = start + end;
  if (sum === 0) return [0, 0];
  const k = Math.max(0, length - MIN_ZONE_SIZE) / sum;
  return [start * k, end * k];
}

/** Each side's keys, in the order depth, start, end. */
export const SIDE_ZONE_KEYS: Readonly<Record<Side, readonly [ZoneKey, ZoneKey, ZoneKey]>> = {
  front: ["frontDepth", "frontStart", "frontEnd"],
  back: ["backDepth", "backStart", "backEnd"],
  left: ["leftDepth", "leftStart", "leftEnd"],
  right: ["rightDepth", "rightStart", "rightEnd"],
};

/** Every side at the kind's default: a fresh object. */
export function nullZones(): ZoneExtents {
  return {
    frontDepth: null, frontStart: null, frontEnd: null,
    backDepth: null, backStart: null, backEnd: null,
    leftDepth: null, leftStart: null, leftEnd: null,
    rightDepth: null, rightStart: null, rightEnd: null,
  };
}

/** The side's stored zone, or null when it follows the kind's default (any of its keys null). */
export function storedZone(zones: ZoneExtents, side: Side): ZoneExtent | null {
  const [d, s, e] = SIDE_ZONE_KEYS[side];
  const depth = zones[d];
  const start = zones[s];
  const end = zones[e];
  return depth !== null && start !== null && end !== null ? { depth, start, end } : null;
}

/** A copy of `zones` with one side stored, or cleared back to the default with null. */
export function withZoneExtent(zones: ZoneExtents, side: Side, extent: ZoneExtent | null): ZoneExtents {
  const [d, s, e] = SIDE_ZONE_KEYS[side];
  return { ...zones, [d]: extent?.depth ?? null, [s]: extent?.start ?? null, [e]: extent?.end ?? null };
}
