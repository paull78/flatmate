import { describe, expect, it } from "vitest";
import type { Point } from "@fm/protocol";
import { defaultSize } from "../src/kinds";
import { CEILING_ID, type Document } from "../src/model";
import { footprintQuad, quadCentre } from "../src/queries/footprints";
import { landing, type LandingCandidate, type Landed } from "../src/queries/landing";
import { levelOf, levels } from "../src/queries/levels";
import { heightsOf } from "../src/queries/vertical";
import { placedPiece } from "../src/shapes";
import { validateDocument } from "../src/validate";
import { place, tinyHouse, withDeck } from "./helpers";

// Landing per level (spec "Placing at a level", levels.08, .16, .20, .23): the current surface if the piece fits on
// it, at any level, then the viewed level's candidates. At the floor: the floor, then the deck under the centre among
// the decks below the floor's cut. At an upper level: the deck under the centre among the level's decks, and "none"
// when there is no such deck.
//
// The studio: the tiny house (main room x 2.1–6.9, y 0.1–2.4) under a 3.20 ceiling, so the floor's cut is 1.20 and
// the loft's 2.675. The loft (2.15, underside 2.03): x 4.5–6.9, y 0.1–2.4. The platform (0.45, solid): x 2.3–3.7,
// y 0.2–1.2. A desk on the floor under the loft: x 4.6–5.8, y 1.8–2.4.

const LOFT = { id: "loft", name: "Loft", at: [5.7, 1.25] as [number, number], w: 2.4, d: 2.3, top: 2.15, solid: false };
const PLATFORM = { id: "plat", name: "Platform", at: [3, 0.7] as [number, number], w: 1.4, d: 1, top: 0.45, solid: true };
type Size = { w: number; d: number; h: number };
const MATTRESS: Size = { w: 1.4, d: 1.2, h: 0.35 };

const studio = (platformTop = 0.45): Document => {
  let doc: Document = { ...tinyHouse(), ceilings: { [CEILING_ID]: { id: CEILING_ID, height: 3.2 } } };
  doc = withDeck(withDeck(doc, LOFT), { ...PLATFORM, top: platformTop });
  return place(doc, { object: "desk", kind: "desk", at: [5.2, 2.4] });
};
const withMattress = (doc: Document): Document =>
  place(doc, { object: "mat", kind: "bed", at: [5.4, 1.5], size: { w: { standard: 1.4 }, d: { standard: 1.2 }, h: { standard: 0.35 } }, deck: "loft" }); // x 4.7–6.1, y 0.3–1.5

/** A landing candidate for a piece of `kind` anchored at `at`: the kind's size and heights unless `size` is given. */
function candidate(kind: string, at: Point, o: { size?: Size; rotation?: number; current?: string | null; ignore?: string[] } = {}): LandingCandidate {
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
    heights: o.size ? { h: o.size.h, z: 0 } : stored,
    current: o.current,
    ignore: o.ignore ?? [],
    centre: quadCentre(footprintQuad(at, w, d, rotation)),
  };
}

const on = (deck: string | null): Landed => ({ kind: "surface", deck });
const NONE: Landed = { kind: "none" };
const floor = (doc: Document) => levelOf(doc, null);
const loft = (doc: Document) => levelOf(doc, "loft");
const BED_OVER_LOFT: Point = { x: 5.7, y: 2.35 }; // the default bed 1.70 × 2.10: x 4.85–6.55, y 0.25–2.35, over the desk

