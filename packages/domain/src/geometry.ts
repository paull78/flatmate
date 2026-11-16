import type { Point } from "@fm/protocol";
import { EPS } from "./model";

export function add(a: Point, b: Point): Point { return { x: a.x + b.x, y: a.y + b.y }; }
export function sub(a: Point, b: Point): Point { return { x: a.x - b.x, y: a.y - b.y }; }
export function scale(a: Point, k: number): Point { return { x: a.x * k, y: a.y * k }; }
export function dot(a: Point, b: Point): number { return a.x * b.x + a.y * b.y; }
export function cross(a: Point, b: Point): number { return a.x * b.y - a.y * b.x; }
export function length(v: Point): number { return Math.hypot(v.x, v.y); }
export function distance(a: Point, b: Point): number { return Math.hypot(a.x - b.x, a.y - b.y); }
export function perpLeft(v: Point): Point { return { x: -v.y, y: v.x }; }

export function normalize(v: Point): Point | null {
  const l = length(v);
  return l < 1e-12 ? null : { x: v.x / l, y: v.y / l };
}

/** Closest point on segment ab to p; t ∈ [0, 1] is its parameter along ab. */
export function projectOnSegment(p: Point, a: Point, b: Point): { point: Point; t: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-24) return { point: a, t: 0 };
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2));
  return { point: add(a, scale(ab, t)), t };
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  return distance(p, projectOnSegment(p, a, b).point);
}

type SegmentHit =
  | { kind: "none" }
  | { kind: "point"; point: Point; t: number; u: number }
  | { kind: "overlap"; length: number };

/**
 * Intersection of segments ab and cd with an EPS tolerance at the ends.
 * Collinear segments sharing more than EPS of length report "overlap".
 */
export function segmentIntersection(a: Point, b: Point, c: Point, d: Point): SegmentHit {
  const r = sub(b, a);
  const s = sub(d, c);
  const lr = length(r);
  const ls = length(s);
  if (lr < 1e-12 || ls < 1e-12) return { kind: "none" };
  const denom = cross(r, s);
  const ac = sub(c, a);
  if (Math.abs(denom) < 1e-9 * lr * ls) {
    // Parallel: overlap only if collinear.
    if (Math.abs(cross(ac, r)) / lr >= EPS) return { kind: "none" };
    const t0 = dot(ac, r) / (lr * lr);
    const t1 = dot(sub(d, a), r) / (lr * lr);
    const lo = Math.max(0, Math.min(t0, t1));
    const hi = Math.min(1, Math.max(t0, t1));
    const shared = (hi - lo) * lr;
    if (shared > EPS) return { kind: "overlap", length: shared };
    if (shared < -EPS) return { kind: "none" };
    const t = Math.min(1, Math.max(0, (lo + hi) / 2));
    const point = add(a, scale(r, t));
    return { kind: "point", point, t, u: dot(sub(point, c), s) / (ls * ls) };
  }
  const t = cross(ac, s) / denom;
  const u = cross(ac, r) / denom;
  const tolT = EPS / lr;
  const tolU = EPS / ls;
  if (t < -tolT || t > 1 + tolT || u < -tolU || u > 1 + tolU) return { kind: "none" };
  return { kind: "point", point: add(a, scale(r, Math.min(1, Math.max(0, t)))), t, u };
}

/** Intersection of the infinite lines p + t·d and q + u·e, or null when parallel. */
export function lineIntersection(p: Point, d: Point, q: Point, e: Point): Point | null {
  const denom = cross(d, e);
  if (Math.abs(denom) < 1e-12 * length(d) * length(e)) return null;
  const t = cross(sub(q, p), e) / denom;
  return add(p, scale(d, t));
}

