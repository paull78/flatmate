import { describe, expect, it } from "vitest";
import { sameGuards } from "../src/model";
import type { Point } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import { defaultSize } from "../src/kinds";
import type { Document } from "../src/model";
import { footprintQuad, quadCentre } from "../src/queries/footprints";
import { landing, type LandingCandidate } from "../src/queries/landing";
import { levelOf } from "../src/queries/levels";
import { heightsOf } from "../src/queries/vertical";
import { placedPiece } from "../src/shapes";
import { validateDocument } from "../src/validate";
import { place, tinyHouse, withDeck } from "./helpers";

// The landing rule at the floor level (spec "Standing on a deck", "Placing at a level"; decks.11, levels.08): the
// current surface if the piece fits there, else the floor if it fits, else the deck under its footprint's centre among
// the decks below the floor's cut if it fits there; when nothing fits, the first candidate. At the floor it never
// answers "none": validation refuses. Upper levels are landing-levels.test.ts.
//
// The tiny house: main room x 2.1–6.9, y 0.1–2.4, 2.50 m ceiling. The loft (2.15, underside 2.03): x 3.3–5.7,
// y 0.8–2.4, flush with the top wall. The platform (0.45): x 3.5–5.5, y 0.55–1.95.

const LOFT = { id: "loft", name: "Loft", at: [4.5, 1.6] as [number, number], w: 2.4, d: 1.6, top: 2.15, solid: false };
const PLATFORM = { id: "plat", name: "Platform", at: [4.5, 1.25] as [number, number], w: 2, d: 1.4, top: 0.45, solid: true };
type Size = { w: number; d: number; h: number; z?: number };
const MATTRESS: Size = { w: 1.4, d: 1.2, h: 0.35 };

/** A landing candidate for a piece of `kind` anchored at `at`: the kind's size and heights unless `size` is given. */
function candidate(doc: Document, kind: string, at: Point, o: { size?: Size; rotation?: number; current?: string | null; ignore?: string[] } = {}): LandingCandidate {
  const defaults = defaultSize(kind);
  const stored = defaults ? heightsOf(defaults, "standard") : null;
  const w = o.size?.w ?? defaults?.w.standard;
  const d = o.size?.d ?? defaults?.d.standard;
  if (w === undefined || d === undefined || !stored) throw new Error(`no size for ${kind}`);
  const rotation = o.rotation ?? 0;
  const { outline, parts } = placedPiece(kind, at, w, d, rotation);
  return {
    state: "s0",
    ring: outline,
    parts,
    heights: o.size ? { h: o.size.h, z: o.size.z ?? 0 } : stored,
    current: o.current,
    ignore: o.ignore ?? [],
    centre: quadCentre(footprintQuad(at, w, d, rotation)),
  };
}

/** Where `c` lands at the floor level: a deck's ID, null for the floor, or "none". */
function land(doc: Document, c: LandingCandidate): string | null {
  const landed = landing(doc, c, levelOf(doc, null));
  return landed.kind === "surface" ? landed.deck : "none";
}

/** The house with a state s0 holding a far chair, so candidates have a layout. */
const house = (...decks: (typeof LOFT)[]): Document => decks.reduce((doc, k) => withDeck(doc, k), place(tinyHouse(), { object: "x", kind: "chair", at: [0.5, 0.6] }));

