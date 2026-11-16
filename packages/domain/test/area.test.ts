import { describe, expect, it } from "vitest";
import { signedArea } from "../src/geometry";
import { footprintsFit, holeFootprint, insetFloor } from "../src/queries/area";

const p = (x: number, y: number) => ({ x, y });

describe("insetFloor", () => {
  it("sample left room: ring (0,0),(3,0),(3,4),(0,4) → 2.8 × 3.8 = 10.64 m²", () => {
    const r = insetFloor([p(0, 0), p(3, 0), p(3, 4), p(0, 4)]);
    expect(r?.area).toBeCloseTo(10.64, 9);
    expect(r?.floor.map((q) => ({ x: +q.x.toFixed(9) + 0, y: +q.y.toFixed(9) + 0 }))).toEqual([p(0.1, 0.1), p(2.9, 0.1), p(2.9, 3.9), p(0.1, 3.9)]);
  });

  it("merges collinear boundary vertices (a straight split wall keeps the same area)", () => {
    const plain = insetFloor([p(0, 0), p(6, 0), p(6, 4), p(0, 4)]);
    const split = insetFloor([p(0, 0), p(3, 0), p(6, 0), p(6, 4), p(0, 4)]);
    expect(split?.area).toBeCloseTo(plain?.area ?? 0, 9);
    expect(plain?.area).toBeCloseTo(5.8 * 3.8, 9);
  });

  it("Try it step-5 right room with a sloped wall: ring (3,0),(6,0),(6,3.5),(3,4) → ≈ 9.936 m²", () => {
    const r = insetFloor([p(3, 0), p(6, 0), p(6, 3.5), p(3, 4)]);
    expect(r?.area).toBeCloseTo(9.936, 3);
  });

  it("declines a room too narrow for its walls", () => {
    expect(insetFloor([p(0, 0), p(0.15, 0), p(0.15, 3), p(0, 3)])).toBeNull();
  });

  it("declines a 0.10 m square whose inset flips to a positive-area square (edge-direction check)", () => {
    // Inset lines of a 0.1 m square with 0.1 m offsets meet at a flipped square of positive area;
    // the direction check rejects it (design-memory Don't).
    expect(insetFloor([p(0, 0), p(0.1, 0), p(0.1, 0.1), p(0, 0.1)])).toBeNull();
  });

  it("declines a boundary that folds back on itself", () => {
    expect(insetFloor([p(0, 0), p(4, 0), p(2, 0), p(2, 3)])).toBeNull();
  });

  it("insets each edge by its own wall's half thickness: a 4 × 5 room is 19.1 m² with 0.10 walls, 17.4 m² with 0.30 (AC-23)", () => {
    const ring = [p(0, 0), p(4, 0), p(4, 5), p(0, 5)];
    expect(insetFloor(ring, [0.05, 0.05, 0.05, 0.05])?.area).toBeCloseTo(3.9 * 4.9, 9);
    expect(insetFloor(ring, [0.15, 0.15, 0.15, 0.15])?.area).toBeCloseTo(3.7 * 4.7, 9);
    expect((3.9 * 4.9).toFixed(1)).toBe("19.1");
    expect((3.7 * 4.7).toFixed(1)).toBe("17.4");
    // Bottom and right walls 0.10, top and left 0.30: 4 − 0.05 − 0.15 by 5 − 0.05 − 0.15.
    expect(insetFloor(ring, [0.05, 0.05, 0.15, 0.15])?.area).toBeCloseTo(3.8 * 4.8, 9);
  });

  it("keeps a step where two collinear edges differ in thickness instead of merging them", () => {
    // Bottom side split at (2, 0): 0.30 from (0, 0) to (2, 0), 0.10 from (2, 0) to (4, 0); other walls 0.20.
    const r = insetFloor([p(0, 0), p(2, 0), p(4, 0), p(4, 3), p(0, 3)], [0.15, 0.05, 0.1, 0.1, 0.1]);
    const round = (q: { x: number; y: number }) => ({ x: +q.x.toFixed(9) + 0, y: +q.y.toFixed(9) + 0 });
    expect(r?.floor.map(round)).toEqual([p(0.1, 0.15), p(2, 0.15), p(2, 0.05), p(3.9, 0.05), p(3.9, 2.9), p(0.1, 2.9)]);
    expect(r?.area).toBeCloseTo(3.8 * 2.75 + 1.9 * 0.1, 9);
  });

  it("still merges collinear edges of equal thickness", () => {
    const split = insetFloor([p(0, 0), p(3, 0), p(6, 0), p(6, 4), p(0, 4)], [0.05, 0.05, 0.1, 0.1, 0.1]);
    expect(split?.floor).toHaveLength(4);
    expect(split?.area).toBeCloseTo(5.8 * 3.85, 9);
  });
});

