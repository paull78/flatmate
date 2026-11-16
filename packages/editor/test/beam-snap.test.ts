import { describe, expect, it } from "vitest";
import { anchorAtMm, levelOf, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { contactPlace } from "../src/snapping/contact";
import { alignAfterContact } from "../src/snapping/settle";
import type { Piece } from "../src/snapping/piece";
import { loftRoomDoc, roomDoc, withCommands } from "./builders";

// A beam's snapping (beams.19; AC-09). roomDoc: a 6 × 4 room, inner faces x 0.1 / 5.9, y 0.1 / 3.9. loftRoomDoc adds a
// Loft at x 1.3–3.7, y 1.4–3.8. A 2.40 × 0.15 beam; at 0° its back edge is at `at.y`, its front at `at.y − 0.15`.

const SIZE = { w: 2.4, d: 0.15 };
const TOL = 0.125;
const beam = (doc: Document): Piece => ({ kind: "beam", config: "standard", riser: null, heights: { h: 0.2, z: "ceiling" }, land: true, current: undefined, level: levelOf(doc, null) });
const place = (doc: Document, centre: Point, r: number, free = false) => contactPlace(doc, "s0", SIZE, centre, r, { tolerance: TOL, free, ...beam(doc) });
/** Left where the pointer put it: the start angle, the centre's anchor. */
const unmoved = (centre: Point, r: number) => ({ at: anchorAtMm(centre, SIZE.d, r), rotation: r });

describe("a beam near a wall", () => {
  it("upright, its end 0.10 m off the bottom wall, it keeps 90° and its place", () => {
    const p = place(roomDoc(), { x: 3, y: 1.4 }, 90);
    expect({ at: p.at, rotation: p.rotation }).toEqual(unmoved({ x: 3, y: 1.4 }, 90));
  });

  it("upright, its end 0.05 m into the bottom wall, it keeps 90° and its place", () => {
    const p = place(roomDoc(), { x: 3, y: 1.25 }, 90);
    expect({ at: p.at, rotation: p.rotation }).toEqual(unmoved({ x: 3, y: 1.25 }, 90));
  });

  it("at 0°, its back 0.05 m off the top wall's face, it slides flush with it; at 180° its front does", () => {
    const back = place(roomDoc(), { x: 3, y: 3.775 }, 0);
    expect([back.at, back.rotation]).toEqual([{ x: 3, y: 3.9 }, 0]);
    const front = place(roomDoc(), { x: 3, y: 3.775 }, 180);
    expect([front.at, front.rotation]).toEqual([{ x: 3, y: 3.75 }, 180]);
  });

  it("with Ctrl it stays put", () => {
    const p = place(roomDoc(), { x: 3, y: 3.775 }, 0, true);
    expect({ at: p.at, rotation: p.rotation }).toEqual(unmoved({ x: 3, y: 3.775 }, 0));
  });
});

describe("a beam under a loft's edge (y 1.4, the slab above it)", () => {
  it("its long side 0.05 m inside the edge slides flush with it, under the slab", () => {
    const p = place(loftRoomDoc(), { x: 2.5, y: 1.525 }, 0);
    expect([p.at, p.rotation]).toEqual([{ x: 2.5, y: 1.55 }, 0]);
  });

  it("its long side 0.05 m outside the edge, its centre under the slab, slides flush with it, under the slab", () => {
    const p = place(loftRoomDoc(), { x: 2.5, y: 1.425 }, 0);
    expect([p.at, p.rotation]).toEqual([{ x: 2.5, y: 1.55 }, 0]);
  });

  it("with its centre outside the loft it doesn't snap to the edge", () => {
    const p = place(loftRoomDoc(), { x: 2.5, y: 1.35 }, 0);
    expect({ at: p.at, rotation: p.rotation }).toEqual(unmoved({ x: 2.5, y: 1.35 }, 0));
  });

  it("at 30° near the edge it neither snaps nor turns", () => {
    const p = place(loftRoomDoc(), { x: 2.5, y: 1.6 }, 30);
    expect({ at: p.at, rotation: p.rotation }).toEqual(unmoved({ x: 2.5, y: 1.6 }, 30));
  });

  it("flush with the edge, a guide from a block beside it doesn't move it", () => {
    // A 0.5 m block at x 4.75–5.25, its back at y 1.62: within the tolerance of the beam's back at 1.55.
    const doc = withCommands(loftRoomDoc(), { type: "placeObject", deck: null, opId: "k", state: "s0", object: { kind: "block", size: { w: 0.5, d: 0.5 } }, at: { x: 5, y: 1.62 }, rotation: 0 });
    const free = { x: 2.5, y: 1.525 };
    const placed = place(doc, free, 0);
    expect(placed.at).toEqual({ x: 2.5, y: 1.55 });
    const settled = alignAfterContact(doc, { layout: "s0", exclude: new Set(), size: SIZE, free, placed, tolerance: TOL, ctrl: false, axes: { x: true, y: true }, ...beam(doc) });
    expect(settled.at).toEqual({ x: 2.5, y: 1.55 });
  });
});
