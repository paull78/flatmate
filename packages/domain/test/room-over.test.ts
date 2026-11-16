import { describe, expect, it } from "vitest";
import type { Point } from "@fm/protocol";
import { candidateShape } from "../src/queries/fit";
import { roomOver } from "../src/queries/room-over";
import { emptyDocument, type Document } from "../src/model";
import { rectangleRoom } from "../src/scripts";
import { run } from "./cabin";
import { rectDoc, withDeck } from "./helpers";

// The room over a footprint (clarity.06, .11): the lowest ceiling or slab over the piece's parts, from what it stands
// on. A 6 × 5 room (inner faces x 0.1–5.9, y 0.1–4.9) under the default 2.50 ceiling. A piece's `at` is the middle of
// its back edge, so a 1.00 × 1.00 chest at (3, 3) covers x 2.5–3.5, y 2–3.

const ROOM = (): Document => rectDoc(0, 0, 6, 5);
/** A loft (hollow, top 2.15, underside 2.03) from x0, y0 to x1, y1. */
const loft = (doc: Document, id: string, x0: number, y0: number, x1: number, y1: number, top = 2.15): Document =>
  withDeck(doc, { id, name: id, at: [(x0 + x1) / 2, (y0 + y1) / 2], w: x1 - x0, d: y1 - y0, top, solid: false });

function over(doc: Document, surface: string | null = null, at: Point = { x: 3, y: 3 }, kind = "block", w = 1, d = 1) {
  const { ring, parts } = candidateShape(kind, at, w, d, 0);
  return roomOver(doc, parts, ring, surface);
}

describe("roomOver", () => {
  it("the ceiling over an open floor", () => {
    expect(over(ROOM())).toEqual({ room: 2.5, under: null });
  });

  it("a loft over the whole footprint", () => {
    expect(over(loft(ROOM(), "up", 2, 1, 4, 4))).toEqual({ room: 2.03, under: "up" });
  });

  it("a loft over part of the footprint counts", () => {
    expect(over(loft(ROOM(), "up", 3.4, 1, 5, 4))).toEqual({ room: 2.03, under: "up" });
  });

  it("a loft beside the footprint doesn't count", () => {
    expect(over(loft(ROOM(), "up", 3.5, 1, 5, 4))).toEqual({ room: 2.5, under: null });
  });

  describe("a loft with a hole, built by commands so validation passes it", () => {
    // A loft at x 1–5, y 1–4 with a hole at x 2–4, y 1.5–3.5, and a platform (top 0.45) inside the hole.
    const holed = (): Document =>
      run(emptyDocument(),
        ...rectangleRoom({ x: 0, y: 0 }, 6, 5, "r"),
        { type: "addDeck", opId: "up", preset: "loft", at: { x: 3, y: 2.5 }, w: 4, d: 3, top: 2.15 },
        { type: "addDeckHole", opId: "h", deck: "up/k0", at: { x: 3, y: 2.5 }, w: 2, d: 2 });

    it("a footprint wholly in a loft's hole counts the ceiling", () => {
      expect(over(holed())).toEqual({ room: 2.5, under: null });
    });

    it("a footprint straddling the hole's edge counts the slab", () => {
      expect(over(holed(), null, { x: 4, y: 3 })).toEqual({ room: 2.03, under: "up/k0" });
    });

    it("a platform inside a loft's hole: measured from the platform's top", () => {
      const doc = run(holed(), { type: "addDeck", opId: "plat", preset: "platform", at: { x: 3, y: 2.5 }, w: 1.6, d: 1.6, top: 0.45 });
      expect(over(doc, "plat/k0", { x: 3, y: 2.9 }, "block", 0.8, 0.8)).toEqual({ room: 2.05, under: null });
    });
  });

  describe("by parts, not the outline", () => {
    // A corner wardrobe, 1.50 × 1.00 with arms of 0.60, at (3, 3): x 2.25–3.75, y 2–3. Its back arm is y 2.4–3 and its
    // left arm x 2.25–2.85, so the empty quarter is x 2.85–3.75, y 2–2.4.
    const wardrobe = (doc: Document) => over(doc, null, { x: 3, y: 3 }, "cornerWardrobe", 1.5, 1);

    it("an `L` piece whose empty quarter alone lies under a loft counts the ceiling", () => {
      expect(wardrobe(loft(ROOM(), "up", 2.95, 0.5, 5, 2.3))).toEqual({ room: 2.5, under: null });
    });

    it("the same loft reaching an arm counts", () => {
      expect(wardrobe(loft(ROOM(), "up", 2.95, 0.5, 5, 2.5))).toEqual({ room: 2.03, under: "up" });
    });
  });

  it("standing on a loft: the ceiling minus its top, to the millimetre", () => {
    // 2.50 − 2.15 isn't 0.35 in floats, and the ghost compares and stores this.
    expect(over(loft(ROOM(), "up", 2, 1, 4, 4), "up")).toEqual({ room: 0.35, under: null });
  });

  it("a solid platform not stood on leaves no room", () => {
    const { room, under } = over(withDeck(ROOM(), { id: "plat", at: [3, 2.5], w: 2, d: 2, top: 0.45, solid: true }));
    expect(room).toBeLessThanOrEqual(0);
    expect(under).toBe("plat");
  });

  it("a deck below the piece still counts, as fit refuses a piece above an underside it overlaps", () => {
    // Not filtered by the piece's bottom (fit.ts `deckClash`): standing on one platform with another under its plan.
    const doc = withDeck(withDeck(ROOM(), { id: "high", at: [2.5, 2.5], w: 1, d: 2, top: 1, solid: true }), { id: "low", at: [3.5, 2.5], w: 1, d: 2, top: 0.45, solid: true });
    expect(over(doc, "high", { x: 3, y: 3 })).toEqual({ room: -1, under: "low" });
  });

  it("the lower of two decks wins, whichever comes first", () => {
    const pair = (a: number, b: number) => loft(loft(ROOM(), "a", 1, 1, 3, 4, a), "b", 3, 1, 5, 4, b);
    expect(over(pair(2.15, 2))).toEqual({ room: 1.88, under: "b" });
    expect(over(pair(2, 2.15))).toEqual({ room: 1.88, under: "a" });
  });
});
