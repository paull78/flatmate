import type { Point } from "@fm/protocol";
import { add, cross, dot, isSimplePolygon, length, lineIntersection, normalize, perpLeft, scale, signedArea, sub } from "../geometry";
import { WALL_THICKNESS } from "../model";

export const AREA_UNAVAILABLE = "Area unavailable: unsupported geometry";

/** Drops vertices between collinear boundary segments that continue in the same direction. */
function mergeCollinear(ring: readonly Point[]): readonly Point[] | null {
  let points = ring;
  let changed = true;
  while (changed && points.length >= 3) {
    changed = false;
    for (let i = 0; i < points.length; i++) {
      const prev = points[(i - 1 + points.length) % points.length];
      const cur = points[i];
      const nxt = points[(i + 1) % points.length];
      if (!prev || !cur || !nxt) return null;
      const u = sub(cur, prev);
      const v = sub(nxt, cur);
      if (Math.abs(cross(u, v)) > 1e-9 * length(u) * length(v)) continue;
      if (dot(u, v) < 0) return null; // the boundary folds back on itself
      points = points.filter((_, k) => k !== i);
      changed = true;
      break;
    }
  }
  return points.length >= 3 ? points : null;
}

/**
 * Clear floor polygon of a counter-clockwise centreline ring (spec §3.6 steps 4–5): offset every
 * boundary line inward by WALL_THICKNESS / 2 and intersect consecutive lines. Accepted only when the
 * result is simple, has positive area and every inset edge keeps its source direction.
 */
export function insetFloor(ring: readonly Point[]): { floor: Point[]; area: number } | null {
  const pts = mergeCollinear(ring);
  if (!pts) return null;
  const n = pts.length;
  const half = WALL_THICKNESS / 2;
  const lines: { p: Point; d: Point }[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const d = a && b ? normalize(sub(b, a)) : null;
    if (!a || !d) return null;
    lines.push({ p: add(a, scale(perpLeft(d), half)), d });
  }
  const floor: Point[] = [];
  for (let i = 0; i < n; i++) {
    const before = lines[(i - 1 + n) % n];
    const here = lines[i];
    const q = before && here ? lineIntersection(before.p, before.d, here.p, here.d) : null;
    if (!q) return null;
    floor.push(q);
  }
  for (let i = 0; i < n; i++) {
    const a = floor[i];
    const b = floor[(i + 1) % n];
    const src = lines[i];
    if (!a || !b || !src) return null;
    const e = sub(b, a);
    if (length(e) <= 1e-9 || dot(e, src.d) <= 0) return null;
  }
  const area = signedArea(floor);
  if (area <= 0 || !isSimplePolygon(floor)) return null;
  return { floor, area };
}
