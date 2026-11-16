import { clipHalfPlane, signedArea } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { Primitive } from "./scene-types";

// A piece's lines clipped by the fills drawn after it (seating.10). The GPU renderers draw a layer's fills before its lines
// (render/src/encode.ts), so there a later fill can hide a piece's fill but never its lines. Canvas2D paints in scene order,
// so the cut is what makes them agree.

const EPS = 1e-9; // a line on a ring's edge, or touching it, stays whole
const AREA_EPS = 1e-9;
const ARC_STEP = Math.PI / 32; // a clipped arc's flattening: about 1.5 mm off the curve at a 0.5 m radius

/** Whether a ring turns one way all round: `clipOutside` takes only convex rings. */
export function isConvexRing(ring: readonly Point[]): boolean {
  let sign = 0;
  for (const [i, p] of ring.entries()) {
    const q = ring[(i + 1) % ring.length];
    const r = ring[(i + 2) % ring.length];
    if (!q || !r) return false;
    const turn = (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x);
    if (Math.abs(turn) < EPS) continue;
    if (sign !== 0 && Math.sign(turn) !== sign) return false;
    sign = Math.sign(turn);
  }
  return true;
}

/**
 * The primitives with every segment and arc cut to outside each convex ring (of either winding). An arc a ring cuts
 * becomes short segments; one no ring cuts stays an arc. Fills, discs and texts are returned as they are.
 */
export function clipOutside(primitives: readonly Primitive[], rings: readonly (readonly Point[])[]): Primitive[] {
  if (rings.length === 0) return [...primitives];
  return primitives.flatMap((p): Primitive[] => {
    if (p.kind === "segment") return cutByAll(p, rings);
    if (p.kind !== "arc") return [p];
    const chords = flatten(p);
    const kept = chords.flatMap((c) => cutByAll(c, rings));
    return kept.length === chords.length && kept.every((s, i) => s === chords[i]) ? [p] : kept;
  });
}

/**
 * Everything cut to outside each convex counter-clockwise ring: `clipOutside`, and fills too, and a dot inside a ring
 * dropped. For what a slab covers (riser.05), where nothing may show, not only a later fill's lines. Texts stay.
 */
export function clipAllOutside(primitives: readonly Primitive[], rings: readonly (readonly Point[])[]): Primitive[] {
  if (rings.length === 0) return [...primitives];
  return clipOutside(primitives, rings).flatMap((p): Primitive[] => {
    if (p.kind === "disc") return rings.some((ring) => inside(p.center, ring)) ? [] : [p];
    if (p.kind !== "polygon") return [p];
    const parts = rings.reduce<(readonly Point[])[]>((kept, ring) => kept.flatMap((part) => fillOutside(part, ring)), [p.points]);
    return parts.length === 1 && parts[0] === p.points ? [p] : parts.map((points) => ({ ...p, points: [...points] }));
  });
}

/** Strictly inside a convex counter-clockwise ring. */
function inside(q: Point, ring: readonly Point[]): boolean {
  return ring.every((a, i) => {
    const b = ring[(i + 1) % ring.length];
    return b !== undefined && (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x) > EPS;
  });
}

/** A convex fill less a convex counter-clockwise ring: what lies beyond each edge in turn, as convex parts. */
function fillOutside(points: readonly Point[], ring: readonly Point[]): (readonly Point[])[] {
  const out: (readonly Point[])[] = [];
  let rest: readonly Point[] = points;
  for (const [i, a] of ring.entries()) {
    const b = ring[(i + 1) % ring.length];
    if (!b) continue;
    const beyond = clipHalfPlane(rest, b, a);
    if (Math.abs(signedArea(beyond)) > AREA_EPS) out.push(beyond);
    rest = clipHalfPlane(rest, a, b);
    if (Math.abs(signedArea(rest)) <= AREA_EPS) return out;
  }
  return out.length === 1 && Math.abs(Math.abs(signedArea(out[0] ?? [])) - Math.abs(signedArea(points))) <= AREA_EPS ? [points] : out;
}

type Segment = Extract<Primitive, { kind: "segment" }>;

/** The segment's parts outside every ring. */
function cutByAll(s: Segment, rings: readonly (readonly Point[])[]): Segment[] {
  return rings.reduce<Segment[]>((parts, ring) => parts.flatMap((part) => cutSegment(part, ring)), [s]);
}

/** The segment's parts outside a convex ring: itself when it doesn't go inside, else up to two pieces. */
function cutSegment(s: Segment, ring: readonly Point[]): Segment[] {
  const length = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
  const inside = insideSpan(s.a, s.b, ring);
  if (inside === null || (inside[1] - inside[0]) * length <= EPS) return [s];
  const at = (t: number): Point => ({ x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t });
  const out: Segment[] = [];
  if (inside[0] * length > EPS) out.push({ ...s, b: at(inside[0]) });
  if ((1 - inside[1]) * length > EPS) out.push({ ...s, a: at(inside[1]) });
  return out;
}

/**
 * The span [t0, t1] of a → b inside a convex ring (Cyrus–Beck), or null when the segment misses it or runs along an
 * edge.
 */
function insideSpan(a: Point, b: Point, ring: readonly Point[]): [number, number] | null {
  const sign = signedArea(ring) < 0 ? -1 : 1;
  let t0 = 0;
  let t1 = 1;
  for (const [i, v] of ring.entries()) {
    const w = ring[(i + 1) % ring.length];
    const len = w ? Math.hypot(w.x - v.x, w.y - v.y) : 0;
    if (!w || len === 0) continue;
    // Outward unit normal of edge v → w, for a counter-clockwise ring turned by `sign`.
    const n = { x: (sign * (w.y - v.y)) / len, y: (sign * -(w.x - v.x)) / len };
    const from = n.x * (a.x - v.x) + n.y * (a.y - v.y); // inside where from + t·along < 0
    const along = n.x * (b.x - a.x) + n.y * (b.y - a.y);
    // Parallel to the edge to within a nanoradian: float noise off a flush edge (a chair turned 30°) cuts nothing.
    if (Math.abs(along) <= EPS * Math.hypot(b.x - a.x, b.y - a.y)) {
      if (from >= -EPS) return null; // parallel to this edge, on it or outside
      continue;
    }
    const t = -from / along;
    if (along > 0) t1 = Math.min(t1, t);
    else t0 = Math.max(t0, t);
    if (t0 >= t1) return null;
  }
  return [t0, t1];
}

/** An arc as a run of short segments, in its own width and colour. */
function flatten(p: Extract<Primitive, { kind: "arc" }>): Segment[] {
  const n = Math.max(1, Math.ceil(Math.abs(p.to - p.from) / ARC_STEP - 1e-9)); // a quarter turn is 16 chords at any start angle
  const at = (i: number): Point => {
    const angle = p.from + ((p.to - p.from) * i) / n;
    return { x: p.center.x + p.radius * Math.cos(angle), y: p.center.y + p.radius * Math.sin(angle) };
  };
  return Array.from({ length: n }, (_, i): Segment => ({ kind: "segment", a: at(i), b: at(i + 1), width: p.width, color: p.color, cap: "round" }));
}