/** Shoelace area; positive when the ring runs counter-clockwise (y up). */
export function signedArea(ring: readonly Point[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    if (p && q) s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

/** Even-odd containment; points on the boundary may go either way. */
export function pointInPolygon(p: Point, ring: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (!a || !b) continue;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * One step of Sutherland–Hodgman: the part of `ring` on the left of the directed line a→b (points on it count as left).
 * The ring may be concave; a ring the line splits comes back as one ring whose pieces are joined by zero-area edges
 * along the line, which fill nothing under even-odd.
 */
export function clipHalfPlane(ring: readonly Point[], a: Point, b: Point): Point[] {
  const d = sub(b, a);
  const side = (q: Point): number => cross(d, sub(q, a));
  const out: Point[] = [];
  ring.forEach((q, i) => {
    const next = ring[(i + 1) % ring.length] ?? q;
    const [fq, fn] = [side(q), side(next)];
    if (fq >= 0) out.push(q);
    if ((fq >= 0) !== (fn >= 0)) {
      const t = fq / (fq - fn);
      out.push({ x: q.x + t * (next.x - q.x), y: q.y + t * (next.y - q.y) });
    }
  });
  return out;
}

/** Whether p lies in a convex ring of either winding, or at most `tol` outside each of its edges. */
export function inConvex(p: Point, ring: readonly Point[], tol: number): boolean {
  const sign = signedArea(ring) < 0 ? -1 : 1;
  return ring.every((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const len = b ? distance(a, b) : 0;
    return !b || len === 0 || (sign * cross(sub(b, a), sub(p, a))) / len >= -tol;
  });
}

/** No two non-adjacent edges touch, and adjacent edges do not fold back onto each other. */
export function isSimplePolygon(ring: readonly Point[]): boolean {
  const n = ring.length;
  if (n < 3) return false;
  const edge = (i: number): [Point, Point] | null => {
    const a = ring[i % n];
    const b = ring[(i + 1) % n];
    return a && b ? [a, b] : null;
  };
  for (let i = 0; i < n; i++) {
    const e1 = edge(i);
    if (!e1) return false;
    for (let j = i + 1; j < n; j++) {
      const e2 = edge(j);
      if (!e2) return false;
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      const hit = segmentIntersection(e1[0], e1[1], e2[0], e2[1]);
      if (adjacent) {
        if (hit.kind === "overlap") return false;
      } else if (hit.kind !== "none") {
        return false;
      }
    }
  }
  return true;
}

export type Box = { minX: number; minY: number; maxX: number; maxY: number };

export function boxOf(points: readonly Point[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** Whether p lies in the box widened by margin on every side. */
export function inBox(p: Point, box: Box, margin: number): boolean {
  return p.x >= box.minX - margin && p.x <= box.maxX + margin && p.y >= box.minY - margin && p.y <= box.maxY + margin;
}

/**
 * The index pairs [i, j], i < j, whose boxes overlap once each is widened by `margin`, sorted by i then j: the
 * candidates for an exact pair test, in the order an all-pairs loop would visit them. A sweep over x, so the cost
 * is about n log n plus the pairs that overlap in x.
 */
export function overlappingPairs(boxes: readonly Box[], margin: number): [number, number][] {
  const gap = 2 * margin;
  const order = boxes.map((box, i) => ({ box, i })).sort((p, q) => p.box.minX - q.box.minX);
  const pairs: [number, number][] = [];
  order.forEach(({ box: a, i }, k) => {
    for (let l = k + 1; l < order.length; l++) {
      const other = order[l];
      if (!other || other.box.minX > a.maxX + gap) break;
      const b = other.box;
      if (b.minY > a.maxY + gap || a.minY > b.maxY + gap) continue;
      pairs.push(i < other.i ? [i, other.i] : [other.i, i]);
    }
  });
  return pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}

/** cos and sin of an angle in degrees; exact for multiples of 90, so right-angle rotations add no float noise. */
function cosSinDeg(deg: number): [number, number] {
  const d = ((deg % 360) + 360) % 360;
  if (d === 0) return [1, 0];
  if (d === 90) return [0, 1];
  if (d === 180) return [-1, 0];
  if (d === 270) return [0, -1];
  const r = (d * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
}

/** p turned counter-clockwise by `deg` degrees about c. */
export function rotateAbout(p: Point, c: Point, deg: number): Point {
  const [cos, sin] = cosSinDeg(deg);
  const x = p.x - c.x;
  const y = p.y - c.y;
  return { x: c.x + x * cos - y * sin, y: c.y + x * sin + y * cos };
}

/**
 * Whether two convex polygons overlap by more than `tol` (separating axis test): touching edges, and contact
 * within `tol`, are not overlap. Used for footprints, use zones and wall bodies (spec: layouts).
 */
export function convexOverlap(a: readonly Point[], b: readonly Point[], tol: number = EPS): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const axis = p && q ? normalize(perpLeft(sub(q, p))) : null;
      if (!axis) continue;
      const [minA, maxA] = project(a, axis);
      const [minB, maxB] = project(b, axis);
      if (maxA <= minB + tol || maxB <= minA + tol) return false;
    }
  }
  return true;
}

/**
 * The intersection of two convex rings: `a` clipped by each edge of `b` in turn (Sutherland–Hodgman), counter-clockwise
 * when `a` is; empty when they don't meet. Touching rings give a degenerate ring of zero area.
 */
export function convexIntersection(a: readonly Point[], b: readonly Point[]): Point[] {
  const ccw = signedArea(b) < 0 ? [...b].reverse() : b;
  let out: Point[] = [...a];
  for (let i = 0; i < ccw.length && out.length > 0; i++) {
    const p = ccw[i];
    const q = ccw[(i + 1) % ccw.length];
    if (p && q) out = clipHalfPlane(out, p, q);
  }
  return out;
}

function project(poly: readonly Point[], axis: Point): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of poly) {
    const v = dot(p, axis);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return [lo, hi];
}
