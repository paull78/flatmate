import type { Point } from "@fm/protocol";
import { pickSnap, type SnapTarget } from "./picker";

// The rotation grip's angle (direct.05, direct.17, direct.18): a near wall's angle, or that angle plus a multiple of
// 90°, within ROTATION_SNAP_DEG wins; otherwise the ROTATION_STEP_DEG step; Ctrl takes any whole degree. Degrees,
// never pixels or metres.

const ROTATION_STEP_DEG = 15;
const ROTATION_SNAP_DEG = 3;

/** An angle in degrees in [0, 360); `+ 0` turns −0 into 0. */
const normalise = (deg: number): number => (((deg % 360) + 360) % 360) + 0;

/** The rotation whose front points from `centre` towards `p`: at rotation r the front faces (sin r, −cos r). */
export function rotationTowards(centre: Point, p: Point): number {
  return normalise((Math.atan2(p.x - centre.x, -(p.y - centre.y)) * 180) / Math.PI);
}

/**
 * The grip's rotation for the `raw` angle, in whole degrees in [0, 360): with `free` (Ctrl) the nearest degree;
 * otherwise the nearest of every wall angle in `wallAngles` (whole degrees) plus 0, 90, 180 or 270 within
 * ROTATION_SNAP_DEG, measured round the circle, else the nearest ROTATION_STEP_DEG step.
 */
export function gripRotation(raw: number, wallAngles: readonly number[], free: boolean): number {
  const targets: SnapTarget<null>[] = [];
  for (const w of wallAngles) {
    for (const k of [0, 90, 180, 270]) {
      const value = normalise(w + k);
      targets.push({ value, distance: Math.abs(wrap(value - raw)), tolerance: ROTATION_SNAP_DEG, tag: null });
    }
  }
  const picked = pickSnap({ targets, stepped: Math.round(raw / ROTATION_STEP_DEG) * ROTATION_STEP_DEG, free: Math.round(raw), ctrl: free });
  return normalise(picked.value);
}

/** A difference of angles wrapped into (−180, 180]. */
function wrap(deg: number): number {
  const d = normalise(deg);
  return d > 180 ? d - 360 : d;
}
