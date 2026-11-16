import { describe, expect, it } from "vitest";
import { CEILING_ID, type Document, type Wall } from "../src/model";
import {
  PLAN_CUT, ZONE_CLEAR_ABOVE, ceilingAlong, ceilingHeight, ceilingOver, clearAbove, cutHeight, defaultOpeningHeights, elevationOf, heightsOf, openingRange, placementRange, rangeOf,
  pickOrder, rangesOverlap, relationToCut, solids, stackOrder, surfaceTop, wallRange, type Range,
} from "../src/queries/vertical";
import { place, rectDoc, tinyHouse, withDeck, withOpening } from "./helpers";

// Every vertical fact is resolved in queries/vertical.ts (heights.27): ranges, the ceiling, the cut, the solids.

const withCeiling = (doc: Document, height: number): Document => ({ ...doc, ceilings: { [CEILING_ID]: { id: CEILING_ID, height } } });
const withTop = (doc: Document, wallId: string, top: Wall["top"]): Document => {
  const w = doc.walls[wallId];
  if (!w) throw new Error(`unknown wall ${wallId}`);
  return { ...doc, walls: { ...doc.walls, [wallId]: { ...w, top } } };
};
const r = (bottom: number, top: number): Range => ({ bottom, top });
const SQUARE = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }];

describe("rangesOverlap boundary table", () => {
  it.each<[string, Range, Range, boolean]>([
    ["desk top touching a loft bed's underside", r(0, 0.75), r(0.75, 1.1), false],
    ["a loft bed from 1.45 + 0.35 against a piece from 1.80", r(1.45, 1.45 + 0.35), r(1.8, 2.5), false],
    ["0.5 mm into each other", r(0, 0.7505), r(0.75, 1.1), false],
    ["1 mm into each other, at the tolerance", r(0, 0.751), r(0.75, 1.1), false],
    ["2 mm into each other", r(0, 0.752), r(0.75, 1.1), true],
    ["0.5 mm apart", r(0, 0.7495), r(0.75, 1.1), false],
    ["one inside the other", r(0.2, 0.4), r(0, 1), true],
    ["the same range", r(0, 0.9), r(0, 0.9), true],
    ["float noise: 0.1 + 0.2 against 0.3", r(0, 0.1 + 0.2), r(0.3, 1), false],
  ])("%s", (_name, a, b, overlap) => {
    expect(rangesOverlap(a, b)).toBe(overlap);
    expect(rangesOverlap(b, a)).toBe(overlap);
  });
});

describe("the ceiling", () => {
  it("ceilingHeight defaults to 2.50 without a row, and reads the row", () => {
    expect(ceilingHeight(rectDoc(0, 0, 4, 3))).toBe(2.5);
    expect(ceilingHeight(withCeiling(rectDoc(0, 0, 4, 3), 2.2))).toBe(2.2);
  });

  it("ceilingOver is the minimum over the ring's corners (flat today: always the height), and the height for no corners", () => {
    const doc = withCeiling(rectDoc(0, 0, 4, 3), 2.2);
    expect(ceilingOver(doc, SQUARE)).toBe(2.2);
    expect(ceilingOver(doc, [])).toBe(2.2);
    expect(ceilingAlong(doc, "W1")).toBe(2.2);
  });
});

