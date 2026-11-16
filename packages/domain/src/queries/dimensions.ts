import type { Point } from "@fm/protocol";
import { distance, dot, normalize, sub } from "../geometry";
import { memo } from "../memo";
import { ANCHOR_TOLERANCE, type Dimension, type DimensionEnd, type Document } from "../model";
import { wallCorners } from "./outlines";

// Placed dimensions (dims.16): an end is anchored to a joint or free; its point is always worked out from the document.

export type FaceCorner = { point: Point; joint: string };

const SAME = 1e-9; // points and distances this close count as equal

/** Each joint's face corners, without repeats (both walls at a miter compute its tip), sorted by x, then y. */
const cornersByJoint = memo((doc: Document): ReadonlyMap<string, readonly Point[]> => {
  const out = new Map<string, Point[]>();
  for (const { a, b } of wallCorners(doc).values()) {
    for (const end of [a, b]) {
      for (const side of [end.left, end.right]) {
        const p = side.points[0];
        if (!side.faceCorner || !p) continue;
        const list = out.get(end.joint) ?? [];
        if (!list.some((q) => distance(p, q) <= SAME)) list.push({ x: p.x, y: p.y });
        out.set(end.joint, list);
      }
    }
  }
  for (const list of out.values()) list.sort((p, q) => p.x - q.x || p.y - q.y);
  return out;
});

/**
 * The wall face corners a dimension end can anchor to: lone wall ends and miter tips, after inner corners are limited.
 * Not bevels or the flat steps of straight joins: a step's two points share one direction from the joint (dims.28).
 * Sorted by joint, then x, then y; cached by document identity, so read-only.
 */
export const faceCorners = memo((doc: Document): readonly FaceCorner[] =>
  [...cornersByJoint(doc)].sort(([j], [k]) => (j < k ? -1 : 1)).flatMap(([joint, points]) => points.map((point) => ({ point, joint }))),
);

/**
 * The end a point placed at `p` becomes: anchored to the nearest face corner or joint centre within ANCHOR_TOLERANCE
 * (a tie goes to the lower joint ID), with the direction from the joint centre to that corner; otherwise free.
 */
export function dimensionEnd(doc: Document, p: Point): DimensionEnd {
  const centres = Object.values(doc.joints).map((j): FaceCorner => ({ point: { x: j.x, y: j.y }, joint: j.id }));
  let best: { c: FaceCorner; d: number } | null = null;
  for (const c of [...faceCorners(doc), ...centres]) {
    const d = distance(p, c.point);
    if (d > ANCHOR_TOLERANCE) continue;
    if (!best || d < best.d - SAME || (d <= best.d + SAME && c.joint < best.c.joint)) best = { c, d };
  }
  const centre = best && doc.joints[best.c.joint];
  if (!best || !centre) return { x: p.x, y: p.y };
  const toward = normalize(sub(best.c.point, centre)) ?? { x: 0, y: 0 };
  return { joint: best.c.joint, tx: toward.x, ty: toward.y };
}

/** An anchored end's point: the face corner at its joint nearest its direction, else the joint centre. */
function endPoint(doc: Document, end: DimensionEnd): Point | null {
  if (!("joint" in end)) return { x: end.x, y: end.y };
  const j = doc.joints[end.joint];
  if (!j) return null;
  const centre = { x: j.x, y: j.y };
  if (end.tx === 0 && end.ty === 0) return centre;
  let best: { p: Point; k: number } | null = null;
  for (const p of cornersByJoint(doc).get(end.joint) ?? []) {
    const dir = distance(p, centre) > SAME ? normalize(sub(p, centre)) : null;
    const k = dir ? dot(dir, { x: end.tx, y: end.ty }) : -Infinity;
    if (dir && (!best || k > best.k)) best = { p, k };
  }
  return best ? { x: best.p.x, y: best.p.y } : centre;
}

/** The two measured points, or null when an anchor's joint is missing. */
export function dimensionPoints(doc: Document, d: Dimension): { a: Point; b: Point } | null {
  const a = endPoint(doc, d.a);
  const b = endPoint(doc, d.b);
  return a && b ? { a, b } : null;
}

export function dimensionLength(doc: Document, d: Dimension): number | null {
  const p = dimensionPoints(doc, d);
  return p ? distance(p.a, p.b) : null;
}
