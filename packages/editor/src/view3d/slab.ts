import type { Point } from "@fm/protocol";
import { orient, sideShade } from "./prism";
import type { Shades } from "./style";
import type { Face3d, PieceItem, Point3 } from "./types";

// A stair's sloped part in the 3D view (stairs steps 11, 12): a convex outline in the plane of the run, extruded across
// it, every face wound from outside (real3d.09). Side boards, a centre stringer and a ladder's rails.

/** A point in the plane of the run: `a` metres along it from the front edge, `z` up. */
export type Local = { a: number; z: number };

/**
 * The faces of `profile` (convex, counter-clockwise in a and z) extruded across from local x0 to x1; `at` places a
 * local point (x across, y along the run from −d/2).
 */
export function slab(owner: string, item: Pick<PieceItem, "rotation" | "d">, shades: Shades, at: (x: number, y: number) => Point, profile: readonly Local[], x0: number, x1: number): Face3d[] {
  const r = (item.rotation * Math.PI) / 180;
  const across = { x: Math.cos(r), y: Math.sin(r) };
  const along = { x: -Math.sin(r), y: Math.cos(r) };
  const p = (x: number, q: Local): Point3 => ({ ...at(x, -item.d / 2 + q.a), z: q.z });
  const out: Face3d[] = [];
  const add = (points: Point3[], n: Point3, color: string): void => {
    out.push({ points: orient(points, n), holes: [], color, owner });
  };
  for (const [x, s] of [[x0, -1], [x1, 1]] as const) {
    const n = { x: s * across.x, y: s * across.y };
    add(profile.map((q) => p(x, q)), { ...n, z: 0 }, sideShade(n, shades));
  }
  profile.forEach((q, i) => {
    const next = profile[(i + 1) % profile.length] ?? q;
    const len = Math.hypot(next.a - q.a, next.z - q.z);
    if (len < 1e-9) return;
    const [na, nz] = [(next.z - q.z) / len, -(next.a - q.a) / len]; // outward for a counter-clockwise profile
    const n = { x: na * along.x, y: na * along.y };
    add([p(x0, q), p(x1, q), p(x1, next), p(x0, next)], { ...n, z: nz }, nz > 1e-9 ? shades.top : sideShade(n, shades));
  });
  return out;
}
