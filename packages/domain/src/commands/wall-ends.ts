import { err, ok } from "@fm/protocol";
import type { Point, Result } from "@fm/protocol";
import { domainError, type DomainError } from "../errors";
import { add, distance, distanceToSegment, dot, perpLeft, projectOnSegment, scale, sub } from "../geometry";
import { incidentWalls, sortedIds, wallEnds } from "../graph";
import { EPS, FLOOR_BASE, type Document } from "../model";
import { isFiniteNumber, isValidId } from "../shape";
import { rangesOverlap, wallRange, type Range } from "../queries/vertical";
import type { JointRef } from "./types";

// Where a new wall's ends go (spec: walls-rooms step 1, pillars.09): onto a joint or a wall of the wall's own base, or, for a
// wall on a deck drawn into a wall of another base, flush against that wall's face.

/** Distances closer than this count as equal, so float noise cannot reorder a tie. */
const TIE = 1e-9;

export type Resolved =
  | { kind: "joint"; jointId: string; point: Point }
  | { kind: "new"; point: Point }
  | { kind: "split"; wallId: string; point: Point };

/** The point a joint reference names, before resolution. */
export function refPoint(doc: Document, ref: JointRef): Result<Point, DomainError> {
  if ("existing" in ref) {
    const j = isValidId(ref.existing) ? doc.joints[ref.existing] : undefined;
    return j ? ok({ x: j.x, y: j.y }) : err(domainError("notFound", "Joint not found"));
  }
  const p = ref.at;
  return isFiniteNumber(p.x) && isFiniteNumber(p.y) ? ok({ x: p.x, y: p.y }) : err(domainError("invalidInput", "Invalid position"));
}

/** What `resolveAt` leaves out: a moving joint and its own walls, and columns' rows and joints (connectJoint). */
export type ResolveExclusions = { excludeJoints?: ReadonlySet<string>; excludeWalls?: ReadonlySet<string>; noColumns?: boolean };

/**
 * A point within EPS of a joint whose walls stand on `base` becomes that joint; otherwise a point within EPS of a wall
 * on `base` splits it at the closest point. Joints and walls of other bases are not there, nor what `skip` excludes.
 * Entities are inspected in ID order; on equal distances (within TIE) the smallest ID wins.
 */
export function resolveAt(doc: Document, p: Point, base: string, skip: ResolveExclusions = {}): Resolved {
  const otherBase = (w: string): boolean => doc.walls[w]?.base !== base || (skip.noColumns === true && doc.walls[w]?.column === true);
  const offLimits = (w: string): boolean => otherBase(w) || skip.excludeWalls?.has(w) === true; // the moving joint's own walls: no self-split
  let joint: { id: string; d: number } | null = null;
  for (const id of sortedIds(doc.joints)) {
    const j = doc.joints[id];
    const d = j ? distance(p, j) : Infinity;
    if (d >= EPS || (joint && d >= joint.d - TIE) || skip.excludeJoints?.has(id) || incidentWalls(doc, id).some(otherBase)) continue;
    joint = { id, d };
  }
  const found = joint ? doc.joints[joint.id] : undefined;
  if (found) return { kind: "joint", jointId: found.id, point: { x: found.x, y: found.y } };
  let wall: { id: string; d: number; point: Point } | null = null;
  for (const id of sortedIds(doc.walls)) {
    const ends = wallEnds(doc, id);
    if (!ends || offLimits(id)) continue;
    const q = projectOnSegment(p, ends.a, ends.b).point;
    const d = distance(p, q);
    if (d < EPS && (!wall || d < wall.d - TIE)) wall = { id, d, point: q };
  }
  return wall ? { kind: "split", wallId: wall.id, point: wall.point } : { kind: "new", point: p };
}

/**
 * Where the end at `end` of a new wall from `from`, standing on deck `base` over `range`, stops when it lies in the
 * body of a wall of another base whose range meets it (the shell, AC-09): on that wall's face on `from`'s side, along
 * the new wall's own line, so a square end is flush with the face. With several such walls, the face met first; null
 * when the end lies in none, or the line runs along the face.
 */
export function flushEnd(doc: Document, end: Point, from: Point, base: string, range: Range): Point | null {
  const u = sub(end, from);
  let best: { t: number; point: Point } | null = null;
  for (const id of sortedIds(doc.walls)) {
    const w = doc.walls[id];
    const ends = wallEnds(doc, id);
    const r = wallRange(doc, id);
    if (!w || !ends || !r || w.base === base || !rangesOverlap(r, range)) continue;
    const half = w.thickness / 2;
    const len = distance(ends.a, ends.b);
    if (len < EPS || distanceToSegment(end, ends.a, ends.b) > half + EPS) continue;
    const side = Math.sign(dot(sub(from, ends.a), perpLeft(sub(ends.b, ends.a))));
    const n = scale(perpLeft(sub(ends.b, ends.a)), side / len); // the unit normal towards `from`
    const across = dot(u, n);
    if (side === 0 || Math.abs(across) < TIE) continue;
    const t = dot(sub(add(ends.a, scale(n, half)), from), n) / across;
    const point = add(from, scale(u, t));
    const along = dot(sub(point, ends.a), sub(ends.b, ends.a)) / len;
    if (t <= 0 || along < -EPS || along > len + EPS) continue;
    if (!best || t < best.t - TIE) best = { t, point };
  }
  return best?.point ?? null;
}

/**
 * Resolves one end of a new wall on `base` (`toward` is its other end): an existing joint, or `resolveAt` on the point;
 * for a wall on a deck, a point left new that lies in a wall of another base is moved flush against its face and
 * resolved again there.
 */
export function resolveEnd(doc: Document, ref: JointRef, toward: Point, base: string, range: Range): Result<Resolved, DomainError> {
  const p = refPoint(doc, ref);
  if (!p.ok) return p;
  if ("existing" in ref) return ok({ kind: "joint", jointId: ref.existing, point: p.value });
  const r = resolveAt(doc, p.value, base);
  const flush = r.kind === "new" && base !== FLOOR_BASE ? flushEnd(doc, p.value, toward, base, range) : null;
  return ok(flush ? resolveAt(doc, flush, base) : r);
}
