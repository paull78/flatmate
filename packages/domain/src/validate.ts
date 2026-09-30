import { err, ok } from "@fm/protocol";
import type { EntityKey, Point, Result } from "@fm/protocol";
import type { Violation } from "./errors";
import { distance, distanceToSegment, segmentIntersection } from "./geometry";
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

/** Checks invariants I1–I8 (spec §3.3). O(n²) pair tests. */
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
  joints.forEach((p, i) => {
    for (const q of joints.slice(i + 1)) {
      if (distance(p, q) < EPS) {
        out.push({ invariant: "I4", message: `Joints ${p.id} and ${q.id} coincide`, entities: [jointKey(p.id), jointKey(q.id)] });
      }
    }
  });

  segments.forEach((s, i) => {
    for (const t of segments.slice(i + 1)) {
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
  });

  for (const j of joints) {
    for (const s of segments) {
      if (s.wall.a === j.id || s.wall.b === j.id) continue;
      if (distanceToSegment(j, s.a, s.b) < EPS) {
        out.push({ invariant: "I6", message: `Joint ${j.id} lies on wall ${s.wall.id}`, entities: [jointKey(j.id), wallKey(s.wall.id)] });
      }
    }
  }

  return out.length === 0 ? ok(undefined) : err(out);
}
