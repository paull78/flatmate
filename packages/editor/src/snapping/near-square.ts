import type { Point } from "@fm/protocol";
import type { SnapResult } from "../types";

// Near-square lands square (straight.10, .19): without Ctrl, a point from the grid, an aligned snap or no snap that
// would leave a wall within 1° of horizontal or vertical, but not on it, takes the other end's coordinate. It never
// changes an exact snap (endpoint, midpoint, on-wall, perpendicular, angle, equal). When two walls on the same axis
// disagree about the coordinate, that axis is left alone. `from` are the far ends of the walls at the moving point.

/** Walls this close to an axis land on it, in degrees. */
export const NEAR_SQUARE_DEG = 1;
const TAN = Math.tan((NEAR_SQUARE_DEG * Math.PI) / 180);

/** The point squared against `from`, when the snap allows it. */
export function squared(snap: SnapResult, from: readonly Point[]): SnapResult {
  if (snap.kind !== "grid" && snap.kind !== "aligned" && snap.kind !== "none") return snap;
  const p = snap.point;
  const ys = new Set<number>();
  const xs = new Set<number>();
  for (const f of from) {
    const dx = Math.abs(p.x - f.x);
    const dy = Math.abs(p.y - f.y);
    if (dy > 0 && dy <= dx * TAN) ys.add(f.y); // nearly horizontal: take the far end's y
    else if (dx > 0 && dx <= dy * TAN) xs.add(f.x); // nearly vertical: take its x
  }
  const [y] = ys;
  const [x] = xs;
  const point = { x: xs.size === 1 && x !== undefined ? x : p.x, y: ys.size === 1 && y !== undefined ? y : p.y };
  return point.x === p.x && point.y === p.y ? snap : { ...snap, point };
}
