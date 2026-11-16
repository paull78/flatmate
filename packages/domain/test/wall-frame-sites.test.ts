import { describe, expect, it } from "vitest";
import { sortedIds } from "../src/graph";
import type { Document, Opening } from "../src/model";
import { wallBodies } from "../src/queries/footprints";
import { faceExtent, wallChain, wallFace, wallRoomSides } from "../src/queries/helpers";
import { levelOf } from "../src/queries/levels";
import { geometryOf, suggestOpening } from "../src/queries/openings";
import { A, C, K, docOf, loops, withOpening } from "./helpers";

/** The wall's chain at the floor level: these tests have no loft. */
const floorChain = (doc: Document, wallId: string, moving?: Opening) => wallChain(doc, wallId, levelOf(doc, null), moving);

// Characterization of the sites that read a wall's frame (tidy step 11, AC-15): their outputs on slanted walls, mixed
// thicknesses, a T divider, holes and a clockwise room, captured before the sites switched to `wallFrame` and
// `faceExtent` and compared exactly (deep equality, −0 included), so a change in the arithmetic shows.

/** A 4 × 3 room with a 0.30 bottom wall split by a 0.10 T divider at x = 2, and a free slanted 0.15 wall F outside. */
const FIX = docOf({
  joints: [["J1", 0, 0], ["J2", 4, 0], ["J3", 4, 3], ["J4", 0, 3], ["J5", 2, 0], ["J6", 2, 3], ["K1", 6, 0], ["K2", 7.5, 1.3]],
  walls: [["W1a", "J1", "J5", 0.3], ["W1b", "J5", "J2", 0.3], ["W2", "J2", "J3", 0.2], ["W3a", "J3", "J6", 0.2], ["W3b", "J6", "J4", 0.2], ["W4", "J4", "J1", 0.2], ["W5", "J5", "J6", 0.1], ["F", "K1", "K2", 0.15]],
});
const HOLES = loops(A, C, K);
/** A 3 × 2 room drawn clockwise, so each wall's room lies on its right; W3 is 0.25 thick. */
const CW = docOf({ joints: [["J1", 0, 0], ["J2", 3, 0], ["J3", 3, 2], ["J4", 0, 2]], walls: [["W1", "J1", "J4"], ["W2", "J4", "J3"], ["W3", "J3", "J2", 0.25], ["W4", "J2", "J1"]] });

const faces = (doc: Document) => Object.fromEntries(sortedIds(doc.walls).map((id) => [id, { rooms: wallRoomSides(doc, id), face: wallFace(doc, id) }]));
const O: Omit<Opening, "id" | "wall" | "offset"> = { kind: "swing", width: 0.8, side: "left", hinge: "a", glazed: false, sill: 0, head: 2.1 };

function capture() {
  return {
    bodies: { fix: Object.fromEntries(wallBodies(FIX)), holes: Object.fromEntries(wallBodies(HOLES)), cw: Object.fromEntries(wallBodies(CW)) },
    faces: { fix: faces(FIX), holes: faces(HOLES), cw: faces(CW) },
    chains: {
      W1a: floorChain(withOpening(FIX, { id: "d", wall: "W1a", offset: 0.5 }), "W1a"),
      F: floorChain(withOpening(FIX, { id: "w", wall: "F", offset: 0.6, kind: "window", side: "right" }), "F"),
    },
    openings: [
      geometryOf(FIX, { ...O, id: "o1", wall: "W1a", offset: 0.5 }),
      geometryOf(FIX, { ...O, id: "o2", wall: "W5", offset: 1.2, side: "right", hinge: "b" }),
      geometryOf(FIX, { ...O, id: "o3", wall: "F", offset: 0.3, width: 0.9, hinge: "b" }),
      geometryOf(FIX, { ...O, id: "o4", wall: "F", offset: 0.6, width: 1, kind: "window", side: "right" }),
      geometryOf(HOLES, { ...O, id: "o5", wall: "K2", offset: 0.1, width: 0.4, side: "right" }),
      geometryOf(FIX, { ...O, id: "o6", wall: "nope", offset: 0 }),
    ],
    suggested: [
      suggestOpening(FIX, "F", { x: 6.5, y: 0.8 }, "swing"),
      suggestOpening(FIX, "F", { x: 7.4, y: 1.0 }, "window"),
      suggestOpening(FIX, "W5", { x: 2.1, y: 2.8 }, "sliding"),
      suggestOpening(HOLES, "C3", { x: 5, y: 5.6 }, "swing"),
      suggestOpening(FIX, "nope", { x: 0, y: 0 }, "swing"),
    ],
  };
}

