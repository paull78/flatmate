import { describe, expect, it } from "vitest";
import { anchorAtMm, levelOf, type Document } from "@fm/domain";
import { contactPlace } from "../src/snapping/contact";
import { placeFootprint, slideOpening } from "../src/snapping/placement";
import { roomDoc, withCommands, ON_FLOOR } from "./builders";

// One placement rule for the Object tool's ghost, a Select drag and a one-piece duplicate (arch-review R-05):
// placeFootprint hands each call to contactPlace (furnish.16). roomDoc's inner faces are x 0.1 / 5.9, y 0.1 / 3.9.
const doc: Document = withCommands(roomDoc(), { type: "placeObject", deck: null, opId: "b", state: "s0", object: { kind: "desk" }, at: { x: 3, y: 2 }, rotation: 0 });
const DESK = { w: 1.2, d: 0.6 };
const OPTS = { tolerance: 0.125, free: false, riser: null, heights: ON_FLOOR, surface: null, land: false as const, level: levelOf(doc, null) };
const CENTRES: [x: number, y: number, r: number][] = [[3, 2, 0], [3, 3.6, 0], [5.6, 2, 0], [0.5, 0.45, 30], [3, 0.42, 90], [5.55, 3.5, 137]];

describe("placeFootprint", () => {
  it.each(CENTRES)("centre (%d, %d) from %d° returns contactPlace's answer", (x, y, r) => {
    expect(placeFootprint(doc, "s0", DESK, { x, y }, r, OPTS)).toEqual(contactPlace(doc, "s0", DESK, { x, y }, r, OPTS));
  });

  it("the back near the top face lands flush; a side across a face by more than the tolerance keeps the angle", () => {
    expect(placeFootprint(doc, "s0", DESK, { x: 3, y: 3.6 }, 0, OPTS)).toEqual({ at: { x: 3, y: 3.9 }, rotation: 0, flushWalls: ["room-3/w0"] });
    // x 5.0–6.2 crosses the right face by 0.3: no contact (the distance turn gave 270 at (5.9, 2)).
    expect(placeFootprint(doc, "s0", DESK, { x: 5.6, y: 2 }, 0, OPTS)).toEqual({ at: { x: 5.6, y: 2.3 }, rotation: 0, flushWalls: [] });
  });

  it("keeps the given angle when asked (Ctrl), anchored to the millimetre", () => {
    const free = { tolerance: 0.125, free: true, riser: null, heights: ON_FLOOR, surface: null, land: false as const, level: levelOf(doc, null) };
    expect(placeFootprint(doc, "s0", DESK, { x: 5.6, y: 2 }, 0, free)).toEqual({ at: { x: 5.6, y: 2.3 }, rotation: 0, flushWalls: [] });
    expect(placeFootprint(doc, "s0", DESK, { x: 1.2345, y: 2.3456 }, 30, free)).toEqual({ at: anchorAtMm({ x: 1.2345, y: 2.3456 }, 0.6, 30), rotation: 30, flushWalls: [] });
  });
});

describe("slideOpening", () => {
  it("adds the drag along the wall rounded to the grid, or exactly with Ctrl, and keeps the offset to the centimetre", () => {
    expect(slideOpening(1.1, 0.37, 0.2, false)).toBe(1.5);
    expect(slideOpening(1.1, 0.373, 0.2, true)).toBe(1.47);
    expect(slideOpening(1.1, -0.29, 0.1, false)).toBe(0.8);
  });
});
