import { describe, expect, it } from "vitest";
import { emptyDocument, execute, placementRange, rectangleRoom, type Command, type Document } from "../src";
import { ceilingOver } from "../src/queries/vertical";
import { fitShapes } from "../src/queries/footprints";

// A piece hung from the ceiling hangs from what is over it (beams.06, .07; AC-04, AC-05): the lower of the ceiling over
// it and the underside of a loft over it that it doesn't stand on (a hollow deck that is a level, beams.21). A 4 × 3 m room of 0.20 m walls on
// centrelines (inner faces x 0.1 / 3.9, y 0.1 / 2.9) with a Loft (top 2.15, underside 2.03) over x 0.1–2.0.

const build = (...cmds: Command[]): Document => {
  let doc = emptyDocument();
  for (const c of cmds) {
    const r = execute(doc, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.error.message}`);
    doc = r.value.doc;
  }
  return doc;
};
const S = (doc: Document): string => Object.keys(doc.states).sort()[0] ?? "";
const loftRoom = (): Document => build(...rectangleRoom({ x: 0, y: 0 }, 4, 3, "c"), { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.05, y: 1.5 }, w: 1.9, d: 2.8, name: "Loft" });
const placed = (doc: Document, kind: string, at: { x: number; y: number }, extra: { size?: { w: number; d: number }; deck?: string; rotation?: number } = {}): { doc: Document; id: string } => {
  const r = execute(doc, { type: "placeObject", opId: "p", state: S(doc), object: { kind, ...(extra.size ? { size: extra.size } : {}) }, at, deck: extra.deck ?? null, ...(extra.rotation !== undefined ? { rotation: extra.rotation } : {}) });
  if (!r.ok) throw new Error(r.error.message);
  const id = Object.values(r.value.doc.placements).find((p) => p.state === S(doc))?.id ?? "";
  return { doc: r.value.doc, id };
};
const range = (r: { doc: Document; id: string }): { bottom: number; top: number } | null => {
  const got = placementRange(r.doc, r.id);
  return got && { bottom: Math.round(got.bottom * 1000) / 1000, top: Math.round(got.top * 1000) / 1000 };
};

describe("under a loft (AC-04)", () => {
  it("a beam wholly under the loft hangs from its underside: 1.83–2.03", () => {
    expect(range(placed(loftRoom(), "beam", { x: 1.05, y: 1.6 }, { size: { w: 1.6, d: 0.15 } }))).toEqual({ bottom: 1.83, top: 2.03 });
  });

  it("a beam straddling the loft's edge hangs from its underside too", () => {
    expect(range(placed(loftRoom(), "beam", { x: 2, y: 1.6 }))).toEqual({ bottom: 1.83, top: 2.03 });
  });

  it("a beam clear of the loft hangs from the ceiling: 2.30–2.50", () => {
    expect(range(placed(loftRoom(), "beam", { x: 3, y: 1.6 }, { size: { w: 1.2, d: 0.15 } }))).toEqual({ bottom: 2.3, top: 2.5 });
  });

  it("a cooker hood under the loft, refused before, hangs under its underside", () => {
    expect(range(placed(loftRoom(), "cookerHood", { x: 1, y: 1 }))).toEqual({ bottom: 1.13, top: 2.03 });
  });

  it("a beam standing on the loft hangs from the ceiling: its own deck is under it", () => {
    expect(range(placed(loftRoom(), "beam", { x: 1.05, y: 1.6 }, { size: { w: 1.6, d: 0.15 }, deck: "loft/k0" }))).toEqual({ bottom: 2.3, top: 2.5 });
  });
});

describe("over a platform (beams.21)", () => {
  // A hollow platform (top 0.45, underside 0.33) at x 2.5–3.5, below the floor's 1.20 cut: not a loft, not a level.
  const platformRoom = (): Document => build(...rectangleRoom({ x: 0, y: 0 }, 4, 3, "c"),
    { type: "addDeck", opId: "plat", preset: "platform", at: { x: 3, y: 1.5 }, w: 1, d: 1, name: "Platform" },
    { type: "setDeck", deckId: "plat/k0", solid: false });

  it("a beam crossing a hollow platform hangs from the ceiling, not the platform's underside", () => {
    expect(range(placed(platformRoom(), "beam", { x: 2, y: 1.6 }))).toEqual({ bottom: 2.3, top: 2.5 });
  });

  it("a beam crossing a solid platform passes over it, hung from the ceiling", () => {
    const solid = build(...rectangleRoom({ x: 0, y: 0 }, 4, 3, "c"), { type: "addDeck", opId: "plat", preset: "platform", at: { x: 3, y: 1.5 }, w: 1, d: 1, name: "Platform" });
    expect(range(placed(solid, "beam", { x: 2, y: 1.6 }))).toEqual({ bottom: 2.3, top: 2.5 });
  });

  it("a block of the same size over the platform is still refused naming it", () => {
    expect(() => placed(platformRoom(), "block", { x: 2, y: 1.6 }, { size: { w: 2.4, d: 0.15 } })).toThrow(/Platform/);
  });
});

describe("under a gable (AC-05)", () => {
  it("a 1.80 m Collar tie across the ridge hangs from the lowest ceiling over its ends, above the eaves", () => {
    const gable = build(...rectangleRoom({ x: 0, y: 0 }, 6, 2.5, "c"), { type: "setCeiling", shape: "gable", height: 2.3, pitch: 35 });
    const r = execute(gable, { type: "placeObject", opId: "t", state: S(gable), object: { kind: "beam", preset: "Collar tie" }, at: { x: 2.075, y: 1.25 }, rotation: 90, deck: null });
    if (!r.ok) throw new Error(r.error.message);
    const id = Object.keys(r.value.doc.placements)[0] ?? "";
    const got = placementRange(r.value.doc, id);
    const ring = fitShapes(r.value.doc).get(id) ?? [];
    expect(got?.top).toBeCloseTo(ceilingOver(r.value.doc, ring), 6);
    expect(got?.top).toBeGreaterThan(2.5);
  });
});
