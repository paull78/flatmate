import { MESSAGES } from "../src/errors";
import { describe, expect, it } from "vitest";
import { CEILING_ID, type Document, type Wall } from "../src/model";
import { validateDocument } from "../src/validate";
import { place, tinyHouse, withDeck } from "./helpers";

// I18, the deck's own rules (spec "The deck", decks.12, .14, .15), on the tiny house: a 7 × 2.5 m shell (inner faces
// x 0.1 and 6.9, y 0.1 and 2.4) with a 2.03 m partition P on x = 2 (its body x 1.9–2.1).

const withCeiling = (doc: Document, height: number): Document => ({ ...doc, ceilings: { [CEILING_ID]: { id: CEILING_ID, height } } });
const withTop = (doc: Document, wallId: string, top: Wall["top"]): Document => {
  const w = doc.walls[wallId];
  if (!w) throw new Error(`unknown wall ${wallId}`);
  return { ...doc, walls: { ...doc.walls, [wallId]: { ...w, top } } };
};
/** The first violation's text, or null for a valid document. */
const refusal = (doc: Document): string | null => {
  const r = validateDocument(doc);
  return r.ok ? null : (r.error[0]?.message ?? "no message");
};
const loft = { name: "Loft", top: 2.15, solid: false };
const platform = { name: "Platform", top: 0.45, solid: true };
const house = tinyHouse();

describe("I18 sizes", () => {
  const sized = (w: number, d: number, top: number): Document => withDeck(withCeiling(house, 10), { id: "k", at: [4.5, 1.25], w, d, top });
  const SIZES = "Deck sizes must be at least 0.30 m, tops 0.15 to 10 m";

  it("the tiny house is valid", () => {
    expect(refusal(house)).toBeNull();
  });

  it("0.29 wide or deep is refused, 0.30 accepted", () => {
    expect(refusal(sized(0.29, 1, 1))).toBe(SIZES);
    expect(refusal(sized(1, 0.29, 1))).toBe(SIZES);
    expect(refusal(sized(0.3, 0.3, 1))).toBeNull();
  });

  it("a top of 0.14 is refused; 0.15 and 10 are accepted; above 10 is refused", () => {
    expect(refusal(sized(1, 1, 0.14))).toBe(SIZES);
    expect(refusal(sized(1, 1, 0.15))).toBeNull();
    expect(refusal(sized(1, 1, 10))).toBeNull();
    expect(refusal(sized(1, 1, 10.001))).toBe(SIZES);
  });

  it("a deck too small is refused once, with the sizes text only", () => {
    const r = validateDocument(withDeck(house, { id: "k", at: [20, 20], w: 0.1, top: 20 }));
    expect(r.ok ? [] : r.error.map((v) => v.message)).toEqual([SIZES]);
  });
});