describe("landing per level", () => {
  it("the studio is valid and has two levels", () => {
    expect(validateDocument(withMattress(studio()))).toEqual({ ok: true, value: undefined });
    expect(levels(studio()).map((l) => [l.height, l.deckIds, l.cut])).toEqual([[0, [], 1.2], [2.15, ["loft"], 2.675]]);
  });

  it("› at the loft: a bed over the loft lands on it; beside it answers none", () => {
    const doc = studio();
    expect(landing(doc, candidate("bed", BED_OVER_LOFT), loft(doc))).toEqual(on("loft"));
    expect(landing(doc, candidate("bed", { x: 3.3, y: 2.35 }), loft(doc))).toEqual(NONE); // centre (3.3, 1.3), off the loft
  });

  it("› at the loft: the mattress on the loft, dragged across it, stays (current)", () => {
    const doc = withMattress(studio());
    expect(landing(doc, candidate("bed", { x: 6.1, y: 1.5 }, { size: MATTRESS, current: "loft", ignore: ["mat/s0"] }), loft(doc))).toEqual(on("loft"));
  });

  it("› dragged off the edge with its centre outside: none", () => {
    const doc = withMattress(studio());
    // x 3.5–4.9, centre (4.2, 0.9): left of the loft's edge at 4.5. The current loft no longer fits, and no deck of
    // the level is under the centre.
    expect(landing(doc, candidate("bed", { x: 4.2, y: 1.5 }, { size: MATTRESS, current: "loft", ignore: ["mat/s0"] }), loft(doc))).toEqual(NONE);
  });

  it("› at the floor: a desk under the loft lands on the floor; a chair on the platform lands on it", () => {
    const doc = studio();
    expect(landing(doc, candidate("desk", { x: 6.2, y: 1 }), floor(doc))).toEqual(on(null)); // x 5.6–6.8, y 0.4–1.0
    expect(landing(doc, candidate("chair", { x: 3, y: 1 }), floor(doc))).toEqual(on("plat"));
  });

  it("› at the floor: a bed over the loft where the desk blocks the floor answers the floor (refused by validation), not the loft", () => {
    const doc = studio();
    // Before the cycle the loft came next and the bed (2.15–3.15) fitted there (levels.20).
    expect(landing(doc, candidate("bed", BED_OVER_LOFT), floor(doc))).toEqual(on(null));
  });

  it("› at the floor: the mattress on the loft dragged across it stays on the loft (current at another level)", () => {
    const doc = withMattress(studio());
    // x 5.4–6.8, y 0.3–1.5: the floor there is free, so only the current surface keeps it up.
    expect(landing(doc, candidate("bed", { x: 6.1, y: 1.5 }, { size: MATTRESS, ignore: ["mat/s0"] }), floor(doc))).toEqual(on(null));
    expect(landing(doc, candidate("bed", { x: 6.1, y: 1.5 }, { size: MATTRESS, current: "loft", ignore: ["mat/s0"] }), floor(doc))).toEqual(on("loft"));
  });

  it("› at the loft: on the shared edge of the 2.15 loft and a touching 2.30 loft, only the 2.15 one counts", () => {
    // A 2.30 loft at x 3.9–4.5 touches the 2.15 one along x = 4.5. A corner basin turned −135° has its long side on
    // that line and its triangle on the 2.15 loft; its footprint's centre is the long side's middle, on both decks.
    const doc = withDeck(studio(), { id: "high", name: "High loft", at: [4.2, 1.25], w: 0.6, d: 2.3, top: 2.3, solid: false });
    expect(validateDocument(doc)).toEqual({ ok: true, value: undefined });
    const size = { w: 0.45, d: 0.45, h: 0.3 };
    const r = Math.SQRT1_2 * 0.225; // the anchor is the back edge's middle, d/2 from the centre, turned −135°
    const c = candidate("cornerBasin", { x: 4.5 + r, y: 1.2 - r }, { size, rotation: -135 });
    expect(c.centre?.x).toBeCloseTo(4.5, 9);
    expect(c.ring.every((p) => p.x >= 4.5 - 1e-9)).toBe(true);
    expect(landing(doc, c, loft(doc))).toEqual(on("loft"));
    expect(landing(doc, c, levelOf(doc, "high"))).toEqual(on("high")); // its only candidate; validation refuses
  });

  it("› a deck at exactly the floor's cut is a level's, not a floor candidate; 1 mm below is a floor candidate", () => {
    // A chair over the solid platform meets it on the floor, so it stands on the platform or nowhere.
    const chair = candidate("chair", { x: 3, y: 1 });
    const atCut = studio(1.2);
    expect(landing(atCut, chair, floor(atCut))).toEqual(on(null));
    expect(landing(atCut, chair, levelOf(atCut, "plat"))).toEqual(on("plat"));
    const below = studio(1.199);
    expect(landing(below, chair, floor(below))).toEqual(on("plat"));
  });
});
