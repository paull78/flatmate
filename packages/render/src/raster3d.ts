import { colorChannels } from "@fm/editor";
import { LAYOUT3D } from "./layout";
import { FACE3D_POLYGON_OFFSET } from "./shaders3d";
import { VIEW3D_UNIFORM, type View3dField } from "./view3d";

// The 3D view in software (real3d.02): the triangles and edge lines WebGL draws (triangles3d), through the same packed
// uniform (packView3d), into a z-buffer at twice the size, then averaged 2×2. It is what Claude's `look` shows, so it
// mirrors the GLSL vertex shader and the WebGL renderer's state: back faces culled (counter-clockwise on screen is
// front, as gl.frontFace(CCW)), depth test LEQUAL, fills pushed back by polygonOffset(1, 1) so their edges draw on top,
// lines about one output pixel wide. Pure: no DOM, no Node built-ins.

const STRIDE = LAYOUT3D.face3d.strideFloats;
const SS = 2; // samples per output pixel along each axis
/** The polygon offset in window depth (0 to 1): a unit is one step of a 24-bit depth buffer, as WebGL's is. */
const OFFSET_UNITS = FACE3D_POLYGON_OFFSET.units / (1 << 24);
const OFFSET_FACTOR = FACE3D_POLYGON_OFFSET.factor;

export type Raster3d = { width: number; height: number; pixels: Uint8Array };

type Vertex = { x: number; y: number; z: number; r: number; g: number; b: number };

/**
 * The picture of `fill` and `edges` (LAYOUT3D.face3d vertices) through `view` (packView3d) as `size` × `size` RGBA
 * pixels, rows from the top, on `background`.
 */
export function raster3d(geometry: { fill: Float32Array; edges: Float32Array }, view: Float32Array, size: number, background: string): Raster3d {
  const n = size * SS;
  const field = (name: View3dField["name"]): Float32Array => {
    const f = VIEW3D_UNIFORM.find((u) => u.name === name);
    if (!f) throw new Error(`no ${name} in the 3D uniform`);
    return view.subarray(f.offset / 4, f.offset / 4 + f.floats);
  };
  const [row0, row1, row2, depth] = [field("row0"), field("row1"), field("row2"), field("depth")];
  const dot = (row: Float32Array, a: Float32Array, i: number): number => (row[0] ?? 0) * (a[i] ?? 0) + (row[1] ?? 0) * (a[i + 1] ?? 0) + (row[2] ?? 0) * (a[i + 2] ?? 0) + (row[3] ?? 0);
  // As FACE3D_VS: clip x, y from rows 0 and 1, clip z = (row 2 − centre) / half range; then the viewport, y down.
  const vertex = (a: Float32Array, i: number): Vertex => ({
    x: ((dot(row0, a, i) + 1) / 2) * n,
    y: ((1 - dot(row1, a, i)) / 2) * n,
    z: 0.5 * ((dot(row2, a, i) - (depth[0] ?? 0)) / (depth[1] ?? 1)) + 0.5,
    r: a[i + 3] ?? 0, g: a[i + 4] ?? 0, b: a[i + 5] ?? 0,
  });

  const zbuf = new Float32Array(n * n).fill(1);
  const [br, bg, bb] = colorChannels(background);
  const color = new Float32Array(n * n * 3);
  for (let i = 0; i < n * n; i++) color.set([br, bg, bb], i * 3);
  const plot = (x: number, y: number, z: number, v: Vertex): void => {
    if (x < 0 || y < 0 || x >= n || y >= n) return;
    const k = y * n + x;
    if (z > (zbuf[k] ?? 1)) return; // LEQUAL
    zbuf[k] = z;
    color[k * 3] = v.r;
    color[k * 3 + 1] = v.g;
    color[k * 3 + 2] = v.b;
  };

  for (let t = 0; t + 3 * STRIDE <= geometry.fill.length; t += 3 * STRIDE) {
    triangle(vertex(geometry.fill, t), vertex(geometry.fill, t + STRIDE), vertex(geometry.fill, t + 2 * STRIDE), n, plot);
  }
  for (let t = 0; t + 2 * STRIDE <= geometry.edges.length; t += 2 * STRIDE) {
    line(vertex(geometry.edges, t), vertex(geometry.edges, t + STRIDE), plot);
  }

  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) sum += color[((y * SS + sy) * n + x * SS + sx) * 3 + c] ?? 0;
        pixels[(y * size + x) * 4 + c] = Math.round((sum / (SS * SS)) * 255);
      }
      pixels[(y * size + x) * 4 + 3] = 255;
    }
  }
  return { width: size, height: size, pixels };
}

/**
 * One filled triangle if it faces the camera, sample centres inside it with a top-left rule; depth pushed back by the
 * offset. Counter-clockwise in clip space (y up) is clockwise in this y-down raster: a positive area here is a back face.
 */
function triangle(a: Vertex, b: Vertex, c: Vertex, n: number, plot: (x: number, y: number, z: number, v: Vertex) => void): void {
  const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (area >= 0) return; // a back face, or edge on
  const [p, q, r] = [a, c, b];
  const s = -area;
  // Depth as a plane z = z0 + zx·x + zy·y; polygonOffset's slope term is its largest step per sample.
  const zx = ((q.z - p.z) * (r.y - p.y) - (r.z - p.z) * (q.y - p.y)) / s;
  const zy = ((r.z - p.z) * (q.x - p.x) - (q.z - p.z) * (r.x - p.x)) / s;
  const offset = OFFSET_FACTOR * Math.max(Math.abs(zx), Math.abs(zy)) + OFFSET_UNITS;
  // In a y-down raster, positive area is clockwise on screen: an edge is "top" or "left" by the direction it runs.
  const topLeft = (u: Vertex, v: Vertex): boolean => (u.y === v.y && v.x < u.x) || v.y > u.y;
  const edges: [Vertex, Vertex][] = [[p, q], [q, r], [r, p]];
  const bias = edges.map(([u, v]) => (topLeft(u, v) ? 0 : -1e-9));
  const x0 = Math.max(0, Math.floor(Math.min(p.x, q.x, r.x)));
  const x1 = Math.min(n - 1, Math.ceil(Math.max(p.x, q.x, r.x)));
  const y0 = Math.max(0, Math.floor(Math.min(p.y, q.y, r.y)));
  const y1 = Math.min(n - 1, Math.ceil(Math.max(p.y, q.y, r.y)));
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    for (let x = x0; x <= x1; x++) {
      const cx = x + 0.5;
      let inside = true;
      edges.forEach(([u, v], i) => {
        const w = (v.x - u.x) * (cy - u.y) - (v.y - u.y) * (cx - u.x);
        if (!(w + (bias[i] ?? 0) >= 0)) inside = false;
      });
      if (!inside) continue;
      plot(x, y, p.z + zx * (cx - p.x) + zy * (cy - p.y) + offset, p);
    }
  }
}

/** One line about one output pixel wide (SS samples across), depth interpolated along it. */
function line(a: Vertex, b: Vertex, plot: (x: number, y: number, z: number, v: Vertex) => void): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  const across = Math.abs(dx) >= Math.abs(dy) ? { x: 0, y: 1 } : { x: 1, y: 0 };
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + dx * t;
    const y = a.y + dy * t;
    const z = a.z + (b.z - a.z) * t;
    for (let k = 0; k < SS; k++) {
      const o = k - (SS - 1) / 2;
      plot(Math.floor(x + across.x * o), Math.floor(y + across.y * o), z, a);
    }
  }
}
