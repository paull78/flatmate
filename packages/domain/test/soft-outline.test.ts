import { describe, expect, it } from "vitest";
import { signedArea } from "../src/geometry";
import { cornerRadius, shapeArea, shapeRing } from "../src/shapes";
import { isConvexCcw } from "./ring-helpers";

// The soft outline (symbols.01): a rounded rectangle, convex and inside the footprint at every size, drawn in straight
// lines like the other shapes. Footprint space: x from −w/2 to w/2, y from −d (front) to 0 (back).

/** Sizes across what a piece can be: thin, small, usual and large. */
const SIZES: readonly [number, number][] = [[0.1, 0.1], [0.1, 10], [10, 0.1], [0.3, 0.3], [0.45, 0.4], [0.6, 0.45], [2, 1], [10, 10]];

const TOL = 1e-9;

describe("soft outline", () => {
  it("is a counter-clockwise convex ring, inside the rectangle and touching its four sides, at every size", () => {
    for (const [w, d] of SIZES) {
      const ring = shapeRing("soft", w, d);
      expect(signedArea(ring), `${w} × ${d}`).toBeGreaterThan(0);
      expect(isConvexCcw(ring), `${w} × ${d} convex`).toBe(true);
      for (const p of ring) {
        expect(Math.abs(p.x), `${w} × ${d} x`).toBeLessThanOrEqual(w / 2 + TOL);
        expect(p.y, `${w} × ${d} back`).toBeLessThanOrEqual(TOL);
        expect(p.y, `${w} × ${d} front`).toBeGreaterThanOrEqual(-d - TOL);
      }
      expect(Math.max(...ring.map((p) => p.x)), `${w} × ${d} right`).toBeCloseTo(w / 2, 9);
      expect(Math.min(...ring.map((p) => p.x)), `${w} × ${d} left`).toBeCloseTo(-w / 2, 9);
      expect(Math.max(...ring.map((p) => p.y)), `${w} × ${d} back side`).toBeCloseTo(0, 9);
      expect(Math.min(...ring.map((p) => p.y)), `${w} × ${d} front side`).toBeCloseTo(-d, 9);
    }
  });

  it("rounds its corners by min(0.06, 20 % of the smaller side)", () => {
    expect(cornerRadius(0.45, 0.4)).toBeCloseTo(0.06, 12);
    expect(cornerRadius(0.2, 1)).toBeCloseTo(0.04, 12);
    expect(cornerRadius(1, 0.1)).toBeCloseTo(0.02, 12);
    // The corner is cut: the rectangle's front-left corner isn't on the ring, and the straight edge starts r in.
    const ring = shapeRing("soft", 0.45, 0.4);
    expect(ring.some((p) => Math.abs(p.x + 0.225) < 1e-9 && Math.abs(p.y + 0.4) < 1e-9)).toBe(false);
    expect(ring.some((p) => Math.abs(p.x + 0.165) < 1e-9 && Math.abs(p.y + 0.4) < 1e-9)).toBe(true);
    expect(ring.some((p) => Math.abs(p.x + 0.225) < 1e-9 && Math.abs(p.y + 0.34) < 1e-9)).toBe(true);
  });

  it("has an area equal to its ring's, less than the rectangle's by about its four corners", () => {
    for (const [w, d] of SIZES) {
      expect(shapeArea("soft", w, d), `${w} × ${d}`).toBeCloseTo(signedArea(shapeRing("soft", w, d)), 9);
    }
    const r = 0.06;
    expect(shapeArea("soft", 0.45, 0.4)).toBeGreaterThan(0.45 * 0.4 - r * r);
    expect(shapeArea("soft", 0.45, 0.4)).toBeLessThan(0.45 * 0.4 - (4 - Math.PI) * r * r);
  });
});
