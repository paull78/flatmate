// The camera uniform (webgpu.11): one field order and byte layout, read by the WGSL struct, the GLSL uniforms and every
// renderer. Laid out as WGSL lays a struct: a vec2 starts at a multiple of 8, so the two f32 sit between the vec2s.

export type CameraField = { name: "center" | "zoom" | "dpr" | "half"; offset: number; floats: 1 | 2 };

/** Byte offsets in the uniform buffer, in order: `struct Camera { center: vec2f, zoom: f32, dpr: f32, half: vec2f }`. */
export const CAMERA_UNIFORM: readonly CameraField[] = [
  { name: "center", offset: 0, floats: 2 },
  { name: "zoom", offset: 8, floats: 1 },
  { name: "dpr", offset: 12, floats: 1 },
  { name: "half", offset: 16, floats: 2 },
];
export const CAMERA_BYTES = 24;

/** The GLSL uniform each field is, in the WebGL shaders. */
export const CAMERA_GLSL: Readonly<Record<CameraField["name"], string>> = { center: "u_center", zoom: "u_zoom", dpr: "u_dpr", half: "u_half" };

type CameraLike = { center: { x: number; y: number }; zoom: number; viewport: { width: number; height: number }; dpr: number };

/** The uniform buffer's contents for a camera: world centre, pixels per metre, device pixel ratio, half the viewport. */
export function packCamera(camera: CameraLike): Float32Array {
  const out = new Float32Array(CAMERA_BYTES / 4);
  const values: Record<CameraField["name"], readonly number[]> = {
    center: [camera.center.x, camera.center.y],
    zoom: [camera.zoom],
    dpr: [camera.dpr],
    half: [camera.viewport.width / 2, camera.viewport.height / 2],
  };
  for (const f of CAMERA_UNIFORM) out.set(values[f.name], f.offset / 4);
  return out;
}
