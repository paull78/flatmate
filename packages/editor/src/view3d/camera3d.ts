import { highSide, wallOutlines, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { Angles3d, Bounds3, Point3 } from "./types";

export type { Angles3d, Bounds3, Point3 } from "./types";

// The 3D view's camera (heights.19, real3d.03, .05): orthographic, at any yaw and a tilt from 10° to 90° down; framed
// on the walls' box, by its 3D diagonal, so the picture neither zooms nor slides while it turns, and stays still while
// pieces move or flip. With surroundings the box may start below the floor and the frame pulls back (surroundings.14).

/**
 * `matrix` is 3 × 4, row-major: clip x and y (the box's diagonal fits −1 to 1, y up) and depth (metres along the view,
 * larger is farther). `project` applies it.
 */
export type Camera3d = { angles: Angles3d; matrix: readonly number[]; project(p: Point3): Point3 };

/** Today's view, from the south-west, 35° down (heights.19): where the panel starts and what look draws by default. */
export const DEFAULT_ANGLES: Angles3d = { yaw: 225, tilt: 35 };
/** The tilt's range in degrees (real3d.03): from nearly level to straight down; the orbit and look both hold to it. */
export const TILT_MIN = 10;
export const TILT_MAX = 90;
const MARGIN = 0.06; // of the clip square, round the framed box
const DEG = Math.PI / 180;

/** The horizontal unit direction from the scene toward the camera at `yaw` degrees, counter-clockwise from +x. */
export function toCamera(yaw: number): Point {
  const a = yaw * DEG;
  return { x: Math.round(Math.cos(a) * 1e12) / 1e12, y: Math.round(Math.sin(a) * 1e12) / 1e12 };
}

/** The walls' outline bounds and the highest ceiling; null without walls. Pieces lie inside rooms, so they never widen it. */
export function shellBounds(doc: Document): Bounds3 | null {
  const points = [...wallOutlines(doc).values()].flat();
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { min: { x: Math.min(...xs), y: Math.min(...ys) }, max: { x: Math.max(...xs), y: Math.max(...ys) }, top: highSide(doc) }; // the highest ceiling (roofs.16)
}

const dot = (a: Point3, b: Point3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/** The camera's scale (clip units per metre) and the box's centre, which it frames at any angle. */
function frame(bounds: Bounds3): { k: number; centre: Point3 } {
  const bottom = bounds.bottom ?? 0;
  const size = { x: bounds.max.x - bounds.min.x, y: bounds.max.y - bounds.min.y, z: bounds.top - bottom };
  const fit = (2 * (1 - MARGIN)) / Math.max(Math.hypot(size.x, size.y, size.z), 1e-9); // the diagonal bounds the box seen from anywhere
  const k = fit * (bounds.pull ?? 1); // then pulled back about the same centre (surroundings.14)
  return { k, centre: { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2, z: (bounds.top + bottom) / 2 } };
}

/**
 * The frame's sphere: whatever lies within `radius` metres of `centre` draws within clip radius 1 at every angle, as
 * an orthographic view never moves a point farther from the centre than it is (surroundings.13).
 */
export function frameSphere(bounds: Bounds3): { centre: Point3; radius: number } {
  const { k, centre } = frame(bounds);
  return { centre, radius: 1 / k };
}

export function camera3d(bounds: Bounds3, angles: Angles3d): Camera3d {
  const d = toCamera(angles.yaw);
  const t = angles.tilt * DEG;
  const forward: Point3 = { x: -d.x * Math.cos(t), y: -d.y * Math.cos(t), z: -Math.sin(t) };
  const right: Point3 = { x: -d.y, y: d.x, z: 0 }; // across the view, from the yaw alone: defined straight down too
  const up: Point3 = { x: right.y * forward.z - right.z * forward.y, y: right.z * forward.x - right.x * forward.z, z: right.x * forward.y - right.y * forward.x };
  const { k, centre } = frame(bounds);
  const [cx, cy] = [dot(centre, right), dot(centre, up)];
  const matrix = [k * right.x, k * right.y, k * right.z, -k * cx, k * up.x, k * up.y, k * up.z, -k * cy, forward.x, forward.y, forward.z, 0];
  const row = (r: number, p: Point3): number => (matrix[4 * r] ?? 0) * p.x + (matrix[4 * r + 1] ?? 0) * p.y + (matrix[4 * r + 2] ?? 0) * p.z + (matrix[4 * r + 3] ?? 0);
  return { angles, matrix, project: (p) => ({ x: row(0, p), y: row(1, p), z: row(2, p) }) };
}
