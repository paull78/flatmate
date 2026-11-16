import { cross, distanceToSegment, pointInPolygon, sub } from "@fm/domain";
import type { Point } from "@fm/protocol";

// A pattern line against a floor with holes (finishes.13, .18). Lines along wall faces and through corners are the
// normal case on grid-aligned rooms, so parallel edges cut nothing and near-equal cuts are one.

type Ring = readonly Point[];

/** A kept piece of a segment, in the segment's direction. */
export type Piece = { a: Point; b: Point };

const MIN_PIECE = 1e-6; // metres: shorter pieces are dropped
const SAME_CUT = 1e-9; // segment parameters this close are one cut
const ON_EDGE = 1e-9; // metres: a piece whose midpoint is this near an edge lies along it (the wall draws there)
const PARALLEL = 1e-12; // the sine of the angle under which a segment and an edge are parallel

function edges(ring: Ring): [Point, Point][] {
  const out: [Point, Point][] = [];
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length];
    if (q) out.push([p, q]);
  });
  return out;
}

/** Where ab crosses an edge, as parameters along ab strictly between its ends; none on edges parallel to it. */
function cuts(a: Point, d: Point, len: number, ringEdges: readonly [Point, Point][]): number[] {
  const out: number[] = [];
  for (const [p, q] of ringEdges) {
    const e = sub(q, p);
    const denom = cross(d, e);
    if (Math.abs(denom) <= PARALLEL * len * Math.hypot(e.x, e.y)) continue;
    const ap = sub(p, a);
    const t = cross(ap, e) / denom;
    const s = cross(ap, d) / denom;
    if (s >= -SAME_CUT && s <= 1 + SAME_CUT && t > SAME_CUT && t < 1 - SAME_CUT) out.push(t);
  }
  return out;
}

/** A floor to clip against: its outer ring, its holes, and every ring's edges, built once per room. */
export type ClipFloor = { outer: Ring; holes: readonly Ring[]; edges: readonly [Point, Point][] };

export function clipFloor(outer: Ring, holes: readonly Ring[]): ClipFloor {
  return { outer, holes, edges: [outer, ...holes].flatMap(edges) };
}

/**
 * The pieces of segment ab on the floor: inside its outer ring and outside every hole by even-odd, judged at each
 * piece's midpoint between cuts, dropping pieces along an edge and pieces under 1 µm. Touching kept pieces join.
 */
export function clipSegment(a: Point, b: Point, { outer, holes, edges: ringEdges }: ClipFloor): Piece[] {
  const d = sub(b, a);
  const len = Math.hypot(d.x, d.y);
  if (!(len >= MIN_PIECE)) return [];
  const ts = [0];
  for (const t of cuts(a, d, len, ringEdges).sort((p, q) => p - q)) {
    if (t - (ts[ts.length - 1] ?? 0) > SAME_CUT) ts.push(t);
  }
  ts.push(1);
  const at = (t: number): Point => (t === 0 ? a : t === 1 ? b : { x: a.x + d.x * t, y: a.y + d.y * t });
  const kept: [number, number][] = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = ts[i] ?? 0;
    const t1 = ts[i + 1] ?? 1;
    if ((t1 - t0) * len < MIN_PIECE) continue;
    const m = at((t0 + t1) / 2);
    if (ringEdges.some(([p, q]) => distanceToSegment(m, p, q) < ON_EDGE)) continue;
    if (!pointInPolygon(m, outer) || holes.some((h) => pointInPolygon(m, h))) continue;
    const last = kept[kept.length - 1];
    if (last && last[1] === t0) last[1] = t1; // through a vertex with floor on both sides: one piece
    else kept.push([t0, t1]);
  }
  return kept.map(([t0, t1]) => ({ a: at(t0), b: at(t1) }));
}
