import { describe, expect, it } from "vitest";
import { emptyDocument, footprintQuad, levelOf, rectangleRoom, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { alignAfterContact, wallLockedAxes } from "../src/snapping/settle";
import { roomDoc, wallDoc, withCommands, ON_FLOOR } from "./builders";

// The wall rule, then the guides (furnish.16): on a screen axis across a wall face within the tolerance of the placed
// piece, the wall wins; on any other axis the nearest guide line of the layout's other furniture, measured from the
// unsnapped box, moves it. roomDoc's inner faces are x 0.1 / 5.9, y 0.1 / 3.9; T = 0.125 (10 px at zoom 80). `at` is
// the middle of a piece's back edge, the +y side at rotation 0.

const T = 0.125;
const place = (opId: string, kind: string, at: Point, state = "s0"): Command => ({ type: "placeObject", linked: false, deck: null, opId, state, object: { kind }, at });
/** S, a wardrobe flush in the top-left corner: x 0.1–1.3, y 3.3–3.9. */
const S = place("s", "wardrobe", { x: 0.7, y: 3.9 });
/** A, a block 0.05 m below the top face: x 2.5–3.1, y 3.25–3.85. */
const A = place("a", "block", { x: 2.8, y: 3.85 });
/** A2, a block in open floor: x 2.5–3.1, y 2.25–2.85. */
const A2 = place("a2", "block", { x: 2.8, y: 2.85 });

const BLOCK = { w: 0.6, d: 0.6 };
const both = { x: true, y: true };

function settle(doc: Document, free: Point, at: Point, more: Partial<Pick<Parameters<typeof alignAfterContact>[1], "size" | "ctrl" | "axes">> = {}) {
  return alignAfterContact(doc, { layout: "s0", exclude: new Set(), size: BLOCK, free, placed: { at, rotation: 0 }, tolerance: T, ctrl: false, axes: both, riser: null, heights: ON_FLOOR, surface: null, land: false, level: levelOf(doc, null), ...more });
}

describe("wallLockedAxes", () => {
  it("a wall face within the tolerance locks the axis across it", () => {
    const quad = (x: number, y: number) => footprintQuad({ x, y }, 0.6, 0.6, 0);
    const horizontal = wallDoc({ x: 0, y: 0 }, { x: 4, y: 0 }); // faces at y ±0.1
    expect(wallLockedAxes(horizontal, quad(2, 0.8), T, levelOf(horizontal, null))).toEqual({ x: false, y: true }); // y 0.2–0.8: a 0.10 gap
    expect(wallLockedAxes(horizontal, quad(2, 0.83), T, levelOf(horizontal, null))).toEqual({ x: false, y: false }); // y 0.23–0.83: 0.13
    const vertical = wallDoc({ x: 0, y: 0 }, { x: 0, y: 4 });
    expect(wallLockedAxes(vertical, quad(0.45, 2.3), T, levelOf(vertical, null))).toEqual({ x: true, y: false }); // x 0.15–0.75: 0.05
    // x 0.225–0.825: a gap of exactly 0.125, which floating point puts a hair above it; contactPlace's margin locks it.
    expect(wallLockedAxes(vertical, quad(0.525, 2.3), T, levelOf(vertical, null))).toEqual({ x: true, y: false });
    const slanted = wallDoc({ x: 0, y: 0 }, { x: 3, y: 3 });
    expect(wallLockedAxes(slanted, quad(2, 1.45), T, levelOf(slanted, null))).toEqual({ x: true, y: true }); // corner (1.7, 1.45) 0.077 from the face
    expect(wallLockedAxes(emptyDocument(), quad(2, 0.8), T, levelOf(emptyDocument(), null))).toEqual({ x: false, y: false });
  });
});

describe("alignAfterContact", () => {
  it("a guide moves the axis no wall holds; the wall's axis keeps contactPlace's place", () => {
    // The free box's left edge 1.35 is 0.05 from S's right edge 1.30; the top wall holds y.
    expect(settle(withCommands(roomDoc(), S), { x: 1.65, y: 3.58 }, { x: 1.65, y: 3.9 })).toEqual({ at: { x: 1.6, y: 3.9 }, rotation: 0, landed: { kind: "surface", deck: null } });
  });

  it("the wall wins on its axis", () => {
    // A's y lines 3.25 / 3.55 / 3.85 are 0.03 from the free box's 3.28 / 3.58 / 3.88; the guide would give y 3.85.
    expect(settle(withCommands(roomDoc(), A), { x: 2, y: 3.58 }, { x: 2, y: 3.9 })).toEqual({ at: { x: 2, y: 3.9 }, rotation: 0, landed: { kind: "surface", deck: null } });
  });

  it("in open floor the guide wins on y too", () => {
    expect(settle(withCommands(roomDoc(), A2), { x: 2, y: 2.58 }, { x: 2, y: 2.9 })).toEqual({ at: { x: 2, y: 2.85 }, rotation: 0, landed: { kind: "surface", deck: null } });
  });

  it("a wall face within the tolerance locks its axis even when the piece is not flush on it", () => {
    // A 1.20 m wide room: inner faces x 0.1 / 1.3, y 0.1 / 2.9. N, a block, x 0.15–0.75, y 2.3–2.9. The 1.00 m piece
    // at x 0.2–1.2 has side gaps of 0.10 it can't turn onto; N's 0.15 is 0.05 from its 0.2, which would give x 0.65.
    const narrow = withCommands(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 1.4, 3), place("n", "block", { x: 0.45, y: 2.9 }));
    expect(settle(narrow, { x: 0.7, y: 1 }, { x: 0.7, y: 1.3 }, { size: { w: 1, d: 0.6 } })).toEqual({ at: { x: 0.7, y: 1.3 }, rotation: 0, landed: { kind: "surface", deck: null } });
  });

  it("a wall face within the tolerance of the free box locks its axis too", () => {
    // B, a bathroom block at rotation 180: x 3.81–5.61. The placed box x 5.1–5.7 is 0.20 from the face x 5.9; the free
    // box x 5.19–5.79 is 0.11 from it. Its centre line 5.49 is 0.12 from B's 5.61, which would give x 5.31–5.91.
    const doc = withCommands(roomDoc(), { type: "placeObject", linked: false, deck: null, opId: "b", state: "s0", object: { kind: "bathroomBlock" }, at: { x: 4.71, y: 1.3 }, rotation: 180 });
    expect(settle(doc, { x: 5.49, y: 0.5 }, { x: 5.4, y: 0.7 })).toEqual({ at: { x: 5.4, y: 0.7 }, rotation: 0, landed: { kind: "surface", deck: null } });
  });

  it("no guide in range keeps contactPlace's place, not the free centre", () => {
    // The free box's left edge 1.48 is 0.18 from S's 1.30, beyond the tolerance.
    expect(settle(withCommands(roomDoc(), S), { x: 1.78, y: 3.58 }, { x: 1.8, y: 3.9 })).toEqual({ at: { x: 1.8, y: 3.9 }, rotation: 0, landed: { kind: "surface", deck: null } });
  });

  it("Ctrl returns contactPlace's place unchanged", () => {
    expect(settle(withCommands(roomDoc(), S), { x: 1.65, y: 3.58 }, { x: 1.65, y: 3.9 }, { ctrl: true })).toEqual({ at: { x: 1.65, y: 3.9 }, rotation: 0, landed: { kind: "surface", deck: null } });
  });

  it("an axis Shift locks out takes no guide", () => {
    const axes = { x: false, y: true };
    expect(settle(withCommands(roomDoc(), S), { x: 1.65, y: 3.58 }, { x: 1.65, y: 3.9 }, { axes })).toEqual({ at: { x: 1.65, y: 3.9 }, rotation: 0, landed: { kind: "surface", deck: null } });
  });

  it("pieces of another layout don't count", () => {
    const doc = withCommands(roomDoc(), { type: "addState", opId: "n", name: "Night" }, place("s", "wardrobe", { x: 0.7, y: 3.9 }, "n/s0"));
    expect(settle(doc, { x: 1.65, y: 3.58 }, { x: 1.65, y: 3.9 })).toEqual({ at: { x: 1.65, y: 3.9 }, rotation: 0, landed: { kind: "surface", deck: null } });
  });
});