describe("I18 over the building (decks.14)", () => {
  it("a deck inside one room is accepted", () => {
    expect(refusal(withDeck(house, { id: "k", at: [4.5, 1.25], ...platform }))).toBeNull();
  });

  it("flush with two walls' inner faces is accepted; 2 mm further crosses the wall", () => {
    expect(refusal(withDeck(house, { id: "k", at: [5.9, 1.7], ...platform }))).toBeNull(); // x 4.9–6.9, y 1.0–2.4
    expect(refusal(withDeck(house, { id: "k", at: [5.902, 1.7], ...platform }))).toBe("Platform (0.00–0.45) overlaps a 2.50 m wall");
  });

  it("a loft whose corners lie exactly on the partition's centreline is accepted", () => {
    // x 0.1–2.0, y 0.1–2.4: two corners on x = 2, where faceAt answers no room; they lie in P's body.
    expect(refusal(withDeck(house, { id: "k", at: [1.05, 1.25], w: 1.9, d: 2.3, ...loft }))).toBeNull();
  });

  it("a loft whose centre lies on the partition's centreline is accepted", () => {
    expect(refusal(withDeck(house, { id: "k", at: [2, 1.25], w: 2, d: 2.3, ...loft }))).toBeNull();
  });

  it("a corner 1 cm outside the shell is refused; on the wall's outer face it is accepted", () => {
    // Over a 0.30 m parapet (W1b), so no wall collides: only "over the building" decides.
    const parapet = withTop(house, "W1b", 0.3);
    expect(refusal(withDeck(parapet, { id: "k", at: [4.5, 0.4], w: 2, d: 1, ...loft }))).toBeNull(); // y −0.10 to 0.90
    expect(refusal(withDeck(parapet, { id: "k", at: [4.5, 0.39], w: 2, d: 1, ...loft }))).toBe("Loft must lie over the building");
  });

  it("a corner within the tolerance outside a wall body is accepted", () => {
    const parapet = withTop(house, "W1b", 0.3);
    expect(refusal(withDeck(parapet, { id: "k", at: [4.5, 0.4], w: 2, d: 1.001, ...loft }))).toBeNull(); // corner y −0.1005
  });

  it("over a low shell a deck stops short of the outer corner squares of a junction (supported constraint, decks.23)", () => {
    const low = { ...house, walls: Object.fromEntries(Object.entries(house.walls).map(([id, w]) => [id, id === "P" ? w : { ...w, top: 0.3 }])) };
    expect(refusal(withDeck(low, { id: "k", at: [0.9, 0.9], w: 2, d: 2, ...loft }))).toBe("Loft must lie over the building");
  });

  it("a deck turned 30° inside a room is accepted; turned so a corner crosses a wall it is refused", () => {
    expect(refusal(withDeck(house, { id: "k", at: [4.5, 1.25], w: 1.5, d: 1, rotation: 30, ...platform }))).toBeNull();
    expect(refusal(withDeck(house, { id: "k", at: [4.5, 1.25], w: 2.2, d: 1.4, rotation: 30, ...platform }))).toBe("Platform (0.00–0.45) overlaps a 2.50 m wall");
    expect(refusal(withDeck(house, { id: "k", at: [4.5, 1.25], w: 2.2, d: 1.4, rotation: 0, ...platform }))).toBeNull();
  });

  it("a deck wholly outside is refused", () => {
    expect(refusal(withDeck(house, { id: "k", at: [10, 10], ...platform }))).toBe("Platform must lie over the building");
  });
});

describe("I18 clear of walls", () => {
  const overP = (doc: Document, deck: { top: number; solid: boolean; name: string }): string | null =>
    refusal(withDeck(doc, { id: "k", at: [2, 1.25], w: 2, d: 2.3, ...deck }));

  it("a hollow loft (underside 2.03) over a 2.03 m partition is accepted; over a 2.04 m one refused with the ranges", () => {
    expect(overP(house, loft)).toBeNull();
    expect(overP(withTop(house, "P", 2.04), loft)).toBe("Loft (2.03–2.15) overlaps a 2.04 m wall");
    expect(overP(withTop(house, "P", 2.032), loft)).toBe("Loft (2.03–2.15) overlaps a 2.03 m wall");
  });

  it("an underside equal to the partition's top within float noise is accepted", () => {
    expect(overP(withTop(house, "P", 2.15 - 0.12), loft)).toBeNull();
    expect(overP(house, { ...loft, top: 2.03 + 0.12 })).toBeNull();
    expect(2.01 - 0.12).toBeLessThan(1.89); // 1.8899999999999997
    expect(overP(withTop(house, "P", 1.89), { ...loft, top: 2.01 })).toBeNull();
  });

  it("crossing a full wall is refused", () => {
    expect(overP(withTop(house, "P", "ceiling"), loft)).toBe("Loft (2.03–2.15) overlaps a 2.50 m wall");
  });

  it("a solid platform across a 0.90 m half wall is refused; a hollow one above it is accepted", () => {
    const low = withTop(house, "P", 0.9);
    expect(overP(low, platform)).toBe("Platform (0.00–0.45) overlaps a 0.90 m wall");
    expect(overP(low, { name: "Bench", top: 1.2, solid: false })).toBeNull(); // 1.08–1.20
    expect(overP(low, { name: "Bench", top: 1.2, solid: true })).toBe("Bench (0.00–1.20) overlaps a 0.90 m wall");
  });
});

