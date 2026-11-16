import { describe, expect, it } from "vitest";
import { execute, unwrap, type Command, type Document } from "@fm/domain";
import { faces3d } from "../../src/view3d/faces";
import { stairFaces } from "../../src/view3d/stair-faces";
import { STYLE_3D } from "../../src/view3d/style";
import { view3dItems } from "../../src/view3d/items";
import type { Face3d, PieceItem } from "../../src/view3d/types";
import { roomDoc } from "../builders";
import { visibleFrom } from "./visible";

// A stair in the 3D view (stairs step 09): stepped blocks, a storage stair's cubby doors on its side, never a cuboid.

const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const loft: Command = { type: "addDeck", opId: "k", preset: "loft", at: { x: 1, y: 2 }, w: 1.8, d: 3.6 };
const stairAt = (x: number, y: number, rotation: number): Command => ({ type: "placeObject", deck: null, opId: "s", state: "s0", object: { kind: "storageStair" }, at: { x, y }, rotation });
/** Its body alone: its handrails have their own tests (handrail-faces.test.ts). */
const pieceOf = (doc: Document): PieceItem => {
  const item = view3dItems(doc, "s0", null, new Set(), false).find((i): i is PieceItem => i.item === "piece");
  if (!item) throw new Error("no piece");
  const body = { ...item };
  delete body.handrails;
  return body;
};
const tops = (faces: readonly Face3d[]): number[] => [...new Set(faces.filter((f) => f.points.every((p) => p.z === f.points[0]?.z) && f.points.length === 4).map((f) => Math.round((f.points[0]?.z ?? 0) * 1000) / 1000))].sort((a, b) => a - b);
const TO_CAMERA = { x: 0.6, y: -0.8 };

describe("a storage stair's faces", () => {
  // Its back edge on the loft's right edge (x 1.9) at (1.9, 2), rising toward −x: 10 risers of 0.215, 9 treads.
  const doc = ok(roomDoc(), loft, stairAt(1.9, 2, 90));

  it("are 9 step blocks whose tops stand at k × 0.215", () => {
    expect(tops(visibleFrom(faces3d(pieceOf(doc)), TO_CAMERA))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => Math.round(k * 0.215 * 1000) / 1000));
  });

  it("put the tallest block at the back edge (x 1.9 side) and the lowest at the front", () => {
    const faces = visibleFrom(faces3d(pieceOf(doc)), TO_CAMERA);
    const topAt = (z: number) => faces.find((f) => f.points.length === 4 && f.points.every((p) => Math.abs(p.z - z) < 1e-9));
    const meanX = (f: Face3d | undefined) => (f ? f.points.reduce((s, p) => s + p.x, 0) / f.points.length : Number.NaN);
    expect(meanX(topAt(9 * 0.215))).toBeLessThan(meanX(topAt(0.215)));
    expect(meanX(topAt(9 * 0.215))).toBeCloseTo(1.9 + 0.2211 / 2, 3);
  });

  it("draw cubby doors, slightly proud of the side facing the camera, on every block", () => {
    const faces = visibleFrom(faces3d(pieceOf(doc)), TO_CAMERA);
    const vertical = faces.filter((f) => new Set(f.points.map((p) => p.z)).size > 1);
    const doors = vertical.filter((f) => f.points.every((p) => Math.abs(p.y - (2 - 0.3 - 0.002)) < 1e-9)); // the −y side, toward the camera
    expect(doors.length).toBeGreaterThanOrEqual(9);
  });

  it("follow the stair's rotation: back edge on the top wall (y 3.9), front toward −y, the tallest block at the back", () => {
    const turned = ok(roomDoc(), stairAt(3, 3.9, 0));
    const faces = visibleFrom(faces3d(pieceOf(turned)), TO_CAMERA);
    const top = faces.find((f) => f.points.length === 4 && f.points.every((p) => Math.abs(p.z - 9 * 0.215) < 1e-9));
    expect(top?.points.map((p) => p.y).sort((a, b) => a - b)).toEqual([3.9 - 1.99 / 9, 3.9 - 1.99 / 9, 3.9, 3.9].map((v) => expect.closeTo(v, 6)));
  });

  it("draws no steps for furniture: a custom box stays one box, and other furniture its parts (parts.01, parts.09)", () => {
    const box = ok(roomDoc(), { type: "placeObject", deck: null, opId: "d", state: "s0", object: { kind: "block" }, at: { x: 3, y: 2 } });
    expect(tops(visibleFrom(faces3d(pieceOf(box)), TO_CAMERA))).toHaveLength(1);
    expect(stairFaces("piece/d/p0", pieceOf(box), STYLE_3D.stair, STYLE_3D.glass)).toBeNull();
  });
});
