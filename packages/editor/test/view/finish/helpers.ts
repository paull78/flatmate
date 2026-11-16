import { distanceToSegment, pointInPolygon } from "@fm/domain";
import type { Point } from "@fm/protocol";

// Shared by the finish geometry tests: a seeded generator, rings, and a point-in-floor oracle.

/** mulberry32, copied from packages/domain/test/helpers.ts: editor tests don't import domain test helpers. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A counter-clockwise rectangle. */
export function rect(x0: number, y0: number, x1: number, y1: number): Point[] {
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

/**
 * The seeded studio's two clear floors, as `floorRings` gives them: computed once from `studioSteps()` in
 * packages/server/scripts/seed-studio.ts (editor tests can't import the server), float noise included.
 */
export const STUDIO_FLOORS: readonly (readonly Point[])[] = [
  [{ x: 1.6, y: 0.10000000000000009 }, { x: 6.9, y: 0.1 }, { x: 6.9, y: 2.4 }, { x: 1.5999999999999996, y: 2.4 }],
  [{ x: 1.4, y: 0.1 }, { x: 1.4, y: 2.4 }, { x: 0.10000000000000009, y: 2.4 }, { x: 0.1, y: 0.10000000000000009 }],
];

export function ringDistance(p: Point, ring: readonly Point[]): number {
  let best = Infinity;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    if (b) best = Math.min(best, distanceToSegment(p, a, b));
  });
  return best;
}

/** On the floor within `tol`: inside the outer ring or on its edge, and outside every hole or on its edge. */
export function onFloor(p: Point, outer: readonly Point[], holes: readonly (readonly Point[])[], tol: number): boolean {
  const inOuter = pointInPolygon(p, outer) || ringDistance(p, outer) < tol;
  return inOuter && holes.every((h) => !pointInPolygon(p, h) || ringDistance(p, h) < tol);
}

export const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Whether segments pq and ab cross at a point inside both (no touching cases: the callers sample random points). */
export function crosses(p: Point, q: Point, a: Point, b: Point): boolean {
  const side = (o: Point, s: Point, t: Point): number => (s.x - o.x) * (t.y - o.y) - (s.y - o.y) * (t.x - o.x);
  return side(p, q, a) * side(p, q, b) < 0 && side(a, b, p) * side(a, b, q) < 0;
}
