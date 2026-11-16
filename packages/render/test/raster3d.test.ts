import { describe, expect, it } from "vitest";
import { camera3d, colorChannels, DEFAULT_ANGLES, type Bounds3, type Face3d, type Point3 } from "@fm/editor";
import { packView3d, raster3d, triangles3d } from "../src/index";

// The software depth buffer `look` draws with (real3d.02): the triangles WebGL draws, a z-buffer, 2×2 supersampling.
// Probes sit one pixel inside and one beyond an edge, placed with the camera's own projection.

const SIZE = 200;
const BG = "#ffffff";
const EDGE = "#202020";
const bounds: Bounds3 = { min: { x: 0, y: 0 }, max: { x: 6, y: 6 }, top: 2.5 };
const cam = camera3d(bounds, DEFAULT_ANGLES); // from the south-west, 35° down

/**
 * A box as the faces a camera-culled builder lists from the south-west (top, south, west), or all six with `closed`:
 * until faces are culled by winding (step 06), a back face meets a front face at the silhouette at equal depth.
 */
function box(owner: string, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, colors: { top: string; side: string }, closed = false): Face3d[] {
  const p = (x: number, y: number, z: number): Point3 => ({ x, y, z });
  const quad = (points: Point3[], color: string): Face3d => ({ points, holes: [], color, owner });
  const top = quad([p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)], colors.top);
  const south = quad([p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1)], colors.side);
  const west = quad([p(x0, y1, z0), p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1)], colors.side);
  if (!closed) return [top, south, west];
  return [
    top, south, west,
    quad([p(x0, y0, z0), p(x0, y1, z0), p(x1, y1, z0), p(x1, y0, z0)], colors.side),
    quad([p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1)], colors.side),
    quad([p(x1, y1, z0), p(x0, y1, z0), p(x0, y1, z1), p(x1, y1, z1)], colors.side),
  ];
}

function draw(faces: Face3d[]) {
  return raster3d(triangles3d(faces, EDGE), packView3d(cam.matrix, bounds), SIZE, BG);
}

/** The pixel a world point lands in. */
function at(p: Point3): { x: number; y: number } {
  const q = cam.project(p);
  return { x: Math.floor(((q.x + 1) / 2) * SIZE), y: Math.floor(((1 - q.y) / 2) * SIZE) };
}

function pixel(img: { width: number; pixels: Uint8Array }, x: number, y: number): string {
  const i = 4 * (y * img.width + x);
  return `#${[0, 1, 2].map((k) => (img.pixels[i + k] ?? 0).toString(16).padStart(2, "0")).join("")}`;
}

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

const close = (a: string, b: string, tol = 3): boolean => {
  const [ar, ag, ab] = colorChannels(a);
  const [br, bg, bb] = colorChannels(b);
  return Math.max(Math.abs(ar - br), Math.abs(ag - bg), Math.abs(ab - bb)) * 255 <= tol;
};

