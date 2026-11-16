import { describe, expect, it } from "vitest";
import { gripRotation, rotationTowards } from "../src/snapping/rotation";

// The rotation grip's angle (direct.05, direct.17, direct.18): a near wall's angle (plus multiples of 90°) within 3°
// wins, else the 15° step; Ctrl takes any whole degree. Always a whole degree in [0, 360).
describe("rotation-snap", () => {
  it("rotationTowards gives the front's direction", () => {
    const c = { x: 0, y: 0 };
    const cases: [{ x: number; y: number }, number][] = [[{ x: 0, y: -1 }, 0], [{ x: 1, y: 0 }, 90], [{ x: 0, y: 1 }, 180], [{ x: -1, y: 0 }, 270]];
    for (const [p, deg] of cases) {
      const r = rotationTowards(c, p);
      expect(r).toBeCloseTo(deg, 9);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(360);
    }
  });

  it("a wall within 3° wins over the 15° step", () => {
    expect(gripRotation(22, [20], false)).toBe(20);
    expect(gripRotation(18, [20], false)).toBe(20);
    expect(gripRotation(23, [20], false)).toBe(20); // exactly 3° counts as within
  });

  it("beyond 3° the 15° step applies", () => {
    expect(gripRotation(24, [20], false)).toBe(30);
    expect(gripRotation(23.5, [20], false)).toBe(30);
    expect(gripRotation(22, [], false)).toBe(15);
    expect(gripRotation(37, [30], false)).toBe(30);
  });

  it("a wall gives its angle plus multiples of 90°", () => {
    expect(gripRotation(112, [20], false)).toBe(110);
    expect(gripRotation(292, [20], false)).toBe(290);
  });

  it("wraps around 0°", () => {
    expect(gripRotation(359, [0], false)).toBe(0);
    // A wall is measured round the circle: the 15° step would give 0 in both cases.
    expect(gripRotation(1, [178], false)).toBe(358);
    expect(gripRotation(359, [1], false)).toBe(1);
    expect(gripRotation(-10, [], false)).toBe(345);
    expect(gripRotation(358.5, [], false)).toBe(0);
  });

  it("free (Ctrl) is whole degrees and ignores walls and steps", () => {
    expect(gripRotation(37.4, [30], true)).toBe(37);
    expect(gripRotation(-0.6, [], true)).toBe(359);
  });

  it("always a whole degree in [0, 360)", () => {
    for (let raw = -720; raw <= 720; raw += 0.7) {
      for (const walls of [[20], []]) {
        for (const free of [true, false]) {
          const r = gripRotation(raw, walls, free);
          expect(Number.isInteger(r), `${raw} ${walls} ${free} → ${r}`).toBe(true);
          expect(r).toBeGreaterThanOrEqual(0);
          expect(r).toBeLessThan(360);
        }
      }
    }
  });
});
