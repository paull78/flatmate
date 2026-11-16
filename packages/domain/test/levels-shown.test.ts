import { describe, expect, it } from "vitest";
import { CEILING_ID, type Document } from "../src/model";
import { levels, placementLevel, shownAt } from "../src/queries/levels";
import { place, tinyHouse, withDeck } from "./helpers";

// What a level shows (spec "What a level shows and what you can click", shown.02, .05): a piece belongs to the level
// of what it stands on; a level shows it when it isn't under the level and doesn't belong to a higher level, or when
// it is a stair reaching the level.
//
// The tiny house under a 3.20 ceiling: a 0.45 platform D1 (part of the floor level), a 2.15 loft D2 over x 3.4–4.6
// and a 2.40 loft D4 over x 5.2–6.4, so the levels are the floor, +2.15 and +2.40.

const size = (w: number, d: number, h: number, z = 0) => ({ w: { standard: w }, d: { standard: d }, h: { standard: h }, z: { standard: z } });

function house(): Document {
  let doc: Document = { ...tinyHouse(), ceilings: { [CEILING_ID]: { id: CEILING_ID, height: 3.2 } } };
  doc = withDeck(doc, { id: "D1", name: "Platform", at: [1, 1], w: 1, d: 1, top: 0.45, solid: true });
  doc = withDeck(doc, { id: "D2", name: "Loft", at: [4, 1.25], w: 1.2, d: 2, top: 2.15, solid: false });
  doc = withDeck(doc, { id: "D4", name: "High loft", at: [5.8, 1.25], w: 1.2, d: 2, top: 2.4, solid: false });
  doc = place(doc, { object: "desk", kind: "desk", at: [2.6, 2.4] }); // floor, top 0.75
  doc = place(doc, { object: "shelf", kind: "desk", at: [2.6, 1.0], size: size(0.8, 0.3, 0.3, 1.3) }); // floor, 1.30–1.60
  doc = place(doc, { object: "step", kind: "desk", at: [1, 1.4], deck: "D1", size: size(0.5, 0.4, 0.3) }); // on the platform
  doc = place(doc, { object: "mat", kind: "mattress", at: [4, 2.2], deck: "D2", size: size(1, 1.8, 0.2) }); // 2.15–2.35
  doc = place(doc, { object: "tall", kind: "desk", at: [4, 0.9], deck: "D2", size: size(0.4, 0.4, 0.5) }); // 2.15–2.65
  doc = place(doc, { object: "high", kind: "mattress", at: [5.8, 2.2], deck: "D4", size: size(1, 1.8, 0.2) }); // 2.40–2.60
  return doc;
}

const [floor, loft, high] = levels(house());

describe("placementLevel", () => {
  const doc = house();
  const [f, l] = levels(doc);

  it("a piece on the floor, on the platform and on a loft belong to the floor, the floor and the loft", () => {
    expect(placementLevel(doc, "desk/s0")).toBe(f);
    expect(placementLevel(doc, "step/s0")).toBe(f);
    expect(placementLevel(doc, "mat/s0")).toBe(l);
  });

  it("an unknown placement is null", () => {
    expect(placementLevel(doc, "nope")).toBeNull();
  });
});

describe("shownAt", () => {
  const doc = house();
  if (!floor || !loft || !high) throw new Error("expected three levels");

  it("the house has three levels: the floor, +2.15 and +2.40", () => {
    expect(levels(doc).map((l) => l.height)).toEqual([0, 2.15, 2.4]);
  });

  it("at the floor, a floor piece above the cut is shown", () => {
    expect(shownAt(doc, "shelf/s0", floor)).toBe(true);
  });

  it("at the floor, a piece on the platform is shown", () => {
    expect(shownAt(doc, "step/s0", floor)).toBe(true);
  });

  it("at the floor, a piece on the loft is not shown", () => {
    expect(shownAt(doc, "mat/s0", floor)).toBe(false);
    expect(shownAt(doc, "high/s0", floor)).toBe(false);
  });

  it("at the 2.15 level, a piece on the 2.40 loft is not shown and a piece on the 2.15 loft is", () => {
    expect(shownAt(doc, "high/s0", loft)).toBe(false);
    expect(shownAt(doc, "mat/s0", loft)).toBe(true);
  });

  it("at the 2.40 level, a tall piece on the 2.15 loft reaching above 2.40 is shown, a low one isn't", () => {
    expect(shownAt(doc, "tall/s0", high)).toBe(true);
    expect(shownAt(doc, "mat/s0", high)).toBe(false);
  });

  it("at the loft, a floor piece whose top is at or below 2.15 is not shown", () => {
    expect(shownAt(doc, "desk/s0", loft)).toBe(false);
  });

  it("a stair on the floor reaching the loft is shown at the floor and at the loft, not at the higher loft", () => {
    let withStair = place(doc, { object: "st", kind: "storageStair", at: [3.1, 1.25], rotation: 270, size: size(0.6, 1.2, 2.15) });
    const o = withStair.objects.st;
    if (!o) throw new Error("no stair");
    withStair = { ...withStair, objects: { ...withStair.objects, st: { ...o, reaches: "D2" } } };
    const [f, l, h] = levels(withStair);
    if (!f || !l || !h) throw new Error("expected three levels");
    expect(shownAt(withStair, "st/s0", f)).toBe(true);
    expect(shownAt(withStair, "st/s0", l)).toBe(true);
    expect(shownAt(withStair, "st/s0", h)).toBe(false);
  });

  it("an unknown placement is shown", () => {
    expect(shownAt(doc, "nope", loft)).toBe(true);
  });
});
