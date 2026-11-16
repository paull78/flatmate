import type { Point } from "@fm/protocol";
import { toMm } from "../format";
import { add, cross, dot, scale, sub } from "../geometry";
import { wallFrame } from "../graph";
import { OPENING_KINDS, type OpeningKind } from "../kinds";
import type { Document, Opening } from "../model";
import { HEAD_CLEAR, ceilingAlong, defaultOpeningHeights, wallRange, wallTopOver } from "./vertical";

// Openings on walls (spec: openings): where they lie, for drawing and for the swing clearance. An opening's `offset` is
// measured from joint `a` along the wall, so moving the wall's joints carries it.

export type OpeningGeometry = {
  /** The span on the wall's centre line, in a → b order. */
  start: Point;
  end: Point;
  /** Unit vector a → b. */
  along: Point;
  /** Unit vector towards the opening side. */
  normal: Point;
  thickness: number;
  /** The span's hinge end and its other end, on the wall face of the opening side. */
  hinge: Point;
  free: Point;
};

/** Where an opening lies, or null when it or its wall is missing. */
export function openingGeometry(doc: Document, openingId: string): OpeningGeometry | null {
  const o = doc.openings[openingId];
  return o ? geometryOf(doc, o) : null;
}

/** The same for an opening that may not be stored yet (a preview). */
export function geometryOf(doc: Document, o: Opening): OpeningGeometry | null {
  const f = wallFrame(doc, o.wall);
  if (!f) return null;
  const normal = o.side === "left" ? f.left : scale(f.left, -1);
  const start = add(f.a, scale(f.dir, o.offset));
  const end = add(f.a, scale(f.dir, o.offset + o.width));
  const face = scale(normal, f.half);
  const [hingeEnd, freeEnd] = o.hinge === "a" ? [start, end] : [end, start];
  return { start, end, along: f.dir, normal, thickness: 2 * f.half, hinge: add(hingeEnd, face), free: add(freeEnd, face) };
}

/** A stretch along a wall, in metres from its joint a. */
export type Reach = { from: number; to: number };

/**
 * An opening's reach along its wall (openkinds.16): its span, and for a kind with a pocket (the table's `pocket`) the
 * stretch one width long past its hinge end, where the leaf slides into the wall. I12 checks reaches.
 */
export function wallReach(o: Pick<Opening, "kind" | "offset" | "width" | "hinge">): Reach {
  const span = { from: o.offset, to: o.offset + o.width };
  if (!OPENING_KINDS[o.kind].pocket) return span;
  return o.hinge === "a" ? { from: o.offset - o.width, to: span.to } : { from: span.from, to: span.to + o.width };
}

export type SuggestedOpening = Pick<Opening, "offset" | "width" | "side" | "hinge" | "sill" | "head">;

/** A window placed on the shell from a loft sits this far above the loft's top (sills.06). */
const LOFT_WINDOW_SILL = 0.3;

/** A full wall's lowest top along its whole length, else its range's top. */
const ceilingTopOf = (doc: Document, wallId: string, top: number): number => (doc.walls[wallId]?.top === "ceiling" ? ceilingAlong(doc, wallId) : top);
export const DOOR_FROM_FLOOR = "A door on this wall starts at the floor: place it from the floor's level";

/**
 * The heights a new opening of `kind` takes on `wallId` placed from a level whose surface is `levelHeight` (sills.06): on
 * a wall standing on that surface, the floor's defaults above its bottom (`defaultOpeningHeights`); on a floor wall seen
 * from a loft, a window from LOFT_WINDOW_SILL above the loft's top to HEAD_CLEAR under the wall's top, and a door or
 * doorway refused, its sill being the floor. Under a slope the wall's top is the lowest over `span` (the opening's
 * stretch along the wall), or along the whole wall without one (roofs.17). Null for a missing wall.
 */
export function openingDefaults(
  doc: Document, wallId: string, kind: OpeningKind, levelHeight: number, span?: { from: number; to: number },
): { sill: number; head: number } | { refused: string } | null {
  const range = wallRange(doc, wallId);
  if (!range) return null;
  const top = span ? wallTopOver(doc, wallId, span.from, span.to) : ceilingTopOf(doc, wallId, range.top);
  const height = (top ?? range.top) - range.bottom;
  const fromFloor = OPENING_KINDS[kind].fromFloor;
  if (levelHeight <= range.bottom + 1e-9) return defaultOpeningHeights(fromFloor, height);
  if (fromFloor) return { refused: DOOR_FROM_FLOOR };
  return { sill: toMm(levelHeight - range.bottom + LOFT_WINDOW_SILL) / 1000, head: toMm(height - HEAD_CLEAR) / 1000 };
}

/**
 * An opening's sill and head once it becomes `kind` and takes the `sill` and `height` given, the one rule Properties,
 * MCP and setOpening share (sills.07): between a door or doorway and a window the head stays and the sill takes the new
 * kind's; a given sill keeps the opening's height, a given height keeps its sill.
 */
export function openingHeightsFor(o: Pick<Opening, "kind" | "sill" | "head">, kind: OpeningKind, given: { sill?: number | undefined; height?: number | undefined } = {}): { sill: number; head: number } {
  const fromFloor = OPENING_KINDS[kind].fromFloor;
  const switched = fromFloor === OPENING_KINDS[o.kind].fromFloor ? o.sill : defaultOpeningHeights(fromFloor, o.head + HEAD_CLEAR).sill;
  const sill = given.sill ?? switched;
  const mm = (m: number): number => toMm(m) / 1000;
  if (given.height !== undefined) return { sill, head: mm(sill + given.height) };
  return { sill, head: given.sill === undefined ? o.head : mm(sill + (o.head - o.sill)) };
}

/**
 * The opening a point near a wall suggests (spec: openings): the kind's default width centred at the point's projection,
 * shifted to stay within the wall; opening to the point's side; hinged at the end nearer the joint closer to the
 * point, or the farther one for a kind whose row says `far` (a pocket or a parked leaf needs wall there, openkinds.10).
 * On a wall shorter than the width the offset is 0 and I12 refuses it. Its heights are the new opening's defaults on the
 * wall (sills.01). Null when the wall is missing.
 */
export function suggestOpening(doc: Document, wallId: string, point: Point, kind: OpeningKind): SuggestedOpening | null {
  const f = wallFrame(doc, wallId);
  const range = wallRange(doc, wallId);
  if (!f || !range) return null;
  const { a, dir: along, length } = f;
  const width = OPENING_KINDS[kind].width.default;
  const t = dot(sub(point, a), along);
  const offset = Math.max(0, Math.min(t - width / 2, length - width));
  return {
    offset: Math.round(offset * 1e6) / 1e6, // float noise from the projection stays out of the document
    width,
    side: cross(along, sub(point, a)) >= 0 ? "left" : "right",
    hinge: (t <= length / 2) === (OPENING_KINDS[kind].hingeAt === "near") ? "a" : "b",
    ...defaultOpeningHeights(OPENING_KINDS[kind].fromFloor, range.top - range.bottom),
  };
}
