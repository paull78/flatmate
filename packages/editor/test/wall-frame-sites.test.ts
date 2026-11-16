import { describe, expect, it } from "vitest";
import { emptyDocument, hitCandidates, levelOf, sortedIds, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import type { Camera } from "../src/camera";
import { contactPlace } from "../src/snapping/contact";
import { faceSegments } from "../src/snapping/dimension-policies";
import { nearWalls } from "../src/snapping/near-walls";
import { helperLabelAt } from "../src/view/helper";
import { ON_FLOOR } from "./builders";

// Characterization of the editor sites that read a wall's frame (tidy step 11, AC-15): the Dimension tool's face
// segments, nearWalls, the corner snap and the helper's placement on slanted walls, mixed thicknesses, a T divider,
// holes and a clockwise room, captured before the sites switched to `wallFrame` and `faceExtent` and compared exactly
// (deep equality, −0 included), so a change in the arithmetic or in the order of the faces shows.

type JointRow = [id: string, x: number, y: number];
type WallRow = [id: string, a: string, b: string, thickness: number];
function docOf(joints: JointRow[], walls: WallRow[]): Document {
  const doc = emptyDocument();
  for (const [id, x, y] of joints) doc.joints[id] = { id, x, y };
  for (const [id, a, b, thickness] of walls) doc.walls[id] = { id, a, b, thickness, top: "ceiling", base: "floor", column: false };
  return doc;
}
/** Closed rectangles, each joints `${p}j1..4` from (x0, y0) counter-clockwise and walls `${p}1..4`. */
function loops(rects: [p: string, x0: number, y0: number, x1: number, y1: number, thickness: number][]): [JointRow[], WallRow[]] {
  const joints: JointRow[] = [];
  const walls: WallRow[] = [];
  for (const [p, x0, y0, x1, y1, t] of rects) {
    joints.push([`${p}j1`, x0, y0], [`${p}j2`, x1, y0], [`${p}j3`, x1, y1], [`${p}j4`, x0, y1]);
    for (let i = 1; i <= 4; i++) walls.push([`${p}${i}`, `${p}j${i}`, `${p}j${(i % 4) + 1}`, t]);
  }
  return [joints, walls];
}
/** The 4 × 3 room with a 0.30 bottom wall split by a 0.10 T divider at x = 2, and a free slanted 0.15 wall F outside. */
const FIX = docOf(
  [["J1", 0, 0], ["J2", 4, 0], ["J3", 4, 3], ["J4", 0, 3], ["J5", 2, 0], ["J6", 2, 3], ["K1", 6, 0], ["K2", 7.5, 1.3]],
  [["W1a", "J1", "J5", 0.3], ["W1b", "J5", "J2", 0.3], ["W2", "J2", "J3", 0.2], ["W3a", "J3", "J6", 0.2], ["W3b", "J6", "J4", 0.2], ["W4", "J4", "J1", 0.2], ["W5", "J5", "J6", 0.1], ["F", "K1", "K2", 0.15]],
);
/** The domain's hole fixtures: apartment A (10 × 8 m), core C (3 × 3 m) in it, column K (0.6 × 0.6 m, 0.10 walls) in the core. */
const HOLES = docOf(...loops([["A", 0, 0, 10, 8, 0.2], ["C", 3.5, 2.5, 6.5, 5.5, 0.2], ["K", 4.7, 3.7, 5.3, 4.3, 0.1]]));
/** A 3 × 2 room drawn clockwise, so each wall's room lies on its right; W3 is 0.25 thick. */
const CW = docOf([["J1", 0, 0], ["J2", 3, 0], ["J3", 3, 2], ["J4", 0, 2]], [["W1", "J1", "J4", 0.2], ["W2", "J4", "J3", 0.2], ["W3", "J3", "J2", 0.25], ["W4", "J2", "J1", 0.2]]);
/** FIX with a door on W2, so its helper sits beyond a chain row. */
const FIX_DOOR: Document = { ...FIX, openings: { d: { id: "d", wall: "W2", kind: "swing", offset: 1, width: 0.8, side: "left", hinge: "a", glazed: false, sill: 0, head: 2.1 } } };

const square = (c: Point, h: number): Point[] => [{ x: c.x - h, y: c.y - h }, { x: c.x + h, y: c.y - h }, { x: c.x + h, y: c.y + h }, { x: c.x - h, y: c.y + h }];
const near = (doc: Document, c: Point, h: number, reach?: number) => nearWalls(doc, square(c, h), c, reach);
const corner = (doc: Document, kind: string, s: number, centre: Point, start: number) =>
  contactPlace(doc, "s0", { w: s, d: s }, centre, start, { tolerance: 0.125, free: false, ignore: [], riser: null, heights: ON_FLOOR, surface: null, land: false, level: levelOf(doc, null), kind });
const camera: Camera = { center: { x: 3, y: 2 }, zoom: 80, viewport: { width: 1200, height: 800 }, dpr: 1 };
const labels = (doc: Document) => Object.fromEntries(sortedIds(doc.walls).map((id) => [id, helperLabelAt(doc, id, camera)]));

function capture() {
  return {
    faces: { fix: faceSegments(FIX), holes: faceSegments(HOLES), cw: faceSegments(CW) },
    near: [
      near(FIX, { x: 7.55, y: 1.35 }, 0.01, 0.3), // diagonally past F's free end K2
      near(FIX, { x: 2.1, y: 1.5 }, 0.02),
      near(FIX, { x: 1, y: 0 }, 0.2),
      near(FIX, { x: 6.6, y: 0.3 }, 0.05),
      near(FIX, { x: 0.25, y: 0.3 }, 0.1),
      near(HOLES, { x: 5, y: 3.55 }, 0.05),
      near(CW, { x: 2.8, y: 1.8 }, 0.05),
    ],
    corners: [
      corner(FIX, "cornerShower", 0.8, { x: 0.53, y: 0.58 }, 0),
      corner(FIX, "cornerShower", 0.8, { x: 1.52, y: 0.58 }, 90),
      corner(FIX, "cornerBasin", 0.45, { x: 3.65, y: 0.4 }, 180),
      corner(FIX, "cornerBasin", 0.45, { x: 2.3, y: 2.65 }, 270),
      corner(HOLES, "cornerBlock", 0.6, { x: 3.95, y: 2.95 }, 0),
      corner(CW, "cornerShower", 0.8, { x: 2.45, y: 1.47 }, 0),
    ],
    labels: { fix: labels(FIX_DOOR), holes: labels(HOLES), cw: labels(CW) },
  };
}

describe("wall frame sites (characterization, AC-15)", () => {
  it("faceSegments, nearWalls, the corner snap and helperLabelAt give the captured values", () => {
    expect(capture()).toEqual(GOLDEN);
  });

  it("nearWalls and hitCandidates keep the rounded end: a probe 0.07 m diagonally past a free wall's end is 18 mm into it and hits it", () => {
    const c = { x: 7.55, y: 1.35 }; // F's free end K2 (7.5, 1.3) plus 0.05 on both axes; F's flat-ended body stops short of it
    const f = near(FIX, c, 0.01, 0.3).find((n) => n.wallId === "F");
    expect(f?.distance).toBeCloseTo(-0.018431, 6);
    expect(hitCandidates(FIX, c, 0.02).some((e) => e.id === "F")).toBe(true);
  });
});

// Captured from the code before tidy step 11.
const GOLDEN = {
  faces: {
    fix: [
      {
        wall: "F",
        start: { x: 5.950880209618662, y: 0.05667668120923623 },
        dir: { x: 0.7556890827898175, y: 0.6549305384178419 },
        length: 1.9849433241279208,
      },
      {
        wall: "F",
        start: { x: 6.049119790381338, y: -0.05667668120923623 },
        dir: { x: 0.7556890827898175, y: 0.6549305384178419 },
        length: 1.9849433241279206,
      },
      { wall: "W1a", start: { x: 0.1, y: 0.15 }, dir: { x: 1, y: 0 }, length: 1.8499999999999999 },
      { wall: "W1a", start: { x: -0.1, y: -0.15 }, dir: { x: 1, y: 0 }, length: 2.1 },
      { wall: "W1b", start: { x: 2.05, y: 0.15 }, dir: { x: 1, y: 0 }, length: 1.85 },
      { wall: "W1b", start: { x: 2, y: -0.15 }, dir: { x: 1, y: 0 }, length: 2.0999999999999996 },
      { wall: "W2", start: { x: 3.9, y: 0.15 }, dir: { x: 0, y: 1 }, length: 2.75 },
      { wall: "W2", start: { x: 4.1, y: -0.15 }, dir: { x: 0, y: 1 }, length: 3.25 },
      { wall: "W3a", start: { x: 3.9, y: 2.9 }, dir: { x: -1, y: 0 }, length: 1.85 },
      { wall: "W3a", start: { x: 4.1, y: 3.1 }, dir: { x: -1, y: 0 }, length: 2.0999999999999996 },
      { wall: "W3b", start: { x: 1.95, y: 2.9 }, dir: { x: -1, y: 0 }, length: 1.8499999999999999 },
      { wall: "W3b", start: { x: 2, y: 3.1 }, dir: { x: -1, y: 0 }, length: 2.1 },
      { wall: "W4", start: { x: 0.1, y: 2.9 }, dir: { x: 0, y: -1 }, length: 2.75 },
      { wall: "W4", start: { x: -0.1, y: 3.1 }, dir: { x: 0, y: -1 }, length: 3.25 },
      { wall: "W5", start: { x: 1.95, y: 0.15 }, dir: { x: 0, y: 1 }, length: 2.75 },
      { wall: "W5", start: { x: 2.05, y: 0.15 }, dir: { x: 0, y: 1 }, length: 2.75 },
    ],
    holes: [
      { wall: "A1", start: { x: 0.1, y: 0.1 }, dir: { x: 1, y: 0 }, length: 9.8 },
      { wall: "A1", start: { x: -0.1, y: -0.1 }, dir: { x: 1, y: 0 }, length: 10.2 },
      { wall: "A2", start: { x: 9.9, y: 0.1 }, dir: { x: 0, y: 1 }, length: 7.800000000000001 },
      { wall: "A2", start: { x: 10.1, y: -0.1 }, dir: { x: 0, y: 1 }, length: 8.2 },
      { wall: "A3", start: { x: 9.9, y: 7.9 }, dir: { x: -1, y: 0 }, length: 9.8 },
      { wall: "A3", start: { x: 10.1, y: 8.1 }, dir: { x: -1, y: 0 }, length: 10.2 },
      { wall: "A4", start: { x: 0.1, y: 7.9 }, dir: { x: 0, y: -1 }, length: 7.800000000000001 },
      { wall: "A4", start: { x: -0.1, y: 8.1 }, dir: { x: 0, y: -1 }, length: 8.2 },
      { wall: "C1", start: { x: 3.6, y: 2.6 }, dir: { x: 1, y: 0 }, length: 2.8000000000000003 },
      { wall: "C1", start: { x: 3.4, y: 2.4 }, dir: { x: 1, y: 0 }, length: 3.1999999999999997 },
      { wall: "C2", start: { x: 6.4, y: 2.6 }, dir: { x: 0, y: 1 }, length: 2.8000000000000003 },
      { wall: "C2", start: { x: 6.6, y: 2.4 }, dir: { x: 0, y: 1 }, length: 3.1999999999999997 },
      { wall: "C3", start: { x: 6.4, y: 5.4 }, dir: { x: -1, y: 0 }, length: 2.8000000000000003 },
      { wall: "C3", start: { x: 6.6, y: 5.6 }, dir: { x: -1, y: 0 }, length: 3.1999999999999997 },
      { wall: "C4", start: { x: 3.6, y: 5.4 }, dir: { x: 0, y: -1 }, length: 2.8000000000000003 },
      { wall: "C4", start: { x: 3.4, y: 5.6 }, dir: { x: 0, y: -1 }, length: 3.1999999999999997 },
      { wall: "K1", start: { x: 4.75, y: 3.75 }, dir: { x: 1, y: 0 }, length: 0.5 },
      { wall: "K1", start: { x: 4.65, y: 3.6500000000000004 }, dir: { x: 1, y: 0 }, length: 0.6999999999999993 },
      { wall: "K2", start: { x: 5.25, y: 3.75 }, dir: { x: 0, y: 1 }, length: 0.5 },
      { wall: "K2", start: { x: 5.35, y: 3.6500000000000004 }, dir: { x: 0, y: 1 }, length: 0.6999999999999993 },
      { wall: "K3", start: { x: 5.25, y: 4.25 }, dir: { x: -1, y: 0 }, length: 0.5 },
      { wall: "K3", start: { x: 5.35, y: 4.35 }, dir: { x: -1, y: 0 }, length: 0.6999999999999993 },
      { wall: "K4", start: { x: 4.75, y: 4.25 }, dir: { x: 0, y: -1 }, length: 0.5 },
      { wall: "K4", start: { x: 4.65, y: 4.35 }, dir: { x: 0, y: -1 }, length: 0.6999999999999993 },
    ],
    cw: [
      { wall: "W1", start: { x: -0.1, y: -0.1 }, dir: { x: 0, y: 1 }, length: 2.2 },
      { wall: "W1", start: { x: 0.1, y: 0.1 }, dir: { x: 0, y: 1 }, length: 1.7999999999999998 },
      { wall: "W2", start: { x: -0.1, y: 2.1 }, dir: { x: 1, y: 0 }, length: 3.225 },
      { wall: "W2", start: { x: 0.1, y: 1.9 }, dir: { x: 1, y: 0 }, length: 2.775 },
      { wall: "W3", start: { x: 3.125, y: 2.1 }, dir: { x: 0, y: -1 }, length: 2.2 },
      { wall: "W3", start: { x: 2.875, y: 1.9 }, dir: { x: 0, y: -1 }, length: 1.7999999999999998 },
      { wall: "W4", start: { x: 3.125, y: -0.1 }, dir: { x: -1, y: 0 }, length: 3.225 },
      { wall: "W4", start: { x: 2.875, y: 0.1 }, dir: { x: -1, y: 0 }, length: 2.775 },
    ],
  },
  near: [
    [{ wallId: "F", distance: -0.01843145750507614, angleDeg: 41, away: { x: -0.6549305384178419, y: 0.7556890827898175 } }],
    [{ wallId: "W5", distance: 0.03000000000000007, angleDeg: 90, away: { x: 1, y: 0 } }],
    [{ wallId: "W1a", distance: -0.15, angleDeg: 0, away: { x: 0, y: 1 } }],
    [{ wallId: "F", distance: 0.02072061715337692, angleDeg: 41, away: { x: 0.6549305384178419, y: -0.7556890827898175 } }],
    [
      { wallId: "W1a", distance: 0.04999999999999999, angleDeg: 0, away: { x: 0, y: 1 } },
      { wallId: "W4", distance: 0.04999999999999999, angleDeg: 270, away: { x: 1, y: 0 } },
    ],
    [{ wallId: "K1", distance: 0.05000000000000053, angleDeg: 0, away: { x: 0, y: -1 } }],
    [
      { wallId: "W3", distance: 0.025000000000000355, angleDeg: 270, away: { x: -1, y: 0 } },
      { wallId: "W2", distance: 0.049999999999999906, angleDeg: 0, away: { x: 0, y: -1 } },
    ],
  ],
  corners: [
    { at: { x: 0.1, y: 0.55 }, rotation: 90, flushWalls: ["W4", "W1a"] },
    { at: { x: 1.55, y: 0.15 }, rotation: 180, flushWalls: ["W1a", "W5"] },
    { at: { x: 3.675, y: 0.15 }, rotation: 180, flushWalls: ["W1b", "W2"] },
    { at: { x: 2.275, y: 2.9 }, rotation: 0, flushWalls: ["W3a", "W5"] },
    { at: { x: 3.6, y: 2.9 }, rotation: 90, flushWalls: ["C4", "C1"] },
    { at: { x: 2.875, y: 1.5 }, rotation: 270, flushWalls: ["W3", "W2"] },
  ],
  labels: {
    fix: {
      F: { x: 6.553520838474647, y: 0.8767067248369451 },
      W1a: { x: 1.025, y: 0.375 },
      W1b: { x: 2.9749999999999996, y: 0.375 },
      W2: { x: 3.1384155273437497, y: 1.525 }, // re-captured at render step 08: the chain row's "00.00" plate is Inter-wide (30.93 px, was 33)
      W3a: { x: 2.9749999999999996, y: 2.675 },
      W3b: { x: 1.025, y: 2.675 },
      W4: { x: 0.325, y: 1.525 },
      W5: { x: 1.7249999999999999, y: 1.525 },
    },
    holes: {
      A1: { x: 5, y: 0.325 },
      A2: { x: 9.675, y: 4 },
      A3: { x: 5, y: 7.675000000000001 },
      A4: { x: 0.325, y: 4 },
      C1: { x: 5, y: 2.825 },
      C2: { x: 6.175000000000001, y: 4 },
      C3: { x: 5, y: 5.175000000000001 },
      C4: { x: 3.825, y: 4 },
      K1: { x: 5, y: 3.975 },
      K2: { x: 5.025, y: 4 },
      K3: { x: 5, y: 4.025 },
      K4: { x: 4.975, y: 4 },
    },
    cw: { W1: { x: 0.325, y: 1 }, W2: { x: 1.4875, y: 1.6749999999999998 }, W3: { x: 2.65, y: 1 }, W4: { x: 1.4875, y: 0.325 } },
  },
};
