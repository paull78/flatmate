import type { EntityKey, Point } from "@fm/protocol";
import type { Violation } from "./errors";
import { boxOf, distance, distanceToSegment, overlappingPairs, segmentIntersection } from "./geometry";
import { EPS, type Document, type Joint, type Wall } from "./model";
import { rangesOverlap, wallRange, type Range } from "./queries/vertical";

// The pair checks between walls and joints, I4–I7 (spec: domain), beside validate.ts. They apply only where the heights
// meet (pillars.08): a loft wall may cross over a floor partition that stops under the loft.

export type Segment = { wall: Wall; a: Point; b: Point };

const jointKey = (id: string): EntityKey => ({ table: "joints", id });
const wallKey = (id: string): EntityKey => ({ table: "walls", id });

/** Every height: a row naming a missing deck (I21 reports it) or a joint no wall uses (I3) is checked against all. */
const EVERYWHERE: Range = { bottom: -Infinity, top: Infinity };

/** Each wall's range, and each joint's: the union of its walls' ranges (one base per joint, I21). */
function ranges(doc: Document, segments: readonly Segment[]): { walls: Range[]; joints: Map<string, Range> } {
  const walls = segments.map((s) => wallRange(doc, s.wall.id) ?? EVERYWHERE);
  const joints = new Map<string, Range>();
  segments.forEach((s, i) => {
    const r = walls[i] ?? EVERYWHERE;
    for (const id of [s.wall.a, s.wall.b]) {
      const was = joints.get(id);
      joints.set(id, was ? { bottom: Math.min(was.bottom, r.bottom), top: Math.max(was.top, r.top) } : r);
    }
  });
  return { walls, joints };
}

/**
 * I4 (coinciding joints), I5 (crossing), I6 (a joint on a wall) and I7 (overlap), only for pairs whose ranges overlap
 * (`rangesOverlap`: touching is not). The tests run only on pairs whose bounding boxes come within 2·EPS, found by a
 * sweep (spec: rendering), and the ranges filter after it, so the sweep's cost stays; every hit of those tests lies within
 * EPS of both items, so no pair is missed. Within ±10 km of the origin this matches testing every pair; farther out,
 * rounding made the all-pairs test report false crossings between nearly collinear walls a few millimetres apart,
 * which the sweep never tests. Pairs come sorted, so each check reports in the order of a loop over all pairs.
 */
export function pairViolations(doc: Document, segments: readonly Segment[], joints: readonly Joint[]): Violation[] {
  const out: Violation[] = [];
  const range = ranges(doc, segments);
  const jointRange = (id: string): Range => range.joints.get(id) ?? EVERYWHERE;
  const wallRangeAt = (i: number): Range => range.walls[i] ?? EVERYWHERE;
  // One sweep over joints (indices 0…J-1) and walls (J…), split into the three pair checks.
  const boxes = [...joints.map((j) => boxOf([j])), ...segments.map((s) => boxOf([s.a, s.b]))];
  const jointPairs: [number, number][] = [];
  const wallPairs: [number, number][] = [];
  const jointOnWall: [number, number][] = [];
  for (const [i, k] of overlappingPairs(boxes, 2 * EPS)) {
    if (k < joints.length) jointPairs.push([i, k]);
    else if (i >= joints.length) wallPairs.push([i - joints.length, k - joints.length]);
    else jointOnWall.push([i, k - joints.length]);
  }

  for (const [i, k] of jointPairs) {
    const p = joints[i];
    const q = joints[k];
    if (p && q && distance(p, q) < EPS && rangesOverlap(jointRange(p.id), jointRange(q.id))) {
      out.push({ invariant: "I4", message: `Joints ${p.id} and ${q.id} coincide`, entities: [jointKey(p.id), jointKey(q.id)] });
    }
  }

  for (const [i, k] of wallPairs) {
    const s = segments[i];
    const t = segments[k];
    if (!s || !t || !rangesOverlap(wallRangeAt(i), wallRangeAt(k))) continue;
    const shared = [s.wall.a, s.wall.b].filter((j) => j === t.wall.a || j === t.wall.b);
    const entities = [wallKey(s.wall.id), wallKey(t.wall.id)];
    if (shared.length === 2) {
      out.push({ invariant: "I7", message: `Walls ${s.wall.id} and ${t.wall.id} overlap`, entities });
      continue;
    }
    const hit = segmentIntersection(s.a, s.b, t.a, t.b);
    if (hit.kind === "overlap") {
      out.push({ invariant: "I7", message: `Walls ${s.wall.id} and ${t.wall.id} overlap`, entities });
    } else if (hit.kind === "point") {
      const sharedJoint = shared[0] === undefined ? undefined : doc.joints[shared[0]];
      if (!sharedJoint || distance(hit.point, sharedJoint) >= EPS) {
        out.push({ invariant: "I5", message: `Walls ${s.wall.id} and ${t.wall.id} cross`, entities });
      }
    }
  }

  for (const [i, k] of jointOnWall) {
    const j = joints[i];
    const s = segments[k];
    if (!j || !s || s.wall.a === j.id || s.wall.b === j.id) continue;
    if (distanceToSegment(j, s.a, s.b) < EPS && rangesOverlap(jointRange(j.id), wallRangeAt(k))) {
      out.push({ invariant: "I6", message: `Joint ${j.id} lies on wall ${s.wall.id}`, entities: [jointKey(j.id), wallKey(s.wall.id)] });
    }
  }
  return out;
}
