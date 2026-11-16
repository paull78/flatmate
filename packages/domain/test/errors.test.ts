import { describe, expect, it } from "vitest";
import { MESSAGES, collisionMessage, namedViolation, thicknessViolation, type Violation } from "../src/errors";

const v = (invariant: Violation["invariant"], message: string = invariant): Violation => ({ invariant, message, entities: [] });

describe("namedViolation (arch-review R-09)", () => {
  it("returns the first fit or opening violation (I10, I11, I12), else null", () => {
    expect(namedViolation([v("I5"), v("I11", "b"), v("I12", "c")])?.message).toBe("b");
    expect(namedViolation([v("I12", "c"), v("I10", "a")])?.message).toBe("c");
    expect(namedViolation([v("I5"), v("I13")])).toBeNull();
    expect(namedViolation([])).toBeNull();
  });
});

describe("range texts come from the constants", () => {
  it("keep their wording", () => {
    expect(MESSAGES.thickness).toBe("Wall thickness must be between 0.05 and 0.50 m");
    expect(MESSAGES.objectSize).toBe("Size must be between 0.02 and 10 m");
    expect(thicknessViolation("W1", 0.6).message).toBe("Wall W1 thickness 0.6 m is outside 0.05 to 0.50 m");
  });
});

// The refusal texts in height (heights.14, .32): one formatter, ranges always, metres with two decimals.
describe("collisionMessage", () => {
  const wardrobe = { name: "Wardrobe", bottom: 0, top: 2.05 };
  it("two pieces", () => {
    expect(collisionMessage({ with: "piece", a: wardrobe, b: { name: "Loft bed", bottom: 1.45, top: 1.8 }, state: "Day" }))
      .toBe("Wardrobe (0.00–2.05) and Loft bed (1.45–1.80) overlap in Day");
    expect(collisionMessage({ with: "piece", a: { name: "Desk", bottom: 0, top: 0.75 }, b: { name: "Chair", bottom: 0, top: 0.9 }, state: "Day" }))
      .toBe("Desk (0.00–0.75) and Chair (0.00–0.90) overlap in Day");
  });

  it("piece and half wall; a full wall says \"a wall\"", () => {
    expect(collisionMessage({ with: "wall", piece: { name: "Wall cabinet", bottom: 0.9, top: 1.65 }, halfWall: 1.1, state: "Day" }))
      .toBe("Wall cabinet (0.90–1.65) overlaps a 1.10 m wall in Day");
    expect(collisionMessage({ with: "wall", piece: wardrobe, halfWall: null, state: "Day" })).toBe("Wardrobe (0.00–2.05) overlaps a wall in Day");
  });

  it("piece and ceiling: the configuration is named only for kinds with two", () => {
    expect(collisionMessage({ with: "ceiling", name: "Murphy bed", config: "Closed", top: 2.24, ceiling: 2.2, state: "Night" }))
      .toBe("Murphy bed (Closed) reaches 2.24 m in Night; the ceiling is 2.20 m");
    expect(collisionMessage({ with: "ceiling", name: "Wardrobe", config: null, top: 2.05, ceiling: 2, state: "Day" }))
      .toBe("Wardrobe reaches 2.05 m in Day; the ceiling is 2.00 m");
  });

  it("half wall and ceiling", () => {
    expect(collisionMessage({ with: "halfWallCeiling", ceiling: 2.5 })).toBe("A wall can't be taller than the 2.50 m ceiling");
  });

  it("float noise prints rounded", () => {
    expect(collisionMessage({ with: "piece", a: { name: "Shelf", bottom: 0.1 + 0.2, top: 1.45 + 0.35 }, b: wardrobe, state: "Day" }))
      .toBe("Shelf (0.30–1.80) and Wardrobe (0.00–2.05) overlap in Day");
  });
});
