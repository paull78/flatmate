import {
  EPS, add, cross, distance, distanceToSegment, dot, lineIntersection, normalize, perpLeft, projectOnSegment, scale,
  sortedIds, sub, wallEnds, type Document,
} from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { SnapKind } from "../types";

/**
 * `distance` is from the cursor; for an aligned point, from the cursor to the line(s) it lines up with; for an angle
 * point, from the cursor to the ray.
 */
export type SnapCandidate = {
  point: Point;
  kind: Exclude<SnapKind, "none">;
  priority: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  distance: number;
  guides?: readonly Point[];
};
export type SnapAxis = { origin: Point; dir: Point }; // dir is (±1, 0) or (0, ±1)
export type SnapContext = {
  doc: Document;
  cursor: Point; // already projected on the axis when there is one
  gridSpacing: number; // metres
  tolerance: number; // metres; the chooser applies it, the aligned policy also needs it per axis
  axis: SnapAxis | null;
  excludeJoints: ReadonlySet<string>;
  excludeWalls: ReadonlySet<string>;
  drawOrigin: Point | null; // the wall tool's origin for the angle and perpendicular policies; null otherwise or with Shift
};
export type SnapPolicy = (ctx: SnapContext) => SnapCandidate[];

export function onAxis(axis: SnapAxis, p: Point): boolean {
  return Math.abs(cross(sub(p, axis.origin), axis.dir)) < EPS;
}

/** Rounds to the nearest multiple of `step`, cleaned to 1e-6 m so 3 × 0.2 is exactly 0.6. */
export function roundTo(v: number, step: number): number {
  const r = Math.round((Math.round(v / step) * step) * 1e6) / 1e6;
  return r === 0 ? 0 : r; // no -0
}

const PRIORITY: Record<SnapCandidate["kind"], SnapCandidate["priority"]> = {
  endpoint: 1, midpoint: 2, perpendicular: 3, onWall: 4, angle: 5, aligned: 6, grid: 7,
};

function candidate(ctx: SnapContext, point: Point, kind: SnapCandidate["kind"]): SnapCandidate {
  return { point, kind, priority: PRIORITY[kind], distance: distance(point, ctx.cursor) };
}

function liveWalls(ctx: SnapContext): { a: Point; b: Point }[] {
  const out: { a: Point; b: Point }[] = [];
  for (const id of sortedIds(ctx.doc.walls)) {
    if (ctx.excludeWalls.has(id)) continue;
    const ends = wallEnds(ctx.doc, id);
    if (ends) out.push(ends);
  }
  return out;
}

export const endpointPolicy: SnapPolicy = (ctx) => {
  const out: SnapCandidate[] = [];
  for (const id of sortedIds(ctx.doc.joints)) {
    const j = ctx.doc.joints[id];
    if (!j || ctx.excludeJoints.has(id)) continue;
    const p = { x: j.x, y: j.y };
    if (ctx.axis && !onAxis(ctx.axis, p)) continue;
    out.push(candidate(ctx, p, "endpoint"));
  }
  return out;
};

export const midpointPolicy: SnapPolicy = (ctx) => {
  const out: SnapCandidate[] = [];
  for (const { a, b } of liveWalls(ctx)) {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (ctx.axis && !onAxis(ctx.axis, mid)) continue;
    out.push(candidate(ctx, mid, "midpoint"));
  }
  return out;
};

export const onWallPolicy: SnapPolicy = (ctx) => {
  const out: SnapCandidate[] = [];
  for (const { a, b } of liveWalls(ctx)) {
    if (!ctx.axis) {
      out.push(candidate(ctx, projectOnSegment(ctx.cursor, a, b).point, "onWall"));
      continue;
    }
    // With Shift: where the axis crosses the wall centreline (parallel walls give no point).
    const hit = lineIntersection(ctx.axis.origin, ctx.axis.dir, a, sub(b, a));
    if (hit && distanceToSegment(hit, a, b) < EPS) out.push(candidate(ctx, hit, "onWall"));
  }
  return out;
};

/** The foot of the perpendicular from the wall tool's origin to each wall's centreline, when it lies within the wall. */
export const perpendicularPolicy: SnapPolicy = (ctx) => {
  const origin = ctx.drawOrigin;
  if (!origin) return [];
  const out: SnapCandidate[] = [];
  for (const { a, b } of liveWalls(ctx)) {
    const n = normalize(perpLeft(sub(b, a)));
    if (!n) continue;
    const foot = add(origin, scale(n, dot(sub(a, origin), n))); // within float error; addWall projects it onto the wall
    if (distanceToSegment(foot, a, b) >= EPS || distance(foot, origin) < EPS) continue;
    out.push({ ...candidate(ctx, foot, "perpendicular"), guides: [origin] });
  }
  return out;
};

const STEP = Math.PI / 12; // 15°

/**
 * The ray every 15° from the wall tool's origin nearest the cursor's direction; the point is on the ray at a whole
 * number of grid steps from the origin, or where another joint's x or y line crosses the ray (tie rule, spec §5.8).
 */