describe("wall frame sites (characterization, AC-15)", () => {
  it("wallBodies, the room sides and faces, the chains, geometryOf and suggestOpening give the captured values", () => {
    expect(capture()).toEqual(GOLDEN);
  });
});

describe("faceExtent", () => {
  it("on the measured side matches wallFace's ends, on every wall of the fixtures", () => {
    for (const doc of [FIX, HOLES, CW]) {
      for (const id of sortedIds(doc.walls)) {
        const face = wallFace(doc, id);
        expect(face, id).not.toBeNull();
        if (face) expect(faceExtent(doc, id, face.side), id).toEqual({ start: face.faceStart, end: face.faceEnd });
      }
    }
  });

  it("on the other side ends where that face's outline does: the outside of the 0.30 wall runs past both its joints", () => {
    const outside = faceExtent(FIX, "W1a", "right"); // y = −0.15, from the outer corner at x = −0.10 to the joint J5 at x = 2
    expect(outside?.start).toBeCloseTo(-0.1, 9);
    expect(outside?.end).toBeCloseTo(2, 9);
    const divider = faceExtent(FIX, "W5", "right"); // x = 2.05, from the 0.30 wall's face to the top wall's
    expect(divider?.start).toBeCloseTo(0.15, 9);
    expect(divider?.end).toBeCloseTo(2.9, 9);
  });

  it("is null for a missing wall and a zero-length wall", () => {
    const zero = docOf({ joints: [["P", 1, 1], ["Q", 1, 1]], walls: [["Z", "P", "Q"]] });
    expect(faceExtent(FIX, "nope", "left")).toBeNull();
    expect(faceExtent(zero, "Z", "left")).toBeNull();
  });
});

