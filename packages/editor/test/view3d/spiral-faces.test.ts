import { describe, expect, it } from "vitest";
import { execute, unwrap, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { faces3d } from "../../src/view3d/faces";
import { sceneFaces } from "../../src/view3d/scene-faces";
import { view3dItems } from "../../src/view3d/items";
import type { Face3d, PieceItem } from "../../src/view3d/types";
import { roomDoc } from "../builders";
import { visibleFrom } from "./visible";

// A spiral in the 3D view (stairs.21, AC-09, AC-10): thin wedge treads of 30° on a 0.13 column, rising clockwise to its
// back edge, never a cuboid. Its back edge on the loft's right edge (x 1.9) at (1.9, 2), turned 90° (rising toward −x):
// x 1.9–3.5, y 1.2–2.8, centre (2.7, 2); 10 risers of 0.215, 9 treads. Turned 90°, tread k covers the world angles
// [180 + (9 − k) × 30, 180 + (10 − k) × 30]: the first [60, 90], the last [180, 210], ending toward the loft.

const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const loft: Command = { type: "addDeck", opId: "k", preset: "loft", at: { x: 1, y: 2 }, w: 1.8, d: 3.6 };
const spiralAt = (x: number, y: number, rotation: number): Command => ({ type: "placeObject", deck: null, opId: "s", state: "s0", object: { kind: "spiralStair" }, at: { x, y }, rotation });
const pieceOf = (doc: Document): PieceItem => {
  const item = view3dItems(doc, "s0", null, new Set(), false).find((i): i is PieceItem => i.item === "piece");
  if (!item) throw new Error("no piece");
  return item;
};
const C: Point = { x: 2.7, y: 2 };
const TO_CAMERA = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };
const flat = (f: Face3d): boolean => f.points.every((p) => Math.abs(p.z - (f.points[0]?.z ?? 0)) < 1e-9);
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const angleOf = (p: Point): number => ((Math.atan2(p.y - C.y, p.x - C.x) * 180) / Math.PI + 360) % 360;
const dist = (p: Point): number => Math.hypot(p.x - C.x, p.y - C.y);
/** The wedge tops: flat faces reaching the outer circle and not past it (the landing's corner lies at 0.8 √2). */
const wedgeTops = (faces: readonly Face3d[]) => faces.filter((f) => flat(f) && f.points.some((p) => Math.abs(dist(p) - 0.8) < 1e-6) && f.points.every((p) => dist(p) < 0.8 + 1e-6));

describe("a spiral's faces", () => {
  const doc = ok(roomDoc(), loft, spiralAt(1.9, 2, 90));
  const faces = visibleFrom(faces3d(pieceOf(doc)), TO_CAMERA);

  it("are wedges whose tops stand at k × 0.215, 0.04 thick, between the column and the circle", () => {
    const tops = wedgeTops(faces);
    expect([...new Set(tops.map((f) => r3(f.points[0]?.z ?? 0)))].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => r3(k * 0.215)));
    for (const f of tops) for (const p of f.points) expect(dist(p)).toBeGreaterThanOrEqual(0.065 - 1e-9);
    const sides = faces.filter((f) => !flat(f) && f.points.some((p) => dist(p) > 0.07));
    const lowest = Math.min(...sides.map((f) => Math.min(...f.points.map((p) => p.z))));
    expect(lowest).toBeCloseTo(0.215 - 0.04, 9);
  });

  it("rise clockwise: the first tread at world 60–90°, the last at 180–210°, ending toward the back edge and the loft", () => {
    /** Tread k's top points out from the column, as signed degrees from the middle of its expected span. */
    const offsets = (k: number): number[] => {
      const mid = 180 + (9 - k) * 30 + 15;
      const pts = wedgeTops(faces).filter((f) => Math.abs((f.points[0]?.z ?? 0) - k * 0.215) < 1e-9).flatMap((f) => f.points).filter((p) => dist(p) > 0.1);
      return pts.map((p) => ((angleOf(p) - mid + 540) % 360) - 180);
    };
    for (let k = 1; k <= 9; k++) {
      const o = offsets(k);
      expect([Math.min(...o), Math.max(...o)], `tread ${k}`).toEqual([expect.closeTo(-15, 6), expect.closeTo(15, 6)]);
    }
  });

  it("stand on a column from the floor to the loft's top, inside the 0.13 circle", () => {
    const bare = { ...pieceOf(doc) };
    delete bare.spiralRails; // a landing rail's end post stands inside the column, up to the ceiling here
    const column = visibleFrom(faces3d(bare), TO_CAMERA).filter((f) => f.points.every((p) => dist(p) <= 0.065 + 1e-9));
    expect(column.length).toBeGreaterThan(0);
    expect(Math.min(...column.flatMap((f) => f.points.map((p) => p.z)))).toBe(0);
    expect(Math.max(...column.flatMap((f) => f.points.map((p) => p.z)))).toBeCloseTo(2.15, 9);
  });

  it("are one owner's, never the box", () => {
    expect(new Set(faces.map((f) => f.owner)).size).toBe(1);
    expect(faces.length).toBeGreaterThan(30);
  });
});

// The top landing (edge-catch.06, .11, AC-06): a slab 0.04 thick under the stair's top over the quarter its treads
// leave open. Turned 90°, footprint right (0°) is world +y and back (90°) world −x: x 1.9–2.7, y 2.0–2.8.
describe("a spiral's landing (AC-06)", () => {
  const doc = ok(roomDoc(), loft, spiralAt(1.9, 2, 90));
  const square: Point[] = [{ x: 2.7, y: 2 }, { x: 2.7, y: 2.8 }, { x: 1.9, y: 2.8 }, { x: 1.9, y: 2 }];
  const isSquare = (f: Face3d): boolean =>
    f.points.length === 4 && square.every((c) => f.points.some((p) => Math.abs(p.x - c.x) < 1e-9 && Math.abs(p.y - c.y) < 1e-9));
  const slab = (faces: readonly Face3d[]) => faces.filter((f) => flat(f) && isSquare(f)).map((f) => r3(f.points[0]?.z ?? NaN)).sort((a, b) => a - b);

  it("is a slab from 2.11 to 2.15 whose outline is the back-right quarter of the box", () => {
    expect(slab(faces3d(pieceOf(doc)))).toEqual([2.15]); // its top; like a tread's, a prism has no bottom face
    // Its four sides stand from 2.11 to 2.15 on the square's edges.
    const sides = faces3d(pieceOf(doc)).filter((f) => !flat(f) && f.points.every((p) => square.some((c) => Math.abs(p.x - c.x) < 1e-9 && Math.abs(p.y - c.y) < 1e-9)));
    expect(sides).toHaveLength(4);
    for (const f of sides) expect([...new Set(f.points.map((p) => r3(p.z)))].sort()).toEqual([2.11, 2.15]);
  });

  it("reaches look's and the panel's one face list", () => {
    expect(slab(sceneFaces({ items: view3dItems(doc, "s0", null, new Set(), false), hidden: new Set() }))).toEqual([2.15]);
  });
});

