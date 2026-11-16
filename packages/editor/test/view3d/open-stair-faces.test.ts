import { describe, expect, it } from "vitest";
import { execute, unwrap, type Command, type Document } from "@fm/domain";
import { faces3d } from "../../src/view3d/faces";
import { view3dItems } from "../../src/view3d/items";
import type { Face3d, PieceItem } from "../../src/view3d/types";
import { roomDoc } from "../builders";
import { visibleFrom } from "./visible";

// The stair and the open stair in the 3D view (stairs step 11): the stair is stepped blocks like the storage stair; the
// open stair is two side boards, sloped with the pitch line and 0.23 deep below it, with thin open treads between them
// and nothing underneath.

const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const loft: Command = { type: "addDeck", opId: "k", preset: "loft", at: { x: 1, y: 2 }, w: 1.8, d: 3.6 };
/** Its back edge on the loft's right edge (x 1.9) at (1.9, 2), rising toward −x: 12 risers of 0.1792, 11 treads of 0.2718; the front at x 4.89. */
const stairAt = (kind: string): Command => ({ type: "placeObject", deck: null, opId: "s", state: "s0", object: { kind }, at: { x: 1.9, y: 2 }, rotation: 90 });
/** Its body alone: its handrails have their own tests (handrail-faces.test.ts). */
const pieceOf = (doc: Document): PieceItem => {
  const item = view3dItems(doc, "s0", null, new Set(), false).find((i): i is PieceItem => i.item === "piece");
  if (!item) throw new Error("no piece");
  const body = { ...item };
  delete body.handrails;
  return body;
};
const flat = (f: Face3d): boolean => f.points.every((p) => Math.abs(p.z - (f.points[0]?.z ?? 0)) < 1e-9);
const round = (v: number): number => Math.round(v * 1000) / 1000;
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
const flatTops = (faces: readonly Face3d[]): number[] => [...new Set(faces.filter(flat).map((f) => round(f.points[0]?.z ?? 0)))].sort((a, b) => a - b);
const TO_CAMERA = { x: 0.6, y: -0.8 };
const RISER = 2.15 / 12;
const GOING = 2.99 / 11;

describe("a stair's faces", () => {
  it("are 11 step blocks whose tops stand at k × 0.179, like the storage stair's", () => {
    const faces = visibleFrom(faces3d(pieceOf(ok(roomDoc(), loft, stairAt("stair")))), TO_CAMERA);
    expect(flatTops(faces)).toEqual(Array.from({ length: 11 }, (_, i) => round((i + 1) * RISER)));
  });
});

describe("an open stair's faces", () => {
  const doc = ok(roomDoc(), loft, stairAt("openStair"));
  const faces = visibleFrom(faces3d(pieceOf(doc)), TO_CAMERA);

  it("have thin treads at k × riser: flat tops at k × 0.179, 0.035 deep", () => {
    const tops = Array.from({ length: 11 }, (_, i) => round((i + 1) * RISER));
    expect(flatTops(faces).filter((z) => tops.includes(z))).toEqual(tops);
    // Each tread is a thin block: its sides span 0.035 below its top.
    for (let k = 1; k <= 11; k++) {
      const top = k * RISER;
      const sides = faces.filter((f) => !flat(f) && f.points.every((p) => near(p.z, top) || near(p.z, top - 0.035)));
      expect(sides.length, `tread ${k}`).toBeGreaterThan(0);
    }
  });

  it("have no block reaching the floor under the high end", () => {
    // Under the high end (x 1.9–2.5), nothing comes down to the floor: the boards' underside there is far above it.
    const high = faces.filter((f) => f.points.every((p) => p.x < 2.5 + 1e-9));
    expect(high.length).toBeGreaterThan(0);
    expect(Math.min(...high.flatMap((f) => f.points.map((p) => p.z)))).toBeGreaterThan(1.5);
  });

  it("have side boards along both long sides, their top on the pitch line and 0.23 deep below it", () => {
    // The boards' outer faces: vertical, at y 2 ± 0.45, toward the camera only the −y one (y 1.55).
    const outer = faces.filter((f) => f.points.length >= 4 && f.points.every((p) => Math.abs(p.y - 1.55) < 1e-9));
    expect(outer).toHaveLength(1);
    const pts = outer[0]?.points ?? [];
    // At the back edge (x 1.9) the board runs from the top (2.15) down to 2.15 − 0.23.
    const atBack = pts.filter((p) => Math.abs(p.x - 1.9) < 1e-9).map((p) => round(p.z)).sort((a, b) => a - b);
    expect(atBack).toEqual([round(2.15 - 0.23), 2.15]);
    // At the front edge (x 4.89) it stands on the floor up to the first riser.
    const atFront = pts.filter((p) => Math.abs(p.x - 4.89) < 1e-9).map((p) => round(p.z)).sort((a, b) => a - b);
    expect(atFront).toEqual([0, round(RISER)]);
    // Its underside meets the floor where the pitch line is 0.23 up: (0.23 − riser) × going / riser from the front.
    const meets = 4.89 - ((0.23 - RISER) * GOING) / RISER;
    expect(pts.some((p) => Math.abs(p.x - meets) < 1e-6 && Math.abs(p.z) < 1e-9)).toBe(true);
  });

  it("show both side boards and the treads between them, in any order (the depth buffer sorts them, real3d.09)", () => {
    const owners: string[] = faces.map((f) => (f.points.every((p) => p.y >= 2.45 - 0.04 - 1e-9) ? "far" : f.points.every((p) => p.y <= 1.55 + 0.04 + 1e-9) ? "near" : "tread"));
    for (const k of ["far", "near", "tread"]) expect(owners, k).toContain(k);
  });
});
