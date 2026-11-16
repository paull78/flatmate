import { describe, expect, it } from "vitest";
import { CANVAS_STYLE, floorView, planPicture, type Primitive } from "@fm/editor";
import { donutDoc, roomDoc, withCommands } from "@fm/editor/testing";
import type { Point } from "@fm/protocol";
import { LAYOUT } from "../src/index";
import { newRecords, pushPolygon } from "../src/records";

// AC-04's earcut check (finishes.13, step 10): cement tiles' clipped shapes are drawn even-odd by Canvas2D, SVG and the
// PDF, and through earcut by WebGL and WebGPU. A split ring's zero-area bridge must not make earcut cover more or less
// than the even-odd area. (Clipped holes did: a hole clipped to a shape shares its vertices and edges with the clipped
// ring, and earcut covered up to twice the area, so shapes meeting a hole are dropped.) The editor doesn't depend on
// @fm/render, so the check lives here, on the floors layer built through @fm/editor's entry.

type Polygon = Extract<Primitive, { kind: "polygon" }>;
type Doc = ReturnType<typeof roomDoc>;

const shoelace = (ring: readonly Point[]): number =>
  ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length] ?? p;
    return sum + (p.x * q.y - q.x * p.y) / 2;
  }, 0);
const perimeter = (ring: readonly Point[]): number =>
  ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length] ?? p;
    return sum + Math.hypot(q.x - p.x, q.y - p.y);
  }, 0);

/** Whether a vertex lies on a non-adjacent edge: the ring is split, its pieces joined by a zero-area bridge. */
function split(ring: readonly Point[]): boolean {
  const n = ring.length;
  return ring.some((v, i) => ring.some((a, j) => {
    const b = ring[(j + 1) % n] ?? a;
    if (j === i || (j + 1) % n === i) return false;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const t = ((v.x - a.x) * (b.x - a.x) + (v.y - a.y) * (b.y - a.y)) / (len * len);
    const off = Math.abs((b.x - a.x) * (v.y - a.y) - (b.y - a.y) * (v.x - a.x)) / len;
    return len > 0 && t > 1e-9 && t < 1 - 1e-9 && off < 1e-9;
  }));
}

/** The even-odd area of a ring less its holes (the holes lie inside it, apart from each other). */
const evenOdd = (p: Polygon): number => Math.abs(shoelace(p.points)) - p.holes.reduce((s, h) => s + Math.abs(shoelace(h)), 0);

/** The area of the triangles the WebGL path (records.ts, earcut) builds for one polygon, from its float32 records. */
function earcutArea(p: Polygon): number {
  const out = newRecords("polygon");
  pushPolygon(out, p, () => [0, 0, 0, 1]);
  const stride = LAYOUT.polygon.strideFloats;
  const v = (k: number): Point => ({ x: out.floats[k * stride] ?? NaN, y: out.floats[k * stride + 1] ?? NaN });
  let area = 0;
  for (let k = 0; k + 2 < out.length / stride; k += 3) area += Math.abs(shoelace([v(k), v(k + 1), v(k + 2)]));
  return area;
}

const cement = (size: number, angle: number) => ({ motif: "cementTiles", colour: "#e3d9c6", strength: 70, size, angle });

/**
 * An L room: 5 × 4 less its top-right corner. Its clear floor's inner corner (2.45, 1.85) lies 0.05 off the 0.20 tiles'
 * centre diamond at (2.5, 1.9) (half-diagonal 0.07), so the corner splits that diamond into two tips.
 */
function ellDoc(): Doc {
  const pts = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 1.95 }, { x: 2.55, y: 1.95 }, { x: 2.55, y: 4 }, { x: 0, y: 4 }];
  return withCommands(roomDocEmpty(), ...pts.map((p, i) => ({ type: "addWall" as const, opId: `l${i}`, from: { at: p }, to: { at: pts[(i + 1) % pts.length] ?? p } })));
}

/** roomDoc's empty start: the sample room with its walls deleted would be more work than starting from nothing. */
function roomDocEmpty(): Doc {
  const doc = roomDoc();
  return { ...doc, joints: {}, walls: {} };
}

/** Each test room, labelled at `at` with the cement finish. */
const ROOMS: { name: string; doc: () => Doc; at: Point }[] = [
  {
    name: "room with two columns",
    doc: () => withCommands(roomDoc(),
      { type: "placeColumn", opId: "c1", at: { x: 2.03, y: 1.97 }, width: 0.3, depth: 0.3 },
      { type: "placeColumn", opId: "c2", at: { x: 4.1, y: 2.6 }, width: 0.4, depth: 0.25, rotation: 30 }),
    at: { x: 1, y: 1 },
  },
  { name: "L room", doc: ellDoc, at: { x: 1, y: 1 } },
  { name: "room with a stair core", doc: donutDoc, at: { x: 1, y: 1 } },
];

describe("cement tiles through earcut (AC-04)", () => {
  it("every floors polygon's earcut triangles cover its even-odd area within 0.1 %", () => {
    const failures: string[] = [];
    let shapes = 0;
    let bridged = 0; // shapes the floor's inner corner split in two, joined by a zero-area bridge
    for (const room of ROOMS) {
      for (const size of [0.15, 0.2, 0.4]) {
        for (const angle of [0, 30, 45, 90]) {
          const doc = withCommands(room.doc(), { type: "labelZone", id: "L1", at: room.at, name: "Floor", finish: cement(size, angle) });
          const floors = planPicture(doc, floorView(doc, null), CANVAS_STYLE, 200, true).floors;
          const polygons = floors.filter((p): p is Polygon => p.kind === "polygon");
          shapes += polygons.length - 1; // the first is the room's colour, with the columns or the core as holes
          expect(polygons[0]?.holes.length, room.name).toBe(room.name === "L room" ? 0 : room.name === "room with a stair core" ? 1 : 2);
          for (const p of polygons.slice(1)) {
            expect(p.holes).toEqual([]);
            if (split(p.points)) bridged++;
          }
          for (const p of polygons) {
            const want = evenOdd(p);
            const got = earcutArea(p);
            // Records snap to 1 µm and store float32: a vertex moves under a micrometre, so tiny pieces get that slack.
            const slack = [p.points, ...p.holes].reduce((s, r) => s + perimeter(r), 0) * 1e-6;
            const off = Math.abs(got - want);
            if (off > 1e-3 * want + slack) failures.push(`${room.name} ${size} ${angle}°: earcut ${got} vs even-odd ${want} | ${JSON.stringify(p)}`);
          }
        }
      }
    }
    expect(failures.slice(0, 3)).toEqual([]);
    expect(shapes).toBeGreaterThan(5000);
    expect(bridged).toBeGreaterThan(0); // the L's inner corner splits some diamonds: bridges reach earcut
  });
});
