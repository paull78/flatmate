// GLSL ES 3.00 sources for the WebGL2 renderer (spec §6.2). Instance layouts match instances.ts.
//
// Spaces: world metres (y up) → "local" CSS px = (world − centre) · zoom, still y up, origin at the viewport
// centre → clip = local / (viewport / 2). Distances in the fragment shaders are local CSS px, so one device pixel
// is 1 / dpr of them: coverage = clamp(0.5 − d · dpr, 0, 1) is the spec's 0.5 − d / fwidth(d) without derivatives.
// Segment and disc distances are exact; the arc's butt ends (ring ∩ wedge) give only a bound near the end corners.
// Colours come in straight; outputs are premultiplied (blend ONE,
// ONE_MINUS_SRC_ALPHA).

const CAMERA = `
uniform vec2 u_center;
uniform float u_zoom;
uniform vec2 u_half;
vec2 toLocal(vec2 world) { return (world - u_center) * u_zoom; }
vec4 toClip(vec2 local) { return vec4(local / u_half, 0.0, 1.0); }
float toPx(float value, float unit) { return unit > 0.5 ? value : value * u_zoom; }
`;

const COVERAGE = `
uniform float u_dpr;
out vec4 outColor;
void shade(float d, vec4 color) {
  float coverage = clamp(0.5 - d * u_dpr, 0.0, 1.0);
  if (coverage <= 0.0) discard;
  outColor = vec4(color.rgb * color.a * coverage, color.a * coverage);
}
`;

/**
 * `?sdf=debug` (spec §6.2, "SDF debug view"): the shape keeps its colour (d ≤ 0, no antialiasing); outside it, the
 * distance d that COVERAGE turns into coverage is drawn as alternating 4 px bands of the colour, fading out by 16 px.
 */
const DEBUG_COVERAGE = `
out vec4 outColor;
void shade(float d, vec4 color) {
  float alpha = d <= 0.0 ? color.a : color.a * step(0.5, fract(d / 8.0)) * max(1.0 - d / 16.0, 0.0);
  if (alpha <= 0.0) discard;
  outColor = vec4(color.rgb * alpha, alpha);
}
`;

/** Quad margin in CSS px: 1 so the antialiased fringe is never clipped; 16 in debug mode, to hold the bands. */
const padFor = (debug: boolean): string => (debug ? "16.0" : "1.0");
const coverageFor = (debug: boolean): string => (debug ? DEBUG_COVERAGE : COVERAGE);

export const POLYGON_VS = `#version 300 es
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec4 a_color;
${CAMERA}
out vec4 v_color;
void main() {
  gl_Position = toClip(toLocal(a_position));
  v_color = a_color;
}
`;

export const POLYGON_FS = `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 outColor;
void main() {
  outColor = vec4(v_color.rgb * v_color.a, v_color.a);
}
`;

const segmentVs = (debug: boolean): string => `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 i_ends;
layout(location = 2) in vec3 i_style;
layout(location = 3) in vec2 i_dash;
layout(location = 4) in vec4 i_color;
${CAMERA}
out vec2 v_p;
flat out float v_length;
flat out float v_halfWidth;
flat out float v_round;
flat out vec2 v_dash;
flat out vec4 v_color;
void main() {
  vec2 a = toLocal(i_ends.xy);
  vec2 b = toLocal(i_ends.zw);
  float len = length(b - a);
  vec2 dir = len > 0.0 ? (b - a) / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float hw = 0.5 * toPx(i_style.x, i_style.y);
  float pad = hw + ${padFor(debug)};
  vec2 p = vec2(mix(-pad, len + pad, a_corner.x * 0.5 + 0.5), a_corner.y * pad);
  gl_Position = toClip(a + dir * p.x + nrm * p.y);
  v_p = p;
  v_length = len;
  v_halfWidth = hw;
  v_round = i_style.z;
  v_dash = i_dash;
  v_color = i_color;
}
`;