describe("landing", () => {
  it("a desk under a loft lands on the floor; so does a mattress, which would also fit on the loft", () => {
    const doc = house(LOFT);
    expect(land(doc, candidate(doc, "desk", { x: 4.5, y: 2.4 }))).toBeNull(); // on the loft its top would be 2.90
    expect(land(doc, candidate(doc, "bed", { x: 4.5, y: 2.4 }, { size: MATTRESS }))).toBeNull(); // the floor comes first
  });

  it("a chair over a solid platform lands on the platform", () => {
    const doc = house(PLATFORM);
    expect(land(doc, candidate(doc, "chair", { x: 4.5, y: 1.5 }))).toBe("plat");
  });

  it("a sofa over a hollow platform lands on top (on the floor it meets the underside at 0.33)", () => {
    const doc = house({ ...PLATFORM, solid: false });
    expect(land(doc, candidate(doc, "sofa", { x: 4.5, y: 1.95 }, { size: { w: 1.8, d: 0.9, h: 0.8 } }))).toBe("plat");
    // A low stool fits under the underside, so it stays on the floor.
    expect(land(doc, candidate(doc, "chair", { x: 4.5, y: 1.5 }, { size: { w: 0.45, d: 0.45, h: 0.3 } }))).toBeNull();
  });

  it("a bed on the loft dragged along it stays on the loft, though the floor would take it", () => {
    let doc = house(LOFT);
    doc = place(doc, { object: "bed", kind: "bed", at: [4, 2.4], size: { w: { standard: 1.4 }, d: { standard: 1.2 }, h: { standard: 0.35 } }, deck: "loft" });
    const along = candidate(doc, "bed", { x: 5, y: 2.4 }, { size: MATTRESS, current: "loft", ignore: ["bed/s0"] }); // x 4.3–5.7
    expect(land(doc, along)).toBe("loft");
  });

  it("a bed on the loft dragged past its edge lands on the floor", () => {
    let doc = house(LOFT);
    doc = place(doc, { object: "bed", kind: "bed", at: [4, 2.4], size: { w: { standard: 1.4 }, d: { standard: 1.2 }, h: { standard: 0.35 } }, deck: "loft" });
    const past = candidate(doc, "bed", { x: 5.4, y: 2.4 }, { size: MATTRESS, current: "loft", ignore: ["bed/s0"] }); // x 4.7–6.1
    expect(land(doc, past)).toBeNull();
    // Dragged where the floor is taken (a wardrobe there), it lands nowhere: the answer is its current surface.
    const taken = place(doc, { object: "w", kind: "wardrobe", at: [6.3, 2.4], size: { w: { standard: 1.2 }, d: { standard: 0.6 }, h: { standard: 1.8 } } }); // x 5.7–6.9
    expect(land(taken, { ...candidate(taken, "bed", { x: 5.4, y: 2.4 }, { size: MATTRESS, current: "loft", ignore: ["bed/s0"] }) })).toBe("loft");
  });

  it("a piece whose centre is on the shared edge of two touching decks lands on the higher", () => {
    // Two platforms turned 45° touch along the line through (4.5, 1.3) at 45°; a corner basin's triangle lies above that
    // line, its footprint's centre on it. On the floor it meets both; it fits only on the upper-left one.
    const off = 0.4 / Math.SQRT2;
    const upper = { id: "b", name: "Upper", at: [4.5 - off, 1.3 + off] as [number, number], w: 1.2, d: 0.8, rotation: 45, top: 0.6, solid: true, finish: null, ...sameGuards("none") };
    const lower = { id: "a", name: "Lower", at: [4.5 + off, 1.3 - off] as [number, number], w: 1.2, d: 0.8, rotation: 45, top: 0.45, solid: true, finish: null, ...sameGuards("none") };
    const basin = { x: 4.5, y: 1.525 };
    const higherUpper = house(upper, lower);
    expect(validateDocument(higherUpper)).toEqual({ ok: true, value: undefined });
    expect(land(higherUpper, candidate(higherUpper, "cornerBasin", basin))).toBe("b");
    // The same decks with the tops swapped: the lower-right one is higher, the basin doesn't fit on it, so the answer is
    // the first candidate, the floor.
    const higherLower = house({ ...upper, top: 0.45 }, { ...lower, top: 0.6 });
    expect(land(higherLower, candidate(higherLower, "cornerBasin", basin))).toBeNull();
  });

  it("nothing fits: answers the current surface, or the floor for a new piece", () => {
    let doc = house(LOFT);
    doc = place(doc, { object: "bed", kind: "bed", at: [4, 2.4], size: { w: { standard: 1.4 }, d: { standard: 1.2 }, h: { standard: 0.35 } }, deck: "loft" });
    const intoWall = { x: 4.5, y: 2.6 }; // across the top wall
    expect(land(doc, candidate(doc, "bed", intoWall, { size: MATTRESS, current: "loft", ignore: ["bed/s0"] }))).toBe("loft");
    expect(land(doc, candidate(doc, "bed", intoWall, { size: MATTRESS }))).toBeNull();
  });

  it("a wardrobe under a loft with no room on it: answers the floor, and validation refuses", () => {
    const doc = house(LOFT);
    expect(land(doc, candidate(doc, "wardrobe", { x: 4.5, y: 2.4 }))).toBeNull(); // on the loft it would reach 4.20
    const r = execute(doc, { type: "placeObject", opId: "w", state: "s0", object: { kind: "wardrobe" }, at: { x: 4.5, y: 2.4 }, deck: null });
    expect(r.ok ? "accepted" : r.error.message).toBe("Wardrobe (0.00–2.05) and Loft (2.03–2.15) overlap in Layout");
  });
});