describe("raster3d", () => {
  it("a box seen from the default camera: its top's colour at the top's centre, the background beyond its silhouette", () => {
    const img = draw(box("a", 2, 2, 4, 4, 0, 1, { top: "#ff0000", side: "#00ff00" }));
    expect([img.width, img.height, img.pixels.length]).toEqual([SIZE, SIZE, SIZE * SIZE * 4]);
    const c = at({ x: 3, y: 3, z: 1 });
    expect(pixel(img, c.x, c.y)).toBe("#ff0000");
    // The top's far corner (north-east) is the silhouette's top point: one pixel above it is background.
    const top = at({ x: 4, y: 4, z: 1 });
    expect(pixel(img, top.x, top.y - 2)).toBe(BG);
    expect(pixel(img, top.x, top.y + 3)).not.toBe(BG);
  });

  it("the nearer of two boxes wins where they overlap on screen, whatever order their triangles come in", () => {
    const near = box("near", 1, 1, 2, 2, 0, 1.5, { top: "#0000ff", side: "#0000aa" });
    const far = box("far", 2.2, 2.2, 3.2, 3.2, 0, 2, { top: "#ff0000", side: "#aa0000" });
    const a = draw([...near, ...far]);
    const b = draw([...far, ...near]);
    expect(same(a.pixels, b.pixels)).toBe(true);
    // Wherever both boxes cover a pixel on their own, the pair shows the near box there (it is nearer everywhere).
    const alone = [draw(near), draw(far)];
    let overlap = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const [n, f] = alone.map((img) => pixel(img, x, y));
        if (n === BG || f === BG || (n !== "#0000ff" && n !== "#0000aa")) continue; // edge blends mix with what is behind
        overlap++;
        expect(pixel(a, x, y), `${x},${y}`).toBe(n);
      }
    }
    expect(overlap).toBeGreaterThan(50);
  });

  it("interpenetrating boxes show the nearer surface on each side of their intersection", () => {
    const tall = box("tall", 2, 2, 3, 3, 0, 2, { top: "#ff0000", side: "#aa0000" });
    const slab = box("slab", 1, 2.3, 4, 2.7, 0.8, 1.2, { top: "#00ff00", side: "#00aa00" });
    const img = draw([...tall, ...slab]);
    // The slab pokes out of the tall box's south face: its top shows outside the box and inside the face's span, the box shows above the slab.
    const out = at({ x: 1.5, y: 2.5, z: 1.2 });
    expect(pixel(img, out.x, out.y)).toBe("#00ff00");
    const above = at({ x: 2.5, y: 2, z: 1.7 });
    expect(pixel(img, above.x, above.y)).toBe("#aa0000");
  });

  it("a face with a hole shows what is behind it through the hole", () => {
    const p = (x: number, y: number, z: number): Point3 => ({ x, y, z });
    const wall: Face3d = { points: [p(0, 2, 0), p(6, 2, 0), p(6, 2, 2.5), p(0, 2, 2.5)], holes: [[p(2, 2, 0.8), p(2, 2, 1.8), p(4, 2, 1.8), p(4, 2, 0.8)]], color: "#888888", owner: "w" };
    const behind = box("b", 3, 3, 5, 4.5, 0, 2.4, { top: "#ff0000", side: "#aa0000" });
    const img = draw([wall, ...behind]);
    const hole = at({ x: 3, y: 2, z: 1.3 });
    expect(pixel(img, hole.x, hole.y)).toBe("#aa0000");
    const solid = at({ x: 3, y: 2, z: 2.2 });
    expect(pixel(img, solid.x, solid.y)).toBe("#888888");
  });

  it("an edge hidden behind a nearer face does not draw; a silhouette edge does", () => {
    const near = box("near", 1, 1, 3, 3, 0, 2, { top: "#ff0000", side: "#aa0000" }, true);
    const img = draw(near);
    // The box's back-bottom edge (north-west to north-east at z 0) lies behind its own body: along it, the side colour only.
    const mid = at({ x: 2, y: 3, z: 0 });
    expect(pixel(img, mid.x, mid.y)).toBe("#aa0000");
    // The top's near edge is on screen: its pixels are the edge colour or a blend toward it, never the plain top.
    const edge = at({ x: 2, y: 1, z: 2 });
    const around = [-1, 0, 1].map((d) => pixel(img, edge.x, edge.y + d));
    expect(around.some((c) => close(c, EDGE, 40))).toBe(true);
  });

  it("2×2 supersampling blends only along edges: a face's interior is its exact colour", () => {
    const img = draw(box("a", 2, 2, 4, 4, 0, 1, { top: "#ff0000", side: "#00ff00" }));
    const colours = new Set<string>();
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) colours.add(pixel(img, x, y));
    expect(colours.has("#ff0000")).toBe(true);
    expect([...colours].some((c) => ![BG, "#ff0000", "#00ff00", EDGE].includes(c))).toBe(true);
    for (const [dx, dy] of [[0, 0], [5, 0], [0, 5], [-5, 0]] as const) {
      const c = at({ x: 3, y: 3, z: 1 });
      expect(pixel(img, c.x + dx, c.y + dy)).toBe("#ff0000");
    }
  });

  it("culls a face wound away from the camera: the same quad drawn front-on, then reversed", () => {
    const p = (x: number, y: number, z: number): Point3 => ({ x, y, z });
    const top: Face3d = { points: [p(2, 2, 1), p(4, 2, 1), p(4, 4, 1), p(2, 4, 1)], holes: [], color: "#ff0000", owner: "q" };
    const c = at({ x: 3, y: 3, z: 1 });
    expect(pixel(draw([top]), c.x, c.y)).toBe("#ff0000");
    expect(pixel(draw([{ ...top, points: [...top.points].reverse() }]), c.x, c.y)).toBe(BG);
  });

  it("is deterministic", () => {
    const faces = box("a", 2, 2, 4, 4, 0, 1, { top: "#ff0000", side: "#00ff00" });
    expect(same(draw(faces).pixels, draw(faces).pixels)).toBe(true);
  });

  describe("a finished floor (finishes.12, AC-13)", () => {
    const p = (x: number, y: number, z: number): Point3 => ({ x, y, z });
    const FLOOR = "#00ff00";
    const LINE = "#ff0000";
    const plain: Face3d = { points: [p(0, 0, 0), p(6, 0, 0), p(6, 6, 0), p(0, 6, 0)], holes: [], color: FLOOR, owner: "floor/f1" };
    const floor: Face3d = { ...plain, lines: [{ a: p(0.5, 3, 0), b: p(5.5, 3, 0), color: LINE }] };
    const piece = box("piece", 2.5, 2.5, 3.5, 3.5, 0, 0.8, { top: "#0000ff", side: "#0000aa" });

    it("a finished floor's pixel is the base colour; a plank line's pixel is the line colour", () => {
      const img = draw([floor]);
      const c = at(p(1, 1.5, 0));
      expect(pixel(img, c.x, c.y)).toBe(FLOOR);
      // Two samples wide, a line covers a whole pixel wherever it runs through one's middle: somewhere along it.
      const along = Array.from({ length: 50 }, (_, i) => at(p(0.6 + i * 0.1, 3, 0)));
      expect(along.some((q) => [-1, 0, 1].some((d) => pixel(img, q.x, q.y + d) === LINE))).toBe(true);
      expect(along.some((q) => [-1, 0, 1].some((d) => pixel(draw([plain]), q.x, q.y + d) === LINE))).toBe(false);
    });

    it("a box standing on the floor hides the lines 2 px inside its footprint", () => {
      const [withLines, without, alone] = [draw([floor, ...piece]), draw([plain, ...piece]), draw(piece)];
      const covered = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < SIZE && y < SIZE && pixel(alone, x, y) !== BG;
      const inside = (x: number, y: number): boolean => {
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (!covered(x + dx, y + dy)) return false;
        return true;
      };
      // The line runs under the box: its path crosses the box's picture well inside it.
      const under = Array.from({ length: 11 }, (_, i) => at(p(2.5 + i * 0.1, 3, 0))).filter((q) => inside(q.x, q.y));
      expect(under.length).toBeGreaterThan(5);
      let probed = 0;
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          if (!inside(x, y)) continue;
          probed++;
          expect(pixel(withLines, x, y), `${x},${y}`).toBe(pixel(without, x, y));
        }
      }
      expect(probed).toBeGreaterThan(100);
    });
  });
});
