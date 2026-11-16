import { describe, expect, it } from "vitest";
import { OBJECT_KINDS, isObjectHeight } from "../src/kinds";
import { LOWEST_SHARE, lowerable, lowestHeight } from "../src/lowering";

// Which kinds a new piece may be lowered on, and how far (clarity.06, .11).

const LOWERABLE = ["wardrobe", "cornerWardrobe", "ovenColumn", "wallCabinet"];
const NOT_LOWERABLE = ["murphyBed", "liftBed", "sofaBed", "builtInTable", "builtInDesk", "foldingTable", "extendingTable"];

describe("lowerable", () => {
  it.each(LOWERABLE)("%s may be lowered", (kind) => {
    expect(lowerable(kind)).toBe(true);
  });

  it.each(NOT_LOWERABLE)("%s may not: a height is shared by its configurations", (kind) => {
    expect(lowerable(kind)).toBe(false);
  });

  it("every kind answers by the rule: one configuration, no stair, a numeric elevation", () => {
    for (const kind of OBJECT_KINDS) {
      const expected = kind.configs.length === 1 && kind.stair === null && kind.configs.every((c) => typeof c.z === "number");
      expect([kind.id, lowerable(kind.id)]).toEqual([kind.id, expected]);
    }
  });

  it("no stair kind may", () => {
    const stairs = OBJECT_KINDS.filter((k) => k.stair !== null);
    expect(stairs.length).toBeGreaterThan(0);
    for (const kind of stairs) expect([kind.id, lowerable(kind.id)]).toEqual([kind.id, false]);
  });

  it("an unknown kind may not", () => {
    expect(lowerable("spaceship")).toBe(false);
    expect(lowerable("constructor")).toBe(false);
  });
});

describe("lowestHeight", () => {
  it("is three quarters", () => {
    expect(LOWEST_SHARE).toBe(0.75);
    expect(lowestHeight(2)).toBe(1.5);
  });

  it("rounds up to the millimetre", () => {
    expect(lowestHeight(2.05)).toBe(1.538);
    expect(lowestHeight(2.15)).toBe(1.613);
    expect(lowestHeight(2.003)).toBe(1.503); // 1502.25 mm: up, not to the nearest
  });

  it("float noise doesn't add a millimetre", () => {
    // 0.4 × 0.75 is 0.30000000000000004 in floats.
    expect(lowestHeight(0.4)).toBe(0.3);
  });

  it("is always a height placeObject takes, even a rug's", () => {
    expect(lowestHeight(0.01)).toBe(0.01);
    for (const kind of OBJECT_KINDS) for (const c of kind.configs) expect([kind.id, isObjectHeight(lowestHeight(c.h))]).toEqual([kind.id, true]);
  });
});
