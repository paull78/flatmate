import { describe, expect, it } from "vitest";
import { camera3d, hiddenWalls, lookScene3d, newell, sceneFaces, shellBounds, STYLE_3D, view3dItems, type Angles3d, type Bounds3, type Face3d, type Point3 } from "@fm/editor";
import { roomDoc, withCommands } from "@fm/editor/testing";
import { raster3d, triangles3d, view3dUniform } from "../src/index";

// Depth is exact at any tilt (real3d.08, AC-09): raster3d against a reference ray caster written here, which intersects
// a view ray with every face that faces the camera (the plane, then the outer ring less its holes) and keeps the
// nearest. Two checks. Fills: drawn without outlines, wherever the caster finds one face at all four of a pixel's 2×2
// samples, raster3d's pixel is exactly that face's colour. Outlines: at points along every outline that lie behind
// the nearest face, where that face covers the pixel's four samples, the pixel shows the face, not the outline.

type Command = Parameters<typeof withCommands>[1];
const SIZE = 240;
const STEP = 5; // check every fifth pixel
const BEHIND = 0.02; // m: an outline point this far behind the nearest face is hidden

const dot = (a: Point3, b: Point3): number => a.x * b.x + a.y * b.y + a.z * b.z;

function insideRing(ring: readonly [number, number][], u: number, v: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = [ring[i], ring[j]];
    if (a && b && (a[1] > v) !== (b[1] > v) && u < ((b[0] - a[0]) * (v - a[1])) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}

/** The colour the nearest front-facing face shows at clip (x, y), or the background; and that face. */
function caster(faces: readonly Face3d[], matrix: readonly number[]) {
  const row = (r: number): Point3 => ({ x: matrix[4 * r] ?? 0, y: matrix[4 * r + 1] ?? 0, z: matrix[4 * r + 2] ?? 0 });
  const off = (r: number): number => matrix[4 * r + 3] ?? 0;
  const [r0, r1, r2] = [row(0), row(1), row(2)];
  const back = { x: -r2.x, y: -r2.y, z: -r2.z };
  const prepared = faces.flatMap((f) => {
    const n = newell(f.points);
    if (dot(n, back) <= 1e-12) return []; // culled by winding
    const a = f.points[0];
    if (!a) return [];
    const [ax, ay, az] = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)];
    const flat = az >= ax && az >= ay ? (p: Point3): [number, number] => [p.x, p.y] : ay >= ax ? (p: Point3): [number, number] => [p.x, p.z] : (p: Point3): [number, number] => [p.y, p.z];
    const xs = f.points.map((p) => dot(r0, p) + off(0));
    const ys = f.points.map((p) => dot(r1, p) + off(1));
    const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; // its screen box
    return [{ f, n, d: dot(n, a), flat, outer: f.points.map(flat), holes: f.holes.map((h) => h.map(flat)), box }];
  });
  return (x: number, y: number): { face: Face3d; depth: number } | null => {
    let best: { face: Face3d; depth: number } | null = null;
    for (const p of prepared) {
      if (x < p.box.x0 || x > p.box.x1 || y < p.box.y0 || y > p.box.y1) continue;
      // Solve r0·q = x − off0, r1·q = y − off1, n·q = d for q (Cramer's rule).
      const rows = [r0, r1, p.n];
      const rhs = [x - off(0), y - off(1), p.d];
      const det = (m: Point3[]): number => dot(m[0] ?? r0, { x: (m[1] ?? r0).y * (m[2] ?? r0).z - (m[1] ?? r0).z * (m[2] ?? r0).y, y: (m[1] ?? r0).z * (m[2] ?? r0).x - (m[1] ?? r0).x * (m[2] ?? r0).z, z: (m[1] ?? r0).x * (m[2] ?? r0).y - (m[1] ?? r0).y * (m[2] ?? r0).x });
      const D = det(rows);
      if (Math.abs(D) < 1e-12) continue;
      const col = (k: "x" | "y" | "z"): Point3[] => rows.map((r, i) => ({ ...r, [k]: rhs[i] ?? 0 }));
      const q = { x: det(col("x")) / D, y: det(col("y")) / D, z: det(col("z")) / D };
      const [u, v] = p.flat(q);
      if (!insideRing(p.outer, u, v) || p.holes.some((h) => insideRing(h, u, v))) continue;
      const depth = dot(r2, q) + off(2);
      if (best === null || depth < best.depth) best = { face: p.f, depth };
    }
    return best;
  };
}

