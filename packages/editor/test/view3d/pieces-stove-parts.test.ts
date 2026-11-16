import { describe, expect, it } from "vitest";
import { appearanceOf } from "../../src/view3d/parts/index";
import type { Part } from "../../src/view3d/parts/types";
import { PARTS_KINDS } from "./parts-fixtures";

// The wood stove in 3D (spec pieces, AC-05; pieces.04, .08): a hearth across its footprint, the stove's body, and a
// flue from its top to the flue's top when the item gives one. Local frame: z up from the piece's bottom.

const top = (p: Part) => (p.shape === "outline" || p.shape === "ring" ? p.z1 : p.at.z1);
const stoveParts = (flue?: number) => appearanceOf("woodStove")("standard", 0.75, 0.75, 0.65, undefined, undefined, flue);

describe("the wood stove in 3D", () => {
  it("is checked by the every-kind properties", () => {
    expect(PARTS_KINDS).toContain("woodStove");
  });

  it("is a hearth across its footprint and a dark stove within its height, with no flue unless given one", () => {
    const ps = stoveParts();
    expect(Math.max(...ps.map(top))).toBeCloseTo(0.65, 9);
    expect(ps.some((p) => p.shape === "box" && p.at.x1 - p.at.x0 > 0.74 && p.at.z1 <= 0.03)).toBe(true);
  });

  it("with a flue top 1.85 m above its bottom, a dark cylinder runs from the stove's top up to it", () => {
    const flue = stoveParts(1.85).filter((p) => p.shape === "cylinder");
    expect(flue).toHaveLength(1);
    expect(flue[0] && top(flue[0])).toBeCloseTo(1.85, 9);
  });
});