describe("ranges", () => {
  it("a \"ceiling\" elevation resolves to ceiling minus height", () => {
    const doc = rectDoc(0, 0, 4, 3);
    const up = { h: 0.35, z: "ceiling" } as const;
    expect(rangeOf(doc, up, SQUARE, null)).toEqual({ bottom: 2.5 - 0.35, top: 2.5 });
    expect(rangeOf(withCeiling(doc, 2.2), up, SQUARE, null)).toEqual({ bottom: 2.2 - 0.35, top: 2.2 });
    expect(rangeOf(doc, { h: 0.35, z: 1.45 }, SQUARE, null)).toEqual({ bottom: 1.45, top: 1.45 + 0.35 });
  });

  it("heightsOf reads one configuration of an object, null for one it lacks", () => {
    const object = { h: { folded: 2.24, down: 2.2 }, z: { folded: 0, down: "ceiling" as const } };
    expect(heightsOf(object, "down")).toEqual({ h: 2.2, z: "ceiling" });
    expect(heightsOf(object, "folded")).toEqual({ h: 2.24, z: 0 });
    expect(heightsOf(object, "open")).toBeNull();
  });

  it("placementRange reads the placement's configuration: the same object differs between states", () => {
    let doc = place(rectDoc(0, 0, 6, 4), { object: "m", kind: "murphyBed", at: [3, 3.9], config: "folded" });
    doc = place(doc, { object: "m", kind: "murphyBed", at: [3, 3.9], state: "n", config: "down" });
    const m = doc.objects.m;
    if (!m) throw new Error("no object");
    doc = { ...doc, objects: { ...doc.objects, m: { ...m, z: { folded: 0.1, down: 0 } } } };
    expect(placementRange(doc, "m/s0")).toEqual({ bottom: 0.1, top: 0.1 + 2.24 });
    expect(placementRange(doc, "m/n")).toEqual({ bottom: 0, top: 2.24 });
    expect(placementRange(doc, "nope")).toBeNull();
  });

  it("wallRange: a \"ceiling\" wall spans 0 to the ceiling and follows it; a 1.10 wall keeps 1.10 (AC-02)", () => {
    const doc = withTop(rectDoc(0, 0, 4, 3), "W2", 1.1);
    expect(wallRange(doc, "W1")).toEqual({ bottom: 0, top: 2.5 });
    expect(wallRange(doc, "W2")).toEqual({ bottom: 0, top: 1.1 });
    const lower = withCeiling(doc, 2.2);
    expect(wallRange(lower, "W1")).toEqual({ bottom: 0, top: 2.2 });
    expect(wallRange(lower, "W2")).toEqual({ bottom: 0, top: 1.1 });
    expect(wallRange(doc, "W9")).toBeNull();
  });
});

describe("the cut and the clear height", () => {
  it.each([[2.5, 1.2], [2.2, 1.1], [1, 0.5], [10, 1.2], [2.4, 1.2]])("cutHeight under %f is %f: min(1.20, ceiling / 2)", (ceiling, cut) => {
    expect(cutHeight(withCeiling(rectDoc(0, 0, 4, 3), ceiling))).toBeCloseTo(cut, 12);
  });

  it("relationToCut: below, crossing, above; a bottom exactly at the cut counts as above, a top exactly at it as below", () => {
    expect(relationToCut(r(0, 0.75), 1.2)).toBe("below");
    expect(relationToCut(r(0, 1.2), 1.2)).toBe("below");
    expect(relationToCut(r(0, 2.05), 1.2)).toBe("crossing");
    expect(relationToCut(r(1.2, 1.95), 1.2)).toBe("above");
    expect(relationToCut(r(1.4, 2.15), 1.2)).toBe("above");
    expect(relationToCut(r(1.1999, 2), 1.2)).toBe("above"); // within the tolerance
    expect(relationToCut(r(1.19, 2), 1.2)).toBe("crossing");
  });

  it("relationToCut with a base: top at the base is under, 1 mm above is below the cut; base 0 never answers under", () => {
    const base = 2.15;
    const cut = 2.325;
    expect(relationToCut(r(2.03, 2.15), cut, base)).toBe("under"); // the loft's own slab
    expect(relationToCut(r(0, 2.03), cut, base)).toBe("under"); // the partition under it
    expect(relationToCut(r(0, 2.1504), cut, base)).toBe("under"); // float noise within the millimetre
    expect(relationToCut(r(0, 2.151), cut, base)).toBe("below");
    expect(relationToCut(r(2.15, 2.3), cut, base)).toBe("below");
    expect(relationToCut(r(0, 2.5), cut, base)).toBe("crossing");
    expect(relationToCut(r(2.4, 2.5), cut, base)).toBe("above");
    expect(relationToCut(r(0, 0), 1.2)).toBe("below");
    expect(relationToCut(r(0, 0), 1.2, 0)).toBe("below");
  });

  it("clearAbove ignores the ceiling: a piece from 1.20 is clear, 1.15 is not (heights.36)", () => {
    // Two rules that share a value, not one (cleanup step 11).
    expect(ZONE_CLEAR_ABOVE).toBe(1.2);
    expect(PLAN_CUT).toBe(1.2);
    expect(clearAbove(r(1.2, 1.55))).toBe(true);
    expect(clearAbove(r(1.45, 1.8))).toBe(true);
    expect(clearAbove(r(1.15, 1.5))).toBe(false);
    expect(clearAbove(r(0.2, 0.55))).toBe(false);
    // The lift bed at the ceiling under 2.20 still clears: the predicate never reads the ceiling.
    const doc = withCeiling(rectDoc(0, 0, 4, 3), 2.2);
    expect(clearAbove(rangeOf(doc, { h: 0.35, z: "ceiling" }, SQUARE, null))).toBe(true);
  });
});