function check(label: string, faces: Face3d[], bounds: Bounds3, angles: Angles3d, background = STYLE_3D.background): { checked: number; wrong: string[] } {
  const cam = camera3d(bounds, angles);
  const view = view3dUniform(bounds, angles);
  const tris = triangles3d(faces, STYLE_3D.edge);
  const bare = raster3d({ fill: tris.fill, edges: new Float32Array(0) }, view, SIZE, background);
  const full = raster3d(tris, view, SIZE, background);
  const cast = caster(faces, cam.matrix);
  const toClip = (px: number): number => (px / SIZE) * 2 - 1;
  const colour = (img: { pixels: Uint8Array }, i: number, j: number): string => `#${[0, 1, 2].map((c) => (img.pixels[4 * (j * SIZE + i) + c] ?? 0).toString(16).padStart(2, "0")).join("")}`;
  /** The one face all four 2×2 samples of pixel (i, j) hit, undefined when they differ, null for the background. */
  const covering = (i: number, j: number): Face3d | null | undefined => {
    const hits = [0.25, 0.75].flatMap((a) => [0.25, 0.75].map((b) => cast(toClip(i + a), -toClip(j + b))?.face ?? null));
    return hits.every((h) => h === hits[0]) ? hits[0] : undefined;
  };
  const wrong: string[] = [];
  let checked = 0;
  const at = `${label} yaw ${angles.yaw} tilt ${angles.tilt}`;
  for (let j = 1; j < SIZE; j += STEP) {
    for (let i = 1; i < SIZE; i += STEP) {
      const face = covering(i, j);
      if (face === undefined) continue;
      if ([[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]].some(([di, dj]) => (cast(toClip(i + 0.5 + (di ?? 0)), -toClip(j + 0.5 + (dj ?? 0)))?.face ?? null) !== face)) continue;
      checked++;
      const want = face?.color ?? background;
      const got = colour(bare, i, j);
      if (got !== want) wrong.push(`${at} fill at ${i},${j}: ${got}, want ${want} (${face?.owner ?? "background"})`);
    }
  }
  // Outlines: points along each edge segment; where one lies behind the nearest face, that face must cover the pixel,
  // unless a visible outline crosses it too (a top's edge right over a hidden bottom edge, seen straight down).
  const stride = 6; // LAYOUT3D.face3d: x, y, z, then the colour
  const segments: [Point3, Point3][] = [];
  for (let k = 0; k + 2 * stride <= tris.edges.length; k += 2 * stride) {
    segments.push([{ x: tris.edges[k] ?? 0, y: tris.edges[k + 1] ?? 0, z: tris.edges[k + 2] ?? 0 }, { x: tris.edges[k + stride] ?? 0, y: tris.edges[k + stride + 1] ?? 0, z: tris.edges[k + stride + 2] ?? 0 }]);
  }
  const pixelOf = (q: Point3): [number, number] => [Math.floor(((q.x + 1) / 2) * SIZE), Math.floor(((1 - q.y) / 2) * SIZE)];
  const seen = new Set<number>(); // pixels a visible outline passes through, and their neighbours
  for (const [a, b] of segments) {
    const [pa, pb] = [cam.project(a), cam.project(b)];
    const n = Math.max(1, Math.ceil((Math.hypot(pb.x - pa.x, pb.y - pa.y) * SIZE) / 2) * 2);
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const q = cam.project({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
      const front = cast(q.x, q.y);
      if (front !== null && front.depth <= q.z - BEHIND) continue;
      const [i, j] = pixelOf(q);
      for (const di of [-1, 0, 1]) for (const dj of [-1, 0, 1]) seen.add((j + dj) * SIZE + i + di);
    }
  }
  for (const [a, b] of segments) {
    for (const t of [0.2, 0.5, 0.8]) {
      const q = cam.project({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
      const front = cast(q.x, q.y);
      if (front === null || front.depth > q.z - BEHIND) continue; // nothing in front of it
      const [i, j] = pixelOf(q);
      if (i < 1 || j < 1 || i >= SIZE - 1 || j >= SIZE - 1 || seen.has(j * SIZE + i)) continue;
      const near = [-1, 0, 1].flatMap((di) => [-1, 0, 1].map((dj) => covering(i + di, j + dj)));
      if (!near.every((f) => f === front.face)) continue; // by a visible boundary, where an outline belongs
      checked++;
      const got = colour(full, i, j);
      if (got !== front.face.color) wrong.push(`${at} hidden outline at ${i},${j}: ${got}, want ${front.face.color} (${front.face.owner})`);
    }
  }
  return { checked, wrong };
}

function scene(doc: ReturnType<typeof roomDoc>, yaw: number): { faces: Face3d[]; bounds: Bounds3 } {
  const bounds = shellBounds(doc);
  if (!bounds) throw new Error("no walls");
  return { faces: sceneFaces({ items: view3dItems(doc, "s0", null, new Set(), false), hidden: hiddenWalls(doc, yaw) }), bounds };
}

const place = (opId: string, kind: string, x: number, y: number, extra: Partial<Extract<Command, { type: "placeObject" }>> = {}): Command => ({ type: "placeObject", deck: null, opId, state: "s0", object: { kind }, at: { x, y }, ...extra });
const ANGLES: readonly Angles3d[] = [10, 35, 90].flatMap((tilt) => [225, 45, 300].map((yaw) => ({ yaw, tilt })));

/** The AC-09 drawings, each where a far-to-near painter could misorder. */
function drawings(): [string, ReturnType<typeof roomDoc>][] {
  const loft = withCommands(roomDoc(), { type: "setCeiling", height: 3.05 }, { type: "addDeck", opId: "l", preset: "loft", at: { x: 2, y: 2 }, w: 2.4, d: 2.2 }, place("d", "desk", 2, 2.6), place("w", "wardrobe", 4.5, 3.6));
  const stair = withCommands(roomDoc(), { type: "setCeiling", height: 3.05 }, { type: "addDeck", opId: "k", preset: "loft", at: { x: 1, y: 2 }, w: 1.8, d: 3.6 },
    place("s", "openStair", 1.9 + 0.95, 2, { rotation: 90 }), place("b", "block", 3.1, 2.2));
  const lShape = withCommands(roomDoc(), place("a", "wardrobe", 2, 3.6), place("b", "wardrobe", 3.6, 3.6, { rotation: 0 }), place("c", "drawers", 2.8, 2.6), place("e", "desk", 4.4, 1.2));
  const window = withCommands(roomDoc(), { type: "addWall", opId: "v", from: { at: { x: 3, y: 0 } }, to: { at: { x: 3, y: 4 } } },
    { type: "addOpening", opId: "vw", wall: "v/w0", kind: "window", offset: 1.5 }, place("p", "wardrobe", 4, 2.1, { rotation: 90 }), place("q", "bed", 1.4, 2.6));
  return [["piece under a loft", loft], ["open stair over a box", stair], ["non-convex arrangement", lShape], ["divider with a window", window]];
}

describe("raster3d's depth against a ray caster (AC-09)", () => {
  for (const [label, doc] of drawings()) {
    it(`${label}: every sample away from an edge shows the nearest face's colour, at tilts 10°, 35° and 90°`, () => {
      const wrong: string[] = [];
      let checked = 0;
      for (const angles of ANGLES) {
        const s = scene(doc, angles.yaw);
        const r = check(label, s.faces, s.bounds, angles);
        checked += r.checked;
        wrong.push(...r.wrong);
      }
      expect(checked).toBeGreaterThan(ANGLES.length * 2000);
      expect(wrong.slice(0, 8)).toEqual([]);
    }, 60_000);
  }

  it("a house on wheels, its ground and trailer, at tilt 10° (surroundings step 10)", () => {
    // Low, where the deck's sides and the gap under the house show; on the sample room and on a big L, whose deck shows
    // past its walls in the notch and whose depth range is large. A deck top tied with the floor fails here; a thin
    // deck (2 cm) did not, so its 0.25 m is held by the trailer's own tests.
    const wheels: Command = { type: "setProjectField", key: "surroundings", value: "wheels" };
    const corners: [number, number][] = [[6, 0], [24, 0], [24, 12], [10, 12], [10, 30], [0, 30], [0, 4]]; // round the sample room: a 24 × 30 m L
    const ell = corners.slice(1).map(([x, y], i): Command => {
      const [px, py] = corners[i] ?? [0, 0];
      return { type: "addWall", opId: `ell-${i}`, from: { at: { x: px, y: py } }, to: { at: { x, y } } };
    });
    const docs = [["room", withCommands(roomDoc(), wheels, place("w", "wardrobe", 4.5, 3.6))], ["big L", withCommands(roomDoc(), ...ell, wheels)]] as const;
    const wrong: string[] = [];
    let checked = 0;
    for (const [label, doc] of docs) {
      for (const yaw of [225, 45, 300, 0]) {
        const look = lookScene3d(doc, "s0", { yaw, tilt: 10 });
        if ("refused" in look) throw new Error(look.refused);
        expect(look.faces.filter((f) => f.owner.startsWith("trailer/")).length).toBeGreaterThan(0);
        const r = check(`${label} on wheels`, look.faces, look.bounds, look.angles, look.background);
        checked += r.checked;
        wrong.push(...r.wrong);
      }
    }
    expect(checked).toBeGreaterThan(8 * 1000);
    expect(wrong.slice(0, 8)).toEqual([]);
  }, 120_000);

  it("two interpenetrating boxes show the nearer surface on each side of their intersection", () => {
    const p = (x: number, y: number, z: number): Point3 => ({ x, y, z });
    const box = (owner: string, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, top: string, side: string): Face3d[] => {
      const q = (points: Point3[], color: string): Face3d => ({ points, holes: [], color, owner });
      return [
        q([p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)], top),
        q([p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1)], side),
        q([p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1)], side),
        q([p(x1, y1, z0), p(x0, y1, z0), p(x0, y1, z1), p(x1, y1, z1)], side),
        q([p(x0, y1, z0), p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1)], side),
      ];
    };
    const faces = [...box("tall", 2, 2, 3, 3, 0, 2, "#ff0000", "#aa0000"), ...box("slab", 1, 2.3, 4, 2.7, 0.8, 1.2, "#00ff00", "#00aa00")];
    const bounds: Bounds3 = { min: { x: 0, y: 0 }, max: { x: 6, y: 6 }, top: 2.5 };
    const wrong: string[] = [];
    for (const angles of ANGLES) wrong.push(...check("boxes", faces, bounds, angles).wrong);
    expect(wrong.slice(0, 8)).toEqual([]);
  });
});
