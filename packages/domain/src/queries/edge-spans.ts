import type { Point } from "@fm/protocol";
import { clipHalfPlane } from "../geometry";

// Stretches of a straight line a wall or another solid lies on: what's left of it is open. A deck's guards and a flight's
// handrails both ask this, of a slab's edge and of a flight's long side, so there is one answer to "against".

/** How near a line a ring counts as being on it. */
export const ON_EDGE = 0.01;
/** A stretch shorter than this is no run: what's left between two that nearly meet. */
const MIN_RUN = 0.02;

/** A straight line: a to b, `normal` the unit to its right. */
export type EdgeLine = { a: Point; b: Point; normal: Point };
/** A stretch of a line, in metres from its `a`. */
export type Span = readonly [from: number, to: number];

/** How far along `edge` a point is. */
export const alongEdge = (edge: EdgeLine, length: number, p: Point): number => ((p.x - edge.a.x) * (edge.b.x - edge.a.x) + (p.y - edge.a.y) * (edge.b.y - edge.a.y)) / length;
const shifted = (p: Point, n: Point, by: number): Point => ({ x: p.x + n.x * by, y: p.y + n.y * by });

/** The stretch of `edge` a ring lies on, within ON_EDGE either side of the line; null when it doesn't reach it. */
export function ringSpan(edge: EdgeLine, length: number, ring: readonly Point[]): Span | null {
  const outside = clipHalfPlane(ring, shifted(edge.a, edge.normal, ON_EDGE), shifted(edge.b, edge.normal, ON_EDGE));
  const band = clipHalfPlane(outside, shifted(edge.b, edge.normal, -ON_EDGE), shifted(edge.a, edge.normal, -ON_EDGE));
  if (band.length < 3) return null;
  const at = band.map((p) => alongEdge(edge, length, p));
  return [Math.min(...at), Math.max(...at)];
}

/** `length` less the spans, in order, each at least MIN_RUN long. */
export function openSpans(length: number, closed: readonly Span[]): Span[] {
  const out: Span[] = [];
  let from = 0;
  const onEdge = closed.filter(([a, b]) => b > 0 && a < length); // something on the line, past the edge's ends, closes none of it
  for (const [a, b] of [...onEdge].sort((p, q) => p[0] - q[0])) {
    if (a - from >= MIN_RUN) out.push([from, a]);
    from = Math.max(from, b);
  }
  if (length - from >= MIN_RUN) out.push([from, length]);
  return out;
}
