import { describe, expect, it } from "vitest";
import { furnitureSymbol } from "../src/view/furniture";

// The heights cycle's symbols (heights.49): a lift bed is a bed, a loft bed a bed with a ladder at the foot, a wall
// cabinet a door line and one diagonal. The generic symbol tests keep each inside its footprint.

const segments = (kind: string, config: string, w: number, d: number) => furnitureSymbol(kind, config, w, d).filter((p) => p.kind === "segment").length;

describe("heights symbols", () => {
  it("a loft bed draws the bed and five more lines (two rails, three rungs); a lift bed draws the bed up and down", () => {
    expect(segments("loftBed", "standard", 1, 2.1)).toBe(segments("bed", "standard", 1, 2.1) + 5);
    expect(segments("liftBed", "up", 1.7, 2.1)).toBe(segments("bed", "standard", 1.7, 2.1));
    expect(segments("liftBed", "down", 1.7, 2.1)).toBe(segments("bed", "standard", 1.7, 2.1));
  });

  it("a mattress draws the bed's symbol at its size, with more lines than an outline (cleanup.07)", () => {
    for (const [w, d] of [[1.6, 2], [0.9, 2], [1.93, 2.03]] as const) {
      expect(furnitureSymbol("mattress", "standard", w, d), `${w} × ${d}`).toEqual(furnitureSymbol("bed", "standard", w, d));
    }
    expect(segments("mattress", "standard", 1.6, 2)).toBeGreaterThan(segments("block", "standard", 1.6, 2));
  });

  it("a wall cabinet draws its door line and a diagonal", () => {
    expect(segments("wallCabinet", "standard", 0.6, 0.35)).toBeGreaterThanOrEqual(2);
  });
});
