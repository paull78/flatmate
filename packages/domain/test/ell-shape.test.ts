import { describe, expect, it } from "vitest";
import type { Point } from "@fm/protocol";
import { rotateAbout, signedArea } from "../src/geometry";
import type { Outline } from "../src/kinds";
import { pieceShape, placedPiece, shapeArea, shapeRing } from "../src/shapes";

// The `L` outline (catalog.16, .17): one six-corner outline that draws, and two convex parts that fit. Footprint space:
// back edge y = 0, front y = −d, left x = −w/2.

const expectPoints = (got: readonly Point[], want: [number, number][]) => {
  expect(got).toHaveLength(want.length);
  want.forEach(([x, y], i) => {
    expect(got[i]?.x, `point ${i} x`).toBeCloseTo(x, 12);
    expect(got[i]?.y, `point ${i} y`).toBeCloseTo(y, 12);
  });
};

/** Every turn of a counter-clockwise ring is a left turn (or straight). */
const isConvexCcw = (ring: readonly Point[]): boolean =>
  ring.every((a, i) => {
    const b = ring[(i + 1) % ring.length] ?? a;
    const c = ring[(i + 2) % ring.length] ?? a;
    return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) >= -1e-12;
  });

describe("the ell outline and its parts (catalog.17)", () => {
  const arms = { back: 0.6, left: 0.6 };

  it("the corner desk's outline is the six points of catalog.17, counter-clockwise from the front-left", () => {
    const { outline } = pieceShape("cornerDesk", 1.6, 1.2, arms);
    expectPoints(outline, [[-0.8, -1.2], [-0.2, -1.2], [-0.2, -0.6], [0.8, -0.6], [0.8, 0], [-0.8, 0]]);
    expect(signedArea(outline)).toBeGreaterThan(0);
  });

  it("the parts are the back arm and the left arm below it: convex, sharing one edge, 1.32 m² together", () => {
    const { parts } = pieceShape("cornerDesk", 1.6, 1.2, arms);
    expect(parts).toHaveLength(2);
    const [back, left] = parts;
    if (!back || !left) throw new Error("two parts");
    expectPoints(back, [[-0.8, -0.6], [0.8, -0.6], [0.8, 0], [-0.8, 0]]);
    expectPoints(left, [[-0.8, -1.2], [-0.2, -1.2], [-0.2, -0.6], [-0.8, -0.6]]);
    for (const p of parts) {
      expect(signedArea(p)).toBeGreaterThan(0);
      expect(isConvexCcw(p)).toBe(true);
    }
    // Disjoint but for the seam: the left arm's top is y = −0.6, the back arm's bottom.
    expect(Math.max(...left.map((p) => p.y))).toBeCloseTo(Math.min(...back.map((p) => p.y)), 12);
    expect(signedArea(back) + signedArea(left)).toBeCloseTo(1.32, 12);
    expect(shapeArea("ell", 1.6, 1.2, arms)).toBeCloseTo(1.32, 12);
    expect(signedArea(pieceShape("cornerDesk", 1.6, 1.2, arms).outline)).toBeCloseTo(1.32, 12);
  });

  it("without arms, the corner desk takes its kind's default arms", () => {
    expect(pieceShape("cornerDesk", 1.6, 1.2)).toEqual(pieceShape("cornerDesk", 1.6, 1.2, arms));
  });

  it("today's outlines: parts is [outline], and the outline is today's shapeRing (frozen)", () => {
    const cases: [string, Outline][] = [["bed", "rect"], ["roundTable", "round"], ["cornerShower", "quarter"], ["cornerBasin", "corner"]];
    for (const [kind, o] of cases) {
      for (const [w, d] of [[1.2, 0.6], [0.8, 0.8], [0.1, 0.1]] as const) {
        const shape = pieceShape(kind, w, d);
        expect(shape.outline, `${kind} ${w}×${d}`).toEqual(shapeRing(o, w, d));
        expect(shape.parts, `${kind} ${w}×${d}`).toEqual([shape.outline]);
      }
    }
  });

  it("placedPiece turns the outline and both parts about `at`", () => {
    const at = { x: 3, y: 2 };
    const local = pieceShape("cornerDesk", 1.6, 1.2, arms);
    const placed = placedPiece("cornerDesk", at, 1.6, 1.2, 90, arms);
    const move = (ring: readonly Point[]) => ring.map((p) => rotateAbout({ x: p.x + at.x, y: p.y + at.y }, at, 90));
    expect(placed.outline).toEqual(move(local.outline));
    expect(placed.parts).toEqual(local.parts.map(move));
    // At 90° the front-left corner (−0.8, −1.2) lands at (3 + 1.2, 2 − 0.8).
    expect(placed.outline[0]?.x).toBeCloseTo(4.2, 12);
    expect(placed.outline[0]?.y).toBeCloseTo(1.2, 12);
  });
});