describe("holeFootprint", () => {
  const round = (q: { x: number; y: number }) => ({ x: +q.x.toFixed(9) + 0, y: +q.y.toFixed(9) + 0 });
  const core = [p(3.5, 2.5), p(3.5, 5.5), p(6.5, 5.5), p(6.5, 2.5)]; // core C's outline, clockwise
  const halves = (n: number, h: number): number[] => Array.from({ length: n }, () => h);

  it("outsets a clockwise outline: core C → 3.2 × 3.2 = 10.24", () => {
    const r = holeFootprint(core, halves(4, 0.1));
    expect(r?.area).toBeCloseTo(10.24, 9);
    expect(signedArea(r?.footprint ?? [])).toBeLessThan(0);
    expect(r?.footprint.map(round)).toEqual([p(3.4, 2.4), p(3.4, 5.6), p(6.6, 5.6), p(6.6, 2.4)]);
  });

  it("column K with 0.10 walls → 0.49", () => {
    expect(holeFootprint([p(4.7, 3.7), p(4.7, 4.3), p(5.3, 4.3), p(5.3, 3.7)], halves(4, 0.05))?.area).toBeCloseTo(0.49, 9);
  });

  it("uses each wall's own thickness: a 0.40 left wall → 3.3 × 3.2 = 10.56", () => {
    // Edge 0 runs up the left side.
    expect(holeFootprint(core, [0.2, 0.1, 0.1, 0.1])?.area).toBeCloseTo(3.3 * 3.2, 9);
  });

  it("of an L-shaped outline → 2.2 × 1.2 + 1.2 × 1.0 = 3.84", () => {
    const l = [p(2, 2), p(2, 4), p(3, 4), p(3, 3), p(4, 3), p(4, 2)];
    expect(holeFootprint(l, halves(6, 0.1))?.area).toBeCloseTo(3.84, 9);
  });

  it("of two squares touching at a corner → 2 × 1.44 − 0.04 = 2.84", () => {
    // The outline passes (3, 3) twice; the outset is a simple polygon, so no special case is needed.
    const two = [p(2, 2), p(2, 3), p(3, 3), p(3, 4), p(4, 4), p(4, 3), p(3, 3), p(3, 2)];
    expect(holeFootprint(two, halves(8, 0.1))?.area).toBeCloseTo(2.84, 9);
  });

  it("each function rejects the other orientation", () => {
    expect(insetFloor(core, halves(4, 0.1))).toBeNull();
    expect(holeFootprint([p(0, 0), p(4, 0), p(4, 3), p(0, 3)], halves(4, 0.1))).toBeNull();
  });
});

describe("footprintsFit", () => {
  // A U-shaped floor 6 × 4 with a 2 × 2 notch open at the top.
  const u = [p(0, 0), p(6, 0), p(6, 4), p(4, 4), p(4, 2), p(2, 2), p(2, 4), p(0, 4)];

  it("refuses a footprint whose edge bridges the notch although all its corners sit in the floor", () => {
    expect(footprintsFit(u, [[p(1, 2.2), p(1, 2.5), p(5, 2.5), p(5, 2.2)]])).toBe(false);
    expect(footprintsFit(u, [[p(1, 1.5), p(1, 2), p(5, 2), p(5, 1.5)]])).toBe(true); // flush with the notch's bottom
  });

  it("refuses two footprints of equal height that overlap side by side; accepts them touching", () => {
    const sq = (x0: number, x1: number) => [p(x0, 0.5), p(x0, 1.5), p(x1, 1.5), p(x1, 0.5)];
    expect(footprintsFit(u, [sq(0.5, 2.5), sq(2.4, 4)])).toBe(false);
    expect(footprintsFit(u, [sq(0.5, 2.5), sq(2.5, 4)])).toBe(true);
  });
});