describe("I18 decks overlap", () => {
  const a = withDeck(house, { id: "a", at: [3.5, 1.25], w: 1, d: 1, ...platform }); // x 3–4
  const step = { id: "b", name: "Step", w: 1, d: 1, top: 0.3, solid: true };

  it("touching edges are accepted (steps); a 1 cm overlap is refused", () => {
    expect(refusal(withDeck(a, { ...step, at: [4.5, 1.25] }))).toBeNull();
    expect(refusal(withDeck(a, { ...step, at: [4.49, 1.25] }))).toBe("Platform and Step overlap");
  });

  it("a deck turned 45° overlapping another at a corner is refused; 1 cm clear it is accepted", () => {
    const turned = (x: number): Document => withDeck(a, { ...step, at: [x, 1.25], rotation: 45 });
    expect(refusal(turned(4 + Math.SQRT1_2 - 0.01))).toBe("Platform and Step overlap");
    expect(refusal(turned(4 + Math.SQRT1_2 + 0.01))).toBeNull();
  });

  it("a deck too small is reported for its size only, not for overlapping a sized deck", () => {
    const tiny = withDeck(a, { ...step, at: [3.5, 1.25], w: 0.2 });
    const r = validateDocument(tiny);
    expect(r.ok ? [] : r.error.map((v) => v.message)).toEqual([MESSAGES.deckSizes]);
  });

  it("a blank name still reads in the refusal", () => {
    expect(refusal(withDeck(a, { ...step, name: "", at: [4.49, 1.25] }))).toBe("Platform and Deck overlap");
  });

  it("decks overlap in plan whatever their heights", () => {
    expect(refusal(withDeck(a, { ...step, at: [3.5, 1.25], ...loft, name: "Step" }))).toBe("Platform and Step overlap");
  });
});

describe("I18 ceiling", () => {
  const withLoft = (doc: Document): Document => withDeck(doc, { id: "k", at: [4.5, 1.25], ...loft });

  it("a loft at 2.15 under a 2.10 ceiling is refused; under 2.50 or 2.15 it is accepted", () => {
    expect(refusal(withLoft(withCeiling(house, 2.1)))).toBe("Loft reaches 2.15 m; the ceiling is 2.10 m");
    expect(refusal(withLoft(withCeiling(house, 2.5)))).toBeNull();
    expect(refusal(withLoft(withCeiling(house, 2.15)))).toBeNull();
  });
});

describe("I18 in validateDocument", () => {
  it("is reported before fit: a document breaking both reports I18 first", () => {
    let doc = withDeck(withCeiling(house, 2.1), { id: "k", at: [4.5, 1.25], ...loft });
    doc = place(doc, { object: "tall", kind: "wardrobe", at: [5, 2.4], size: { w: { standard: 1 }, d: { standard: 0.4 }, h: { standard: 2.2 } } }); // clear of the loft on plan
    const r = validateDocument(doc);
    expect(r.ok ? [] : r.error.map((v) => v.invariant)).toEqual(["I18", "I17"]);
  });

  it("names the deck, and the wall it crosses", () => {
    const r = validateDocument(withDeck(withTop(house, "P", 2.04), { id: "k", at: [2, 1.25], w: 2, d: 2.3, ...loft }));
    expect(r.ok ? [] : r.error).toEqual([
      { invariant: "I18", message: "Loft (2.03–2.15) overlaps a 2.04 m wall", entities: [{ table: "decks", id: "k" }, { table: "walls", id: "P" }] },
    ]);
  });

  it("a piece overlapping a deck is reported against the deck, not as a wall collision (fit-decks.test.ts)", () => {
    const doc = place(withDeck(house, { id: "k", at: [4.5, 1.25], ...platform }), { object: "chair", kind: "chair", at: [4.5, 1.5] });
    expect(refusal(doc)).toBe("Chair (0.00–0.90) and Platform (0.00–0.45) overlap in Layout");
  });
});
