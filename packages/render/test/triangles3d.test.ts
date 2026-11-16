import { describe, expect, it } from "vitest";
import { camera3d, sceneFaces, type Face3d, type PieceItem, type Point3, type Ring, type View3d } from "@fm/editor";
import { LAYOUT3D, triangles3d } from "../src/index";

const VERTEX_FLOATS = LAYOUT3D.face3d.strideFloats;

// The 3D view's triangles (heights.34, real3d.12): every face cut into triangles wound as the face is, from outside, so a
// face toward the camera is counter-clockwise on screen and back-face culling keeps it; each outline as line pairs.

const bounds = { min: { x: 0, y: 0 }, max: { x: 4, y: 4 }, top: 2.5 };

function piece(ring: Ring): PieceItem {
  return { item: "piece", placement: "p/p0", object: "p/o0", objectKind: "block", config: "default", ring, centre: { x: 2, y: 2 }, rotation: 0, w: 1, d: 1, bottom: 0.4, top: 1.2, selected: false };
}
const box = piece([{ x: 1.5, y: 1.5 }, { x: 2.5, y: 1.5 }, { x: 2.5, y: 2.5 }, { x: 1.5, y: 2.5 }]);
const round = piece(Array.from({ length: 24 }, (_, i) => ({ x: 2 + 0.5 * Math.cos((i * Math.PI) / 12), y: 2 + 0.5 * Math.sin((i * Math.PI) / 12) })));

