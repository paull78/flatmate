// WGSL modules for the WebGPU renderer (webgpu.11), one per 2D kind, translated one to one from the GLSL in shaders.ts:
// the same spaces, SDFs and coverage (see there). Each module is self-contained, so it can be written to a .wgsl file as
// is. Vertex inputs match LAYOUT, the camera struct CAMERA_UNIFORM, the entry points ENTRY (tests check), and the unit
// and cap codes come from layout.ts. GLSL's `a ? b : c` is `select(c, b, a)`; flat values are `@interpolate(flat)`.
// There is no WGSL form of `?sdf=debug`: that view stays WebGL's (webgpu.11).

import { CAP_ROUND, UNIT_PX, type GeometryKind } from "./layout";
import { CAMERA_BINDING } from "./pass";

const PRELUDE = `
const UNIT_PX: f32 = ${UNIT_PX}.0;
const CAP_ROUND: f32 = ${CAP_ROUND}.0;
struct Camera { center: vec2f, zoom: f32, dpr: f32, half: vec2f }
@group(${CAMERA_BINDING.group}) @binding(${CAMERA_BINDING.binding}) var<uniform> camera: Camera;
fn toLocal(world: vec2f) -> vec2f { return (world - camera.center) * camera.zoom; }
fn toClip(local: vec2f) -> vec4f { return vec4f(local / camera.half, 0.0, 1.0); }
fn toPx(value: f32, unit: f32) -> f32 { return select(value * camera.zoom, value, unit == UNIT_PX); }
fn shade(d: f32, color: vec4f) -> vec4f {
  let coverage = clamp(0.5 - d * camera.dpr, 0.0, 1.0);
  if (coverage <= 0.0) { discard; }
  return vec4f(color.rgb * color.a * coverage, color.a * coverage);
}
`;

/** Quad margin in CSS px, so the antialiased fringe is never clipped (the GLSL's non-debug padding). */
const PAD = "1.0";

const POLYGON = `${PRELUDE}
struct Varyings {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
}
@vertex fn vs(@location(0) a_position: vec2f, @location(1) a_color: vec4f) -> Varyings {
  return Varyings(toClip(toLocal(a_position)), a_color);
}
@fragment fn fs(v: Varyings) -> @location(0) vec4f {
  return vec4f(v.color.rgb * v.color.a, v.color.a);
}
`;

const SEGMENT = `${PRELUDE}
struct Varyings {
  @builtin(position) position: vec4f,
  @location(0) p: vec2f,
  @location(1) @interpolate(flat) len: f32,
  @location(2) @interpolate(flat) halfWidth: f32,
  @location(3) @interpolate(flat) cap: f32,
  @location(4) @interpolate(flat) dash: vec2f,
  @location(5) @interpolate(flat) color: vec4f,
}
@vertex fn vs(@location(0) a_corner: vec2f, @location(1) i_ends: vec4f, @location(2) i_style: vec3f, @location(3) i_dash: vec2f, @location(4) i_color: vec4f) -> Varyings {
  let a = toLocal(i_ends.xy);
  let b = toLocal(i_ends.zw);
  let len = length(b - a);
  let dir = select(vec2f(1.0, 0.0), (b - a) / len, len > 0.0);
  let nrm = vec2f(-dir.y, dir.x);
  let hw = 0.5 * toPx(i_style.x, i_style.y);
  let pad = hw + ${PAD};
  let p = vec2f(mix(-pad, len + pad, a_corner.x * 0.5 + 0.5), a_corner.y * pad);
  return Varyings(toClip(a + dir * p.x + nrm * p.y), p, len, hw, i_style.z, i_dash, i_color);
}
@fragment fn fs(v: Varyings) -> @location(0) vec4f {
  // v.p: x along the segment from a, y across it, in CSS px.
  let along = clamp(v.p.x, 0.0, v.len);
  let roundD = length(v.p - vec2f(along, 0.0)) - v.halfWidth;
  let q = vec2f(abs(v.p.x - 0.5 * v.len) - 0.5 * v.len, abs(v.p.y) - v.halfWidth);
  let buttD = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0);
  let d = select(buttD, roundD, v.cap == CAP_ROUND);
  // Dashes start at a, like Canvas2D; their ends are cut without antialiasing. % is GLSL's mod on the non-negative max.
  if (v.dash.x > 0.0 && max(v.p.x, 0.0) % (v.dash.x + v.dash.y) > v.dash.x) { discard; }
  return shade(d, v.color);
}
`;

const ARC = `${PRELUDE}
struct Varyings {
  @builtin(position) position: vec4f,
  @location(0) p: vec2f,
  @location(1) @interpolate(flat) radius: f32,
  @location(2) @interpolate(flat) halfWidth: f32,
  @location(3) @interpolate(flat) start: f32,
  @location(4) @interpolate(flat) span: f32,
  @location(5) @interpolate(flat) color: vec4f,
}
@vertex fn vs(@location(0) a_corner: vec2f, @location(1) i_center: vec2f, @location(2) i_shape: vec3f, @location(3) i_width: vec2f, @location(4) i_color: vec4f) -> Varyings {
  let radius = i_shape.x * camera.zoom;
  let hw = 0.5 * toPx(i_width.x, i_width.y);
  let p = a_corner * (radius + hw + ${PAD});
  return Varyings(toClip(toLocal(i_center) + p), p, radius, hw, i_shape.y, i_shape.z, i_color);
}
@fragment fn fs(v: Varyings) -> @location(0) vec4f {
  let ring = abs(length(v.p) - v.radius) - v.halfWidth;
  // Butt ends: the ring cut by the wedge from v.start, counter-clockwise by v.span (world y up, like v.p).
  let s = vec2f(cos(v.start), sin(v.start));
  let e = vec2f(cos(v.start + v.span), sin(v.start + v.span));
  let afterStart = dot(v.p, vec2f(s.y, -s.x));
  let beforeEnd = dot(v.p, vec2f(-e.y, e.x));
  let wedge = select(select(min(afterStart, beforeEnd), max(afterStart, beforeEnd), v.span <= 3.14159265), -1e6, v.span >= 6.2831);
  return shade(max(ring, wedge), v.color);
}
`;

const DISC = `${PRELUDE}
struct Varyings {
  @builtin(position) position: vec4f,
  @location(0) p: vec2f,
  @location(1) @interpolate(flat) radius: f32,
  @location(2) @interpolate(flat) color: vec4f,
}
@vertex fn vs(@location(0) a_corner: vec2f, @location(1) i_center: vec2f, @location(2) i_radius: vec2f, @location(3) i_color: vec4f) -> Varyings {
  let radius = toPx(i_radius.x, i_radius.y);
  let p = a_corner * (radius + ${PAD});
  return Varyings(toClip(toLocal(i_center) + p), p, radius, i_color);
}
@fragment fn fs(v: Varyings) -> @location(0) vec4f {
  return shade(length(v.p) - v.radius, v.color);
}
`;

/** One finished WGSL module per 2D kind, with entry points ENTRY.vertex and ENTRY.fragment and the camera at group 0, binding 0. */
export const WGSL: Readonly<Record<GeometryKind, string>> = { polygon: POLYGON, segment: SEGMENT, arc: ARC, disc: DISC };
