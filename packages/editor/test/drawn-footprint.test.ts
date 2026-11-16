import { describe, expect, it } from "vitest";
import { emptyDocument, rectangleRoom } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { drawnFootprint, footprintCorner } from "../src/snapping/drawn-footprint";
import { nichesDoc, roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

const p = (x: number, y: number): Point => ({ x, y });
// The four niches of nichesDoc as drawn from face corner to face corner, and the footprint each should give.
const T = { a: p(1.1, 3.9), b: p(2.3, 3.3), want: { at: p(1.7, 3.9), rotation: 0, w: 1.2, d: 0.6 } };
const L = { a: p(0.1, 1.1), b: p(0.7, 2.3), want: { at: p(0.1, 1.7), rotation: 90, w: 1.2, d: 0.6 } };
const R = { a: p(5.3, 1.1), b: p(5.9, 2.3), want: { at: p(5.9, 1.7), rotation: 270, w: 1.2, d: 0.6 } };
const B = { a: p(3.1, 0.1), b: p(4.0, 2.1), want: { at: p(3.55, 0.1), rotation: 180, w: 0.9, d: 2 } };
/** A clear 1.20 × 0.60 room, x 0.1–1.3, y 0.1–0.7: every side of a rectangle filling it is walled. */
const closetDoc = () => withCommands(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 1.4, 0.8));

describe("drawnFootprint: the open-side back rule (furnish.17)", () => {
  it("the back is the walled side opposite the one open side, in all four directions", () => {
    const doc = nichesDoc();
    for (const start of [0, 90]) {
      for (const n of [T, L, R, B]) expect(drawnFootprint(doc, n.a, n.b, start)).toEqual(n.want); // the open side beats the start angle
    }
  });

  it("the corner order does not matter", () => {
    const doc = nichesDoc();
    for (const [a, b] of [[p(1.1, 3.9), p(2.3, 3.3)], [p(2.3, 3.3), p(1.1, 3.9)], [p(1.1, 3.3), p(2.3, 3.9)], [p(2.3, 3.9), p(1.1, 3.3)]] as const) {
      expect(drawnFootprint(doc, a, b, 0)).toEqual(T.want);
    }
  });

  it("a side is walled only when a parallel face lies on it, within 1 mm", () => {
    const doc = nichesDoc();
    // 2 cm below the niche's back face the top is open too: two open sides, so the start angle (90) decides.
    expect(drawnFootprint(doc, p(1.1, 3.88), p(2.3, 3.3), 90)).toEqual({ at: p(1.1, 3.59), rotation: 90, w: 0.58, d: 1.2 });
    // 0.5 mm below it the top is still walled.
    expect(drawnFootprint(doc, p(1.1, 3.8995), p(2.3, 3.3), 90)).toMatchObject({ rotation: 0, w: 1.2, d: 0.599 });
  });

  it("with two open sides, or none, the start angle decides, rounded to a quarter turn", () => {
    // The room's bottom-left corner: bottom and left walled, top and right open.
    const corner = roomDoc();
    expect(drawnFootprint(corner, p(0.1, 0.1), p(1.3, 0.7), 0)).toEqual({ at: p(0.7, 0.7), rotation: 0, w: 1.2, d: 0.6 });
    expect(drawnFootprint(corner, p(0.1, 0.1), p(1.3, 0.7), 46)).toEqual({ at: p(0.1, 0.4), rotation: 90, w: 0.6, d: 1.2 });
    const closet = closetDoc();
    expect(drawnFootprint(closet, p(0.1, 0.1), p(1.3, 0.7), 314)).toEqual({ at: p(1.3, 0.4), rotation: 270, w: 0.6, d: 1.2 });
    expect(drawnFootprint(closet, p(0.1, 0.1), p(1.3, 0.7), 316)).toEqual({ at: p(0.7, 0.7), rotation: 0, w: 1.2, d: 0.6 });
  });

  it("open floor: the start angle turns the rectangle", () => {
    const doc = roomDoc();
    const a = p(2, 1);
    const b = p(3.2, 1.6);
    expect(drawnFootprint(doc, a, b, 0)).toEqual({ at: p(2.6, 1.6), rotation: 0, w: 1.2, d: 0.6 });
    expect(drawnFootprint(doc, a, b, 90)).toEqual({ at: p(2, 1.3), rotation: 90, w: 0.6, d: 1.2 });
    expect(drawnFootprint(doc, a, b, 180)).toEqual({ at: p(2.6, 1), rotation: 180, w: 1.2, d: 0.6 });
    expect(drawnFootprint(doc, a, b, 270)).toEqual({ at: p(3.2, 1.3), rotation: 270, w: 0.6, d: 1.2 });
  });

  it("sizes are floored to the millimetre, the anchor rounded", () => {
    expect(drawnFootprint(roomDoc(), p(2, 1), p(3.2007, 1.6007), 0)).toEqual({ at: p(2.6, 1.6), rotation: 0, w: 1.2, d: 0.6 });
  });
});

describe("footprintCorner", () => {
  it("footprintCorner: a face corner first, then a face, else the centimetre; Ctrl keeps the centimetre", () => {
    const doc = nichesDoc();
    const camera = FakeShell.withDocument(doc).state.camera;
    expect(camera.zoom).toBe(80);
    // The corner is 0.042 away and wins over the top face's foot, 0.03 away.
    expect(footprintCorner(doc, camera, 10, p(1.13, 3.87), false)).toEqual(p(1.1, 3.9));
    expect(footprintCorner(doc, camera, 10, p(2.27, 3.53), false)).toEqual(p(2.3, 3.53)); // onto fin t2's face
    expect(footprintCorner(doc, camera, 10, p(2.004, 3.006), false)).toEqual(p(2, 3.01));
    expect(footprintCorner(doc, camera, 10, p(1.13, 3.87), true)).toEqual(p(1.13, 3.87));
    // The corner is 0.234 away: outside 10 px at zoom 80 (0.125 m), inside at zoom 40 (0.25 m).
    expect(footprintCorner(doc, camera, 10, p(1.25, 3.72), false)).toEqual(p(1.25, 3.72));
    expect(footprintCorner(doc, { ...camera, zoom: 40 }, 10, p(1.25, 3.72), false)).toEqual(p(1.1, 3.9));
  });
});