describe("stacking and solids", () => {
  it("stackOrder sorts by bottom, lowest first, then by ID; bottoms within a millimetre's noise tie", () => {
    const items = [
      { id: "c", range: r(1.45, 1.8) },
      { id: "b", range: r(0, 0.75) },
      { id: "a", range: r(0.1 + 0.2, 1) },
      { id: "z", range: r(0, 2) },
      { id: "d", range: r(0.3, 0.9) },
    ];
    expect([...items].sort(stackOrder).map((x) => x.id)).toEqual(["b", "z", "a", "d", "c"]);
  });

  it("a seat draws before other pieces at the same bottom and is picked after them (seating.10)", () => {
    const items = [
      { id: "a", range: r(0, 0.9), seat: true },
      { id: "b", range: r(0, 0.75) },
      { id: "c", range: r(0.3, 0.9), seat: true },
      { id: "d", range: r(0, 0.9), seat: true },
      { id: "e", range: r(0, 0.75) },
    ];
    expect([...items].sort(stackOrder).map((x) => x.id)).toEqual(["a", "d", "b", "e", "c"]);
    expect([...items].sort(pickOrder).map((x) => x.id)).toEqual(["b", "e", "a", "d", "c"]);
  });

  it("solids lists placements per state and walls with null state, memoised", () => {
    let doc = withTop(rectDoc(0, 0, 6, 4), "W2", 1.1);
    doc = place(doc, { object: "d", kind: "desk", at: [3, 3.9] });
    doc = place(doc, { object: "d", kind: "desk", at: [2, 3.9], state: "n" });
    const all = solids(doc);
    expect(solids(doc)).toBe(all);
    const byKey = new Map(all.map((s) => [`${s.key.table}/${s.key.id}`, s]));
    expect([...byKey.keys()].sort()).toEqual(["placements/d/n", "placements/d/s0", "walls/W1", "walls/W2", "walls/W3", "walls/W4"]);
    expect(byKey.get("walls/W2")).toMatchObject({ state: null, range: { bottom: 0, top: 1.1 } });
    expect(byKey.get("walls/W1")).toMatchObject({ state: null, range: { bottom: 0, top: 2.5 } });
    expect(byKey.get("placements/d/n")).toMatchObject({ state: "n", range: { bottom: 0, top: 0.75 } });
    expect(byKey.get("placements/d/s0")?.ring).toHaveLength(4);
    expect(solids({ ...doc })).not.toBe(all);
  });
});

