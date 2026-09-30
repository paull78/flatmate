import { describe, expect, it } from "vitest";
import { insetFloor } from "../src/queries/area";

const p = (x: number, y: number) => ({ x, y });

describe("insetFloor", () => {
  it("demo left room: ring (0,0),(3,0),(3,4),(0,4) → 2.8 × 3.8 = 10.64 m²", () => {
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

  it("demo step-5 right room with a sloped wall: ring (3,0),(6,0),(6,3.5),(3,4) → ≈ 9.936 m²", () => {
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
});
