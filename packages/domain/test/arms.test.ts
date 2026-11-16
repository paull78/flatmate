import { describe, expect, it } from "vitest";
import { MIN_ARM, armsFit, armsFor, armsOf, parseArms } from "../src/arms";
import { pieceShape } from "../src/shapes";

// An `L` piece's arms (catalog.17, .19): t1 (back) and t2 (left), each at least 0.10 m and 0.10 m shallower than the
// side it runs across.

describe("armsFit", () => {
  it("accepts 0.10 and d − 0.10 (and w − 0.10), refuses 0.0999 and d − 0.0999", () => {
    expect(MIN_ARM).toBe(0.1);
    const [w, d] = [1.6, 1.2];
    expect(armsFit({ back: 0.1, left: 0.1 }, w, d)).toBe(true);
    expect(armsFit({ back: d - 0.1, left: w - 0.1 }, w, d)).toBe(true);
    expect(armsFit({ back: 0.0999, left: 0.6 }, w, d)).toBe(false);
    expect(armsFit({ back: 0.6, left: 0.0999 }, w, d)).toBe(false);
    expect(armsFit({ back: d - 0.0999, left: 0.6 }, w, d)).toBe(false);
    expect(armsFit({ back: 0.6, left: w - 0.0999 }, w, d)).toBe(false);
  });
});

describe("parseArms", () => {
  it("takes exactly back and left, finite numbers, as a fresh object", () => {
    const v = { back: 0.6, left: 0.5 };
    const parsed = parseArms(v);
    expect(parsed).toEqual(v);
    expect(parsed).not.toBe(v);
  });

  it("refuses missing keys, extra keys, strings and NaN", () => {
    for (const bad of [{ back: 0.6 }, { left: 0.6 }, {}, { back: 0.6, left: 0.6, extra: 1 }, { back: "0.6", left: 0.6 }, { back: 0.6, left: Number.NaN }, { back: Infinity, left: 0.6 }, "0.6", null, undefined, [0.6, 0.6]]) {
      expect(parseArms(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("armsFor (catalog.19)", () => {
  it("at 10 × 10 the corner desk takes its kind's 0.60 arms", () => {
    expect(armsFor("cornerDesk", 10, 10)).toEqual({ back: 0.6, left: 0.6 });
  });

  it("keeps given arms that fit", () => {
    expect(armsFor("cornerDesk", 1.6, 1.2, { back: 0.5, left: 0.7 })).toEqual({ back: 0.5, left: 0.7 });
  });

  it("at 0.10 × 0.10 the outline stays inside the footprint", () => {
    const arms = armsFor("cornerDesk", 0.1, 0.1);
    expect(arms.back).toBeGreaterThan(0);
    expect(arms.left).toBeGreaterThan(0);
    expect(arms.back).toBeLessThan(0.1);
    expect(arms.left).toBeLessThan(0.1);
    for (const p of pieceShape("cornerDesk", 0.1, 0.1).outline) {
      expect(p.x >= -0.05 - 1e-12 && p.x <= 0.05 + 1e-12 && p.y >= -0.1 - 1e-12 && p.y <= 1e-12, `(${p.x}, ${p.y})`).toBe(true);
    }
  });

  it("clamps arms too deep for the footprint so the shape keeps its six corners inside it", () => {
    for (const [w, d] of [[0.1, 0.1], [0.15, 0.3], [0.6, 0.6], [1.6, 1.2], [10, 0.1]] as const) {
      const arms = armsFor("cornerDesk", w, d, { back: 5, left: 5 });
      expect(arms.back, `${w}×${d}`).toBeLessThan(d);
      expect(arms.left, `${w}×${d}`).toBeLessThan(w);
      expect(arms.back, `${w}×${d}`).toBeGreaterThan(0);
      expect(arms.left, `${w}×${d}`).toBeGreaterThan(0);
    }
    const deep = armsFor("cornerDesk", 1.6, 1.2, { back: 5, left: 5 });
    expect(deep.back).toBeCloseTo(1.1, 12);
    expect(deep.left).toBeCloseTo(1.5, 12);
  });
});

describe("armsOf", () => {
  it("reads an object's stored arms, else its kind's default, else none", () => {
    expect(armsOf({ kind: "cornerDesk", arms: { back: 0.4, left: 0.5 } })).toEqual({ back: 0.4, left: 0.5 });
    expect(armsOf({ kind: "cornerDesk" })).toEqual({ back: 0.6, left: 0.6 });
    expect(armsOf({ kind: "desk" })).toBeNull();
    expect(armsOf({ kind: "piano" })).toBeNull();
  });
});
