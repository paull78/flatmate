import {
  EPS, add, distance, distanceToSegment, dot, faceCorners, faceExtent, lineIntersection, scale, sortedIds, sub, wallFrame, type Document,
} from "@fm/domain";
import type { Point } from "@fm/protocol";
import { anglePolicy, candidate, endpointPolicy, gridPolicy, onAxis, type SnapCandidate, type SnapContext, type SnapPolicy } from "./policies";

// The Dimension tool's snaps (dims.18): the points a dimension end can measure from. Face corners and joint centres
// are both `endpoint`, so the nearer wins and centres stay reachable when the tolerance passes half a wall's thickness.

export type FaceSegment = { wall: string; start: Point; dir: Point; length: number };

const SLACK = 1e-9;
const SIDES: readonly ("left" | "right")[] = ["left", "right"];

/**
 * Each wall's two faces as drawn, in wall ID order, left of a → b first. A face runs along the domain's `faceExtent`,
 * so corners, T-junctions and bevels end it; a face with no extent offers no snap.
 */
export function faceSegments(doc: Document): FaceSegment[] {
  const out: FaceSegment[] = [];
  for (const id of sortedIds(doc.walls)) {
    const f = wallFrame(doc, id);
    if (!f) continue;
    for (const side of SIDES) {
      const extent = faceExtent(doc, id, side);
      if (!extent) continue;
      const offset = (side === "left" ? 1 : -1) * f.half;
      out.push({ wall: id, start: add(f.a, add(scale(f.left, offset), scale(f.dir, extent.start))), dir: f.dir, length: extent.end - extent.start });
    }
  }
  return out;
}

/** The foot of `p` on the face's line, or null when it falls past either end. */
function footOn(f: FaceSegment, p: Point): Point | null {
  const t = dot(sub(p, f.start), f.dir);
  return t >= -SLACK && t <= f.length + SLACK ? add(f.start, scale(f.dir, t)) : null;
}

function liveFaces(ctx: SnapContext): FaceSegment[] {
  return faceSegments(ctx.doc).filter((f) => !ctx.excludeWalls.has(f.wall));
}

/** The corners an end anchors to (the domain's `faceCorners`), marked like joint centres. */
export const faceCornerPolicy: SnapPolicy = (ctx) => {
  const out: SnapCandidate[] = [];
  for (const { point, joint } of faceCorners(ctx.doc)) {
    if (ctx.excludeJoints.has(joint) || (ctx.axis && !onAxis(ctx.axis, point))) continue;
    out.push(candidate(ctx, point, "endpoint"));
  }
  return out;
};

/** The nearest point on each face, never clamped to its ends; with Shift, where the axis crosses the face. */
export const onFacePolicy: SnapPolicy = (ctx) => {
  const out: SnapCandidate[] = [];
  for (const f of liveFaces(ctx)) {
    if (!ctx.axis) {
      const foot = footOn(f, ctx.cursor);
      if (foot) out.push(candidate(ctx, foot, "onWall"));
      continue;
    }
    const hit = lineIntersection(ctx.axis.origin, ctx.axis.dir, f.start, f.dir);
    if (hit && distanceToSegment(hit, f.start, add(f.start, scale(f.dir, f.length))) < EPS) out.push(candidate(ctx, hit, "onWall"));
  }
  return out;
};

/**
 * The foot of the perpendicular from the second click's origin to each face, when it lies within the face. The
 * global `perpendicularPolicy` lands on the centre line, inside the wall body.
 */
export const facePerpendicularPolicy: SnapPolicy = (ctx) => {
  const origin = ctx.drawOrigin;
  if (!origin) return [];
  const out: SnapCandidate[] = [];
  for (const f of liveFaces(ctx)) {
    const foot = footOn(f, origin);
    if (!foot || distance(foot, origin) < EPS) continue;
    out.push({ ...candidate(ctx, foot, "perpendicular"), guides: [origin] });
  }
  return out;
};

export const DIMENSION_POLICIES: readonly SnapPolicy[] = [
  faceCornerPolicy, endpointPolicy, facePerpendicularPolicy, onFacePolicy, anglePolicy, gridPolicy,
];