describe("standing on a deck (decks.04, .16)", () => {
  // The tiny house with a loft (top 2.15, underside 2.03) across the partition, x 0.8–3.2, y 0.6–2.4, and a 2.00 × 1.60
  // mattress (0.35 high) on it in Night with its back on the top wall's inner face.
  const MATTRESS = { w: { standard: 2 }, d: { standard: 1.6 }, h: { standard: 0.35 }, z: { standard: 0 } };
  const loft = (top: number): Document => withDeck(tinyHouse(), { id: "loft", name: "Loft", at: [2, 1.5], w: 2.4, d: 1.8, top, solid: false });
  const onLoft = (top: number): Document => place(loft(top), { object: "bed", kind: "bed", at: [2, 2.4], state: "night", size: MATTRESS, deck: "loft" });

  it("a bed with elevation 0 on a loft at 2.15 spans 2.15–2.50", () => {
    expect(placementRange(onLoft(2.15), "bed/night")).toEqual({ bottom: 2.15, top: 2.15 + 0.35 });
  });

  it("surfaceTop is 0 for the floor and the deck's top for a deck", () => {
    expect(surfaceTop(onLoft(2.15), null)).toBe(0);
    expect(surfaceTop(onLoft(2.15), "loft")).toBe(2.15);
  });

  it("a \"ceiling\" elevation hangs from what is over it: on the loft the ceiling, on the floor under it the loft (beams.06)", () => {
    const doc = onLoft(2.15);
    const up = { h: 0.35, z: "ceiling" } as const;
    expect(rangeOf(doc, up, SQUARE, "loft")).toEqual({ bottom: 2.5 - 0.35, top: 2.5 });
    expect(rangeOf(doc, up, SQUARE, null)).toEqual({ bottom: 2.03 - 0.35, top: 2.03 });
    expect(rangeOf(doc, { h: 0.35, z: 0.1 }, SQUARE, "loft")).toEqual({ bottom: 2.15 + 0.1, top: 2.15 + 0.1 + 0.35 });
  });

  it("raising the loft raises the bed's range", () => {
    expect(placementRange(onLoft(2.2), "bed/night")).toEqual({ bottom: 2.2, top: 2.2 + 0.35 });
    expect(placementRange(onLoft(1), "bed/night")).toEqual({ bottom: 1, top: 1 + 0.35 });
  });

  it("elevationOf returns the stored relative value", () => {
    const doc = onLoft(2.15);
    expect(elevationOf(doc, "bed/night")).toBe(0);
    const bed = doc.objects.bed;
    if (!bed) throw new Error("no object");
    const raised: Document = { ...doc, objects: { ...doc.objects, bed: { ...bed, z: { standard: 0.05 } } } };
    expect(elevationOf(raised, "bed/night")).toBe(0.05);
    expect(placementRange(raised, "bed/night")?.bottom).toBe(2.15 + 0.05);
    const hung: Document = { ...doc, objects: { ...doc.objects, bed: { ...bed, z: { standard: "ceiling" } } } };
    expect(elevationOf(hung, "bed/night")).toBe("ceiling");
    expect(elevationOf(doc, "nope")).toBeNull();
  });

  it("a placement on a missing deck has no range, and solids leave it out (decks.15)", () => {
    const doc = place(tinyHouse(), { object: "bed", kind: "bed", at: [4, 2.4], state: "night", size: MATTRESS, deck: "gone" });
    expect(placementRange(doc, "bed/night")).toBeNull();
    expect(solids(doc).some((s) => s.key.table === "placements")).toBe(false);
  });

  it("solids list a deck with its range and no state, between the walls and the placements", () => {
    const tables = solids(onLoft(2.15)).map((s) => s.key.table);
    expect(tables.indexOf("decks")).toBeGreaterThan(tables.lastIndexOf("walls"));
    expect(tables.indexOf("decks")).toBeLessThan(tables.indexOf("placements"));
    expect(solids(onLoft(2.15)).find((s) => s.key.table === "decks")).toMatchObject({ state: null, range: { bottom: 2.15 - 0.12, top: 2.15 } });
  });
});

describe("openings (levels.05)", () => {
  it("openingRange: the stored sill and head above the wall's bottom", () => {
    // W1b runs (2, 0)–(7, 0) and W2 (7, 0)–(7, 2.5), both to the 2.50 ceiling.
    const doc = withOpening(withOpening(tinyHouse(), { id: "door", wall: "W1b", offset: 1 }), { id: "win", wall: "W2", offset: 0.5, kind: "window", head: 1.95 });
    expect(openingRange(doc, "door")).toEqual(r(0, 2.1));
    expect(openingRange(doc, "win")).toEqual(r(0.9, 1.95));
    expect(openingRange(doc, "nope")).toBeNull();
  });

  it("a new opening's heights: a door 0–2.10, a window 0.90–2.10, the head 0.10 under a lower wall's top (sills.01)", () => {
    expect(defaultOpeningHeights(true, 2.5)).toEqual({ sill: 0, head: 2.1 });
    expect(defaultOpeningHeights(false, 2.5)).toEqual({ sill: 0.9, head: 2.1 });
    expect(defaultOpeningHeights(true, 2.05)).toEqual({ sill: 0, head: 1.95 });
    expect(defaultOpeningHeights(false, 2.05)).toEqual({ sill: 0.9, head: 1.95 });
    expect(defaultOpeningHeights(true, 2.12)).toEqual({ sill: 0, head: 2.02 });
  });
});
