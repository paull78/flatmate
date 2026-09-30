import type { Point } from "@fm/protocol";
import { add, distance, dot, lineIntersection, normalize, perpLeft, scale, sub } from "../geometry";
import { jointWalls, sortedIds, wallEnds } from "../graph";
import { EPS, WALL_THICKNESS, type Document } from "../model";

const HALF = WALL_THICKNESS / 2;
const MITER_LIMIT = 4; // an outer miter tip farther than 4 · HALF from the joint becomes a bevel (inner tips: limitSide)
// Inner corners that would stop closer than this meet instead: segment tests stretch each end by EPS,
// so a shorter edge would make its two neighbouring edges touch.
const MERGE_GAP = 2 * EPS;

type Spoke = { wallId: string; dir: Point; angle: number };

/** Walls leaving a joint, sorted counter-clockwise by angle. */
function spokes(doc: Document, jointId: string, wallIds: string[]): Spoke[] {
  const j = doc.joints[jointId];
  if (!j) return [];
  const out: Spoke[] = [];
  for (const wallId of wallIds) {
    const w = doc.walls[wallId];
    const other = w && doc.joints[w.a === jointId ? w.b : w.a];
    const dir = other ? normalize(sub(other, j)) : null;
    if (dir) out.push({ wallId, dir, angle: Math.atan2(dir.y, dir.x) });
  }
  return out.sort((p, q) => p.angle - q.angle || (p.wallId < q.wallId ? -1 : 1));
}

/** Counter-clockwise angle from direction u to direction v, in (0, 2π]. */
function ccwAngle(u: Point, v: Point): number {
  const a = Math.atan2(v.y, v.x) - Math.atan2(u.y, u.x);
  const r = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return r === 0 ? 2 * Math.PI : r;
}

/**
 * Corner points of one side of a wall at joint j, edge point first.
 * side +1: the wall's left edge (seen leaving j) meets the right edge of the next wall counter-clockwise.
 * side −1: the wall's right edge meets the left edge of the next wall clockwise.
 */
function corner(j: Point, me: Spoke, neighbour: Spoke | null, side: 1 | -1): Point[] {
  const nMe = perpLeft(me.dir);
  const own = add(j, scale(nMe, side * HALF));
  if (!neighbour || neighbour.wallId === me.wallId) return [own]; // flat end (spec §3.5)
  const gap = side === 1 ? ccwAngle(me.dir, neighbour.dir) : ccwAngle(neighbour.dir, me.dir);
  if (Math.abs(gap - Math.PI) < 1e-9) return [own]; // straight through: continuous edges
  const other = add(j, scale(perpLeft(neighbour.dir), -side * HALF));
  const tip = lineIntersection(own, me.dir, other, neighbour.dir);
  if (!tip) return [own];
  if (gap > Math.PI && distance(tip, j) > MITER_LIMIT * HALF) {
    // Bevel: both walls share the midpoint of their two edge points, so no gap remains.
    return [own, scale(add(own, other), 0.5)];
  }
  return [tip];
}

/** How far a corner reaches into its wall from joint j (dir points along the wall); only inner miter tips reach past 0. */
function reach(points: Point[], j: Point, dir: Point): number {
  return Math.max(0, ...points.map((p) => dot(sub(p, j), dir)));
}

/** Slides the corner points that reach into the wall along their offset line to k times their reach. */
function scaleReach(points: Point[], j: Point, dir: Point, k: number): Point[] {
  return points.map((p) => {
    const r = dot(sub(p, j), dir);
    return r > 0 ? sub(p, scale(dir, r * (1 - k))) : p;
  });
}

/**
 * One side of wall ab, with its corner points at a and at b: when the inner corners' reaches add up to more than
 * the wall's length, both scale in proportion so they meet instead of passing each other (spec §3.5).
 * Corners that would stop less than MERGE_GAP apart meet too.
 */
function limitSide(a: Point, b: Point, atA: Point[], atB: Point[]): [Point[], Point[]] {
  const dir = normalize(sub(b, a));
  if (!dir) return [atA, atB];
  const back = scale(dir, -1);
  const total = reach(atA, a, dir) + reach(atB, b, back);
  const len = distance(a, b);
  if (total <= 0 || total <= len - MERGE_GAP) return [atA, atB]; // no inner corner, or room to spare
  return [scaleReach(atA, a, dir, len / total), scaleReach(atB, b, back, len / total)];
}

/** Drops each point that repeats the next one, cyclically: limited corners can land on each other or on a flat end. */
function withoutRepeats(ring: Point[]): Point[] {
  return ring.filter((p, i) => distance(p, ring[(i + 1) % ring.length] ?? p) > 1e-9);
}

/**
 * One counter-clockwise polygon per wall with mitered joins (spec §3.5): at each joint the incident
 * walls are sorted by angle and each wall's edge meets the facing edge of its angular neighbour.
 * At a joint of 3 or more walls the outline runs through the joint between its two corners.
 * Inner corners are limited so each outline stays within its wall body, plus its outer miters and bevels.
 */
export function wallOutlines(doc: Document): ReadonlyMap<string, readonly Point[]> {
  // Cached by document identity like the rooms (spec §3.6): shared by every caller, so read-only.
  const cached = outlineMemo.get(doc);
  if (cached) return cached;
  const result = computeOutlines(doc);
  outlineMemo.set(doc, result);
  return result;
}

const outlineMemo = new WeakMap<Document, ReadonlyMap<string, readonly Point[]>>();

function computeOutlines(doc: Document): Map<string, Point[]> {
  const byJoint = jointWalls(doc);
  const cache = new Map<string, Spoke[]>();
  const spokesAt = (jointId: string): Spoke[] => {
    let s = cache.get(jointId);
    if (!s) {
      s = spokes(doc, jointId, byJoint.get(jointId) ?? []);
      cache.set(jointId, s);
    }
    return s;
  };
  // Where 3 or more walls meet, each outline also passes through the joint: corner to corner alone would
  // leave the region around the joint (e.g. a triangle under a T-junction) in no outline.
  const sides = (jointId: string, wallId: string): { left: Point[]; through: Point[]; right: Point[] } | null => {
    const j = doc.joints[jointId];
    const list = spokesAt(jointId);
    const i = list.findIndex((s) => s.wallId === wallId);
    const me = list[i];
    if (!j || !me) return null;
    const next = list[(i + 1) % list.length] ?? null;
    const prev = list[(i - 1 + list.length) % list.length] ?? null;
    const through = list.length >= 3 ? [{ x: j.x, y: j.y }] : [];
    return { left: corner(j, me, next, 1), through, right: corner(j, me, prev, -1) };
  };

  const out = new Map<string, Point[]>();
  for (const id of sortedIds(doc.walls)) {
    const w = doc.walls[id];
    const ends = wallEnds(doc, id);
    const atA = w && sides(w.a, id);
    const atB = w && sides(w.b, id);
    if (!ends || !atA || !atB) continue;
    // The left side seen from a is the right side seen from b, and vice versa.
    const [aLeft, bRight] = limitSide(ends.a, ends.b, atA.left, atB.right);
    const [aRight, bLeft] = limitSide(ends.a, ends.b, atA.right, atB.left);
    out.set(id, withoutRepeats([...aLeft, ...atA.through, ...[...aRight].reverse(), ...bLeft, ...atB.through, ...[...bRight].reverse()]));
  }
  return out;
}
