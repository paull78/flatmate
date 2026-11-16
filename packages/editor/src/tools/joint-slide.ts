import { add, dot, isStraightJoint, normalize, roundMm, scale, sub, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { roundTo } from "../snapping/policies";
import type { SnapResult } from "../types";

// A straight joint slides along its line (straight.21, spec M1 "Straight joint slides"): dragging the joint between two
// walls in line moves it only along that line, by the snap step from where it started, or onto the projection of an
// endpoint or aligned snap; Ctrl frees it (the caller doesn't call this then), which is how a step is pulled out of a
// straight wall after a Split.

/** The unit direction of the straight joint's line (far end to far end), or null when the joint isn't straight. */
export function slideLine(doc: Document, jointId: string): Point | null {
  if (!isStraightJoint(doc, jointId)) return null;
  const walls = Object.values(doc.walls).filter((w) => w.a === jointId || w.b === jointId);
  const [p, q] = walls.map((w) => doc.joints[w.a === jointId ? w.b : w.a]);
  return p && q ? normalize(sub(q, p)) : null;
}

/** The slid point for snap `snap` of the cursor: on the line through `start` along `dir`. */
export function slidePoint(start: Point, dir: Point, cursor: Point, snap: SnapResult, step: number): SnapResult {
  const along = snap.kind === "grid" || snap.kind === "none" ? roundTo(dot(sub(cursor, start), dir), step) : dot(sub(snap.point, start), dir);
  const point = add(start, scale(dir, along));
  return { ...snap, point: { x: roundMm(point.x), y: roundMm(point.y) } };
}