const segmentFs = (debug: boolean): string => `#version 300 es
precision highp float;
in vec2 v_p;
flat in float v_length;
flat in float v_halfWidth;
flat in float v_round;
flat in vec2 v_dash;
flat in vec4 v_color;
${coverageFor(debug)}
void main() {
  // v_p: x along the segment from a, y across it, in CSS px.
  float along = clamp(v_p.x, 0.0, v_length);
  float roundD = length(v_p - vec2(along, 0.0)) - v_halfWidth;
  vec2 q = vec2(abs(v_p.x - 0.5 * v_length) - 0.5 * v_length, abs(v_p.y) - v_halfWidth);
  float buttD = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float d = v_round > 0.5 ? roundD : buttD;
  // Dashes start at a, like Canvas2D; their ends are cut without antialiasing.
  if (v_dash.x > 0.0 && mod(max(v_p.x, 0.0), v_dash.x + v_dash.y) > v_dash.x) discard;
  shade(d, v_color);
}
`;

const arcVs = (debug: boolean): string => `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 i_center;
layout(location = 2) in vec3 i_shape;
layout(location = 3) in vec2 i_width;
layout(location = 4) in vec4 i_color;
${CAMERA}
out vec2 v_p;
flat out float v_radius;
flat out float v_halfWidth;
flat out float v_start;
flat out float v_span;
flat out vec4 v_color;
void main() {
  float radius = i_shape.x * u_zoom;
  float hw = 0.5 * toPx(i_width.x, i_width.y);
  vec2 p = a_corner * (radius + hw + ${padFor(debug)});
  gl_Position = toClip(toLocal(i_center) + p);
  v_p = p;
  v_radius = radius;
  v_halfWidth = hw;
  v_start = i_shape.y;
  v_span = i_shape.z;
  v_color = i_color;
}
`;

const arcFs = (debug: boolean): string => `#version 300 es
precision highp float;
in vec2 v_p;
flat in float v_radius;
flat in float v_halfWidth;
flat in float v_start;
flat in float v_span;
flat in vec4 v_color;
${coverageFor(debug)}
void main() {
  float ring = abs(length(v_p) - v_radius) - v_halfWidth;
  // Butt ends: the ring cut by the wedge from v_start, counter-clockwise by v_span (world y up, like v_p).
  vec2 s = vec2(cos(v_start), sin(v_start));
  vec2 e = vec2(cos(v_start + v_span), sin(v_start + v_span));
  float afterStart = dot(v_p, vec2(s.y, -s.x));
  float beforeEnd = dot(v_p, vec2(-e.y, e.x));
  float wedge = v_span >= 6.2831 ? -1e6 : (v_span <= 3.14159265 ? max(afterStart, beforeEnd) : min(afterStart, beforeEnd));
  shade(max(ring, wedge), v_color);
}
`;

const discVs = (debug: boolean): string => `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 i_center;
layout(location = 2) in vec2 i_radius;
layout(location = 3) in vec4 i_color;
${CAMERA}
out vec2 v_p;
flat out float v_radius;
flat out vec4 v_color;
void main() {
  float radius = toPx(i_radius.x, i_radius.y);
  vec2 p = a_corner * (radius + ${padFor(debug)});
  gl_Position = toClip(toLocal(i_center) + p);
  v_p = p;
  v_radius = radius;
  v_color = i_color;
}
`;

const discFs = (debug: boolean): string => `#version 300 es
precision highp float;
in vec2 v_p;
flat in float v_radius;
flat in vec4 v_color;
${coverageFor(debug)}
void main() {
  shade(length(v_p) - v_radius, v_color);
}
`;

export type SdfShaders = Record<"segment" | "arc" | "disc", { vs: string; fs: string }>;

/** The SDF programs' sources; `debug` swaps in the debug view's padding and shading. Polygons have no debug form. */
export function sdfShaders(debug: boolean): SdfShaders {
  return {
    segment: { vs: segmentVs(debug), fs: segmentFs(debug) },
    arc: { vs: arcVs(debug), fs: arcFs(debug) },
    disc: { vs: discVs(debug), fs: discFs(debug) },
  };
}
