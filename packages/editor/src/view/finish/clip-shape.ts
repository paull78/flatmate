import { boxOf, clipHalfPlane, cross, dot, pointInPolygon, signedArea, sub } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { ClipFloor } from "./clip";

// A filled convex shape against a floor with holes (finishes.13): Sutherland–Hodgman with the floor ring as subject and
// the shape as the clip polygon. A ring the shape splits keeps its pieces joined by zero-area edges, which fill nothing
// under even-odd and triangulate to nothing. A shape meeting a hole is dropped (see clipShape).

type Ring = readonly Point[];

const MIN_AREA = 1e-10; // m²: smaller results are dropped

const SAME_POINT = 1e-12; // metres
const NEAR = 1e-9; // metres: a ring edge this near a shape's box may cut it
const FOLD = 1e-9; // the sine of the angle under which a ring folding back on itself is a spike

/** Whether the ring folds back at v: prev and next lie on one ray from it (or v repeats prev), so v bounds no area. */
function spike(prev: Point, v: Point, next: Point): boolean {
  const a = sub(prev, v);
  const b = sub(next, v);
  const la = Math.hypot(a.x, a.y);
  if (la < SAME_POINT) return true;
  return Math.abs(cross(a, b)) <= FOLD * la * Math.hypot(b.x, b.y) && dot(a, b) > 0;
}

/**
 * The ring without its spikes, until none is left: where a split ring's zero-area bridge turns at a corner of the clip
 * polygon, S–H walks out along one of its edges and back; that corner may lie off the floor, and it bounds no area.
 */
function withoutSpikes(ring: Point[]): Point[] {
  const out = [...ring];
  let i = 0;
  let unchanged = 0; // vertices checked since the last removal: a full lap with none means done
  while (out.length >= 3 && unchanged < out.length) {
    const n = out.length;
    const [prev, v, next] = [out[(i + n - 1) % n], out[i % n], out[(i + 1) % n]];
    if (prev && v && next && spike(prev, v, next)) {
      out.splice(i % n, 1);
      unchanged = 0;
      i = Math.max(0, (i % n) - 1);
    } else {
      unchanged++;
      i = (i + 1) % n;
    }
  }
  return out.length >= 3 ? out : [];
}

/** The part of `ring` (any simple polygon) inside `convex` (either winding), spikes dropped. */
export function clipToConvex(ring: Ring, convex: Ring): Point[] {
  const ccw = signedArea(convex) >= 0 ? convex : [...convex].reverse();
  let out: Point[] = [...ring];
  for (let i = 0; i < ccw.length && out.length > 0; i++) {
    const a = ccw[i];
    const b = ccw[(i + 1) % ccw.length];
    if (a && b) out = clipHalfPlane(out, a, b);
  }
  return withoutSpikes(out);
}

const area = (ring: Ring): number => (ring.length < 3 ? 0 : Math.abs(signedArea(ring)));

/** Whether `shape` lies wholly on the floor: no ring's edge comes near its box, and its first vertex is on the floor. */
function wholly({ outer, holes, edges }: ClipFloor, shape: Ring): boolean {
  const box = boxOf(shape);
  const near = edges.some(([p, q]) =>
    Math.max(p.x, q.x) >= box.minX - NEAR && Math.min(p.x, q.x) <= box.maxX + NEAR &&
    Math.max(p.y, q.y) >= box.minY - NEAR && Math.min(p.y, q.y) <= box.maxY + NEAR);
  const at = shape[0];
  return !near && at !== undefined && pointInPolygon(at, outer) && !holes.some((h) => pointInPolygon(at, h));
}

/**
 * The part of the convex `shape` on the floor as one ring drawn even-odd, or null when it covers less than 1e-10 m² of
 * the floor or meets a hole. A shape wholly on the floor comes back as it is (most of them).
 *
 * A shape meeting a hole's footprint is dropped, so the floor's colour shows round a column or a stair core (step 10's
 * pre-registered fallback): a clipped hole shares vertices and edges with the clipped ring along the shape's edges, and
 * earcut (the WebGL and WebGPU path) then covers up to twice the even-odd area. Bridges alone triangulate correctly.
 */
export function clipShape(floor: ClipFloor, shape: Ring): Point[] | null {
  if (wholly(floor, shape)) return [...shape];
  if (floor.holes.some((h) => area(clipToConvex(h, shape)) >= MIN_AREA)) return null;
  const points = clipToConvex(floor.outer, shape);
  return area(points) < MIN_AREA ? null : points;
}
