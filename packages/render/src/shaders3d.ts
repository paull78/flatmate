// The 3D view's shaders (webgpu.09), GLSL for WebGL2 and WGSL for WebGPU (and G4), reading LAYOUT3D.face3d. One matrix
// (the camera's three rows) and the view's depth range as uniforms; the colour, edges included, comes in the vertices.
// WebGL's clip z runs -1..1, WebGPU's 0..1: the WGSL maps the same depth value into its range. The uniform's layout is
// VIEW3D_UNIFORM and its packer packView3d (view3d.ts); entry points are ENTRY's (tests check).

import { ENTRY } from "./pass";

/**
 * The 3D pass's fixed state, read by every 3D renderer (WebGL and look's raster3d): depth test LEQUAL, back faces culled
 * with counter-clockwise front faces, and fills pushed back by this polygon offset so their edges, at the same depth,
 * draw on top.
 */
export const FACE3D_POLYGON_OFFSET: Readonly<{ factor: number; units: number }> = { factor: 1, units: 1 };

export const FACE3D_VS = `#version 300 es
uniform vec4 u_row0;
uniform vec4 u_row1;
uniform vec4 u_row2;
uniform vec2 u_depth; // centre and half range of the view's depth
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_color;
out vec3 v_color;
void main() {
  vec4 p = vec4(a_pos, 1.0);
  gl_Position = vec4(dot(u_row0, p), dot(u_row1, p), (dot(u_row2, p) - u_depth.x) / u_depth.y, 1.0);
  v_color = a_color;
}`;

export const FACE3D_FS = `#version 300 es
precision mediump float;
in vec3 v_color;
out vec4 outColor;
void main() { outColor = vec4(v_color, 1.0); }`;

/** WebGPU: `struct View3d` at group 0, binding 0; ENTRY's entry points; depth mapped into 0..1. */
export const WGSL_FACE3D = `struct View3d {
  row0: vec4f,
  row1: vec4f,
  row2: vec4f,
  depth: vec2f, // centre and half range of the view's depth
};
@group(0) @binding(0) var<uniform> view: View3d;

struct Varyings {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
};

@vertex
fn ${ENTRY.vertex}(@location(0) a_pos: vec3f, @location(1) a_color: vec3f) -> Varyings {
  let p = vec4f(a_pos, 1.0);
  let d = (dot(view.row2, p) - view.depth.x) / view.depth.y; // -1..1, as the GLSL's clip z
  var out: Varyings;
  out.position = vec4f(dot(view.row0, p), dot(view.row1, p), 0.5 * d + 0.5, 1.0);
  out.color = a_color;
  return out;
}

@fragment
fn ${ENTRY.fragment}(v: Varyings) -> @location(0) vec4f {
  return vec4f(v.color, 1.0);
}
`;
