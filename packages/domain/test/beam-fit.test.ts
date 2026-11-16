import { describe, expect, it } from "vitest";
import { emptyDocument, execute, placementFit, rectangleRoom, type Command, type Document } from "../src";

// Beams into walls (beams.05; AC-02, AC-03). A 3 × 3 m room of 0.20 m walls on centrelines: inner faces at 0.1 and
// 2.9, outer faces at −0.1 and 3.1. At rotation 0 a piece's back edge is at `at.y`, its front at `at.y − d`.

const build = (...cmds: Command[]): Document => {
  let doc = emptyDocument();
  for (const c of cmds) {
    const r = execute(doc, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.error.message}`);
    doc = r.value.doc;
  }
  return doc;
};
const room = (): Document => build(...rectangleRoom({ x: 0, y: 0 }, 3, 3, "c"));
const S = (doc: Document): string => Object.keys(doc.states).sort()[0] ?? "";
const place = (opId: string, kind: string, x: number, backY: number, size?: { w: number; d: number; h?: number }): (doc: Document) => Command => (doc) => ({
  type: "placeObject", opId, state: S(doc), object: { kind, ...(size ? { size } : {}) }, at: { x, y: backY }, deck: null,
});
const refusal = (doc: Document, make: (doc: Document) => Command): string | null => {
  const r = execute(doc, make(doc));
  return r.ok ? null : r.error.message;
};
const ok = (doc: Document, make: (doc: Document) => Command): Document => {
  const r = execute(doc, make(doc));
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
};
const previews = (doc: Document, kind: string, x: number, backY: number, size: { w: number; d: number; h?: number }): boolean =>
  placementFit(doc, { kind, state: S(doc), at: { x, y: backY }, rotation: 0, config: "standard", surface: null, w: size.w, d: size.d, ...(size.h !== undefined ? { h: size.h } : {}) }).fits;

/** A 3.20 m beam from x −0.1 to 3.1, into both side walls to their outer faces, at y 1.45–1.6. */
const ACROSS = { w: 3.2, d: 0.15 };

describe("a beam into walls (AC-02)", () => {
  it("a 3.20 m beam across the room, its ends into both walls, is accepted, and the preview agrees", () => {
    expect(refusal(room(), place("b", "beam", 1.5, 1.6, ACROSS))).toBeNull();
    expect(previews(room(), "beam", 1.5, 1.6, ACROSS)).toBe(true);
  });

  it("a block of the same size, hung no differently, is refused against the wall", () => {
    expect(refusal(room(), place("k", "block", 1.5, 1.6, { ...ACROSS, h: 0.2 }))).toMatch(/overlaps a wall/);
  });

  it("a beam whose centre lies under a wall is refused as not inside a room, and the preview agrees", () => {
    // y −0.075 to 0.075: its centre at y 0, in the lower wall's body.
    expect(refusal(room(), place("b", "beam", 1.5, 0.075))).toMatch(/not inside a room/);
    expect(previews(room(), "beam", 1.5, 0.075, { w: 2.4, d: 0.15 })).toBe(false);
  });

  it("a beam still meets a deck: lowered through a loft's slab it is refused", () => {
    const loft = build(...rectangleRoom({ x: 0, y: 0 }, 3, 3, "c"), { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.5, y: 2.4 }, w: 2.8, d: 1, name: "Loft" });
    const placed = ok(loft, place("b", "beam", 1.5, 1.2));
    // 2.00–2.20 crosses the slab's 2.03–2.15; moved under the loft it meets it.
    const low = ok(placed, () => ({ type: "setObjectSize", objectId: "b/o0", w: 2.4, d: { standard: 0.15 }, h: { standard: 0.2 }, z: { standard: 2 } }));
    const id = Object.keys(low.placements)[0] ?? "";
    expect(refusal(low, () => ({ type: "movePlacement", placementId: id, at: { x: 1.5, y: 2.5 }, rotation: 0 }))).toMatch(/Loft/);
  });
});

describe("pieces under a beam (AC-03)", () => {
  const withBeam = (): Document => ok(room(), place("b", "beam", 1.5, 1.6, ACROSS)); // 2.30–2.50

  it("a 2.00 m wardrobe under it fits; a 2.40 m one is refused naming the Beam", () => {
    expect(refusal(withBeam(), place("w", "wardrobe", 1.5, 1.9, { w: 1, d: 0.6, h: 2 }))).toBeNull();
    expect(refusal(withBeam(), place("w", "wardrobe", 1.5, 1.9, { w: 1, d: 0.6, h: 2.4 }))).toMatch(/Beam/);
  });
});
