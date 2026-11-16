import type { Point } from "@fm/protocol";
import { add, dot, scale, sub } from "../geometry";
import { sortedIds, wallFrame } from "../graph";
import { OPENING_KINDS } from "../kinds";
import { memo } from "../memo";
import { FLOOR_BASE, type Document } from "../model";
import { geometryOf } from "./openings";
import { wallOutlines } from "./outlines";
import { faceAt } from "./zones";

// A door's span through its wall (spec "thresholds", thresholds.01, .02, .04, .05): the floor changes under the closed
// door, so the span takes the floor of the room on the far side of the door line, the face the leaf closes against
// (a swing door's) or runs outside (a sliding door's), both on the opening's `normal` side.

/** How far the span reaches past the far face onto its own room's floor, covering the wall's face line there. */
export const SPAN_OVERHANG_M = 0.01;
/** How far past a face the room on that side is looked up. */
const PROBE_M = 0.005;
const EPS = 1e-9;

/**
 * One door's span: `ring` across the wall from the door line to SPAN_OVERHANG_M past the far face, along the door's
 * width clipped to the wall's clear stretch; `line`, the door line's ends; `room`, the face key of the room whose
 * floor it shows: beyond the far face, else beyond the door line (an entrance from outside), else null.
 */
export type DoorSpan = { openingId: string; ring: readonly Point[]; line: readonly [Point, Point]; room: string | null };

/**
 * The span of every opening from the floor (`fromFloor`), by opening ID; windows have none, and neither has a door on a
 * wall on a deck, as a loft has no rooms (sills.03).
 */
export const doorSpans = memo((doc: Document): readonly DoorSpan[] =>
  sortedIds(doc.openings).flatMap((id): DoorSpan[] => {
    const o = doc.openings[id];
    const f = o ? wallFrame(doc, o.wall) : null;
    const g = o ? geometryOf(doc, o) : null;
    const clear = o ? clearStretch(doc, o.wall) : null;
    if (!o || !f || !g || !clear || !OPENING_KINDS[o.kind].fromFloor || doc.walls[o.wall]?.base !== FLOOR_BASE) return [];
    const lo = Math.max(clear[0], Math.min(o.offset, o.offset + o.width));
    const hi = Math.min(clear[1], Math.max(o.offset, o.offset + o.width));
    if (hi - lo <= EPS) return [];
    const at = (s: number, across: number): Point => add(add(f.a, scale(f.dir, s)), scale(g.normal, across));
    const near = f.half; // the door line, on `normal`'s side
    const far = -(f.half + SPAN_OVERHANG_M);
    const mid = (lo + hi) / 2;
    const room = faceAt(doc, at(mid, -(f.half + PROBE_M)))?.key ?? faceAt(doc, at(mid, f.half + PROBE_M))?.key ?? null;
    return [{ openingId: id, ring: [at(lo, far), at(hi, far), at(hi, near), at(lo, near)], line: [at(lo, near), at(hi, near)], room }];
  }),
);

/**
 * The wall's clear stretch along it, from joint `a` in metres: where both long faces of its outline run, so neither a
 * corner's wall nor a free end is in it (the 3D view's threshold uses the same stretch, wall-faces.ts).
 */
export function clearStretch(doc: Document, wallId: string): [number, number] | null {
  const f = wallFrame(doc, wallId);
  const outline = wallOutlines(doc).get(wallId);
  if (!f || !outline) return null;
  const s = (p: Point): number => dot(sub(p, f.a), f.dir);
  const d = (p: Point): number => dot(sub(p, f.a), f.left);
  const left = outline.filter((p) => d(p) > EPS).map(s);
  const right = outline.filter((p) => d(p) < -EPS).map(s);
  if (left.length === 0 || right.length === 0) return null;
  return [Math.max(Math.min(...left), Math.min(...right)), Math.min(Math.max(...left), Math.max(...right))];
}
