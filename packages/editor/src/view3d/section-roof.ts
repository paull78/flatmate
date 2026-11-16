import type { Plane } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { clipRing, mix2 } from "./ceiling-clip";

// A section under a sloped ceiling (roofs.14): the ceiling's planes in the section's frame, x along the line and d the
// depth past it, so the cut is clipped under the ceiling at d 0, the roof's band follows it, and a wall past the cut
// shows its sloped top.
//
//        roof band ╱‾‾‾‾‾‾‾‾╲  the band from the ceiling up, over the roof's stretch of the line
//       ▓▓▓▓▓▓▓▓▓▓╱          ╲▓▓  the cut, clipped under the ceiling
//       ▓        ╱  beyond:   ▓   a wall past the cut, its top the highest of the slope over its depth
//       ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓

/** A ceiling plane in the section's frame: z = a + b·x + c·d. */
export type SectionPlane = { a: number; b: number; c: number };

export function sectionPlanes(frame: { origin: Point; dir: Point; seen: Point }, planes: readonly Plane[]): SectionPlane[] {
  const { origin: o, dir, seen } = frame;
  return planes.map((q) => ({ a: q.c + q.gx * o.x + q.gy * o.y, b: q.gx * dir.x + q.gy * dir.y, c: q.gx * seen.x + q.gy * seen.y }));
}

/** The ceiling at x and depth d. */
export const ceilingAt = (ps: readonly SectionPlane[], x: number, d = 0): number => Math.min(...ps.map((p) => p.a + p.b * x + p.c * d));

/** Where a gable's two planes meet along the line at depth 0 (its ridge), or nothing for a shed or a ridge along the line. */
function ridgeX(ps: readonly SectionPlane[]): number[] {
  const [p, q] = ps;
  if (!p || !q || Math.abs(p.b - q.b) < 1e-12) return [];
  return [(q.a - p.a) / (p.b - q.b)];
}

/** A shape in the picture (x, z) clipped under the ceiling at depth 0. */
export function underCeilingLine(points: readonly Point[], ps: readonly SectionPlane[]): Point[] {
  return ps.reduce<Point[]>((r, p) => clipRing(r, (pt) => pt.y - (p.a + p.b * pt.x), mix2), [...points]);
}

/** The roof's band over the stretches of the line it covers: from the ceiling up `band`, broken at the ridge. */
export function roofBands(ps: readonly SectionPlane[], stretches: readonly (readonly [number, number])[], band: number): Point[][] {
  return stretches.map(([lo, hi]) => {
    const xs = [lo, ...ridgeX(ps).filter((x) => x > lo && x < hi), hi];
    return [...xs.map((x) => ({ x, y: ceilingAt(ps, x) })), ...[...xs].reverse().map((x) => ({ x, y: ceilingAt(ps, x) + band }))];
  });
}

/**
 * A full wall past the cut over x `lo`–`hi`, its depths `d0`–`d1`: from `bottom` up to the highest of the ceiling over
 * that depth at each x (a gable's ridge where it crosses the wall), sampled finely enough for a straight wall's top.
 */
export function slopedWall(ps: readonly SectionPlane[], lo: number, hi: number, bottom: number, d0: number, d1: number): Point[] {
  const topAt = (x: number): number => {
    const ds = [d0, d1];
    const [p, q] = ps;
    if (p && q && Math.abs(p.c - q.c) > 1e-12) {
      const d = (q.a - p.a + (q.b - p.b) * x) / (p.c - q.c); // where the two planes meet at this x
      if (d > d0 && d < d1) ds.push(d);
    }
    return Math.max(...ds.map((d) => ceilingAt(ps, x, d)));
  };
  const n = 24;
  const tops = Array.from({ length: n + 1 }, (_, i) => hi - ((hi - lo) * i) / n).map((x) => ({ x, y: topAt(x) }));
  return [{ x: lo, y: bottom }, { x: hi, y: bottom }, ...tops];
}
