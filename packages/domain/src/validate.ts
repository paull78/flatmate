import { err, ok } from "@fm/protocol";
import type { EntityKey, Point, Result } from "@fm/protocol";
import type { Violation } from "./errors";
import { boxOf, distance, distanceToSegment, overlappingPairs, segmentIntersection } from "./geometry";
import { EPS, MIN_EDGE, type Document, type Wall } from "./model";
import { isFiniteNumber, isValidId, isValidName } from "./shape";

const jointKey = (id: string): EntityKey => ({ table: "joints", id });
const wallKey = (id: string): EntityKey => ({ table: "walls", id });

/** I8: IDs, keys, coordinates and label fields. */
function shapeViolations(doc: Document): Violation[] {
  const out: Violation[] = [];
  const bad = (table: EntityKey["table"], id: string, what: string): void => {
    out.push({ invariant: "I8", message: `${table} ${id}: ${what}`, entities: [{ table, id }] });
  };
  for (const [key, j] of Object.entries(doc.joints)) {
    if (!isValidId(j.id) || j.id !== key) bad("joints", key, "invalid ID");
    else if (!isFiniteNumber(j.x) || !isFiniteNumber(j.y)) bad("joints", key, "coordinates must be finite");
  }
  for (const [key, w] of Object.entries(doc.walls)) {
    if (!isValidId(w.id) || w.id !== key || !isValidId(w.a) || !isValidId(w.b)) bad("walls", key, "invalid ID");
  }
  for (const [key, l] of Object.entries(doc.zoneLabels)) {
    if (!isValidId(l.id) || l.id !== key) bad("zoneLabels", key, "invalid ID");
    else if (!isFiniteNumber(l.at.x) || !isFiniteNumber(l.at.y)) bad("zoneLabels", key, "position must be finite");
    else if (!isValidName(l.name)) bad("zoneLabels", key, "name too long");
  }
  return out;
}

type Segment = { wall: Wall; a: Point; b: Point };

/**
 * Checks invariants I1–I8 (spec §3.3). The pair tests (I4–I7) run only on pairs whose bounding boxes come within
 * 2·EPS, found by a sweep (spec §6.3); every hit of those tests lies within EPS of both items, so no pair is missed.
 * Within ±10 km of the origin this matches testing every pair; farther out, rounding made the all-pairs test report
 * false crossings between nearly collinear walls a few millimetres apart, which the sweep never tests.
 */
export function validateDocument(doc: Document): Result<void, Violation[]> {
  const shape = shapeViolations(doc);
  if (shape.length > 0) return err(shape);

  const out: Violation[] = [];
  const segments: Segment[] = [];
  const used = new Set<string>();
  const wallIds = Object.keys(doc.walls).sort();
  const jointIds = Object.keys(doc.joints).sort();

  for (const id of wallIds) {
    const wall = doc.walls[id];
    if (!wall) continue;
    const a = doc.joints[wall.a];
    const b = doc.joints[wall.b];
    if (!a || !b || wall.a === wall.b) {
      out.push({ invariant: "I1", message: `Wall ${id} needs two existing, distinct joints`, entities: [wallKey(id)] });
      continue;
    }
    used.add(wall.a);
    used.add(wall.b);
    if (distance(a, b) < MIN_EDGE) {
      out.push({ invariant: "I2", message: `Wall ${id} is shorter than 1 cm`, entities: [wallKey(id)] });
    }
    segments.push({ wall, a, b });
  }

  for (const id of jointIds) {
    if (!used.has(id)) out.push({ invariant: "I3", message: `Joint ${id} is not used by any wall`, entities: [jointKey(id)] });
  }

  const joints = jointIds.flatMap((id) => doc.joints[id] ?? []);
  // One sweep over joints (indices 0…J-1) and walls (J…), split into the three pair checks. Pairs come sorted, so
  // each check reports in the order of a loop over all pairs.
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
    if (p && q && distance(p, q) < EPS) {
      out.push({ invariant: "I4", message: `Joints ${p.id} and ${q.id} coincide`, entities: [jointKey(p.id), jointKey(q.id)] });
    }
  }

  for (const [i, k] of wallPairs) {
    const s = segments[i];
    const t = segments[k];
    if (!s || !t) continue;
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
    if (distanceToSegment(j, s.a, s.b) < EPS) {
      out.push({ invariant: "I6", message: `Joint ${j.id} lies on wall ${s.wall.id}`, entities: [jointKey(j.id), wallKey(s.wall.id)] });
    }
  }

  return out.length === 0 ? ok(undefined) : err(out);
}
