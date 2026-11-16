import type { Point } from "@fm/protocol";
import { camera3d, toCamera, type Camera3d } from "../../src/view3d/camera3d";
import { newell } from "../../src/view3d/prism";
import type { Angles3d, Face3d } from "../../src/view3d/types";

// What the camera sees of a face list (real3d.09): the faces whose outside looks toward it, which is what culling by
// winding keeps in WebGL and raster3d. The view direction is the camera matrix's third row.

export { newell as normal } from "../../src/view3d/prism";

/** One of the four views the 3D panel turned between before free rotation: from the south-west, a quarter turn each, 35° down. */
export const turnAngles = (turn: number): Angles3d => ({ yaw: (225 + 90 * turn) % 360, tilt: 35 });

const UNIT_BOX = { min: { x: 0, y: 0 }, max: { x: 1, y: 1 }, top: 1 };

/** The faces that face `camera` (or a camera at `angles`), in their order. */
export function visible(faces: readonly Face3d[], at: Angles3d | Camera3d): Face3d[] {
  const m = "matrix" in at ? at.matrix : camera3d(UNIT_BOX, at).matrix;
  const back = { x: -(m[8] ?? 0), y: -(m[9] ?? 0), z: -(m[10] ?? 0) };
  return faces.filter((f) => {
    const n = newell(f.points);
    return (n.x * back.x + n.y * back.y + n.z * back.z) / (Math.hypot(n.x, n.y, n.z) || 1) > 1e-9;
  });
}

/** The faces that face a camera 35° down from horizontal direction `d` (unit, from the drawing toward the camera). */
export function visibleFrom(faces: readonly Face3d[], d: Point): Face3d[] {
  const yaw = (Math.atan2(d.y, d.x) * 180) / Math.PI;
  const c = toCamera(yaw);
  if (Math.abs(c.x - d.x) + Math.abs(c.y - d.y) > 1e-6) throw new Error("d must be a unit direction");
  return visible(faces, { yaw, tilt: 35 });
}
