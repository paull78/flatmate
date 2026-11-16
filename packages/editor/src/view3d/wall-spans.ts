import type { Point } from "@fm/protocol";
import { ccw } from "./prism";
import type { Opening3d, Point3, WallItem } from "./types";

const EPS = 1e-9;

/**
 * A wall with openings along and across itself, from its first opening's start: `s` along the wall, `d` to its left.
 * The clear span `c0`–`c1` is where both long sides run; beyond it lies a corner's wall (`solidBefore`, `solidAfter`) or
 * nothing (a free end). One owner for the wall's grid and the openings' frames, which keep to the same span.
 */
export type WallAxes = {
  along: Point;
  left: Point;
  half: number;
  outline: readonly Point[];
  sOf: (p: Point) => number;
  dOf: (p: Point) => number;
  at: (s: number, d: number, z: number) => Point3;
  c0: number;
  c1: number;
  solidBefore: boolean;
  solidAfter: boolean;
};

/** Null when the wall has no opening to measure from, or no clear span. */
export function wallAxes(item: WallItem): WallAxes | null {
  const first = item.openings[0];
  const length = first ? Math.hypot(first.end.x - first.start.x, first.end.y - first.start.y) : 0;
  if (first === undefined || length < EPS) return null;
  const along = { x: (first.end.x - first.start.x) / length, y: (first.end.y - first.start.y) / length };
  const left = { x: -along.y, y: along.x };
  const origin = first.start;
  const sOf = (p: Point): number => (p.x - origin.x) * along.x + (p.y - origin.y) * along.y;
  const dOf = (p: Point): number => (p.x - origin.x) * left.x + (p.y - origin.y) * left.y;
  const at = (s: number, d: number, z: number): Point3 => ({ x: origin.x + along.x * s + left.x * d, y: origin.y + along.y * s + left.y * d, z });
  const outline = ccw(item.outline);
  const sidesS = (sign: number) => outline.filter((p) => dOf(p) * sign > EPS).map(sOf);
  const [plus, minus] = [sidesS(1), sidesS(-1)];
  if (plus.length === 0 || minus.length === 0) return null;
  const c0 = Math.max(Math.min(...plus), Math.min(...minus));
  const c1 = Math.min(Math.max(...plus), Math.max(...minus));
  return {
    along, left, half: first.thickness / 2, outline, sOf, dOf, at, c0, c1,
    solidBefore: Math.min(...plus, ...minus) < c0 - EPS,
    solidAfter: Math.max(...plus, ...minus) > c1 + EPS,
  };
}

/** An opening's span along the wall, kept to the clear span so none reaches into a corner. */
export function keptSpan(axes: WallAxes, o: Opening3d): { lo: number; hi: number } {
  const [s0, s1] = [axes.sOf(o.start), axes.sOf(o.end)];
  return { lo: Math.max(axes.c0, Math.min(s0, s1)), hi: Math.min(axes.c1, Math.max(s0, s1)) };
}
