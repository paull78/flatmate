import { describe, expect, it } from "vitest";
import { metres, shown, shownCm, toMm } from "../src/format";
import { roundMm } from "../src/queries/footprints";
import { cutAt } from "../src/queries/vertical";
import { rectDoc } from "./helpers";

// One way to show a number (cleanup.13, AC-15): round to 0.1 mm first, which drops float noise (2.675 is stored as
// 2.67499…), then to the shown digits with halves away from zero.

describe("shown", () => {
  it("rounds halves away from zero after dropping float noise", () => {
    expect(shown(2.675)).toBe("2.68");
    expect(shown(2.6745)).toBe("2.67"); // a real 2.6745 is under the half: not rounded twice
    expect(shown(-2.675)).toBe("-2.68");
    expect(shown(1.295)).toBe("1.30");
    expect(shown(0.005)).toBe("0.01");
    expect(shown(10)).toBe("10.00");
    expect(shown(12.345, 1)).toBe("12.3");
    expect(shown(12.35, 1)).toBe("12.4");
    expect(shown(-0.001)).toBe("0.00"); // never "-0.00"
    expect((2.675).toFixed(2)).toBe("2.67"); // the float fact the rule exists for
  });

  it("shownCm is the centimetre the text shows; toMm the millimetre", () => {
    expect(shownCm(1.295)).toBe(130);
    expect(shownCm(1.2949)).toBe(129);
    expect(shownCm(-2.675)).toBe(-268);
    // Values whose float sits just under the half: plain Math.round(v * 100) reads them a centimetre short.
    expect([1.005, 0.285, 2.105, 3.045].map(shownCm)).toEqual([101, 29, 211, 305]);
    expect(shown(1.385 - 1.1)).toBe("0.29"); // 0.28499… in floats
    expect(toMm(2.6745)).toBe(2675);
    expect(toMm(0.0004)).toBe(0);
  });

  it("roundMm and toMm are one exact millimetre rule; the cut of a loft at 2.001 under 2.50 is 2.250 (cleanup.40)", () => {
    for (const v of [5.3444984, 2.0005, 1.0049999, 0.0004, 2.6745]) expect(roundMm(v) * 1000, String(v)).toBeCloseTo(toMm(v), 9);
    // Geometry rounds exactly: 5,344.4984 mm is 5,344 mm (the display's noise step would give 5,345).
    expect(toMm(5.3444984)).toBe(5344);
    expect(roundMm(5.3444984)).toBe(5.344);
    expect(cutAt(rectDoc(0, 0, 4, 3), 2.001)).toBe(2.25); // 2.001 + 0.2495, as before the cycle
  });

  it("metres prints limits under 10 m with two decimals and whole metres from 10 up", () => {
    expect(metres(0.05)).toBe("0.05");
    expect(metres(2)).toBe("2.00");
    expect(metres(10)).toBe("10");
  });
});
