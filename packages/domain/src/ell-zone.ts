import { assertNever, type Point } from "@fm/protocol";
import type { Arms } from "./arms";
import { clampInsets, type ZoneExtent } from "./use-zone";

// An `L` piece's front zone (catalog.04, .11, .13): one zone of two strips at one depth, strip 0 in front of the left
// arm's inner edge and strip 1 in front of the back arm's, meeting at the inner corner, which is never trimmed. `start`
// trims the left strip from the left arm's front end, `end` the back strip from the back arm's right end. Placement
// coordinates before rotation (x −w/2…w/2, y −d front … 0 back), with arms as drawn (`armsFor`):
//
//    back arm               ┌──────────────────┐
//              corner (cx, cy) ┌───────────────┘
//                         │ │░░░░░░░░░░░░░░░│   strip 1: back, x cx … w/2 − end, y cy − z … cy
//                         │ │░░░░░┌─────────┘
//    left arm             │ │░░░░░│               strip 0: left, x cx … cx + z, y −d + start … cy
//                         └─┘─────┘

/** A strip as [x0, x1] × [y0, y1]. */
export type StripRect = { x0: number; y0: number; x1: number; y1: number };
/** A span of a line, in metres: [from, to]. */
export type Span = readonly [number, number];
/**
 * Where a strip's outer line and its far end lie on the zone's outline: the outer line measured along the inner edge
 * from the inner corner, the far end out from the inner edge; null where the other strip covers it.
 */
export type StripLines = { outer: Span | null; end: Span | null };

const EPS = 1e-9;

/** The inner edges' lengths: the left arm's (d − t1, the left strip's room) and the back arm's (w − t2). */
function edges(w: number, d: number, arms: Arms): { left: number; back: number } {
  return { left: d - arms.back, back: w - arms.left };
}

/** `start` and `end` as read: each strip keeps at least MIN_ZONE_SIZE of its inner edge (`clampInsets`). */
export function ellInsets(w: number, d: number, arms: Arms, start: number, end: number): [number, number] {
  const e = edges(w, d, arms);
  return [clampInsets(e.left, start, 0)[0], clampInsets(e.back, 0, end)[1]];
}

/** The shorter strip's length for `start` and `end`, as stored: what the zone command keeps at MIN_ZONE_SIZE or more. */
export function ellShortest(w: number, d: number, arms: Arms, start: number, end: number): number {
  const e = edges(w, d, arms);
  return Math.min(e.left - start, e.back - end);
}

/** The two strips of a resolved extent: [left, back]. */
export function ellStrips(w: number, d: number, arms: Arms, { depth: z, start, end }: ZoneExtent): [StripRect, StripRect] {
  const cx = -w / 2 + arms.left;
  const cy = -arms.back;
  return [{ x0: cx, y0: -d + start, x1: cx + z, y1: cy }, { x0: cx, y0: cy - z, x1: w / 2 - end, y1: cy }];
}

/** How the strips, `left` and `back` metres long and `z` deep, meet: one inside the other, an L band, or both short. */
function union(left: number, back: number, z: number): "back" | "left" | "band" | "notch" {
  if (back >= z - EPS && left <= z + EPS) return "back";
  if (left >= z - EPS && back <= z + EPS) return "left";
  return back > z ? "band" : "notch";
}

/** Each strip's lines on the zone's outline, [left, back], for strips `left` and `back` metres long and `z` deep. */
export function ellZoneLines(left: number, back: number, z: number): [StripLines, StripLines] {
  const none: StripLines = { outer: null, end: null };
  const kind = union(left, back, z);
  switch (kind) {
    case "back": return [none, { outer: [0, back], end: [0, z] }];
    case "left": return [{ outer: [0, left], end: [0, z] }, none];
    case "band": return [{ outer: [z, left], end: [0, z] }, { outer: [z, back], end: [0, z] }];
    case "notch": return [{ outer: [0, left], end: [back, z] }, { outer: [0, back], end: [left, z] }];
    default: return assertNever(kind);
  }
}

/**
 * The zone's outline, counter-clockwise: the union of its strips, a rectangle when one lies inside the other, else
 * six corners (catalog.11).
 */
export function ellZoneRing(strips: readonly [StripRect, StripRect]): Point[] {
  const [l, b] = strips;
  const [cx, cy] = [b.x0, b.y1];
  const left = { u: l.x1 - cx, v: cy - l.y0 };
  const back = { u: b.x1 - cx, v: cy - b.y0 };
  const box = (s: { u: number; v: number }): Point[] => [{ x: cx, y: cy - s.v }, { x: cx + s.u, y: cy - s.v }, { x: cx + s.u, y: cy }, { x: cx, y: cy }];
  const kind = union(left.v, back.u, back.v);
  if (kind === "back") return box(back);
  if (kind === "left") return box(left);
  const [tall, wide] = kind === "band" ? [left, back] : [back, left];
  return [
    { x: cx, y: cy }, { x: cx, y: cy - tall.v }, { x: cx + tall.u, y: cy - tall.v },
    { x: cx + tall.u, y: cy - wide.v }, { x: cx + wide.u, y: cy - wide.v }, { x: cx + wide.u, y: cy },
  ];
}
