import { describe, expect, it } from "vitest";
import type { Point } from "@fm/protocol";
import { furnitureSymbol, objectLook } from "../src/view/furniture";
import { shapeFront } from "../src/view/shapes";

// The front lines of the four outline shapes (furnish.12, .22); the rings themselves are tested in the domain
// (shapefit.01). Footprint space: back edge y = 0, front y = −d, left x = −w/2.

const expectPoints = (got: readonly Point[], want: [number, number][], digits: number) => {
  expect(got).toHaveLength(want.length);
  want.forEach(([x, y], i) => {
    expect(got[i]?.x, `point ${i} x`).toBeCloseTo(x, digits);
    expect(got[i]?.y, `point ${i} y`).toBeCloseTo(y, digits);
  });
};

describe("outline fronts (furnish.12, .22)", () => {
  it("front follows the shape", () => {
    expectPoints(shapeFront("rect", 1.2, 0.6), [[-0.6, -0.6], [0.6, -0.6]], 12);
    expectPoints(shapeFront("corner", 0.45, 0.45), [[-0.225, -0.45], [0.225, 0]], 12);
    const quarter = shapeFront("quarter", 0.8, 0.8);
    expect(quarter).toHaveLength(9);
    expectPoints([quarter[0], quarter.at(-1)].flatMap((p) => (p ? [p] : [])), [[-0.4, -0.8], [0.4, 0]], 9);
    const round = shapeFront("round", 0.6, 0.6);
    expect(round).toHaveLength(17);
    expectPoints([round[0], round.at(-1)].flatMap((p) => (p ? [p] : [])), [[-0.3, -0.3], [0.3, -0.3]], 9);
    for (const p of round) expect(p.y).toBeLessThanOrEqual(-0.3 + 1e-9);
  });

  it("an ell's front is its two inner edges, the outline's second to fourth points (catalog.17)", () => {
    expectPoints(shapeFront("ell", 1.6, 1.2, { back: 0.6, left: 0.6 }), [[-0.2, -1.2], [-0.2, -0.6], [0.8, -0.6]], 12);
  });
});

// The corner desk's minimal symbol (catalog.17, .21): the L outline and the mitre from the inner corner to the outer
// back-left corner; its heavier front line runs along the two inner edges.
describe("the corner desk symbol", () => {
  const segs = (ps: ReturnType<typeof furnitureSymbol>) => ps.flatMap((p) => (p.kind === "segment" ? [[p.a.x, p.a.y, p.b.x, p.b.y].map((v) => Math.round(v * 1e9) / 1e9)] : []));

  it("draws the six-corner outline and the mitre", () => {
    expect(segs(furnitureSymbol("cornerDesk", "standard", 1.6, 1.2))).toEqual([
      [-0.8, -1.2, -0.2, -1.2], [-0.2, -1.2, -0.2, -0.6], [-0.2, -0.6, 0.8, -0.6], [0.8, -0.6, 0.8, 0], [0.8, 0, -0.8, 0], [-0.8, 0, -0.8, -1.2],
      [-0.2, -0.6, -0.8, 0],
    ]);
  });

  it("draws its heavier front along the two inner edges", () => {
    const look = objectLook("cornerDesk", "standard", 1.6, 1.2, { line: "L", frontPx: 3 });
    const front = look.filter((p) => p.kind === "segment" && "px" in p.width && p.width.px === 3);
    expect(segs(front)).toEqual([[-0.2, -1.2, -0.2, -0.6], [-0.2, -0.6, 0.8, -0.6]]);
  });
});