export const anglePolicy: SnapPolicy = (ctx) => {
  const origin = ctx.drawOrigin;
  if (!origin) return [];
  const v = sub(ctx.cursor, origin);
  const k = Math.round(Math.atan2(v.y, v.x) / STEP);
  const dir = { x: tidy(Math.cos(k * STEP)), y: tidy(Math.sin(k * STEP)) };
  const length = roundTo(dot(v, dir), ctx.gridSpacing);
  if (length <= 0) return [];
  const tie = rayCrossing(ctx, origin, dir);
  return [{
    point: tie ? tie.point : add(origin, scale(dir, length)),
    kind: "angle",
    priority: PRIORITY.angle,
    distance: Math.abs(cross(v, dir)),
    guides: tie ? [origin, tie.joint] : [origin],
  }];
};

/** Exact 0 and ±1 on the axes: cos 90° is 6e-17 in floating point. */
function tidy(v: number): number {
  const r = Math.round(v);
  return Math.abs(v - r) < 1e-12 ? r + 0 : v; // + 0 turns -0 into 0
}

type Crossing = { point: Point; joint: Point };

/** Where the x or y line of the joint nearest the cursor crosses the ray, within the tolerance of the cursor. */
function rayCrossing(ctx: SnapContext, origin: Point, dir: Point): Crossing | null {
  const jx = nearestLine(ctx, "x");
  const jy = nearestLine(ctx, "y");
  const hits: Crossing[] = [];
  // A line parallel to the ray (dir.x = 0 for x = const) never crosses it; t is the distance along the ray.
  if (jx && Math.abs(dir.x) > EPS) {
    const t = (jx.x - origin.x) / dir.x;
    if (t > EPS) hits.push({ point: { x: jx.x, y: origin.y + dir.y * t }, joint: jx });
  }
  if (jy && Math.abs(dir.y) > EPS) {
    const t = (jy.y - origin.y) / dir.y;
    if (t > EPS) hits.push({ point: { x: origin.x + dir.x * t, y: jy.y }, joint: jy });
  }
  let best: Crossing | null = null;
  for (const h of hits) {
    const d = distance(h.point, ctx.cursor);
    if (d <= ctx.tolerance && (!best || d < distance(best.point, ctx.cursor))) best = h;
  }
  return best;
}

/**
 * Lines the point up with another joint's x and/or y when the cursor is within the tolerance of it on that axis;
 * the other coordinate stays on the grid. The grid step changes with zoom, so without this a joint placed at one
 * zoom could not be lined up with again at another. With Shift, only the axis's own coordinate lines up.
 */
export const alignedPolicy: SnapPolicy = (ctx) => {
  const vx = ctx.axis ? ctx.axis.dir.y === 0 : true; // x may line up (free, or a horizontal axis)
  const vy = ctx.axis ? ctx.axis.dir.x === 0 : true;
  const gx = vx ? nearestLine(ctx, "x") : null;
  const gy = vy ? nearestLine(ctx, "y") : null;
  if (!gx && !gy) return [];
  const grid = gridPoint(ctx);
  const point = { x: gx ? gx.x : grid.x, y: gy ? gy.y : grid.y };
  const guides = [gx, gy].filter((g): g is Point => g !== null);
  const off = Math.max(gx ? Math.abs(ctx.cursor.x - gx.x) : 0, gy ? Math.abs(ctx.cursor.y - gy.y) : 0);
  return [{ point, kind: "aligned", priority: PRIORITY.aligned, distance: off, guides }];
};

/** The joint whose x (or y) is nearest the cursor's, within the tolerance; ties go to the joint nearest the cursor. */
function nearestLine(ctx: SnapContext, axis: "x" | "y"): Point | null {
  let best: Point | null = null;
  for (const id of sortedIds(ctx.doc.joints)) {
    const j = ctx.doc.joints[id];
    if (!j || ctx.excludeJoints.has(id)) continue;
    const p = { x: j.x, y: j.y };
    const d = Math.abs(p[axis] - ctx.cursor[axis]);
    if (d > ctx.tolerance) continue;
    const bd = best ? Math.abs(best[axis] - ctx.cursor[axis]) : Infinity;
    if (!best || d < bd || (d === bd && distance(p, ctx.cursor) < distance(best, ctx.cursor))) best = p;
  }
  return best;
}

function gridPoint(ctx: SnapContext): Point {
  const s = ctx.gridSpacing;
  if (!ctx.axis) return { x: roundTo(ctx.cursor.x, s), y: roundTo(ctx.cursor.y, s) };
  // With Shift: whole grid steps along the axis, measured from the origin.
  const k = roundTo(dot(sub(ctx.cursor, ctx.axis.origin), ctx.axis.dir), s);
  return { x: ctx.axis.origin.x + ctx.axis.dir.x * k, y: ctx.axis.origin.y + ctx.axis.dir.y * k };
}

export const gridPolicy: SnapPolicy = (ctx) => [candidate(ctx, gridPoint(ctx), "grid")];

export const POLICIES: readonly SnapPolicy[] = [
  endpointPolicy, midpointPolicy, perpendicularPolicy, onWallPolicy, anglePolicy, alignedPolicy, gridPolicy,
];
