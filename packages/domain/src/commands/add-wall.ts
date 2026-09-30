import { assertNever, err, ok } from "@fm/protocol";
import type { EntityKey, Point, Result } from "@fm/protocol";
import { MESSAGES, domainError, topologyMessage, type DomainError } from "../errors";
import { distance, projectOnSegment, segmentIntersection } from "../geometry";
import { sortedIds, wallEnds } from "../graph";
import { EPS, MIN_EDGE, type Document, type Joint, type Wall } from "../model";
import { diffPatch } from "../patch";
import { isFiniteNumber, isValidId } from "../shape";
import { validateDocument } from "../validate";
import type { CommandOf, CommandResult, JointRef } from "./types";

/** Distances closer than this count as equal, so float noise cannot reorder a tie. */
const TIE = 1e-9;

/**
 * IDs are capped at 128 characters (`isValidId`) and the longest suffix added to the operation ID is
 * "/w2" or "/j1" (3 characters), so 125 would fit; 120 keeps a small margin.
 */
const MAX_OP_ID_LENGTH = 120;

type Resolved =
  | { kind: "joint"; jointId: string; point: Point }
  | { kind: "new"; point: Point }
  | { kind: "split"; wallId: string; point: Point };

/**
 * §3.4 step 1: a point within EPS of a joint becomes that joint; otherwise a point within EPS of a
 * wall body splits that wall at the closest point. Entities are inspected in ID order; on equal
 * distances (within TIE) the smallest ID wins.
 */
function resolve(doc: Document, ref: JointRef): Result<Resolved, DomainError> {
  if ("existing" in ref) {
    const j = isValidId(ref.existing) ? doc.joints[ref.existing] : undefined;
    return j ? ok({ kind: "joint", jointId: j.id, point: { x: j.x, y: j.y } }) : err(domainError("notFound", "Joint not found"));
  }
  const p = ref.at;
  if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return err(domainError("invalidInput", "Invalid position"));
  let joint: { id: string; d: number } | null = null;
  for (const id of sortedIds(doc.joints)) {
    const j = doc.joints[id];
    if (!j) continue;
    const d = distance(p, j);
    if (d < EPS && (!joint || d < joint.d - TIE)) joint = { id, d };
  }
  if (joint) {
    const j = doc.joints[joint.id];
    if (j) return ok({ kind: "joint", jointId: j.id, point: { x: j.x, y: j.y } });
  }
  let wall: { id: string; d: number; point: Point } | null = null;
  for (const id of sortedIds(doc.walls)) {
    const ends = wallEnds(doc, id);
    if (!ends) continue;
    const q = projectOnSegment(p, ends.a, ends.b).point;
    const d = distance(p, q);
    if (d < EPS && (!wall || d < wall.d - TIE)) wall = { id, d, point: q };
  }
  if (wall) return ok({ kind: "split", wallId: wall.id, point: wall.point });
  return ok({ kind: "new", point: { x: p.x, y: p.y } });
}

/**
 * addWall normalisation (spec §3.4): resolve endpoints, split walls at T-junctions, reject collinear
 * overlap and interior crossings, validate. IDs: the new wall is `${opId}/w0`, split fragments
 * `${opId}/w1`…, new joints `${opId}/j0`…, in from-then-to order. A split wall keeps its ID on the
 * fragment next to its original `a` endpoint.
 */
export function addWall(doc: Document, cmd: CommandOf<"addWall">): CommandResult {
  if (!isValidId(cmd.opId) || cmd.opId.length > MAX_OP_ID_LENGTH) return err(domainError("invalidInput", "Invalid operation ID"));
  const prefix = `${cmd.opId}/`;
  if ([...Object.keys(doc.joints), ...Object.keys(doc.walls)].some((id) => id.startsWith(prefix))) {
    return err(domainError("invalidInput", "Operation ID already used"));
  }
  const from = resolve(doc, cmd.from);
  if (!from.ok) return from;
  const to = resolve(doc, cmd.to);
  if (!to.ok) return to;
  if (distance(from.value.point, to.value.point) < MIN_EDGE) return err(domainError("tooShort", MESSAGES.tooShort));
  if (from.value.kind === "split" && to.value.kind === "split" && from.value.wallId === to.value.wallId) {
    return err(domainError("overlap", MESSAGES.overlap));
  }

  const joints: Record<string, Joint> = { ...doc.joints };
  const walls: Record<string, Wall> = { ...doc.walls };
  const deps: EntityKey[] = [];
  let nextJoint = 0;
  let nextWall = 1;

  const place = (r: Resolved): Result<string, DomainError> => {
    switch (r.kind) {
      case "joint":
        deps.push({ table: "joints", id: r.jointId });
        return ok(r.jointId);
      case "new": {
        const id = `${prefix}j${nextJoint++}`;
        joints[id] = { id, x: r.point.x, y: r.point.y };
        return ok(id);
      }
      case "split": {
        const wall = doc.walls[r.wallId];
        const a = wall && doc.joints[wall.a];
        const b = wall && doc.joints[wall.b];
        if (!wall || !a || !b) return err(domainError("notFound", "Wall not found"));
        if (distance(a, r.point) < MIN_EDGE || distance(r.point, b) < MIN_EDGE) {
          return err(domainError("tooShort", MESSAGES.splitTooShort));
        }
        const id = `${prefix}j${nextJoint++}`;
        const fragment = `${prefix}w${nextWall++}`;
        joints[id] = { id, x: r.point.x, y: r.point.y };
        walls[wall.id] = { id: wall.id, a: wall.a, b: id };
        walls[fragment] = { id: fragment, a: id, b: wall.b };
        deps.push({ table: "walls", id: wall.id }, { table: "joints", id: wall.a }, { table: "joints", id: wall.b });
        return ok(id);
      }
      default:
        return assertNever(r);
    }
  };

  const a = place(from.value);
  if (!a.ok) return a;
  const b = place(to.value);
  if (!b.ok) return b;
  const wallId = `${prefix}w0`;
  walls[wallId] = { id: wallId, a: a.value, b: b.value };
  const next: Document = { ...doc, joints, walls };
  const pa = joints[a.value];
  const pb = joints[b.value];
  if (!pa || !pb) return err(domainError("notFound", "Joint not found"));

  const others = sortedIds(walls).filter((id) => id !== wallId);
  // §3.4 step 2: collinear overlap.
  for (const id of others) {
    const o = walls[id];
    const ends = wallEnds(next, id);
    if (!o || !ends) continue;
    const sharesBoth = (o.a === a.value || o.a === b.value) && (o.b === a.value || o.b === b.value);
    if (sharesBoth || segmentIntersection(pa, pb, ends.a, ends.b).kind === "overlap") {
      return err(domainError("overlap", MESSAGES.overlap));
    }
  }
  // §3.4 step 3: the new wall may touch other walls only at its own endpoints' joints.
  for (const id of others) {
    const o = walls[id];
    const ends = wallEnds(next, id);
    if (!o || !ends) continue;
    const hit = segmentIntersection(pa, pb, ends.a, ends.b);
    if (hit.kind !== "point") continue;
    const shared = [a.value, b.value].find((j) => j === o.a || j === o.b);
    const sharedPoint = shared === undefined ? undefined : joints[shared];
    if (!sharedPoint || distance(hit.point, sharedPoint) >= EPS) return err(domainError("crossing", MESSAGES.crossing));
  }
  // §3.4 step 4.
  const valid = validateDocument(next);
  if (!valid.ok) return err(domainError("invalid", topologyMessage(valid.error), valid.error));
  return ok({ doc: next, patch: diffPatch(doc, next, deps) });
}
