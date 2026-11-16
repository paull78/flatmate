import { describe, expect, it } from "vitest";
import { clearanceWarnings, deckRing, emptyDocument, execute, inConvex, rectangleRoom, zoneRings, type Command, type Document } from "../src";

// A use zone's height and edge (AC-04, AC-05, studio.09). The platform runs x 1.5–4.5, y 1.75–3.25, top 0.45, hollow, with
// room for 0.33 below. The sofa on it runs y 2.25–3.15, its front zone 1.00 deep, which stops at the platform's edge y 1.75.

const PLAT = "plat/k0";
// A 0.40 square centred on `at`, its anchor the middle of its back.
const box = (opId: string, at: { x: number; y: number }, h: number, deck: string | null = null, z = 0): Command[] => [
  { type: "placeObject", opId, state: "s0", object: { kind: "block", size: { w: 0.4, d: 0.4, h } }, at: { x: at.x, y: at.y + 0.2 }, rotation: 0, deck },
  ...(z > 0 ? [{ type: "setObjectSize" as const, objectId: `${opId}/o0`, w: 0.4, d: {}, z: { standard: z } }] : []),
];
const forward = (opId: string, atY: number): Command[] => [
  { type: "placeObject", opId, state: "s0", object: { kind: "counter", size: { w: 0.6, d: 0.6 } }, at: { x: 3, y: atY }, rotation: 180, deck: null },
  { type: "setZoneSides", placementId: `${opId}/p0`, sides: { front: true, back: false, left: false, right: false } },
  { type: "setZoneExtent", placementId: `${opId}/p0`, side: "front", extent: { depth: 1, start: 0, end: 0 } },
];
function build(cmds: Command[]): Document {
  let doc = emptyDocument();
  for (const c of [...rectangleRoom({ x: 0, y: 0 }, 6, 4, "r"), ...cmds]) {
    const r = execute(doc, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.error.message}`);
    doc = r.value.doc;
  }
  return doc;
}
function house(...more: Command[]): Document {
  return build([
    { type: "addDeck", opId: "plat", preset: "platform", at: { x: 3, y: 2.5 }, w: 3, d: 1.5, top: 0.45, solid: false },
    { type: "placeObject", opId: "sofa", state: "s0", object: { kind: "sofa", preset: "2 seats" }, at: { x: 3, y: 3.15 }, rotation: 0, deck: PLAT },
    { type: "setZoneSides", placementId: "sofa/p0", sides: { front: true, back: false, left: false, right: false } },
    { type: "setZoneExtent", placementId: "sofa/p0", side: "front", extent: { depth: 1, start: 0, end: 0 } },
    ...more,
  ]);
}
const blocked = (doc: Document): string[] => clearanceWarnings(doc, "s0").filter((w) => w.zone.table === "placements" && w.zone.id === "sofa/p0").map((w) => w.against.id);

describe("a zone's height range", () => {
  it("a bed stowed under the platform doesn't block the zone of a sofa on it", () => {
    expect(blocked(house(...box("bed", { x: 3, y: 2 }, 0.3)))).toEqual([]);
  });

  it("a piece on the platform in that zone still does", () => {
    expect(blocked(house(...box("chair", { x: 3, y: 2 }, 0.9, PLAT)))).toEqual(["chair/p0"]);
  });

  it("a piece hung 0.85 above the platform (1.30 over the floor) blocks it; from 1.20 above the platform it doesn't (loft.07)", () => {
    // decks.18 measured 1.20 from the floor, so this shelf at 1.30 blocked nothing; the band now runs 0.45 to 1.65.
    expect(blocked(house(...box("shelf", { x: 3, y: 2 }, 0.3, PLAT, 0.85)))).toEqual(["shelf/p0"]);
    expect(blocked(house(...box("shelf", { x: 3, y: 2 }, 0.3, PLAT, 1.2)))).toEqual([]);
  });

  it("a floor piece's zone is still blocked by what stands on the floor, and by a platform's piece over it", () => {
    const low = clearanceWarnings(house(...forward("t", 0.3), ...box("low", { x: 3, y: 1.3 }, 0.3)), "s0").filter((w) => w.zone.table === "placements" && w.zone.id === "t/p0");
    expect(low.map((w) => w.against.id)).toEqual(["low/p0"]);
    const high = clearanceWarnings(house(...forward("t", 0.6), ...box("up", { x: 3, y: 2 }, 0.9, PLAT)), "s0").filter((w) => w.zone.table === "placements" && w.zone.id === "t/p0");
    expect(high.map((w) => w.against.id)).toEqual(["up/p0"]);
  });
});

describe("a zone off a deck's edge", () => {
  it("is drawn up to the edge", () => {
    const doc = house();
    const ring = zoneRings(doc).get("sofa/p0")?.find((z) => z.side === "front")?.ring ?? [];
    expect(Math.min(...ring.map((p) => p.y))).toBeCloseTo(1.75, 6);
    expect(Math.max(...ring.map((p) => p.y))).toBeCloseTo(2.25, 6);
  });

  it("isn't blocked by a piece on the floor beyond the edge", () => {
    expect(blocked(house(...box("floor", { x: 3, y: 1.5 }, 0.75)))).toEqual([]);
  });

  it("on a turned deck it still stays on the deck", () => {
    const turn = (10 * Math.PI) / 180;
    const doc = build([
      { type: "addDeck", opId: "plat", preset: "platform", at: { x: 3, y: 2 }, w: 3, d: 2.4, top: 0.45, rotation: 10, solid: false },
      { type: "placeObject", opId: "sofa", state: "s0", object: { kind: "sofa", preset: "2 seats" }, at: { x: 3 - 0.9 * Math.sin(turn), y: 2 + 0.9 * Math.cos(turn) }, rotation: 10, deck: PLAT },
      { type: "setZoneSides", placementId: "sofa/p0", sides: { front: true, back: false, left: false, right: false } },
      { type: "setZoneExtent", placementId: "sofa/p0", side: "front", extent: { depth: 2, start: 0, end: 0 } },
    ]);
    const ring = zoneRings(doc).get("sofa/p0")?.find((z) => z.side === "front")?.ring ?? [];
    const deck = doc.decks[PLAT];
    if (!deck) throw new Error("no deck");
    expect(ring.length).toBeGreaterThan(2);
    for (const p of ring) expect(inConvex(p, deckRing(deck), 1e-6)).toBe(true);
  });

  it("a piece at the very edge has no zone on that side to draw or block", () => {
    const doc = house(
      { type: "movePlacement", placementId: "sofa/p0", at: { x: 3, y: 2.65 }, rotation: 0 }, // its front on the edge y 1.75
      ...box("floor", { x: 3, y: 1.5 }, 0.75),
    );
    expect(zoneRings(doc).get("sofa/p0")?.find((z) => z.side === "front")).toBeUndefined();
    expect(blocked(doc)).toEqual([]);
  });

  it("a piece on the floor keeps its whole zone", () => {
    const doc = house(...forward("t", 0.3));
    const ring = zoneRings(doc).get("t/p0")?.find((z) => z.side === "front")?.ring ?? [];
    expect(Math.max(...ring.map((p) => p.y))).toBeCloseTo(1.9, 6);
  });
});

// Zones on a loft (loft.07): a zone's band runs from its piece's surface to 1.20 m above it, for pieces and walls alike.
// The loft runs x 1–5, y 0.1–3.9, top 2.15 (underside 2.03), under a 4.50 ceiling. A counter turned to face +y stands
// at x 2.7–3.3, y 0.3–0.9; its front zone, 1.00 deep, runs y 0.9–1.9.
const LOFT = "loft/k0";
const facing = (opId: string, deck: string | null, z = 0): Command[] => [
  { type: "placeObject", opId, state: "s0", object: { kind: "counter", size: { w: 0.6, d: 0.6 } }, at: { x: 3, y: 0.3 }, rotation: 180, deck },
  { type: "setZoneSides", placementId: `${opId}/p0`, sides: { front: true, back: false, left: false, right: false } },
  { type: "setZoneExtent", placementId: `${opId}/p0`, side: "front", extent: { depth: 1, start: 0, end: 0 } },
  ...(z > 0 ? [{ type: "setObjectSize" as const, objectId: `${opId}/o0`, w: 0.6, d: {}, z: { standard: z } }] : []),
];
const lofted = (...more: Command[]): Document => build([
  { type: "setCeiling", height: 4.5 },
  { type: "addDeck", opId: "loft", preset: "loft", at: { x: 3, y: 2 }, w: 4, d: 3.8 },
  ...more,
]);
const blocksOf = (doc: Document, id: string): string[] =>
  clearanceWarnings(doc, "s0").filter((w) => w.zone.table === "placements" && w.zone.id === id).map((w) => w.against.id);
const across = (opId: string, extra: { base?: string; top?: number } = {}): Command =>
  ({ type: "addWall", opId, from: { at: { x: 2.4, y: 1.4 } }, to: { at: { x: 3.6, y: 1.4 } }, thickness: 0.1, ...extra });

describe("zones on a loft (loft.07)", () => {
  it("a piece on the loft in another loft piece's zone blocks it, as on the floor (AC-01)", () => {
    expect(blocksOf(lofted(...facing("c", LOFT), ...box("b", { x: 3, y: 1.4 }, 0.9, LOFT)), "c/p0")).toEqual(["b/p0"]);
    expect(blocksOf(build([...facing("c", null), ...box("b", { x: 3, y: 1.4 }, 0.9)]), "c/p0")).toEqual(["b/p0"]);
  });

  it("a piece hung 1.10 above the loft blocks a loft zone; at 1.30 it doesn't (AC-02)", () => {
    expect(blocksOf(lofted(...facing("c", LOFT), ...box("b", { x: 3, y: 1.4 }, 0.3, LOFT, 1.1)), "c/p0")).toEqual(["b/p0"]);
    expect(blocksOf(lofted(...facing("c", LOFT), ...box("b", { x: 3, y: 1.4 }, 0.3, LOFT, 1.3)), "c/p0")).toEqual([]);
  });

  it("a loft piece hung 1.30 above the loft owns no zone that warns; at 1.10 it does (AC-02)", () => {
    expect(blocksOf(lofted(...facing("c", LOFT, 1.3), ...box("b", { x: 3, y: 1.4 }, 0.9, LOFT)), "c/p0")).toEqual([]);
    expect(blocksOf(lofted(...facing("c", LOFT, 1.1), ...box("b", { x: 3, y: 1.4 }, 0.9, LOFT)), "c/p0")).toEqual(["b/p0"]);
  });

  it("a floor wall that stops under the loft doesn't block a loft zone; it blocks a floor zone (AC-03)", () => {
    expect(blocksOf(lofted(across("w", { top: 2.0 }), ...facing("c", LOFT)), "c/p0")).toEqual([]);
    expect(blocksOf(lofted(across("w", { top: 2.0 }), ...facing("c", null)), "c/p0")).toEqual(["w/w0"]);
  });

  it("a wall standing on the loft blocks a loft zone and no floor zone under it (AC-03)", () => {
    expect(blocksOf(lofted(across("w", { base: LOFT }), ...facing("c", LOFT)), "c/p0")).toEqual(["w/w0"]);
    expect(blocksOf(lofted(across("w", { base: LOFT }), ...facing("c", null)), "c/p0")).toEqual([]);
  });
});
