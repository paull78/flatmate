import { describe, expect, it } from "vitest";
import { shown } from "../src/format";
import { CEILING_ID, type Document } from "../src/model";
import { deckUnder, deckView } from "../src/queries/decks";
import { cutAt, deckRelationAt, hiddenAt, isFloor, levelDeckAt, levelHeight, levelOf, levels, relationAt, } from "../src/queries/levels";
import { tinyHouse, withDeck } from "./helpers";

// Levels are the floor plus each distinct deck top at or above the floor's cut, grouped to the millimetre (levels.02);
// the cut at a level is today's rule with the level as its base (levels.03).

const withCeiling = (doc: Document, height: number): Document => ({ ...doc, ceilings: { [CEILING_ID]: { id: CEILING_ID, height } } });
const house = tinyHouse();
const platform = (doc: Document, top = 0.45): Document => withDeck(doc, { id: "D1", at: [1, 1], name: "Platform", top });
const loft = (doc: Document, id: string, top = 2.15, name = "Loft"): Document =>
  withDeck(doc, { id, at: id === "D2" ? [4, 1.25] : [5.8, 1.25], w: 1.2, d: 2, name, top, solid: false });

/** AC-01's drawing: a 0.45 platform, a 2.15 loft and a second 2.15 loft, under the default 2.50 ceiling. */
const ac01 = (platformTop = 0.45): Document => loft(loft(platform(house, platformTop), "D2"), "D3", 2.15, "Loft 2");

describe("levels", () => {
  it("a floor alone has one level, Floor, cut 1.20", () => {
    expect(levels(house)).toEqual([{ height: 0, deckIds: [], cut: 1.2, name: "Floor" }]);
  });

  it('AC-01: a 0.45 platform, a 2.15 loft and a second 2.15 loft under 2.50 make two levels, the second listing both decks in id order, named "Loft, Loft 2"', () => {
    const doc = ac01();
    expect(levels(doc)).toEqual([
      { height: 0, deckIds: [], cut: 1.2, name: "Floor" },
      { height: 2.15, deckIds: ["D2", "D3"], cut: 2.325, name: "Loft, Loft 2" },
    ]);
    expect(levels(doc)).toBe(levels(doc)); // memoised by document
  });

  it("raising the platform to 1.20 adds a level +1.20; at 1.199 it does not", () => {
    expect(levels(ac01(1.2)).map((l) => [l.height, l.deckIds])).toEqual([[0, []], [1.2, ["D1"]], [2.15, ["D2", "D3"]]]);
    expect(levels(ac01(1.199)).map((l) => [l.height, l.deckIds])).toEqual([[0, []], [2.15, ["D2", "D3"]]]);
  });

  it("a low ceiling (2.10) moves the floor's cut to 1.05 and a 1.10 deck becomes a level", () => {
    const doc = withCeiling(platform(house, 1.1), 2.1);
    expect(levels(platform(house, 1.1)).map((l) => l.height)).toEqual([0]); // under 2.50 it is part of the floor
    expect(levels(doc)).toEqual([
      { height: 0, deckIds: [], cut: 1.05, name: "Floor" },
      { height: 1.1, deckIds: ["D1"], cut: 1.6, name: "Platform" },
    ]);
  });

  it("tops 2.1504 and 2.1496 make one level", () => {
    const doc = loft(loft(house, "D2", 2.1504), "D3", 2.1496, "Bunk");
    expect(levels(doc).map((l) => [l.height, l.deckIds, l.name])).toEqual([[0, [], "Floor"], [2.15, ["D2", "D3"], "Loft, Bunk"]]);
    const apart = loft(loft(house, "D2", 2.15), "D3", 2.151, "Bunk"); // a millimetre apart: two levels
    expect(levels(apart).map((l) => l.height)).toEqual([0, 2.15, 2.151]);
  });

  it('a blank-named deck reads "Deck"', () => {
    expect(levels(loft(house, "D2", 2.15, "  ")).map((l) => l.name)).toEqual(["Floor", "Deck"]);
  });
});

describe("levelOf", () => {
  const doc = ac01();
  it("a level's deck, a platform's deck (→ floor), a missing id (→ floor), null (→ floor)", () => {
    expect(levelOf(doc, "D3")).toEqual({ height: 2.15, deckIds: ["D2", "D3"], cut: 2.325, name: "Loft, Loft 2" });
    expect(levelOf(doc, "D3")).toBe(levelOf(doc, "D2"));
    const floor = levels(doc)[0];
    expect(levelOf(doc, "D1")).toBe(floor);
    expect(levelOf(doc, "nope")).toBe(floor);
    expect(levelOf(doc, null)).toBe(floor);
  });
});

