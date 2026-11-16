import { describe, expect, it } from "vitest";
import type { Point } from "@fm/protocol";
import type { Outline } from "../src/kinds";
import { footprintQuad } from "../src/queries/footprints";
import { outlineOf, shapeRing } from "../src/shapes";

// The four outline shapes inside a w × d footprint (furnish.12, .18, .22; moved from the editor, shapefit.01): footprint
// space, back edge y = 0, front y = −d, left x = −w/2.

const OUTLINES: readonly Outline[] = ["rect", "round", "quarter", "corner"];

const expectPoints = (got: readonly Point[], want: [number, number][], digits: number) => {
  expect(got).toHaveLength(want.length);
  want.forEach(([x, y], i) => {
    expect(got[i]?.x, `point ${i} x`).toBeCloseTo(x, digits);
    expect(got[i]?.y, `point ${i} y`).toBeCloseTo(y, digits);
  });
};

/** The shoelace area: positive for a counter-clockwise ring. */
const signedArea = (ring: readonly Point[]): number =>
  ring.reduce((t, a, i) => {
    const b = ring[(i + 1) % ring.length] ?? a;
    return t + (a.x * b.y - b.x * a.y) / 2;
  }, 0);

describe("outline shapes (furnish.12, .22)", () => {
  it("rect ring is the footprint rectangle", () => {
    expect(shapeRing("rect", 1.2, 0.6)).toEqual(footprintQuad({ x: 0, y: 0 }, 1.2, 0.6, 0));
    expectPoints(shapeRing("rect", 1.2, 0.6), [[-0.6, -0.6], [0.6, -0.6], [0.6, 0], [-0.6, 0]], 12);
  });

  it("round ring is an inscribed ellipse of 32 points", () => {
    const circle = shapeRing("round", 0.9, 0.9);
    expect(circle).toHaveLength(32);
    for (const p of circle) expect(Math.hypot(p.x, p.y + 0.45)).toBeCloseTo(0.45, 9);
    const ellipse = shapeRing("round", 1.2, 0.6);
    expectPoints(ellipse.slice(0, 1), [[0.6, -0.3]], 9);
    for (const p of ellipse) expect((p.x / 0.6) ** 2 + ((p.y + 0.3) / 0.3) ** 2).toBeCloseTo(1, 9);
    // Radii from w and d separately: a radius of min(w, d)/2 would stop at x 0.3.
    expect(Math.max(...ellipse.map((p) => p.x))).toBeCloseTo(0.6, 9);
    expect(Math.min(...ellipse.map((p) => p.y))).toBeCloseTo(-0.6, 9);
    expect(Math.max(...ellipse.map((p) => p.y))).toBeCloseTo(0, 9);
  });

  it("quarter ring has its right angle at back-left", () => {
    const q = shapeRing("quarter", 0.8, 0.8);
    expect(q).toHaveLength(10);
    expectPoints([q[0], q[1], q.at(-1)].flatMap((p) => (p ? [p] : [])), [[-0.4, 0], [-0.4, -0.8], [0.4, 0]], 9);
    for (const p of q.slice(1)) expect(Math.hypot(p.x + 0.4, p.y)).toBeCloseTo(0.8, 9);
    for (const p of shapeRing("quarter", 1.2, 0.6).slice(1)) expect(((p.x + 0.6) / 1.2) ** 2 + (p.y / 0.6) ** 2).toBeCloseTo(1, 9);
  });

  it("corner ring is back-left, front-left, back-right", () => {
    expectPoints(shapeRing("corner", 0.45, 0.45), [[-0.225, 0], [-0.225, -0.45], [0.225, 0]], 12);
  });

  it("every ring is counter-clockwise, inside its rectangle and touches all four sides", () => {
    for (const o of OUTLINES) {
      for (const [w, d] of [[0.6, 0.6], [1.2, 0.6], [0.1, 0.1], [10, 0.1]] as const) {
        const ring = shapeRing(o, w, d);
        const where = `${o} ${w}×${d}`;
        expect(signedArea(ring), where).toBeGreaterThan(0);
        for (const p of ring) {
          expect(p.x >= -w / 2 - 1e-9 && p.x <= w / 2 + 1e-9 && p.y >= -d - 1e-9 && p.y <= 1e-9, `${where} (${p.x}, ${p.y})`).toBe(true);
        }
        const xs = ring.map((p) => p.x);
        const ys = ring.map((p) => p.y);
        expect(Math.min(...xs), where).toBeCloseTo(-w / 2, 9);
        expect(Math.max(...xs), where).toBeCloseTo(w / 2, 9);
        expect(Math.min(...ys), where).toBeCloseTo(-d, 9);
        expect(Math.max(...ys), where).toBeCloseTo(0, 9);
      }
    }
    expect(signedArea(shapeRing("rect", 1.2, 0.6))).toBeCloseTo(0.72, 5);
    expect(signedArea(shapeRing("round", 0.6, 0.6))).toBeCloseTo(0.28093, 5); // 16·sin(π/16)·rx·ry
    expect(signedArea(shapeRing("round", 1.2, 0.6))).toBeCloseTo(0.56186, 5);
    expect(signedArea(shapeRing("quarter", 0.8, 0.8))).toBeCloseTo(0.499431, 5); // 4·sin(π/16)·w·d
    expect(signedArea(shapeRing("corner", 0.45, 0.45))).toBeCloseTo(0.10125, 5);
  });

  it("outlineOf reads the kinds column", () => {
    expect(outlineOf("roundBlock")).toBe("round");
    expect(outlineOf("cornerBlock")).toBe("corner");
    expect(outlineOf("bed")).toBe("rect");
    expect(outlineOf("constructor")).toBe("rect");
    expect(outlineOf("piano")).toBe("rect");
  });
});
