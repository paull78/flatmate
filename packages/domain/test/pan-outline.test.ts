import { describe, expect, it } from "vitest";
import { signedArea } from "../src/geometry";
import { cornerRadius, shapeArea, shapeRing } from "../src/shapes";
import { isConvexCcw } from "./ring-helpers";

// The pan outline (symbols.01): a flat back with rounded corners and a full front, convex and inside the footprint at
// every size. Footprint space: x from −w/2 to w/2, y from −d (front) to 0 (back).

const SIZES: readonly [number, number][] = [[0.1, 0.1], [0.1, 10], [10, 0.1], [0.36, 0.54], [0.4, 0.65], [0.45, 0.6], [2, 1], [10, 10]];
const TOL = 1e-9;

describe("pan outline", () => {
  it("is a counter-clockwise convex ring, inside the rectangle and touching its four sides, at every size", () => {
    for (const [w, d] of SIZES) {
      const ring = shapeRing("pan", w, d);
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

  it("has a straight back between its rounded corners, so it sits flush on a wall", () => {
    const [w, d] = [0.36, 0.54];
    const r = cornerRadius(w, d);
    const back = shapeRing("pan", w, d).filter((p) => Math.abs(p.y) < 1e-9).map((p) => p.x).sort((a, b) => a - b);
    expect(back).toHaveLength(2);
    expect(back[0]).toBeCloseTo(-w / 2 + r, 9);
    expect(back[1]).toBeCloseTo(w / 2 - r, 9);
  });

  it("is symmetric, and its front is full: at half the depth it is still nearly the whole width", () => {
    const [w, d] = [0.36, 0.54];
    const ring = shapeRing("pan", w, d);
    for (const p of ring) expect(ring.some((q) => Math.abs(q.x + p.x) < 1e-9 && Math.abs(q.y - p.y) < 1e-9), `${p.x}, ${p.y}`).toBe(true);
    const widest = Math.max(...ring.filter((p) => p.y < -d * 0.7).map((p) => p.x));
    expect(widest).toBeGreaterThan(0.33 * w); // a plain half ellipse would be narrower here, a rectangle would be 0.5 w
    expect(widest).toBeLessThan(0.5 * w);
  });

  it("has an area equal to its ring's", () => {
    for (const [w, d] of SIZES) expect(shapeArea("pan", w, d), `${w} × ${d}`).toBeCloseTo(signedArea(shapeRing("pan", w, d)), 9);
    expect(shapeArea("pan", 0.36, 0.54)).toBeLessThan(0.36 * 0.54);
  });
});
