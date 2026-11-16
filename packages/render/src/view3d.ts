import { camera3d, type Angles3d, type Bounds3 } from "@fm/editor";

// The 3D view's uniform (webgpu.12, the 3D twin of camera.ts): the camera's three matrix rows and the view's depth range,
// one layout read by the WGSL struct `View3d`, the GLSL uniforms and every 3D renderer. The depth range is the drawing's
// box corners through the third row (with a pull, the frame's sphere), a metre of margin each side, as a centre and a
// half range.

export type View3dField = { name: "row0" | "row1" | "row2" | "depth"; offset: number; floats: 2 | 4 };

/** Byte offsets: `struct View3d { row0: vec4f, row1: vec4f, row2: vec4f, depth: vec2f }`, 56 bytes rounded to 64. */
export const VIEW3D_UNIFORM: readonly View3dField[] = [
  { name: "row0", offset: 0, floats: 4 },
  { name: "row1", offset: 16, floats: 4 },
  { name: "row2", offset: 32, floats: 4 },
  { name: "depth", offset: 48, floats: 2 },
];
export const VIEW3D_BYTES = 64;

/** The GLSL uniform each field is, in the WebGL 3D shader. */
export const VIEW3D_GLSL: Readonly<Record<View3dField["name"], string>> = { row0: "u_row0", row1: "u_row1", row2: "u_row2", depth: "u_depth" };

/**
 * The uniform buffer for the camera's 3 × 4 `matrix` (camera3d) and the drawing's `bounds`. With a `pull`, the depth
 * range is the frame's sphere instead (surroundings.14): whatever lies within the frame's radius `1 / k` (k, the
 * matrix's row scale) of the box's centre has a depth within the centre's ± that radius, a metre of margin each side.
 */
export function packView3d(matrix: readonly number[], bounds: Bounds3): Float32Array {
  const m = (i: number): number => matrix[i] ?? 0;
  const depths: number[] = [];
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.bottom ?? 0, bounds.top]) depths.push(m(8) * x + m(9) * y + m(10) * z + m(11));
  const [lo, hi] = [Math.min(...depths), Math.max(...depths)];
  const radius = 1 / Math.max(Math.hypot(m(0), m(1), m(2)), 1e-9);
  const [near, far] = bounds.pull === undefined ? [lo - 1, hi + 1] : [(lo + hi) / 2 - radius - 1, (lo + hi) / 2 + radius + 1]; // a box's depths are even about its centre's
  const values: Record<View3dField["name"], readonly number[]> = {
    row0: [m(0), m(1), m(2), m(3)],
    row1: [m(4), m(5), m(6), m(7)],
    row2: [m(8), m(9), m(10), m(11)],
    depth: [(near + far) / 2, (far - near) / 2],
  };
  const out = new Float32Array(VIEW3D_BYTES / 4);
  for (const f of VIEW3D_UNIFORM) out.set(values[f.name], f.offset / 4);
  return out;
}

/** The uniform for the camera at `angles` framing `bounds`: the one way the panel and look build their camera (real3d.23). */
export function view3dUniform(bounds: Bounds3, angles: Angles3d): Float32Array {
  return packView3d(camera3d(bounds, angles).matrix, bounds);
}