// Captured from the code before tidy step 11.
const GOLDEN = {
  bodies: {
    fix: {
      F: [
        { x: 6.049119790381338, y: -0.05667668120923631 },
        { x: 7.549119790381338, y: 1.2433233187907637 },
        { x: 7.450880209618662, y: 1.3566766812092363 },
        { x: 5.950880209618662, y: 0.05667668120923631 },
      ],
      W1a: [{ x: 0, y: -0.15 }, { x: 2, y: -0.15 }, { x: 2, y: 0.15 }, { x: 0, y: 0.15 }],
      W1b: [{ x: 2, y: -0.15 }, { x: 4, y: -0.15 }, { x: 4, y: 0.15 }, { x: 2, y: 0.15 }],
      W2: [{ x: 4.1, y: 0 }, { x: 4.1, y: 3 }, { x: 3.9, y: 3 }, { x: 3.9, y: 0 }],
      W3a: [{ x: 4, y: 3.1 }, { x: 2, y: 3.1 }, { x: 2, y: 2.9 }, { x: 4, y: 2.9 }],
      W3b: [{ x: 2, y: 3.1 }, { x: 0, y: 3.1 }, { x: 0, y: 2.9 }, { x: 2, y: 2.9 }],
      W4: [{ x: -0.1, y: 3 }, { x: -0.1, y: 0 }, { x: 0.1, y: 0 }, { x: 0.1, y: 3 }],
      W5: [{ x: 2.05, y: 0 }, { x: 2.05, y: 3 }, { x: 1.95, y: 3 }, { x: 1.95, y: 0 }],
    },
    holes: {
      A1: [{ x: 0, y: -0.1 }, { x: 10, y: -0.1 }, { x: 10, y: 0.1 }, { x: 0, y: 0.1 }],
      A2: [{ x: 10.1, y: 0 }, { x: 10.1, y: 8 }, { x: 9.9, y: 8 }, { x: 9.9, y: 0 }],
      A3: [{ x: 10, y: 8.1 }, { x: 0, y: 8.1 }, { x: 0, y: 7.9 }, { x: 10, y: 7.9 }],
      A4: [{ x: -0.1, y: 8 }, { x: -0.1, y: 0 }, { x: 0.1, y: 0 }, { x: 0.1, y: 8 }],
      C1: [{ x: 3.5, y: 2.4 }, { x: 6.5, y: 2.4 }, { x: 6.5, y: 2.6 }, { x: 3.5, y: 2.6 }],
      C2: [{ x: 6.6, y: 2.5 }, { x: 6.6, y: 5.5 }, { x: 6.4, y: 5.5 }, { x: 6.4, y: 2.5 }],
      C3: [{ x: 6.5, y: 5.6 }, { x: 3.5, y: 5.6 }, { x: 3.5, y: 5.4 }, { x: 6.5, y: 5.4 }],
      C4: [{ x: 3.4, y: 5.5 }, { x: 3.4, y: 2.5 }, { x: 3.6, y: 2.5 }, { x: 3.6, y: 5.5 }],
      K1: [{ x: 4.7, y: 3.6500000000000004 }, { x: 5.3, y: 3.6500000000000004 }, { x: 5.3, y: 3.75 }, { x: 4.7, y: 3.75 }],
      K2: [{ x: 5.35, y: 3.7 }, { x: 5.35, y: 4.3 }, { x: 5.25, y: 4.3 }, { x: 5.25, y: 3.7 }],
      K3: [{ x: 5.3, y: 4.35 }, { x: 4.7, y: 4.35 }, { x: 4.7, y: 4.25 }, { x: 5.3, y: 4.25 }],
      K4: [{ x: 4.65, y: 4.3 }, { x: 4.65, y: 3.7 }, { x: 4.75, y: 3.7 }, { x: 4.75, y: 4.3 }],
    },
    cw: {
      W1: [{ x: 0.1, y: 0 }, { x: 0.1, y: 2 }, { x: -0.1, y: 2 }, { x: -0.1, y: 0 }],
      W2: [{ x: 0, y: 1.9 }, { x: 3, y: 1.9 }, { x: 3, y: 2.1 }, { x: 0, y: 2.1 }],
      W3: [{ x: 2.875, y: 2 }, { x: 2.875, y: 0 }, { x: 3.125, y: 0 }, { x: 3.125, y: 2 }],
      W4: [{ x: 3, y: 0.1 }, { x: 0, y: 0.1 }, { x: 0, y: -0.1 }, { x: 3, y: -0.1 }],
    },
  },
  faces: {
    fix: {
      F: {
        rooms: { left: false, right: false, normal: { x: -0.6549305384178419, y: 0.7556890827898175 } },
        face: { side: "left", faceStart: -1.1796119636642288e-16, faceEnd: 1.9849433241279206 },
      },
      W1a: { rooms: { left: true, right: false, normal: { x: -0, y: 1 } }, face: { side: "left", faceStart: 0.1, faceEnd: 1.95 } },
      W1b: { rooms: { left: true, right: false, normal: { x: -0, y: 1 } }, face: { side: "left", faceStart: 0.04999999999999982, faceEnd: 1.9 } },
      W2: { rooms: { left: true, right: false, normal: { x: -1, y: 0 } }, face: { side: "left", faceStart: 0.15, faceEnd: 2.9 } },
      W3a: {
        rooms: { left: true, right: false, normal: { x: -0, y: -1 } },
        face: { side: "left", faceStart: 0.10000000000000009, faceEnd: 1.9500000000000002 },
      },
      W3b: { rooms: { left: true, right: false, normal: { x: -0, y: -1 } }, face: { side: "left", faceStart: 0.050000000000000044, faceEnd: 1.9 } },
      W4: { rooms: { left: true, right: false, normal: { x: 1, y: 0 } }, face: { side: "left", faceStart: 0.10000000000000009, faceEnd: 2.85 } },
      W5: { rooms: { left: true, right: true, normal: { x: -1, y: 0 } }, face: { side: "left", faceStart: 0.15, faceEnd: 2.9 } },
    },
    holes: {
      A1: { rooms: { left: true, right: false, normal: { x: -0, y: 1 } }, face: { side: "left", faceStart: 0.1, faceEnd: 9.9 } },
      A2: { rooms: { left: true, right: false, normal: { x: -1, y: 0 } }, face: { side: "left", faceStart: 0.1, faceEnd: 7.9 } },
      A3: { rooms: { left: true, right: false, normal: { x: -0, y: -1 } }, face: { side: "left", faceStart: 0.09999999999999964, faceEnd: 9.9 } },
      A4: { rooms: { left: true, right: false, normal: { x: 1, y: 0 } }, face: { side: "left", faceStart: 0.09999999999999964, faceEnd: 7.9 } },
      C1: { rooms: { left: true, right: true, normal: { x: -0, y: 1 } }, face: { side: "left", faceStart: 0.10000000000000009, faceEnd: 2.9000000000000004 } },
      C2: { rooms: { left: true, right: true, normal: { x: -1, y: 0 } }, face: { side: "left", faceStart: 0.10000000000000009, faceEnd: 2.9000000000000004 } },
      C3: { rooms: { left: true, right: true, normal: { x: -0, y: -1 } }, face: { side: "left", faceStart: 0.09999999999999964, faceEnd: 2.9 } },
      C4: { rooms: { left: true, right: true, normal: { x: 1, y: 0 } }, face: { side: "left", faceStart: 0.09999999999999964, faceEnd: 2.9 } },
      K1: { rooms: { left: true, right: true, normal: { x: -0, y: 1 } }, face: { side: "left", faceStart: 0.04999999999999982, faceEnd: 0.5499999999999998 } },
      K2: { rooms: { left: true, right: true, normal: { x: -1, y: 0 } }, face: { side: "left", faceStart: 0.04999999999999982, faceEnd: 0.5499999999999998 } },
      K3: { rooms: { left: true, right: true, normal: { x: -0, y: -1 } }, face: { side: "left", faceStart: 0.04999999999999982, faceEnd: 0.5499999999999998 } },
      K4: { rooms: { left: true, right: true, normal: { x: 1, y: 0 } }, face: { side: "left", faceStart: 0.04999999999999982, faceEnd: 0.5499999999999998 } },
    },
    cw: {
      W1: { rooms: { left: false, right: true, normal: { x: -1, y: 0 } }, face: { side: "right", faceStart: 0.1, faceEnd: 1.9 } },
      W2: { rooms: { left: false, right: true, normal: { x: -0, y: 1 } }, face: { side: "right", faceStart: 0.1, faceEnd: 2.875 } },
      W3: { rooms: { left: false, right: true, normal: { x: 1, y: 0 } }, face: { side: "right", faceStart: 0.10000000000000009, faceEnd: 1.9 } },
      W4: { rooms: { left: false, right: true, normal: { x: -0, y: -1 } }, face: { side: "right", faceStart: 0.125, faceEnd: 2.9 } },
    },
  },
  chains: {
    W1a: {
      side: "left",
      faceStart: 0.1,
      faceEnd: 1.95,
      pieces: [
        {
          role: "gap",
          start: 0.1,
          end: 0.5,
          length: 0.4,
          from: { x: 0.1, y: 0.15 },
          to: { x: 0.5, y: 0.15 },
          left: { kind: "joint", joint: "a" },
          right: { kind: "opening", id: "d" },
        },
        {
          role: "opening",
          start: 0.5,
          end: 1.3,
          length: 0.8,
          from: { x: 0.5, y: 0.15 },
          to: { x: 1.3, y: 0.15 },
          left: { kind: "opening", id: "d" },
          right: { kind: "opening", id: "d" },
        },
        {
          role: "gap",
          start: 1.3,
          end: 1.95,
          length: 0.6499999999999999,
          from: { x: 1.3, y: 0.15 },
          to: { x: 1.95, y: 0.15 },
          left: { kind: "opening", id: "d" },
          right: { kind: "joint", joint: "b" },
        },
      ],
    },
    F: {
      side: "left",
      faceStart: -1.1796119636642288e-16,
      faceEnd: 1.9849433241279206,
      pieces: [
        {
          role: "gap",
          start: -1.1796119636642288e-16,
          end: 0.6,
          length: 0.6000000000000001,
          from: { x: 5.950880209618662, y: 0.05667668120923623 },
          to: { x: 6.404293659292552, y: 0.4496350042599414 },
          left: { kind: "joint", joint: "a" },
          right: { kind: "opening", id: "w" },
        },
        {
          role: "opening",
          start: 0.6,
          end: 1.6,
          length: 1,
          from: { x: 6.404293659292552, y: 0.4496350042599414 },
          to: { x: 7.15998274208237, y: 1.1045655426777834 },
          left: { kind: "opening", id: "w" },
          right: { kind: "opening", id: "w" },
        },
        {
          role: "gap",
          start: 1.6,
          end: 1.9849433241279206,
          length: 0.38494332412792054,
          from: { x: 7.15998274208237, y: 1.1045655426777834 },
          to: { x: 7.450880209618662, y: 1.3566766812092361 },
          left: { kind: "opening", id: "w" },
          right: { kind: "joint", joint: "b" },
        },
      ],
    },
  },
  openings: [
    {
      start: { x: 0.5, y: 0 },
      end: { x: 1.3, y: 0 },
      along: { x: 1, y: 0 },
      normal: { x: -0, y: 1 },
      thickness: 0.3,
      hinge: { x: 0.5, y: 0.15 },
      free: { x: 1.3, y: 0.15 },
    },
    {
      start: { x: 2, y: 1.2 },
      end: { x: 2, y: 2 },
      along: { x: 0, y: 1 },
      normal: { x: 1, y: -0 },
      thickness: 0.1,
      hinge: { x: 2.05, y: 2 },
      free: { x: 2.05, y: 1.2 },
    },
    {
      start: { x: 6.226706724836945, y: 0.19647916152535255 },
      end: { x: 6.906826899347781, y: 0.7859166461014102 },
      along: { x: 0.7556890827898175, y: 0.6549305384178419 },
      normal: { x: -0.6549305384178419, y: 0.7556890827898175 },
      thickness: 0.15,
      hinge: { x: 6.8577071089664425, y: 0.8425933273106465 },
      free: { x: 6.177586934455607, y: 0.25315584273458885 },
    },
    {
      start: { x: 6.45341344967389, y: 0.3929583230507051 },
      end: { x: 7.209102532463708, y: 1.047888861468547 },
      along: { x: 0.7556890827898175, y: 0.6549305384178419 },
      normal: { x: 0.6549305384178419, y: -0.7556890827898175 },
      thickness: 0.15,
      hinge: { x: 6.502533240055229, y: 0.3362816418414688 },
      free: { x: 7.258222322845047, y: 0.9912121802593108 },
    },
    {
      start: { x: 5.3, y: 3.8000000000000003 },
      end: { x: 5.3, y: 4.2 },
      along: { x: 0, y: 1 },
      normal: { x: 1, y: -0 },
      thickness: 0.1,
      hinge: { x: 5.35, y: 3.8000000000000003 },
      free: { x: 5.35, y: 4.2 },
    },
    null,
  ],
  suggested: [
    { offset: 0.501789, width: 0.8, side: "left", hinge: "a", sill: 0, head: 2.1 },
    { offset: 0.984943, width: 1, side: "right", hinge: "b", sill: 0.9, head: 2.1 },
    { offset: 2.2, width: 0.8, side: "right", hinge: "a", sill: 0, head: 2.1 }, // a sliding door parks toward the far end (openkinds.10)
    { offset: 1.1, width: 0.8, side: "right", hinge: "a", sill: 0, head: 2.1 },
    null,
  ],
};
