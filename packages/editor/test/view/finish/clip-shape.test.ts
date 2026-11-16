import { describe, expect, it } from "vitest";
import { convexOverlap, pointInPolygon, signedArea } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { clipShape, clipToConvex } from "../../../src/view/finish/clip-shape";
import { clipFloor } from "../../../src/view/finish/clip";
import { onFloor, rect, ringDistance, rng } from "./helpers";

// A filled convex shape against a floor with holes (finishes.13): the floor ring clipped to the shape by
// Sutherland–Hodgman, drawn even-odd; a shape meeting a hole is dropped (step 10's fallback: earcut and clipped holes).

const P = (x: number, y: number): Point => ({ x, y });
/** A diamond (counter-clockwise) centred on c with half-diagonal r. */
const diamond = (c: Point, r: number): Point[] => [P(c.x, c.y - r), P(c.x + r, c.y), P(c.x, c.y + r), P(c.x - r, c.y)];
/** An L: 3 × 3 less its top-right 2 × 2, so the inner corner is (1, 1). */
const ELL = [P(0, 0), P(3, 0), P(3, 1), P(1, 1), P(1, 3), P(0, 3)];

type Ring = readonly Point[];
const area = (ring: Ring): number => Math.abs(signedArea(ring));

/**
 * The oracle, point by point: across the shape's box, p is covered (even-odd) exactly when it lies in the convex shape and
 * on the floor, and the shape meets no hole (the holes here are convex); points within 1e-6 of any edge are skipped.
 * Returns the area it sampled as covered.
 */
function agrees(got: Ring | null, convex: Ring, outer: Ring, holes: readonly Ring[], samples = 4000): number {
  const xs = convex.map((p) => p.x);
  const ys = convex.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const r = rng(5);
  let hits = 0;
  for (let i = 0; i < samples; i++) {
    const p = P(x0 + r() * (x1 - x0), y0 + r() * (y1 - y0));
    const rings = [convex, outer, ...holes, ...(got ? [got] : [])];
    if (rings.some((ring) => ringDistance(p, ring) < 1e-6)) continue;
    const want = pointInPolygon(p, convex) && pointInPolygon(p, outer) && !holes.some((h) => convexOverlap(convex, h, 1e-9));
    expect(got !== null && pointInPolygon(p, got), JSON.stringify(p)).toBe(want);
    if (want) hits++;
  }
  return (hits / samples) * (x1 - x0) * (y1 - y0);
}

/** Every vertex of the clipped ring lies on the floor (spikes dropped: a split ring's bridge never turns off it). */
function verticesOnFloor(got: Ring, outer: Ring, holes: readonly Ring[]): void {
  for (const p of got) expect(onFloor(p, outer, holes, 1e-9), JSON.stringify(p)).toBe(true);
}

describe("clipToConvex", () => {
  it("keeps the part of any ring inside a convex shape of either winding", () => {
    const square = rect(0, 0, 2, 2);
    expect(Math.abs(signedArea(clipToConvex(square, rect(1, 1, 3, 3))))).toBeCloseTo(1, 12);
    expect(Math.abs(signedArea(clipToConvex(square, [...rect(1, 1, 3, 3)].reverse())))).toBeCloseTo(1, 12);
    expect(clipToConvex(square, rect(5, 5, 6, 6))).toEqual([]);
  });
});

describe("clipShape", () => {
  it("a shape inside the floor comes back whole", () => {
    const shape = diamond(P(1, 1), 0.3);
    const got = clipShape(clipFloor(rect(0, 0, 3, 2), []), shape);
    expect(got).toEqual(shape); // exactly, not recomputed by the clipper
  });

  it("a shape across a wall corner of an L room is cut to the floor", () => {
    // Centred on the inner corner: the quarter over the notch goes.
    const shape = diamond(P(1, 1), 0.4);
    const got = clipShape(clipFloor(ELL, []), shape);
    if (!got) throw new Error("expected a shape");
    expect(area(got)).toBeCloseTo(0.75 * 0.32, 12);
    verticesOnFloor(got, ELL, []);
    agrees(got, shape, ELL, []);
  });

  it("a shape across the notch of an L is cut into two pieces, still one even-odd polygon", () => {
    const shape = diamond(P(1.15, 1.15), 0.25); // its left and bottom tips reach the two arms; its middle is in the notch
    const got = clipShape(clipFloor(ELL, []), shape);
    if (!got) throw new Error("expected a shape");
    // Each tip is a triangle 0.1 high and 0.2 wide at the arm's edge.
    expect(area(got)).toBeCloseTo(2 * 0.01, 12);
    verticesOnFloor(got, ELL, []);
    agrees(got, shape, ELL, []);
  });

  it("a shape over a column hole is dropped (the fallback: no shape with a hole reaches earcut)", () => {
    const column = rect(1.2, 0.8, 1.5, 1.1);
    expect(clipShape(clipFloor(rect(0, 0, 3, 2), [column]), rect(1, 0.6, 1.8, 1.4))).toBeNull();
  });

  it("a shape partly over a hole is dropped; one touching it, or beside it, stays whole", () => {
    const column = rect(1.2, 0.8, 1.5, 1.1);
    const floor = clipFloor(rect(0, 0, 3, 2), [column]);
    expect(clipShape(floor, diamond(P(1.2, 0.8), 0.2))).toBeNull(); // centred on the column's corner: a quarter over it
    expect(clipShape(floor, diamond(P(1, 0.95), 0.2))).toEqual(diamond(P(1, 0.95), 0.2)); // its right tip on the column's side
    expect(clipShape(floor, diamond(P(0.9, 0.95), 0.2))).toEqual(diamond(P(0.9, 0.95), 0.2));
  });

  it("drops a shape off the floor, inside a hole, or under 1e-10 m²", () => {
    const column = rect(1.2, 0.8, 1.5, 1.1);
    const floor = clipFloor(rect(0, 0, 3, 2), [column]);
    expect(clipShape(floor, diamond(P(5, 5), 0.2))).toBeNull();
    expect(clipShape(floor, diamond(P(1.35, 0.95), 0.1))).toBeNull();
    expect(clipShape(floor, diamond(P(-0.2, 1), 0.2 + 1e-6))).toBeNull(); // a sliver 1e-12 m²
    expect(clipShape(floor, diamond(P(-0.2, 1), 0.21))).not.toBeNull();
  });

  it("random shapes over random floors with holes agree with the point oracle", () => {
    const r = rng(42);
    for (let n = 0; n < 60; n++) {
      const holes = r() < 0.7 ? [rect(1.1, 0.4, 1.4 + r() * 0.3, 0.7 + r() * 0.3)] : [];
      const outer = r() < 0.5 ? ELL : rect(0, 0, 3, 2);
      const c = P(r() * 3, r() * 3);
      const k = 0.1 + r() * 0.5;
      const t = r() * Math.PI;
      const shape = [0, 1, 2, 3].map((i) => P(c.x + k * Math.cos(t + (i * Math.PI) / 2), c.y + k * Math.sin(t + (i * Math.PI) / 2)));
      const got = clipShape(clipFloor(outer, holes), shape);
      if (got) verticesOnFloor(got, outer, holes);
      const sampled = agrees(got, shape, outer, holes, 1500);
      if (got) expect(Math.abs(area(got) - sampled)).toBeLessThan(0.05 * 2 * k * k + 1e-3);
      if (got && holes.length > 0) expect(holes.some((h) => convexOverlap(shape, h, 1e-9))).toBe(false);
    }
  });
});
