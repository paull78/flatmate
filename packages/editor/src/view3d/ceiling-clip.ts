import type { Plane } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { Face3d, Point3 } from "./types";

// Full walls under a sloped ceiling (roofs.09, .16): a wall is built up to its highest point as before, then each face
// is clipped under the ceiling's planes (one for a shed, the lower of two for a gable: a convex region, so one clip per
// plane), and every face that was its top is lifted onto the slope, split where a gable's ridge crosses it.
//
//   built to the top          clipped                lifted top
//   ┌──────────────┐       ╱‾‾‾‾‾‾‾‾‾‾‾‾‾╲          ╱‾‾‾‾‾‾╲  one piece per plane
//   │              │      ╱                ╲
//   │    ┌──┐      │  →  │     ┌──┐        │       openings stay whole: I12 keeps
//   │    └──┘      │     │     └──┘        │       every head under the ceiling

const EPS = 1e-9;
export const heightOn = (q: Plane, p: { x: number; y: number }): number => q.c + q.gx * p.x + q.gy * p.y;
/** How far a point lies above a plane: positive above it. */
const above = (q: Plane, p: Point3): number => p.z - heightOn(q, p);

/** A ring clipped to the side of one plane where `d` is at most 0 (Sutherland–Hodgman against one half-space). */
export function clipRing<T extends Point>(ring: readonly T[], d: (p: T) => number, mix: (a: T, b: T, t: number) => T): T[] {
  const out: T[] = [];
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length] ?? a;
    const [da, db] = [d(a), d(b)];
    if (da <= EPS) out.push(a);
    if ((da <= EPS) !== (db <= EPS)) out.push(mix(a, b, da / (da - db)));
  });
  return out;
}

const mix3 = (a: Point3, b: Point3, t: number): Point3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
export const mix2 = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Twice a ring's area, projected on its own plane (Newell): small means the clip left a sliver or nothing. */
function size(ring: readonly Point3[]): number {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length] ?? a;
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  });
  return Math.hypot(nx, ny, nz);
}

const under = (planes: readonly Plane[], ring: readonly Point3[]): Point3[] =>
  planes.reduce<Point3[]>((r, q) => clipRing(r, (p) => above(q, p), mix3), [...ring]);

/** A face flat at `top` (a wall's or a cap's top) lifted onto the ceiling: one face per plane it lies under. */
function lifted(face: Face3d, planes: readonly Plane[]): Face3d[] {
  return planes.flatMap((q, i): Face3d[] => {
    // The part of the face's outline where this plane is the lowest: under every other plane's height there.
    const others = planes.filter((_, k) => k !== i);
    const part = others.reduce<Point[]>((r, o) => clipRing(r, (p) => heightOn(q, p) - heightOn(o, p), mix2), face.points.map((p) => ({ x: p.x, y: p.y })));
    const points = part.map((p) => ({ x: p.x, y: p.y, z: heightOn(q, p) }));
    return points.length >= 3 && size(points) > 1e-9 ? [{ ...face, points, holes: [] }] : [];
  });
}

/**
 * A full wall's faces, built up to `top`, cut under the ceiling's planes: a face flat at `top` is lifted onto them, any
 * other is clipped, and a face wholly above them is gone. Holes (openings) are kept as they are when the face keeps
 * them all, since a head is always under the ceiling.
 */
export function underCeiling(faces: readonly Face3d[], planes: readonly Plane[], top: number): Face3d[] {
  return faces.flatMap((f): Face3d[] => {
    if (f.points.every((p) => Math.abs(p.z - top) < 1e-7)) return lifted(f, planes);
    const points = under(planes, f.points);
    if (points.length < 3 || size(points) < 1e-9) return [];
    return [{ ...f, points, holes: f.holes.filter((h) => h.every((p) => planes.every((q) => above(q, p) <= EPS))) }];
  });
}
