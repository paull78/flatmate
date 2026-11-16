import type { Point } from "@fm/protocol";
import { cross, dot, normalize, sub } from "../geometry";
import { jointWalls } from "../graph";
import { memo } from "../memo";
import { EPS, type Document } from "../model";

// Straight runs of walls (straight.02): walls meeting end to end in one line, through joints where the line goes on,
// whatever else meets there. A joint is in a line when it lies within EPS of the line through the two far ends.

const wallsAtJoints = memo(jointWalls);

/** Distance of `p` from the line from → to, and how far along it `p` lies; null when from and to coincide. */
function onLine(from: Point, p: Point, to: Point): { off: number; along: number; len: number } | null {
  const d = sub(to, from);
  const len = Math.hypot(d.x, d.y);
  if (len === 0) return null;
  return { off: Math.abs(cross(d, sub(p, from))) / len, along: dot(d, sub(p, from)) / len, len };
}

/** Whether `p` lies within EPS of the line from → to, strictly between them. */
function between(from: Point, p: Point, to: Point): boolean {
  const l = onLine(from, p, to);
  return l !== null && l.off < EPS && 0 < l.along && l.along < l.len;
}

/**
 * Whether a → b sits in the line from `from` to `to` (the far ends of the walls at a and at b): a and b lie within
 * EPS of that line, in the order from, a, b, to. The far ends set the line, so rounded joints only need to lie near it.
 */
export function inLine(from: Point, a: Point, b: Point, to: Point): boolean {
  const la = onLine(from, a, to);
  const lb = onLine(from, b, to);
  return la !== null && lb !== null && between(from, a, to) && between(from, b, to) && la.along < lb.along;
}

/** The far end of wall `wallId` from joint `jointId`, or null. */
function farEnd(doc: Document, wallId: string, jointId: string): Point | null {
  const w = doc.walls[wallId];
  const far = w ? doc.joints[w.a === jointId ? w.b : w.a] : undefined;
  return far ? { x: far.x, y: far.y } : null;
}

/** The wall continuing `wallId` in line through joint `jointId`: the one other wall there in line, else null. */
function continuation(doc: Document, wallId: string, jointId: string): string | null {
  const j = doc.joints[jointId];
  const from = farEnd(doc, wallId, jointId);
  if (!j || !from) return null;
  const next = (wallsAtJoints(doc).get(jointId) ?? []).filter((id) => {
    const to = id === wallId ? null : farEnd(doc, id, jointId);
    return to !== null && between(from, j, to);
  });
  return next.length === 1 && next[0] !== undefined ? next[0] : null;
}

/** Whether the joint has exactly two walls, in line (a straight joint). */
export function isStraightJoint(doc: Document, jointId: string): boolean {
  const walls = wallsAtJoints(doc).get(jointId) ?? [];
  const [p, q] = walls;
  return walls.length === 2 && p !== undefined && q !== undefined && continuation(doc, p, jointId) === q;
}

/** Walk from `wallId` out of joint `jointId`, collecting the walls that continue the line, nearest first. */
function walk(doc: Document, wallId: string, jointId: string, seen: Set<string>): string[] {
  const out: string[] = [];
  let [wall, joint] = [wallId, jointId];
  for (;;) {
    const next = continuation(doc, wall, joint);
    const w = next === null ? undefined : doc.walls[next];
    if (next === null || !w || seen.has(next)) return out;
    seen.add(next);
    out.push(next);
    [wall, joint] = [next, w.a === joint ? w.b : w.a];
  }
}

/** The walls of `wallId`'s run, in order along the line from its joint-a side; [] when the wall is missing. */
export function wallRunOf(doc: Document, wallId: string): string[] {
  const w = doc.walls[wallId];
  if (!w) return [];
  const seen = new Set([wallId]);
  const before = walk(doc, wallId, w.a, seen);
  const after = walk(doc, wallId, w.b, seen);
  return [...before.reverse(), wallId, ...after];
}

/**
 * How far out of a straight line the two walls at a joint are, in degrees: 0 when in line, 90 at a right angle; null
 * unless exactly two walls meet there. Joints and their walls that are in line within 1 mm read 0 here too.
 */
export function kinkAngle(doc: Document, jointId: string): number | null {
  const walls = wallsAtJoints(doc).get(jointId) ?? [];
  const j = doc.joints[jointId];
  const [p, q] = walls;
  if (walls.length !== 2 || !j || p === undefined || q === undefined) return null;
  const [fp, fq] = [farEnd(doc, p, jointId), farEnd(doc, q, jointId)];
  const [dp, dq] = [fp ? normalize(sub(fp, j)) : null, fq ? normalize(sub(fq, j)) : null];
  if (!dp || !dq) return null;
  return 180 - (Math.acos(Math.max(-1, Math.min(1, dot(dp, dq)))) * 180) / Math.PI;
}

/** Degrees between the wall's direction and the nearest axis, 0 to 45; 0 when the wall or a joint is missing. */
export function offAxisAngle(doc: Document, wallId: string): number {
  const w = doc.walls[wallId];
  const a = w ? doc.joints[w.a] : undefined;
  const b = w ? doc.joints[w.b] : undefined;
  if (!a || !b) return 0;
  const deg = (Math.abs(Math.atan2(b.y - a.y, b.x - a.x)) * 180) / Math.PI % 90;
  return Math.min(deg, 90 - deg);
}
