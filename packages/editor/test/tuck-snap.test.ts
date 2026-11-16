import { describe, expect, it } from "vitest";
import { anchorAtMm, footprintQuad, levelOf, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { contactPlace } from "../src/snapping/contact";
import { LOFT_ROOM_LOFT, loftRoomDoc, roomDoc, withCommands } from "./builders";

// The tuck snap (seating.11, AC-08): a chair whose front comes within the tolerance of a sit-at piece's edge, or
// overlaps it, turns square to it (at a round table, facing its centre) and slides in until its back 0.10 m strip is
// flush with the edge, if that fits; before touch to turn; Ctrl skips it. roomDoc: 6 × 4 m, inner faces x 0.1 / 5.9,
// y 0.1 / 3.9. The desk: x 1.4–2.6, y 3.3–3.9, its front edge y 3.3. A 0.45 chair at 210° (30° off facing the desk,
// front (−0.5, 0.866)) centred on y 2.9 has its nearest front corner at y 3.207, 0.093 from the edge (7.4 px at zoom
// 80); T = 0.125 is 10 px at zoom 80.

const T = 0.125;
const CHAIR = { w: 0.45, d: 0.45 };
const CHAIR_HEIGHTS = { h: 0.9, z: 0 };
const place = (opId: string, kind: string, at: Point, rotation = 0, deck: string | null = null): Command => ({ type: "placeObject", deck, opId, state: "s0", object: { kind }, at, rotation });
const DESK = withCommands(roomDoc(), place("desk", "desk", { x: 2, y: 3.9 }));
/** A 0.90 round table centred on (3, 2), radius 0.45. */
const ROUND = withCommands(roomDoc(), place("table", "roundTable", { x: 3, y: 2.45 }));

function snap(doc: Document, centre: Point, r: number, free = false) {
  return contactPlace(doc, "s0", CHAIR, centre, r, { tolerance: T, free, kind: "chair", config: "standard", riser: null, heights: CHAIR_HEIGHTS, surface: null, land: false, level: levelOf(doc, null) });
}

/** The plain contact result: the same chair with no kind, so no tuck snap. */
function plain(doc: Document, centre: Point, r: number) {
  return contactPlace(doc, "s0", CHAIR, centre, r, { tolerance: T, free: false, riser: null, heights: CHAIR_HEIGHTS, surface: null, land: false, level: levelOf(doc, null) });
}

describe("the tuck snap at a desk (AC-08)", () => {
  it("front within 10 px turns square and tucks", () => {
    const placed = snap(DESK, { x: 2, y: 2.9 }, 210);
    expect(placed).toMatchObject({ at: { x: 2, y: 3.2 }, rotation: 180 });
    const quad = footprintQuad(placed.at, CHAIR.w, CHAIR.d, placed.rotation);
    expect(Math.max(...quad.map((p) => p.y)) - 3.3).toBeCloseTo(0.35, 9); // 0.35 m under the desk
    expect(snap(DESK, { x: 2, y: 2.9 }, 150)).toMatchObject({ at: { x: 2, y: 3.2 }, rotation: 180 });
  });

  it("a front overlapping the desk tucks too", () => {
    expect(snap(DESK, { x: 2, y: 3.1 }, 210)).toMatchObject({ at: { x: 2, y: 3.2 }, rotation: 180 });
  });

  it("Ctrl skips", () => {
    expect(snap(DESK, { x: 2, y: 2.9 }, 210, true)).toEqual({ at: anchorAtMm({ x: 2, y: 2.9 }, CHAIR.d, 210), rotation: 210, flushWalls: [] });
  });

  it("too far away: no snap", () => {
    // Centred on y 2.85 the nearest front corner is 0.143 from the edge.
    expect(snap(DESK, { x: 2, y: 2.85 }, 210)).toEqual(plain(DESK, { x: 2, y: 2.85 }, 210));
    expect(snap(DESK, { x: 2, y: 2.85 }, 210).rotation).toBe(210);
  });

  it("would not fit (another chair in the way): no snap", () => {
    const doc = withCommands(DESK, place("other", "chair", { x: 2.4, y: 3.2 }, 180)); // tucked, x 2.175–2.625
    expect(snap(doc, { x: 2, y: 2.9 }, 210)).toEqual(plain(doc, { x: 2, y: 2.9 }, 210));
    expect(snap(doc, { x: 2, y: 2.9 }, 210).rotation).toBe(210);
  });

  it("sliding along the edge keeps it tucked", () => {
    expect(snap(DESK, { x: 2.2, y: 2.9 }, 210)).toMatchObject({ at: { x: 2.2, y: 3.2 }, rotation: 180 });
    expect(snap(DESK, { x: 1.83, y: 2.95 }, 210)).toMatchObject({ at: { x: 1.83, y: 3.2 }, rotation: 180 });
  });

  it("an already tucked chair (its centre over the desk) stays tucked as it slides", () => {
    // Turned 5° and 2.5 cm too deep: the snap squares it and draws it out to flush.
    expect(snap(DESK, { x: 1.7, y: 3.45 }, 185)).toMatchObject({ at: { x: 1.7, y: 3.2 }, rotation: 180 });
  });

  it("pulling away releases: the plain contact result, from the start angle", () => {
    expect(snap(DESK, { x: 2, y: 2.7 }, 210)).toEqual(plain(DESK, { x: 2, y: 2.7 }, 210));
    expect(snap(DESK, { x: 2, y: 2.7 }, 210).rotation).toBe(210);
  });

  it("a chair whose front turns away from the edge doesn't turn round to tuck", () => {
    // At 80° its front faces right and a little down; its front-left corner is 0.068 from the edge.
    expect(snap(DESK, { x: 2, y: 3.05 }, 80)).toEqual(plain(DESK, { x: 2, y: 3.05 }, 80));
    expect(snap(DESK, { x: 2, y: 3.05 }, 80).rotation).toBe(80);
  });

  it("a chair over the desk, its back past the edge, isn't pulled out", () => {
    expect(snap(DESK, { x: 2, y: 3.6 }, 180)).toEqual(plain(DESK, { x: 2, y: 3.6 }, 180));
    expect(snap(DESK, { x: 2, y: 3.6 }, 180).at.y).toBe(3.375);
  });

  it("at a corner, of two edges the front crosses, the smaller turn wins", () => {
    // At 260° the front faces left and a little up: it crosses the desk's front edge and its right edge (x 2.6).
    expect(snap(DESK, { x: 2.8, y: 3.2 }, 260)).toMatchObject({ at: { x: 2.7, y: 3.2 }, rotation: 270 });
    expect(snap(DESK, { x: 2.8, y: 3.2 }, 190)).toMatchObject({ at: { x: 2.8, y: 3.2 }, rotation: 180 });
  });

  it("the nearer edge wins over a smaller turn", () => {
    // A second desk turned 90°, its front edge x 1.4, y 2.0–3.2. At 250° the chair's front crosses the first desk's
    // front edge (a 70° turn) and comes 0.012 from the second's (a 20° turn).
    const doc = withCommands(DESK, place("side", "desk", { x: 0.8, y: 2.6 }, 90));
    expect(snap(doc, { x: 1.7, y: 3.05 }, 250)).toMatchObject({ at: { x: 1.7, y: 3.2 }, rotation: 180 });
  });

  it("a desk on a loft doesn't take a chair on the floor under it", () => {
    // The desk on the loft: x 1.9–3.1, y 3.2–3.8. Tucked below it the chair would fit on the floor, under the loft.
    const doc = withCommands(loftRoomDoc(), place("desk", "desk", { x: 2.5, y: 3.8 }, 0, LOFT_ROOM_LOFT));
    expect(snap(doc, { x: 2.5, y: 2.8 }, 210).rotation).toBe(210);
  });

  it("a chair beyond the desk's end doesn't tuck at its front edge", () => {
    expect(snap(DESK, { x: 3.2, y: 2.9 }, 210).rotation).toBe(210);
  });
});

describe("the tuck snap at a round table (AC-08)", () => {
  // Down and right of the centre, along u = (0.707, −0.707): facing the centre is 225°; the chair starts at 240°.
  // Centred 0.80 out its front is 0.098 from the circle (7.8 px at zoom 80); 0.90 out, 0.194.
  const U = { x: Math.SQRT1_2, y: -Math.SQRT1_2 };
  const along = (s: number): Point => ({ x: 3 + U.x * s, y: 2 + U.y * s });

  it("faces the centre, its strip flush at the radius", () => {
    const placed = snap(ROUND, along(0.8), 240);
    expect(placed.rotation).toBe(225);
    const out = { x: placed.at.x - 3, y: placed.at.y - 2 };
    const r = Math.hypot(out.x, out.y);
    expect(r).toBeGreaterThanOrEqual(0.55); // the back edge's middle at the radius plus SEAT_BACK, never inside
    expect(r).toBeLessThanOrEqual(0.552);
    expect(Math.abs(out.x / r - U.x)).toBeLessThanOrEqual(0.002);
    expect(Math.abs(out.y / r - U.y)).toBeLessThanOrEqual(0.002);
  });

  it("a chair whose front turns away from the centre doesn't tuck", () => {
    // At 125° its front turns 100° from the centre, a little away from it; its front is 0.085 from the circle.
    expect(snap(ROUND, along(0.65), 125).rotation).toBe(125);
  });

  it("too far from the circle: no snap", () => {
    expect(snap(ROUND, along(0.9), 240).rotation).toBe(240);
  });
});