describe("cutAt", () => {
  it("AC-02: cutAt(2.15) under 2.50 is 2.325; cutAt(0) is 1.20; under a 3.20 ceiling cutAt(2.15) is 2.675", () => {
    expect(cutAt(house, 2.15)).toBe(2.325);
    expect(cutAt(house, 0)).toBe(1.2);
    expect(cutAt(withCeiling(house, 3.2), 2.15)).toBe(2.675);
    expect(cutAt(withCeiling(house, 6), 2.15)).toBe(3.35); // a high ceiling: 1.20 above the level
  });
});

describe("isFloor, relationAt and hiddenAt: the one rule for what a level hides (levels.04)", () => {
  const doc = ac01();
  const [floor, upper] = levels(doc);
  const partition = { bottom: 0, top: 2.03 };
  const wardrobe = { bottom: 0, top: 2.2 }; // a 2.20 wardrobe beside the loft
  const mattress = { bottom: 2.15, top: 2.45 }; // on the loft
  it("the floor is the level without decks", () => {
    expect(floor && isFloor(floor)).toBe(true);
    expect(upper && isFloor(upper)).toBe(false);
  });

  it("at the floor nothing is under: the cut alone, as relationToCut always drew it", () => {
    if (!floor) throw new Error("no floor");
    expect([partition, wardrobe, mattress, { bottom: 0, top: 0.45 }].map((r) => relationAt(r, floor))).toEqual(["crossing", "crossing", "above", "below"]);
    expect(hiddenAt(partition, floor)).toBe(false);
  });

  it("at +2.15 a top at or under the level is under it, a taller one is against the level's cut (2.325)", () => {
    if (!upper) throw new Error("no level");
    expect([partition, { bottom: 0, top: 2.15 }, { bottom: 0, top: 2.151 }, wardrobe, mattress].map((r) => relationAt(r, upper))).toEqual(["under", "under", "below", "below", "crossing"]);
    expect([partition, wardrobe, null].map((r) => hiddenAt(r, upper))).toEqual([true, false, false]); // no range: not hidden
  });

  it("deckRelationAt: the level's own decks are never under it (their tops are the level); every other deck is", () => {
    if (!floor || !upper) throw new Error("no levels");
    const relations = (level: typeof floor): string[] =>
      ["D1", "D2", "D3"].map((id) => { const d = deckView(doc, id); return d ? deckRelationAt(d, level) : "missing"; });
    expect(relations(floor)).toEqual(["below", "above", "above"]); // the platform, then both lofts' slabs (2.03–2.15)
    expect(relations(upper)).toEqual(["under", "below", "below"]);
  });
});

describe("levelDeckAt: the deck of a level under a point", () => {
  // A 2.15 loft at x 3.4–4.6 touching a 2.30 loft at x 4.6–5.8 on x = 4.6, and the 0.45 platform at x 0–2, y 0.3–1.7.
  const doc = withDeck(loft(platform(house), "D2"), { id: "D3", at: [5.2, 1.25], w: 1.2, d: 2, name: "High", top: 2.3, solid: false });
  const [floor, low, high] = levels(doc);
  const edge = { x: 4.6, y: 1.25 };
  it("on the shared edge: the higher loft for deckUnder, each level its own loft", () => {
    if (!floor || !low || !high) throw new Error("no levels");
    expect(deckUnder(doc, edge)?.id).toBe("D3");
    expect(levelDeckAt(doc, low, edge)?.id).toBe("D2");
    expect(levelDeckAt(doc, high, edge)?.id).toBe("D3");
    expect(levelDeckAt(doc, floor, edge)).toBeNull(); // neither loft is below the floor's cut
  });

  it("at the floor a deck below its cut; an upper level never reaches it", () => {
    if (!floor || !low) throw new Error("no levels");
    expect(levelDeckAt(doc, floor, { x: 1, y: 1 })?.id).toBe("D1");
    expect(levelDeckAt(doc, low, { x: 1, y: 1 })).toBeNull();
    expect(levelDeckAt(doc, low, { x: 6.5, y: 1 })).toBeNull(); // off every deck
  });
});

describe("shown and levelHeight", () => {
  it("round halves away from zero after dropping float noise, where toFixed(2) rounds the float down", () => {
    expect((2.675).toFixed(2)).toBe("2.67"); // the float is 2.67499…: the loft's cut under the studio's 3.20 ceiling
    expect(shown(2.675)).toBe("2.68");
    expect((2.15 + 0.175).toFixed(2)).toBe("2.32"); // an unrounded sum, 2.32499…
    expect(shown(2.15 + 0.175)).toBe("2.33");
    expect(shown(2.325)).toBe("2.33");
    expect(shown(1.2)).toBe("1.20");
    expect(shown(1.104)).toBe("1.10");
    const [floor, upper] = levels(loft(house, "D2"));
    expect(floor && levelHeight(floor)).toBe("0.00");
    expect(upper && levelHeight(upper)).toBe("+2.15");
    // A strip row at a half reads as every number does (cleanup M3 review): toFixed gave "+2.67".
    if (upper) expect(levelHeight({ ...upper, height: 2.675 })).toBe("+2.68");
  });
});