function screenAreas(view: View3d, turn: number): number[] {
  const { fill } = triangles3d(sceneFaces(view), "#000000");
  const cam = camera3d(view.bounds, { yaw: (225 + 90 * turn) % 360, tilt: 35 });
  const areas: number[] = [];
  for (let t = 0; t < fill.length; t += 3 * VERTEX_FLOATS) {
    const [a, b, c] = [0, 1, 2].map((k) => cam.project({ x: fill[t + k * VERTEX_FLOATS] ?? 0, y: fill[t + k * VERTEX_FLOATS + 1] ?? 0, z: fill[t + k * VERTEX_FLOATS + 2] ?? 0 }));
    if (!a || !b || !c) throw new Error("short triangle");
    areas.push((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
  }
  return areas;
}

describe("triangles3d", () => {
  it("a box: four sides and the top, two triangles each; seen from a corner, the top and two sides are counter-clockwise on screen (kept), the other two clockwise (culled), at every turn", () => {
    for (const turn of [0, 1, 2, 3] as const) {
      const areas = screenAreas({ items: [box], bounds, hidden: new Set() }, turn);
      expect(areas).toHaveLength(10);
      expect(areas.filter((a) => a > 0)).toHaveLength(6);
      expect(areas.filter((a) => a < 0)).toHaveLength(4);
    }
  });

  it("a round piece: its top as 22 triangles and 24 sides as two each; the top and the twelve or thirteen sides facing the camera are counter-clockwise", () => {
    const areas = screenAreas({ items: [round], bounds, hidden: new Set() }, 0);
    expect(areas).toHaveLength(22 + 2 * 24);
    const kept = (areas.filter((a) => a > 1e-12).length - 22) / 2;
    expect(kept).toBeGreaterThanOrEqual(11);
    expect(kept).toBeLessThanOrEqual(13);
  });

  it("every triangle's normal agrees with its face's normal, whichever way the face is wound", () => {
    const face = (points: Point3[]): Face3d => ({ points, holes: [], color: "#808080", owner: "f" });
    const p = (x: number, y: number, z: number): Point3 => ({ x, y, z });
    const up = face([p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)]);
    const down = face([...up.points].reverse());
    const wall = face([p(0, 0, 0), p(2, 0, 0), p(2, 0, 2), p(0, 0, 2)]); // faces −y
    const holed: Face3d = { ...face([p(0, 0, 0), p(0, 3, 0), p(0, 3, 2), p(0, 0, 2)]), holes: [[p(0, 1, 0.5), p(0, 2, 0.5), p(0, 2, 1.5), p(0, 1, 1.5)]] }; // faces +x
    for (const [f, want] of [[up, p(0, 0, 1)], [down, p(0, 0, -1)], [wall, p(0, -1, 0)], [holed, p(1, 0, 0)]] as const) {
      const { fill } = triangles3d([f], "#000000");
      expect(fill.length).toBeGreaterThan(0);
      for (let t = 0; t < fill.length; t += 3 * VERTEX_FLOATS) {
        const v = (k: number): Point3 => p(fill[t + k * VERTEX_FLOATS] ?? 0, fill[t + k * VERTEX_FLOATS + 1] ?? 0, fill[t + k * VERTEX_FLOATS + 2] ?? 0);
        const [a, b, c] = [v(0), v(1), v(2)];
        const n = { x: (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y), y: (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z), z: (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) };
        expect(n.x * want.x + n.y * want.y + n.z * want.z).toBeGreaterThan(0);
      }
    }
  });

  it("each face's outline as line pairs, and the face's colour on every vertex", () => {
    const faces = sceneFaces({ items: [box], hidden: new Set() });
    const { fill, edges } = triangles3d(faces, "#000000");
    expect(edges.length / VERTEX_FLOATS).toBe(2 * 20); // five quads, four edges each, two ends each
    const top = fill.slice(-VERTEX_FLOATS * 6);
    for (let v = 0; v < 6; v++) expect(Array.from(top.slice(v * VERTEX_FLOATS + 3, v * VERTEX_FLOATS + 6)).map((c) => Math.round(c * 255))).toEqual([0xf4, 0xf3, 0xf0]);
  });

  it("floor lines become edge pairs with their own colours, before the face's outline in the edge colour (which wins a tie)", () => {
    const p = (x: number, y: number): Point3 => ({ x, y, z: 0 });
    const lines = [{ a: p(0, 0.2), b: p(3, 0.2), color: "#ff0000" }, { a: p(1.2, 0), b: p(1.2, 0.2), color: "#00ff00" }];
    const floor: Face3d = { points: [p(0, 0), p(3, 0), p(3, 2), p(0, 2)], holes: [], color: "#808080", owner: "floor/f1", lines };
    const { edges } = triangles3d([floor], "#000000");
    const vertex = (v: number) => Array.from(edges.slice(v * VERTEX_FLOATS, (v + 1) * VERTEX_FLOATS)).map((c, i) => (i < 3 ? c : Math.round(c * 255)));
    expect(edges.length / VERTEX_FLOATS).toBe(2 * (4 + 2));
    for (let v = 4; v < 12; v++) expect(vertex(v).slice(3)).toEqual([0, 0, 0]); // the outline after the lines
    expect([0, 1, 2, 3].map(vertex)).toEqual([
      [0, 0.2, 0, 255, 0, 0], [3, 0.2, 0, 255, 0, 0],
      [1.2, 0, 0, 0, 255, 0], [1.2, 0.2, 0, 0, 255, 0],
    ].map((v) => v.map((c, i) => (i < 3 ? Math.fround(c) : c))));
  });

  it("a face with outline false draws its triangles and no outline: a floor pattern's shape (shown.12)", () => {
    const p = (x: number, y: number): Point3 => ({ x, y, z: 0.001 });
    const shape: Face3d = { points: [p(0, 0), p(1, 0), p(0, 1)], holes: [], color: "#808080", owner: "floor/f1", outline: false };
    const { fill, edges } = triangles3d([shape], "#000000");
    expect(fill.length / VERTEX_FLOATS).toBe(3);
    expect(edges.length).toBe(0);
  });

  it("a face with outline false still draws its lines, and only them: Grid's lines on the ground's disc (surroundings.16)", () => {
    const p = (x: number, y: number): Point3 => ({ x, y, z: -0.005 });
    const lines = [{ a: p(-3, 1), b: p(3, 1), color: "#a9c4b4" }];
    const disc: Face3d = { points: [p(0, 0), p(1, 0), p(0, 1)], holes: [], color: "#dbeee3", owner: "ground/plate", outline: false, lines };
    const { edges } = triangles3d([disc], "#000000");
    const vertex = (v: number) => Array.from(edges.slice(v * VERTEX_FLOATS, (v + 1) * VERTEX_FLOATS)).map((c, i) => (i < 3 ? c : Math.round(c * 255)));
    expect([0, 1].map(vertex)).toEqual([
      [-3, 1, Math.fround(-0.005), 0xa9, 0xc4, 0xb4], [3, 1, Math.fround(-0.005), 0xa9, 0xc4, 0xb4],
    ]);
    expect(edges.length / VERTEX_FLOATS).toBe(2);
  });
});
